const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');

(async () => {
  const db = await createDatabase();
  let checks = 0;
  try {
    for (const name of fs.readdirSync(path.resolve(__dirname, '../../../supabase/migrations'))
      .filter(name => name.endsWith('.sql') && name > isolationMigration).sort()) await db.exec(migration(name));
    await seedCompanies(db);
    for (const [n, name, active] of [[12, 'Corretor Alfa', true], [13, 'Corretor Beta', true], [14, 'Corretor Inativo', false]]) {
      await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,$3,$4,'scrypt-v1$fixture','broker',$5,$6,$6)",
        [id(n), id(1), name, name.toLowerCase(), active, `fixture${n}@example.test`]);
    }
    for (const [n, assignee] of [[102, 'Corretor Alfa'], [103, 'Corretor Beta'], [104, null], [106, 'Corretor Beta'], [107, 'Corretor Beta'], [108, 'Corretor Inativo']]) {
      await db.query("INSERT INTO leads(id,company_id,name,phone,assigned_to) VALUES($1,$2,$3,$4,$5)", [id(n), id(1), `Cliente ${n}`, `553599999${n}`, assignee]);
    }
    await db.query("INSERT INTO conversations(id,company_id,lead_id,assigned_broker_id,assigned_to,status) VALUES($1,$2,$3,$4,'Corretor Alfa','open'),($5,$2,$6,$7,'Corretor Inativo','open')",
      [id(506), id(1), id(106), id(12), id(508), id(108), id(14)]);
    await db.query("INSERT INTO social_accounts(id,company_id,channel,account_id,page_id,enabled,token_ciphertext) VALUES($1,$2,'instagram','123456','123457',true,'fixture')", [id(850), id(1)]);
    await db.query("INSERT INTO social_threads(id,company_id,account_id,lead_id,recipient_id,assigned_broker_id,assigned_to) VALUES($1,$2,$3,$4,'999',$5,'Corretor Alfa')", [id(851), id(1), id(850), id(107), id(12)]);
    for (const [n, captor] of [[302, 12], [303, 13], [304, 14]]) {
      await db.query("INSERT INTO properties(id,company_id,title,status,captured_by,images) VALUES($1,$2,$3,'Disponível',$4,'[]')", [id(n), id(1), `Imóvel ${n}`, id(captor)]);
    }
    for (const [n, lead, assignee] of [[902, 102, 'Corretor Beta'], [903, 103, 'Corretor Beta'], [904, 104, null]]) {
      await db.query("INSERT INTO appointments(id,company_id,lead_id,property_id,scheduled_at,assigned_to,status,notes) VALUES($1,$2,$3,$4,now(),$5,'Aguardando','Fixture')", [id(n), id(1), id(lead), id(301), assignee]);
    }
    const read = async (table, actor = 12, company = 1, limit = 10001) => (await db.query('SELECT read_classic_crm_records($1,$2,$3,$4) row', [id(company), id(actor), table, limit])).rows[0].row;
    const write = async (table, target, action, data = {}, actor = 12, company = 1) => (await db.query('SELECT write_classic_crm_record($1,$2,$3,$4,$5,$6) row', [id(company), id(actor), table, target == null ? null : id(target), action, JSON.stringify(data)])).rows[0].row;
    const denied = async (call, pattern = /classic_crm_forbidden/) => { await assert.rejects(call, pattern); checks++; };
    const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
    await db.exec('SET ROLE service_role');
    // The original privileged raw path sees both portfolios; the new API RPC does not.
    eq((await db.query('SELECT id FROM leads WHERE company_id=$1 AND id=$2', [id(1), id(103)])).rows.length, 1);
    eq((await read('leads')).map(r => r.id).sort(), [id(102), id(106)]);
    eq((await read('leads', 13)).map(r => r.id), [id(103)]);
    eq((await read('leads', 11)).length, 7);
    eq((await read('leads', 21, 2)).map(r => r.id), [id(201)]);
    eq((await read('leads', 12, 1, 1)).length, 1);
    await denied(() => read('leads', 14));
    await denied(() => read('leads', 21, 1));
    await denied(() => read('leads', 12, 1, 10002), /classic_crm_invalid/);
    await denied(() => read('broker_accounts'), /classic_crm_invalid/);
    eq((await read('properties')).map(r => r.id).sort(), [id(301), id(302), id(303), id(304)]);
    const slots = await read('appointments');
    eq(slots.map(r => r.id), [id(902)], 'appointment inherits lead ownership, not free-text assignee');
    eq([slots[0].lead_name, slots[0].property_title], ['Cliente 102', 'Imóvel 1']);
    eq((await read('appointments', 11)).length, 4);

    await denied(() => write('leads', 103, 'update', { lifecycle_status: 'Convertido' }));
    await denied(() => write('leads', 104, 'update', { lifecycle_status: 'Visita' }));
    await denied(() => write('leads', 107, 'update', { lifecycle_status: 'Visita' }));
    eq((await write('leads', 102, 'update', { lifecycle_status: 'Visita' })).lifecycle_status, 'Visita');
    eq((await write('leads', 106, 'update', { lifecycle_status: 'Proposta' })).lifecycle_status, 'Proposta', 'WhatsApp UUID overrides stale lead label');
    await denied(() => write('leads', 102, 'update', { assigned_to: 'Corretor Beta' }));
    await denied(() => write('leads', 102, 'update', { assigned_to: null }));
    await denied(() => write('leads', 106, 'update', { assigned_to: 'Dono 1' }, 11));
    await denied(() => write('leads', 102, 'update', { company_id: id(2) }), /classic_crm_invalid/);
    await denied(() => write('leads', 102, 'update', { interest_profile: {} }), /classic_crm_invalid/);
    await denied(() => write('leads', 102, 'update', { lifecycle_status: null }), /classic_crm_invalid/);
    eq(await write('leads', 201, 'update', { lifecycle_status: 'Visita' }, 11), null);
    await write('leads', 102, 'update', { assigned_to: 'Corretor Beta' }, 11);
    await denied(() => write('leads', 102, 'update', { lifecycle_status: 'Convertido' }), /classic_crm_forbidden/, 'access is rechecked after a handoff');
    eq((await write('leads', 102, 'update', { lifecycle_status: 'Em atendimento' }, 13)).lifecycle_status, 'Em atendimento');
    await write('leads', 102, 'update', { assigned_to: 'Corretor Alfa' }, 11);

    for (const action of ['check', 'update', 'delete']) await denied(() => write('properties', 303, action, action === 'update' ? { title: 'Intrusão' } : {}));
    await denied(() => write('properties', 301, 'update', { title: 'Sem captador' }));
    eq((await write('properties', 302, 'check')).id, id(302));
    eq((await write('properties', 302, 'update', { images: ['https://example.com/test.jpg'] })).images, ['https://example.com/test.jpg']);
    await denied(() => write('properties', 302, 'update', { captured_by: id(13) }));
    await denied(() => write('properties', null, 'insert', { title: 'Intrusão', captured_by: id(13) }));
    const newProperty = await write('properties', null, 'insert', { title: 'Nova captação', status: 'Disponível' });
    eq(newProperty.captured_by, id(12));
    eq(newProperty.company_id, id(1));
    eq((await write('properties', 303, 'update', { title: 'Administrador' }, 11)).captured_by, id(13), 'owner edit preserves capture owner');
    eq((await write('properties', 304, 'update', { title: 'Captador inativo' }, 11)).captured_by, id(14));
    await denied(() => write('properties', 302, 'update', { captured_by: id(21) }, 11));
    eq(await write('properties', 401, 'delete', {}, 11), null);
    eq((await write('properties', 302, 'delete')).id, id(302));
    eq(await write('properties', 302, 'check'), null);

    const slotInput = { lead_id: id(102), property_id: id(301), scheduled_at: '2027-01-20T12:00:00Z', status: 'Confirmada', notes: 'Cliente 102 · Imóvel 1' };
    const newSlot = await write('appointments', 910, 'insert', slotInput);
    eq(newSlot.assigned_to, 'Corretor Alfa');
    await denied(() => write('appointments', null, 'insert', { ...slotInput, lead_id: id(103) }));
    await denied(() => write('appointments', null, 'insert', { ...slotInput, assigned_to: 'Corretor Beta' }));
    await denied(() => write('appointments', null, 'insert', { ...slotInput, assigned_to: 'Corretor Beta' }, 11));
    await denied(() => write('appointments', null, 'insert', { ...slotInput, property_id: id(401) }));
    await denied(() => write('appointments', null, 'insert', { ...slotInput, lead_id: id(201) }, 11));
    await denied(() => write('appointments', null, 'insert', { ...slotInput, scheduled_at: 'infinity' }), /classic_crm_invalid/);
    await denied(() => write('appointments', null, 'insert', { ...slotInput, status: 'Realizada' }), /classic_crm_invalid/);
    await denied(() => write('appointments', 903, 'update', { status: 'Confirmada' }));
    await denied(() => write('appointments', 903, 'delete'));
    eq((await write('appointments', 902, 'update', { status: 'Confirmada' })).status, 'Confirmada');
    await denied(() => write('appointments', 902, 'update', { lead_id: id(103) }), /classic_crm_invalid/);
    await db.query("UPDATE appointments SET status='Realizada' WHERE id=$1", [id(910)]);
    eq(await write('appointments', 910, 'update', { status: 'Aguardando' }, 11), null);
    eq(await write('appointments', 910, 'delete', {}, 11), null);
    eq((await write('appointments', 902, 'delete')).id, id(902));
    eq(await write('appointments', 1001, 'delete', {}, 11), null);

    await db.exec('RESET ROLE');
    // Ambiguous historical display names never expand the canonical portfolio.
    await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,'CORRETOR  ALFA','different-fixture-key','scrypt-v1$fixture','broker',true,'dup@example.test','dup@example.test')", [id(15), id(1)]);
    await db.exec('SET ROLE service_role');
    eq((await read('leads')).map(r => r.id), [id(106)]);
    await denied(() => write('leads', 102, 'update', { lifecycle_status: 'Proposta' }));
    await db.exec('RESET ROLE');
    await db.query('UPDATE broker_accounts SET active=false WHERE id=$1', [id(12)]);
    await db.exec('SET ROLE service_role');
    await denied(() => read('leads'));
    await denied(() => write('properties', null, 'insert', { title: 'Inativo' }));
    await db.exec('RESET ROLE');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await denied(() => read('leads'), /permission denied/);
      await denied(() => write('leads', 102, 'update', {}), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.query("INSERT INTO leads(company_id,name,phone,assigned_to) SELECT $1,'Scale fixture '||n,'bulk-'||n,'Dono 2' FROM generate_series(1,1100) n", [id(2)]);
    await db.exec('SET ROLE service_role');
    const scale = await read('leads', 21, 2);
    eq(scale.length, 1101, 'all rows survive the API table-row cap because the RPC returns one scalar array');
    eq((await read('leads', 21, 2, 1001)).length, 1001, 'SQL still bounds the actual payload');
    const fn = (await db.query("SELECT proretset,prorettype::regtype::text result_type FROM pg_proc WHERE oid='public.read_classic_crm_records(uuid,uuid,text,integer)'::regprocedure")).rows[0];
    eq(fn, { proretset: false, result_type: 'jsonb' });
    await db.exec('RESET ROLE');
    console.log(`PASS classic portfolio SQL: ${checks} assertions; cross-broker reads/writes denied, owner access, active actor, live WhatsApp/social ownership, ambiguity, captor control, appointment history, immutable tenant identity and server-only RPC grants. No network.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
