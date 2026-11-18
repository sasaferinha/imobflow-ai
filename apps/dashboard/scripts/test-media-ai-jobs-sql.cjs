const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');

// Actual migrations in isolated PostgreSQL/WASM. No remote DB, credentials,
// provider requests, billing, or real customer/property mutations.
(async () => {
  const db = await createDatabase();
  try {
    for (const name of fs.readdirSync(path.resolve(__dirname, '../../../supabase/migrations'))
      .filter(name => name.endsWith('.sql') && name > isolationMigration).sort()) {
      await db.exec(migration(name));
    }
    await seedCompanies(db);
    const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
    const count = () => scalar('SELECT count(*)::int FROM media_ai_jobs');
    const reserve = (overrides = {}) => {
      const request = { company: id(1), actor: id(11), request: id(1000), hash: 'a'.repeat(64),
        kind: 'photo', property: 'demo-casa-jardim', index: 0, format: 'landscape', provider: 'openai', model: 'image-model', ...overrides };
      return scalar('SELECT reserve_media_ai_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', Object.values(request));
    };
    const claim = (job, company = id(1), actor = id(11)) => scalar('SELECT claim_media_ai_job($1,$2,$3)', [company, actor, job]);
    const bucket = (await db.query("SELECT * FROM storage.buckets WHERE id='media-ai'")).rows[0];
    assert.equal(bucket.public, false);
    assert.equal(bucket.file_size_limit, 30_000_000);
    assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);
    for (const table of ['media_ai_entitlements', 'media_ai_jobs']) {
      const flags = (await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [table])).rows[0];
      assert.deepEqual(flags, { relrowsecurity: true, relforcerowsecurity: true });
      for (const role of ['anon', 'authenticated']) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3)', [role, table, privilege]), false);
        }
      }
    }
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await assert.rejects(() => reserve(), /permission denied/);
        await assert.rejects(() => claim(id(12345)), /permission denied/);
        await assert.rejects(() => db.query('SELECT * FROM media_ai_jobs'), /permission denied/);
        await assert.rejects(() => db.query('INSERT INTO media_ai_entitlements(company_id,enabled) VALUES($1,true)', [id(1)]), /permission denied/);
      } finally { await db.exec('RESET ROLE'); }
    }
    await assert.rejects(() => reserve(), /media_not_enabled/, 'nothing is implicitly enabled for an owner');
    await db.query('INSERT INTO media_ai_entitlements(company_id) VALUES($1),($2)', [id(1), id(2)]);
    assert.deepEqual((await db.query('SELECT enabled,photo_enabled,video_enabled,photo_daily_limit,video_daily_limit FROM media_ai_entitlements WHERE company_id=$1', [id(1)])).rows[0],
      { enabled: false, photo_enabled: true, video_enabled: false, photo_daily_limit: 3, video_daily_limit: 1 });
    await assert.rejects(() => reserve(), /media_not_enabled/);
    for (const value of [0, 11]) {
      await assert.rejects(() => db.query('UPDATE media_ai_entitlements SET photo_daily_limit=$1', [value]), /check constraint/);
      await assert.rejects(() => db.query('UPDATE media_ai_entitlements SET video_daily_limit=$1', [value]), /check constraint/);
    }
    await db.exec('SET ROLE service_role');
    await db.query('UPDATE media_ai_entitlements SET enabled=true');
    await db.exec('RESET ROLE');
    await assert.rejects(() => reserve({ actor: id(21) }), /media_forbidden/, 'owner of B cannot spend quota of A');
    await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,'Corretor','corretor','scrypt-v1$fixture','broker',true,'broker@example.test','broker@example.test')", [id(12), id(1)]);
    await assert.rejects(() => reserve({ actor: id(12) }), /media_forbidden/);
    await db.query('UPDATE broker_accounts SET active=false WHERE id=$1', [id(11)]);
    await assert.rejects(() => reserve(), /media_forbidden/);
    await db.query('UPDATE broker_accounts SET active=true WHERE id=$1', [id(11)]);
    await assert.rejects(() => reserve({ kind: 'video', provider: 'runway', model: 'gen4_turbo' }), /media_feature_disabled/);
    await db.query('UPDATE media_ai_entitlements SET photo_enabled=false WHERE company_id=$1', [id(1)]);
    await assert.rejects(() => reserve(), /media_feature_disabled/);
    await db.query('UPDATE media_ai_entitlements SET photo_enabled=true WHERE company_id=$1', [id(1)]);
    for (const invalid of [
      { company: null }, { actor: null }, { request: null }, { hash: null }, { hash: 'A'.repeat(64) }, { hash: 'a'.repeat(63) },
      { kind: 'audio' }, { kind: null }, { property: id(301) }, { property: 'demo-other' }, { property: null },
      { index: -1 }, { index: 3 }, { index: null }, { property: 'demo-casa-verde', index: 2 },
      { format: 'square' }, { format: null }, { provider: 'runway' }, { provider: null }, { model: 'https://example.test' }, { model: null },
    ]) await assert.rejects(() => reserve(invalid), /media_invalid_request/);
    assert.equal(await count(), 0);

    await db.exec('SET ROLE service_role');
    const first = await reserve();
    await db.exec('RESET ROLE');
    assert.equal(first.reused, false);
    assert.equal(first.job.status, 'reserved');
    assert.equal(first.job.company_id, id(1));
    assert.equal(first.job.actor_id, id(11));
    assert.equal(first.job.purged_at, null);
    assert(Number.isFinite(Date.parse(first.job.poll_after)));
    assert.equal(Date.parse(first.job.expires_at) - Date.parse(first.job.created_at), 7 * 24 * 60 * 60 * 1000);
    const retries = await Promise.all(Array.from({ length: 5 }, () => reserve()));
    assert(retries.every(retry => retry.reused && retry.job.id === first.job.id));
    assert.equal(await count(), 1, 'request retries consume one quota slot');
    await assert.rejects(() => reserve({ hash: 'b'.repeat(64) }), /media_request_conflict/);
    await assert.rejects(() => reserve({ property: 'demo-casa-verde' }), /media_request_conflict/, 'immutable inputs also match the hash');
    await db.query('UPDATE media_ai_entitlements SET enabled=false WHERE company_id=$1', [id(1)]);
    await assert.rejects(() => reserve(), /media_not_enabled/, 'a reused key cannot bypass revoked entitlement');
    await assert.rejects(() => claim(first.job.id), /media_not_enabled/);
    await db.query('UPDATE media_ai_entitlements SET enabled=true WHERE company_id=$1', [id(1)]);
    await db.query('UPDATE broker_accounts SET active=false WHERE id=$1', [id(11)]);
    await assert.rejects(() => claim(first.job.id), /media_forbidden/);
    await db.query('UPDATE broker_accounts SET active=true WHERE id=$1', [id(11)]);
    await db.query('UPDATE media_ai_entitlements SET photo_enabled=false WHERE company_id=$1', [id(1)]);
    await assert.rejects(() => claim(first.job.id), /media_feature_disabled/);
    await db.query('UPDATE media_ai_entitlements SET photo_enabled=true WHERE company_id=$1', [id(1)]);
    assert.equal(await claim(first.job.id, id(2), id(21)), null, 'tenant B cannot claim or read a job from A');
    await assert.rejects(() => claim(first.job.id, id(1), id(21)), /media_forbidden/);
    const claimed = await Promise.all([claim(first.job.id), claim(first.job.id), claim(first.job.id)]);
    assert.equal(claimed.filter(Boolean).length, 1, 'only one claimant can dispatch');
    assert.equal(claimed.find(Boolean).status, 'submitting');

    const prefix = `${id(1)}/${first.job.id}`;
    await db.query('UPDATE media_ai_jobs SET input_path=$1 WHERE id=$2', [`${prefix}/input.jpg`, first.job.id]);
    for (const forbidden of [`${id(2)}/${first.job.id}/input.jpg`, `${prefix}/../input.jpg`, 'https://example.test/input.jpg']) {
      await assert.rejects(() => db.query('UPDATE media_ai_jobs SET input_path=$1 WHERE id=$2', [forbidden, first.job.id]), /check constraint/);
    }
    await assert.rejects(() => db.query('UPDATE media_ai_jobs SET company_id=$1,actor_id=$2 WHERE id=$3', [id(2), id(21), first.job.id]), /media_identity_immutable/);
    await assert.rejects(() => db.query("UPDATE media_ai_jobs SET created_at=created_at-interval '1 day' WHERE id=$1", [first.job.id]), /media_identity_immutable/);
    await assert.rejects(() => db.query("UPDATE media_ai_jobs SET request_hash=repeat('b',64) WHERE id=$1", [first.job.id]), /media_identity_immutable/);
    await assert.rejects(() => db.query("UPDATE media_ai_jobs SET status='completed' WHERE id=$1", [first.job.id]), /check constraint/);
    await assert.rejects(() => db.query("UPDATE media_ai_jobs SET result_path=$1 WHERE id=$2", [`${prefix}/result.mp4`, first.job.id]), /check constraint/);
    await assert.rejects(() => db.query("UPDATE media_ai_jobs SET provider_task_id='https://provider.example/task' WHERE id=$1", [first.job.id]), /check constraint/);
    await assert.rejects(() => db.query("UPDATE media_ai_jobs SET provider_usage='[]' WHERE id=$1", [first.job.id]), /check constraint/);
    await assert.rejects(() => db.query("UPDATE media_ai_jobs SET result_bytes=30000001 WHERE id=$1", [first.job.id]), /check constraint/);
    await db.exec('SET ROLE service_role');
    await db.query("UPDATE media_ai_jobs SET status='completed',result_path=$1,result_mime='image/jpeg',result_bytes=1234,provider_usage=$4 WHERE id=$2 AND company_id=$3 AND status='submitting'", [`${prefix}/result.jpg`, first.job.id, id(1), JSON.stringify({ images: 1 })]);
    assert.equal(await scalar('SELECT status FROM media_ai_jobs WHERE id=$1', [first.job.id]), 'completed');
    await db.exec('RESET ROLE');
    assert.equal(await claim(first.job.id), null);
    assert.equal((await reserve()).job.result_path, `${prefix}/result.jpg`, 'retry returns historical output without redispatch');
    const second = await reserve({ request: id(1001), property: 'demo-apartamento-centro', index: 1 });
    const third = await reserve({ request: id(1002), property: 'demo-apartamento-serra', index: 1 });
    await db.query("UPDATE media_ai_jobs SET status='failed',error_code='provider_failed' WHERE id=$1", [second.job.id]);
    await db.query("UPDATE media_ai_jobs SET status='unknown',error_code='provider_uncertain' WHERE id=$1", [third.job.id]);
    await assert.rejects(() => reserve({ request: id(1003) }), /media_daily_limit/, 'failed and unknown reservations still consume quota');
    assert.equal((await reserve({ request: id(1001), property: 'demo-apartamento-centro', index: 1 })).job.status, 'failed');
    assert.equal((await reserve({ request: id(1002), property: 'demo-apartamento-serra', index: 1 })).reused, true);
    await assert.rejects(() => reserve({ hash: 'c'.repeat(64) }), /media_request_conflict/, 'conflict is identified even at quota');
    const tenantB = await reserve({ company: id(2), actor: id(21) });
    assert.notEqual(tenantB.job.id, first.job.id, 'same request key stays in its tenant');
    await db.query('UPDATE media_ai_entitlements SET video_enabled=true WHERE company_id=$1', [id(1)]);
    const video = await reserve({ request: id(1100), kind: 'video', provider: 'runway', model: 'gen4_turbo', format: 'portrait' });
    assert.equal(video.job.kind, 'video', 'photo and video quotas are independent');
    await assert.rejects(() => reserve({ request: id(1101), kind: 'video', provider: 'runway', model: 'gen4_turbo' }), /media_daily_limit/);
    await claim(video.job.id);
    await db.query("UPDATE media_ai_jobs SET status='processing',provider_task_id=$1 WHERE id=$2 AND company_id=$3 AND status='submitting'", [id(1199), video.job.id, id(1)]);
    const lease = () => db.query("UPDATE media_ai_jobs SET poll_after=now()+interval '60 seconds' WHERE id=$1 AND company_id=$2 AND status='processing' AND poll_after<=now() RETURNING id", [video.job.id, id(1)]);
    assert.equal((await lease()).rows.length, 1);
    assert.equal((await lease()).rows.length, 0, 'a second poll cannot acquire the active provider/download lease');
    await assert.rejects(() => db.query("UPDATE media_ai_jobs SET result_mime='image/jpeg' WHERE id=$1", [video.job.id]), /check constraint/);
    await db.query("UPDATE media_ai_jobs SET status='completed',result_path=$1,result_mime='video/mp4',result_bytes=4000 WHERE id=$2 AND company_id=$3 AND status='processing'", [`${id(1)}/${video.job.id}/result.mp4`, video.job.id, id(1)]);
    assert.equal(await claim(video.job.id), null);

    // Broad legacy browser policies/grants must not expose jobs, entitlements,
    // or private media. Verify restrictive denials with hostile fixtures.
    await db.exec(`
      GRANT ALL ON media_ai_entitlements,media_ai_jobs TO anon,authenticated;
      CREATE POLICY test_legacy_entitlements ON media_ai_entitlements FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
      CREATE POLICY test_legacy_jobs ON media_ai_jobs FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
      CREATE POLICY test_legacy_storage ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
      INSERT INTO storage.buckets(id,name,public) VALUES('other-test-bucket','other-test-bucket',true);
      INSERT INTO storage.objects(bucket_id,name) VALUES('media-ai','private-input.jpg'),('other-test-bucket','public-test.jpg');
    `);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      try {
        assert.equal(await count(), 0);
        assert.equal(await scalar('SELECT count(*)::int FROM media_ai_entitlements'), 0);
        await assert.rejects(() => db.query('INSERT INTO media_ai_entitlements(company_id,enabled) VALUES($1,true)', [id(999)]), /row-level security/);
        assert.equal((await db.query('UPDATE media_ai_entitlements SET enabled=true RETURNING company_id')).rows.length, 0);
        assert.equal((await db.query("DELETE FROM media_ai_jobs RETURNING id")).rows.length, 0);
        assert.equal(await scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='media-ai'"), 0);
        assert.equal(await scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='other-test-bucket'"), 1);
        await assert.rejects(() => db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('media-ai','attacker.jpg')"), /row-level security/);
        assert.equal((await db.query("UPDATE storage.objects SET name='changed.jpg' WHERE bucket_id='media-ai' RETURNING id")).rows.length, 0);
        assert.equal((await db.query("DELETE FROM storage.objects WHERE bucket_id='media-ai' RETURNING id")).rows.length, 0);
        await assert.rejects(() => reserve(), /permission denied/, 'table grants cannot expose privileged RPC');
      } finally { await db.exec('RESET ROLE'); }
    }
    await db.exec('REVOKE ALL ON media_ai_entitlements,media_ai_jobs FROM anon,authenticated');
    assert.equal(await scalar("SELECT count(*)::int FROM storage.objects WHERE bucket_id='media-ai'"), 1);
    assert.equal(await count(), 5, 'denied browser mutations preserve history');
    await assert.rejects(() => db.query("INSERT INTO media_ai_jobs(company_id,actor_id,request_id,request_hash,kind,property_id,photo_index,format,provider,model) VALUES($1,$2,$3,repeat('d',64),'photo','demo-casa-jardim',0,'landscape','openai','image-model')", [id(1), id(21), id(1900)]), /foreign key/);

    // UTC windows do not inherit the caller's display timezone. Historical,
    // expired and tomorrow's records are retained but excluded from today.
    await db.exec("SET TIME ZONE 'Pacific/Auckland'");
    await db.query(`INSERT INTO media_ai_jobs(id,company_id,actor_id,request_id,request_hash,kind,property_id,photo_index,format,provider,model,created_at,expires_at)
      SELECT $1,$2,$3,$4,repeat('e',64),'photo','demo-casa-verde',0,'landscape','openai','image-model',now()-interval '192 hours',now()-interval '24 hours'`, [id(2000), id(2), id(21), id(2001)]);
    assert.equal(await claim(id(2000), id(2), id(21)), null, 'expired reservations cannot start provider calls');
    await db.query('UPDATE media_ai_jobs SET purged_at=now() WHERE id=$1 AND company_id=$2 AND expires_at<=now()', [id(2000), id(2)]);
    assert(await scalar('SELECT purged_at IS NOT NULL FROM media_ai_jobs WHERE id=$1', [id(2000)]));
    const old = await reserve({ company: id(2), actor: id(21), request: id(2001), hash: 'e'.repeat(64), property: 'demo-casa-verde' });
    assert.equal(old.reused, true, 'expired request IDs cannot create another paid generation');
    await db.query(`INSERT INTO media_ai_jobs(id,company_id,actor_id,request_id,request_hash,kind,property_id,photo_index,format,provider,model,created_at,expires_at)
      SELECT job_id,$1,$2,gen_random_uuid(),repeat('f',64),'photo','demo-casa-verde',0,'landscape','openai','image-model',stamp,stamp+interval '168 hours'
      FROM (VALUES ($3::uuid,(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 minute'),
                   ($4::uuid,(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '24 hours')) dates(job_id,stamp)`, [id(2), id(21), id(2004), id(2006)]);
    await assert.rejects(() => claim(id(2004), id(2), id(21)), /media_reservation_expired/, 'yesterday\'s unused quota cannot start generation today');
    await db.query('UPDATE media_ai_jobs SET purged_at=now() WHERE id=$1', [id(2004)]);
    assert.equal(await claim(id(2004), id(2), id(21)), null, 'purged jobs cannot start even before their expiry');
    const boundary = await reserve({ company: id(2), actor: id(21), request: id(2002) });
    assert.equal(boundary.reused, false);
    const utcCount = await scalar("SELECT count(*)::int FROM media_ai_jobs WHERE kind='photo' AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND created_at < (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + interval '24 hours'");
    assert.equal(utcCount, 5);
    await db.query(`INSERT INTO media_ai_jobs(company_id,actor_id,request_id,request_hash,kind,property_id,photo_index,format,provider,model,status)
      SELECT $1,$2,gen_random_uuid(),repeat('f',64),'photo','demo-casa-jardim',0,'landscape','openai','image-model',
        CASE WHEN n%2=0 THEN 'unknown' ELSE 'failed' END FROM generate_series(1,$3::int) n`, [id(1), id(11), 100 - utcCount]);
    await assert.rejects(() => reserve({ company: id(2), actor: id(21), request: id(2003) }), /media_global_limit/);
    assert.equal((await reserve({ company: id(2), actor: id(21), request: id(2002) })).job.id, boundary.job.id, 'idempotency works at global cap');
    assert.equal(await scalar('SELECT status FROM media_ai_jobs WHERE id=$1', [first.job.id]), 'completed');
    assert.equal(await scalar('SELECT result_path FROM media_ai_jobs WHERE id=$1', [first.job.id]), `${prefix}/result.jpg`);
    console.log('PASS media AI SQL: disabled defaults, service-only grants, forced RLS, private bucket, tenant/owner checks, demo-only inputs, one reservation/claim, retained history, immutable identity, strict paths, UTC quotas and global cap.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exit(1); });
