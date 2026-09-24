// Execute all versioned migrations together against the legacy schema fixture.
// Never connects to Supabase/Neon, sends WhatsApp or creates live accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');

async function main() {
  const db = await createDatabase();
  try {
    const migrationDir = path.resolve(__dirname, '../../../supabase/migrations');
    const remaining = fs.readdirSync(migrationDir).filter(file => file.endsWith('.sql') && file > isolationMigration).sort();
    for (const file of remaining) await db.exec(migration(file));
    await seedCompanies(db);
    await db.query('UPDATE conversations SET assigned_broker_id=$1,assigned_to=$2 WHERE id=$3', [id(11), 'Dono 1', id(501)]);
    await db.query('UPDATE appointments SET assigned_to=$1 WHERE company_id=$2', ['Dono 1', id(1)]);
    const renamed = await db.query('SELECT * FROM update_account_profile($1,$2,$3,$4,$5,$6,$7,$8)', [id(1), id(11), 'Gestora atual', 'gestora atual', 'Empresa Renomeada', 'empresa renomeada', 'Dono 1', 'Empresa 1']);
    assert.equal(renamed.rows[0].name, 'Gestora atual');
    const alias = await db.query('SELECT name FROM broker_name_history WHERE broker_id=$1 ORDER BY name', [id(11)]);
    assert.deepEqual(alias.rows.map(row => row.name), ['Dono 1', 'Gestora atual']);
    for (const table of ['leads', 'appointments', 'conversations']) {
      const row = (await db.query(`SELECT assigned_to,assigned_broker_id FROM ${table} WHERE company_id=$1`, [id(1)])).rows[0];
      assert.equal(row.assigned_to, 'Gestora atual');
      assert.equal(row.assigned_broker_id, id(11));
    }
    assert.equal((await db.query('SELECT name FROM broker_accounts WHERE id=$1', [id(21)])).rows[0].name, 'Dono 2');
    const photo = { propertyId: id(301), path: `property-images/${id(1)}/${id(9001)}.webp`, url: `https://fixture.supabase.co/storage/v1/object/public/property-images/${id(1)}/${id(9001)}.webp` };
    await db.query('UPDATE properties SET images=$1::jsonb WHERE id=$2', [JSON.stringify([photo.url]), id(301)]);
    const args = [id(1), id(501), 'integration-offer', 'Imóvel de teste', id(11), id(301), JSON.stringify([photo])];
    const ids = (await db.query('SELECT enqueue_property_offer($1,$2,$3,$4,$5,$6,$7::jsonb) AS ids', args)).rows[0].ids;
    assert.equal(ids.length, 2);
    await assert.rejects(() => db.query('SELECT hide_dashboard_message($1,$2,$3)', [id(1), id(11), ids[0]]), /message_in_flight/);
    assert.equal((await db.query('SELECT claim_outbox_message_v2($1,$2) AS claimed', [id(1), ids[0]])).rows[0].claimed, true);
    const attempt = (await db.query('SELECT attempts FROM message_outbox WHERE id=$1', [ids[0]])).rows[0].attempts;
    await db.query("SELECT finish_outbox_attempt($1,$2,$3,'sent',NULL,$4,NULL)", [id(1), ids[0], attempt, 'wamid.integration']);
    await db.query('SELECT hide_dashboard_message($1,$2,$3)', [id(1), id(11), ids[0]]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM message_outbox WHERE id=ANY($1::uuid[])', [ids])).rows[0].n, 2);
    assert.equal((await db.query('SELECT claim_outbox_message_v2($1,$2) AS claimed', [id(1), ids[1]])).rows[0].claimed, true, 'hiding accepted parent never destroys photo queue');
    assert.deepEqual((await db.query('SELECT enqueue_property_offer($1,$2,$3,$4,$5,$6,$7::jsonb) AS ids', args)).rows[0].ids, ids, 'hidden parent retains idempotency');
    const previousLeadStatus = (await db.query('SELECT lifecycle_status FROM leads WHERE id=$1', [id(101)])).rows[0].lifecycle_status;
    const sale = (await db.query("SELECT record_property_deal($1,$2,$3,$4,$5,current_date,570000,'Venda','Cliente de teste') AS deal", [id(1), id(11), id(301), id(11), id(101)])).rows[0].deal;
    const convertedLead = (await db.query('SELECT lifecycle_status,last_deal_id FROM leads WHERE id=$1', [id(101)])).rows[0];
    assert.equal(convertedLead.lifecycle_status, 'Convertido');
    assert.equal(convertedLead.last_deal_id, sale.id);
    const cancelled = (await db.query('SELECT cancel_property_deal($1,$2,$3) AS result', [id(1), id(11), sale.id])).rows[0].result;
    assert.equal(cancelled.propertyRestored, true);
    assert.equal((await db.query('SELECT status FROM properties WHERE id=$1', [id(301)])).rows[0].status, 'Disponível');
    assert.equal((await db.query('SELECT lifecycle_status FROM leads WHERE id=$1', [id(101)])).rows[0].lifecycle_status, previousLeadStatus);
    console.log(`PASS combined CRM release: ${remaining.length} later migrations verbatim, rename+aliases+assignments, media+visibility+dedupe, sale+cancel, cross-tenant unchanged`);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
