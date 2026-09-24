const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=await PGlite.create();
 try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE conversation_settings(company_id uuid primary key,whatsapp_phone_number_id text,whatsapp_access_token text,whatsapp_enabled boolean);
 CREATE TABLE messages(id int primary key,company_id uuid,delivery_status text);
 CREATE TABLE message_outbox(id int primary key,company_id uuid,state text,updated_at timestamptz);
 INSERT INTO conversation_settings VALUES('00000000-0000-4000-8000-000000000001','12345','test',true),('00000000-0000-4000-8000-000000000002','67890','other',true);
 INSERT INTO messages VALUES(1,'00000000-0000-4000-8000-000000000001','pending'),(2,'00000000-0000-4000-8000-000000000002','pending');
 INSERT INTO message_outbox SELECT id,company_id,'pending',now() FROM messages;`);
 await db.exec(fs.readFileSync(path.resolve(__dirname,'../../..','supabase/migrations/20260915230000_disconnect_whatsapp.sql'),'utf8'));
 await assert.rejects(()=>db.query("SELECT disconnect_company_whatsapp('00000000-0000-4000-8000-000000000001','67890')"),/connection_changed/);
 await db.query("SELECT disconnect_company_whatsapp('00000000-0000-4000-8000-000000000001','12345')");
 const rows=(await db.query('SELECT * FROM conversation_settings ORDER BY company_id')).rows;
 assert.equal(rows[0].whatsapp_enabled,false); assert.equal(rows[0].whatsapp_access_token,null); assert.equal(rows[0].whatsapp_phone_number_id,'12345');
 assert.equal(rows[1].whatsapp_enabled,true); assert.equal(rows[1].whatsapp_access_token,'other');
 assert.deepEqual((await db.query('SELECT delivery_status FROM messages ORDER BY id')).rows.map(r=>r.delivery_status),['failed','pending']);
 assert.equal((await db.query('SELECT count(*)::int AS total FROM messages')).rows[0].total,2);
 await db.exec('SET ROLE anon');
 await assert.rejects(()=>db.query("SELECT public.disconnect_company_whatsapp('00000000-0000-4000-8000-000000000001','12345')"),/permission denied/);
 console.log('PASS SQL disconnect: scoped changes, stale number denied, history retained, pending cancelled, public invocation denied');
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
