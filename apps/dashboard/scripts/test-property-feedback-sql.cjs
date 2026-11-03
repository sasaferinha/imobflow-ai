const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');

(async () => {
  const db = await createDatabase();
  try {
    for (const file of fs.readdirSync(path.resolve(__dirname, '../../../supabase/migrations')).filter(file => file.endsWith('.sql') && file > isolationMigration).sort()) await db.exec(migration(file));
    await seedCompanies(db);
    await db.query('UPDATE conversations SET assigned_broker_id=$1 WHERE company_id=$2', [id(11), id(1)]);
    const ensure = (requestId = 3001, company = 1, actor = 11, lead = 101, hash = 'a'.repeat(64)) => db.query(
      'SELECT ensure_property_feedback_request($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
      [id(company), id(actor), id(requestId), `case:${id(lead)}`, `property:${id(301)}`, id(lead), 'Apartamento fictício', 'Venda', hash],
    );
    await db.exec('SET ROLE service_role');
    const request = (await ensure()).rows[0].result;
    assert.equal(request.company_id, id(1));
    assert.equal((await ensure(3002, 1, 11, 101, 'b'.repeat(64))).rows[0].result.id, request.id, 'same negotiation is idempotent, original link preserved');
    await assert.rejects(() => ensure(3003, 1, 21, 101, 'c'.repeat(64)), /feedback_forbidden/, 'foreign actor denied');
    await assert.rejects(() => ensure(3003, 1, 11, 201, 'c'.repeat(64)), /feedback_forbidden/, 'foreign lead denied');
    const queue = () => db.query('SELECT queue_property_feedback($1,$2,$3,$4) result', [id(1), id(11), request.id, 'Pesquisa fictícia https://example.invalid/avaliacao/fixture']);
    const firstQueue = (await queue()).rows[0].result;
    assert.ok(firstQueue.outboxId, 'open window queues real outbox entry');
    assert.equal((await queue()).rows[0].result.outboxId, firstQueue.outboxId, 'retries do not duplicate outbound messages');
    assert.equal((await db.query('SELECT count(*)::int n FROM message_outbox WHERE company_id=$1', [id(1)])).rows[0].n, 1);
    const submit = (visit = 4, property = 5, hash = 'a'.repeat(64)) => db.query('SELECT submit_property_feedback($1,$2,$3,$4,$5) result', [hash, visit, property, 'Sim', 'Gostei da localização.']);
    assert.equal((await submit(6)).rows[0].result, false, 'rating bound validated in SQL');
    assert.equal((await submit(4, 5, 'f'.repeat(64))).rows[0].result, false, 'unknown token cannot write');
    assert.equal((await submit()).rows[0].result, true);
    assert.equal((await submit(1, 1)).rows[0].result, false, 'submitted response cannot be overwritten');
    assert.equal((await db.query('SELECT visit_score,property_score FROM property_feedback_requests WHERE id=$1', [request.id])).rows[0].visit_score, 4);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`RESET ROLE; SET ROLE ${role}`);
      await assert.rejects(() => db.query('SELECT * FROM property_feedback_requests'), error => error.code === '42501');
      await assert.rejects(() => submit(), error => error.code === '42501');
    }
    await db.exec('RESET ROLE');
    await db.query("UPDATE messages SET created_at=now()-interval '25 hours' WHERE company_id=$1 AND direction='incoming'", [id(2)]);
    await db.query('UPDATE conversations SET assigned_broker_id=$1 WHERE company_id=$2', [id(21), id(2)]);
    await db.exec('SET ROLE service_role');
    const other = (await db.query('SELECT ensure_property_feedback_request($1,$2,$3,$4,$5,$6,$7,$8,$9) result', [id(2), id(21), id(3004), `case:${id(201)}`, `property:${id(401)}`, id(201), 'Imóvel de outra empresa', 'Venda', 'd'.repeat(64)])).rows[0].result;
    const outside = (await db.query('SELECT queue_property_feedback($1,$2,$3,$4) result', [id(2), id(21), other.id, 'Pesquisa fictícia'])).rows[0].result;
    assert.match(outside.reason, /Fora da janela/); assert.equal(outside.outboxId, undefined);
    assert.equal((await db.query('SELECT count(*)::int n FROM message_outbox WHERE company_id=$1', [id(2)])).rows[0].n, 0, 'outside-window message not queued');
    await db.exec('RESET ROLE');
    await db.query("UPDATE property_feedback_requests SET created_at=now()-interval '92 days',expires_at=now()-interval '2 days' WHERE id=$1", [other.id]);
    await db.exec('SET ROLE service_role');
    assert.equal((await submit(3, 3, 'd'.repeat(64))).rows[0].result, false, 'expired token cannot answer');
    console.log('PASS property feedback SQL: tenant/actor checks, service-only access, single response, bounds, expiry, outbox idempotency and WhatsApp window. Synthetic database only.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
