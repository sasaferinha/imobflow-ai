const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const operation = fs.readFileSync(path.resolve(__dirname, '../../../supabase/operations/media-ai-recovery-cron.sql'), 'utf8');

// The reviewed operations file runs unchanged. net/cron/Vault are inert local
// fixtures; no HTTP, provider generation, credentials, or live DB is accessed.
(async () => {
  const db = await PGlite.create();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS');
    const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
    const rejectedInstall = async pattern => {
      await assert.rejects(() => db.exec(operation), pattern);
      await db.exec('ROLLBACK');
    };
    await rejectedInstall(/media_ai_scheduler_prerequisites_missing/);
    await db.exec(`
      CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA vault;
      CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
      CREATE FUNCTION cron.schedule(p_name text,p_schedule text,p_command text) RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command) RETURNING jobid $$;
      CREATE FUNCTION cron.alter_job(job_id bigint,active boolean) RETURNS void LANGUAGE sql AS $$
        UPDATE cron.job SET active=alter_job.active WHERE jobid=job_id $$;
      INSERT INTO cron.job(jobname,schedule,command) VALUES('imobflow-message-recovery','* * * * *','SELECT existing_worker()');
      CREATE TABLE net._http_response(id bigint PRIMARY KEY,status_code integer,created timestamptz DEFAULT now());
      CREATE TABLE net.synthetic_requests(id bigserial PRIMARY KEY,url text,body jsonb,authorized boolean,timeout_ms integer);
      CREATE TABLE vault.secrets(name text,secret text);
      CREATE VIEW vault.decrypted_secrets AS SELECT name,secret AS decrypted_secret FROM vault.secrets;
      CREATE TABLE public.media_ai_jobs(id integer PRIMARY KEY,status text,kind text,provider text,provider_task_id text,
        poll_after timestamptz DEFAULT now(),expires_at timestamptz DEFAULT now()+interval '7 days',purged_at timestamptz);
      CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}',params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 2000)
      RETURNS bigint LANGUAGE plpgsql AS $$
      DECLARE request_id bigint;
      BEGIN
        IF url <> 'https://www.imobflow.net.br/api/media-studio/recover' OR body <> '{}'::jsonb OR params <> '{}'::jsonb THEN RAISE EXCEPTION 'unexpected_request'; END IF;
        IF headers->>'Authorization' IS DISTINCT FROM 'Bearer '||repeat('R',48) OR headers->>'Content-Type' <> 'application/json' THEN RAISE EXCEPTION 'unexpected_headers'; END IF;
        INSERT INTO net.synthetic_requests(url,body,authorized,timeout_ms) VALUES(url,body,true,timeout_milliseconds) RETURNING id INTO request_id;
        RETURN request_id;
      END $$;
    `);
    await rejectedInstall(/media_ai_scheduler_secret_missing_or_ambiguous/);
    await db.query('INSERT INTO vault.secrets VALUES($1,$2)', ['imobflow_message_recovery_secret', 'short']);
    await rejectedInstall(/media_ai_scheduler_secret_invalid/);
    await db.query('UPDATE vault.secrets SET secret=$1', ['R'.repeat(48)]);
    await db.exec("SET pg_net.max_timeout_ms='100000'");
    await rejectedInstall(/media_ai_scheduler_timeout_unavailable/);
    await db.exec("SET pg_net.max_timeout_ms='600000'");
    await db.exec(operation);
    assert.equal(await scalar('SELECT count(*)::int FROM net.synthetic_requests'), 0);
    assert.deepEqual((await db.query("SELECT jobname,schedule,command,active FROM cron.job WHERE jobname='imobflow-media-ai-recovery'")).rows[0], {
      jobname: 'imobflow-media-ai-recovery', schedule: '*/2 * * * *', command: 'SELECT public.dispatch_media_ai_recovery()', active: false,
    });
    assert.deepEqual((await db.query("SELECT schedule,command,active FROM cron.job WHERE jobname='imobflow-message-recovery'")).rows[0], {
      schedule: '* * * * *', command: 'SELECT existing_worker()', active: true,
    });
    const tick = () => db.query('SELECT public.dispatch_media_ai_recovery()');
    const requests = () => scalar('SELECT count(*)::int FROM net.synthetic_requests');
    await tick(); assert.equal(await requests(), 0, 'empty queue makes no HTTP request');
    assert.equal(await scalar('SELECT last_result FROM media_ai_scheduler'), 'idle');
    await db.exec(`INSERT INTO media_ai_jobs(id,status,kind,provider,provider_task_id,poll_after,expires_at,purged_at) VALUES
      (1,'reserved','video','runway','task',now(),now()+interval '1 day',NULL),
      (2,'processing','photo','openai','task',now(),now()+interval '1 day',NULL),
      (3,'processing','video','runway',NULL,now(),now()+interval '1 day',NULL),
      (4,'processing','video','runway','task',now()+interval '1 hour',now()+interval '1 day',NULL),
      (5,'processing','video','runway','task',now(),now()-interval '1 hour',NULL),
      (6,'processing','video','runway','task',now(),now()+interval '1 day',now()),
      (7,'processing','video','another-provider','task',now(),now()+interval '1 day',NULL)`);
    await tick(); assert.equal(await requests(), 0, 'only eligible in-flight Runway jobs wake the worker');
    await db.exec("UPDATE media_ai_jobs SET status='processing' WHERE id=1");
    await db.exec("INSERT INTO vault.secrets(name,secret) SELECT name,secret FROM vault.secrets");
    await assert.rejects(tick, /media_ai_scheduler_secret_missing_or_ambiguous/);
    await db.exec('DELETE FROM vault.secrets WHERE ctid NOT IN (SELECT min(ctid) FROM vault.secrets GROUP BY name)');
    await db.query('UPDATE vault.secrets SET secret=$1', ['R'.repeat(48) + '\n']);
    await assert.rejects(tick, /media_ai_scheduler_secret_invalid/);
    await db.query('UPDATE vault.secrets SET secret=$1', ['R'.repeat(48)]);
    await tick(); assert.equal(await requests(), 1);
    assert.equal(await scalar('SELECT timeout_ms FROM net.synthetic_requests LIMIT 1'), 170000);
    assert.equal(await scalar('SELECT last_result FROM media_ai_scheduler'), 'dispatched');
    await tick(); assert.equal(await requests(), 1, 'unfinished HTTP request cannot stack another worker');
    assert.equal(await scalar('SELECT last_result FROM media_ai_scheduler'), 'awaiting_response');
    await db.exec("INSERT INTO net._http_response(id,status_code) VALUES(1,NULL); UPDATE media_ai_scheduler SET last_request_at=now()-interval '100 seconds'");
    await tick(); assert.equal(await requests(), 1, 'transport timeout also keeps the 180-second guard');
    await db.exec("UPDATE media_ai_scheduler SET last_request_at=now()-interval '181 seconds'");
    await tick(); assert.equal(await requests(), 2, 'stale HTTP lease can recover without creating a provider task');
    await db.exec('INSERT INTO net._http_response(id,status_code) VALUES(2,503)');
    await tick(); assert.equal(await requests(), 3);
    assert.equal(await scalar('SELECT last_http_status FROM media_ai_scheduler'), 503);
    await db.exec("INSERT INTO net._http_response(id,status_code) VALUES(3,200); UPDATE media_ai_jobs SET status='completed'");
    await tick(); assert.equal(await requests(), 3);
    assert.equal(await scalar('SELECT last_success_at IS NOT NULL FROM media_ai_scheduler'), true);
    assert.equal(await scalar('SELECT last_http_status FROM media_ai_scheduler'), 200);
    assert.equal(await scalar('SELECT last_result FROM media_ai_scheduler'), 'idle');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await assert.rejects(tick, /permission denied/);
        await assert.rejects(() => db.query('UPDATE media_ai_scheduler SET last_request_at=NULL'), /permission denied/);
        if (role === 'service_role') assert.equal(await scalar('SELECT last_http_status FROM media_ai_scheduler'), 200);
        else await assert.rejects(() => db.query('SELECT * FROM media_ai_scheduler'), /permission denied/);
      } finally { await db.exec('RESET ROLE'); }
    }
    assert.equal(await scalar('SELECT secret FROM vault.secrets'), 'R'.repeat(48), 'the shared credential remains unchanged');
    assert(!JSON.stringify((await db.query('SELECT * FROM media_ai_scheduler')).rows).includes('R'.repeat(48)));
    await rejectedInstall(/media_ai_scheduler_already_installed_review_existing_job/);
    assert.equal(await scalar('SELECT count(*)::int FROM cron.job'), 2, 'repeat installation never replaces/duplicates either worker');
    console.log(`PASS media AI recovery SQL: inactive 2-minute job, existing Vault key, prerequisites, timeout bounds, eligible queue, 180-second guard, HTTP metadata, private grants, unchanged WhatsApp worker; no network. Operation SHA256 ${createHash('sha256').update(operation).digest('hex')}`);
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exit(1); });
