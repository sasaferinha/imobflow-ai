const assert=require('node:assert/strict');const {createDatabase,seedCompanies,id,migration}=require('./helpers/tenant-test-database.cjs');
(async()=>{for(const arrays of [false,true]) {const db=await createDatabase();try{
await seedCompanies(db);
if(arrays) await db.exec("CREATE FUNCTION pg_temp.text_array(v jsonb) RETURNS text[] LANGUAGE sql AS $$ SELECT array_agg(x) FROM jsonb_array_elements_text(v) x $$; ALTER TABLE properties ALTER COLUMN images DROP DEFAULT; ALTER TABLE properties ALTER COLUMN images TYPE text[] USING pg_temp.text_array(images); ALTER TABLE messages ALTER COLUMN media_urls DROP DEFAULT; ALTER TABLE messages ALTER COLUMN media_urls TYPE text[] USING pg_temp.text_array(media_urls);");
await db.exec(migration('20261108010000_property_whatsapp_media.sql'));
const image='https://example.supabase.co/storage/v1/object/public/property-images/'+id(1)+'/photo.jpg';
await db.query('UPDATE properties SET images=$1 WHERE id=$2',[(arrays?[image]:JSON.stringify([image])),id(301)]);
await db.query("UPDATE conversations SET assigned_broker_id=$1,external_conversation_id='whatsapp:5535999990001',phone_number_id='123456',bot_paused=true WHERE id=$2",[id(11),id(501)]);
await db.query('SELECT generate_property_opportunities($1,$2,7)',[id(1),id(301)]);
const opp=(await db.query('SELECT id FROM opportunities WHERE company_id=$1',[id(1)])).rows[0].id;
async function send(request=id(900),images=[image],content='Oferta teste',company=id(1),broker=id(11)){return (await db.query('SELECT enqueue_property_whatsapp_offer($1,$2,$3,$4,$5,$6,$7) AS ids',[company,broker,opp,request,content,JSON.stringify(images),'123456'])).rows[0].ids}
const ids=await send();assert.equal(ids.length,2);assert.deepEqual(await send(),ids);
assert.equal((await db.query('SELECT image_url FROM message_outbox WHERE id=$1',[ids[1]])).rows[0].image_url,image);
await assert.rejects(send(id(900),[]),/offer_request_conflict/);
await assert.rejects(send(id(901),[image+'bad']),/invalid_offer_images/);
await assert.rejects(send(id(902),[image,image]),/invalid_offer_images/);
await assert.rejects(send(id(903),[image],'other',id(2),id(21)),/opportunity_not_found/);
await db.query("UPDATE messages SET created_at=now()-interval '25 hours' WHERE direction='incoming'");
await assert.rejects(send(id(904)),/template_required/);
assert.equal((await db.query('SELECT count(*)::int AS n FROM property_whatsapp_batches')).rows[0].n,1);
await db.exec('SET ROLE authenticated');await assert.rejects(db.query('SELECT * FROM property_whatsapp_batches'),/permission denied/);
console.log('PASS atomic property offer: images, deduplication, mismatch, tenant, expiry, rollback, browser denial. Isolated database only.');
}finally{await db.close()}}})().catch(e=>{console.error(e);process.exitCode=1});