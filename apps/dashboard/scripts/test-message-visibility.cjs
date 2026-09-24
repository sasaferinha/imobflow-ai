// Local PostgreSQL/WASM only. Never contacts Supabase, Meta or a real client.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { company: id(1), otherCompany: id(2), owner: id(11), broker: id(12), otherBroker: id(13), disabled: id(14), foreignOwner: id(21), conversation: id(101), foreignConversation: id(102), lead: id(201) };
let db, account = { companyId: ids.company, brokerId: ids.owner, role: 'owner' };
const calls = [];
function load(file, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module, exports: module.exports, Error, Date, Intl, URL, URLSearchParams, Response, console, process: { env: {} },
    require(name) {
      if (name in mocks) return mocks[name];
      if (name.startsWith('@/') || name.startsWith('./')) {
        const target = name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(file), name);
        return load(target + (fs.existsSync(path.join(root, target + '.tsx')) ? '.tsx' : '.ts'), mocks);
      }
      return require(name);
    },
  });
  return module.exports;
}
async function rpc(name, company, actor, message, contact) {
  return db.query(contact === undefined ? `SELECT ${name}($1,$2,$3)` : `SELECT ${name}($1,$2,$3,$4)`,
    contact === undefined ? [company, actor, message] : [company, actor, contact, message]);
}
async function request(resource, options = {}) {
  calls.push({ resource, ...options });
  if (resource.startsWith('rpc/')) {
    const b = options.body;
    assert.equal(b.p_company_id, account.companyId);
    assert.equal(b.p_broker_id, account.brokerId);
    assert.equal(options.method, 'POST');
    if (resource === 'rpc/enqueue_conversation_message') {
      // Model the existing queue's idempotent replay without a provider send.
      const row = (await db.query('SELECT id FROM message_outbox WHERE company_id=$1 AND request_key=$2',[b.p_company_id,b.p_key])).rows[0];
      assert.ok(row,'Replay must return the original durable queue entry');
      return row.id;
    }
    return rpc(resource.slice(4), b.p_company_id, b.p_broker_id, b.p_message_id, b.p_contact_id);
  }
  assert.equal(options.method || 'GET', 'GET', 'No PATCH/DELETE of actual data is ever used by the visibility helper');
  const [table, query] = resource.split('?');
  assert.ok(['leads', 'messages', 'message_outbox', 'message_delivery_events', 'conversations', 'demo_conversation_threads', 'broker_accounts'].includes(table));
  const params = new URLSearchParams(query), values = [], predicates = [];
  assert.equal(params.get('company_id'), `eq.${account.companyId}`);
  for (const [column, filter] of params) {
    if (['select', 'limit', 'order'].includes(column)) continue;
    assert.match(column, /^[a-z_]+$/);
    const bind = value => { values.push(value); return `$${values.length}`; };
    if (filter.startsWith('eq.')) predicates.push(`${column}=${bind(filter.slice(3))}`);
    else { assert.ok(filter.startsWith('in.(')); predicates.push(`${column} IN (${filter.slice(4, -1).split(',').map(value => bind(value.replace(/^"|"$/g, ''))).join(',')})`); }
  }
  const selected = params.get('select') || '*'; assert.match(selected, /^[a-z_,*]+$/);
  const result = await db.query(`SELECT ${selected} FROM ${table} WHERE ${predicates.join(' AND ')} LIMIT ${Number(params.get('limit') || 1000)}`, values);
  return result.rows.map(row => ({ ...row, ...(row.created_at ? { created_at: new Date(row.created_at).toISOString() } : {}) }));
}
const mocks = {
  './supabase': { supabaseCompanyId: () => account.companyId, supabaseRequest: request },
  './tenant-context': { currentAccount: () => account },
  './message-delivery': { deliveryError: () => 'Falha de entrega' }, './message-outbox': { sendQueuedMessage: async (company,messageId) => {
    assert.equal(company,ids.company); assert.equal(messageId,id(302));
    assert.equal((await db.query('SELECT state FROM message_outbox WHERE id=$1',[messageId])).rows[0].state,'sent');
  } },
  './whatsapp-media': { isWhatsAppMediaPath: () => true, isWhatsAppAudioPath: () => false, readStoredWhatsAppImage: () => { throw Error('Hidden media must not be read'); } },
};
async function run() {
  db = await PGlite.create();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE broker_accounts(id uuid PRIMARY KEY,company_id uuid,name text,role text,active boolean,UNIQUE(company_id,id));
    CREATE TABLE leads(id uuid PRIMARY KEY,company_id uuid);
    CREATE TABLE conversations(id uuid PRIMARY KEY,company_id uuid,lead_id uuid,status text,assigned_broker_id uuid,assigned_to text,bot_paused boolean);
    CREATE TABLE messages(id uuid PRIMARY KEY,company_id uuid,conversation_id uuid,content text,direction text,external_message_id text,created_at timestamptz DEFAULT now(),media_urls jsonb DEFAULT '[]',delivery_status text,sender_type text,UNIQUE(company_id,external_message_id));
    CREATE TABLE message_outbox(id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,company_id uuid,state text,attempts int,next_attempt_at text,request_key text UNIQUE);
    CREATE TABLE inbound_reply_jobs(message_id uuid REFERENCES messages(id) ON DELETE CASCADE,state text);
    CREATE TABLE attendance_replies(dedup_key text PRIMARY KEY,state text);
    CREATE TABLE message_delivery_events(company_id uuid,external_message_id text,status text,error_code int);
    CREATE TABLE demo_conversation_threads(company_id uuid,contact_id text,assigned_broker_id uuid,messages jsonb DEFAULT '[]',revision int DEFAULT 1,updated_at timestamptz DEFAULT now(),PRIMARY KEY(company_id,contact_id));
    INSERT INTO broker_accounts VALUES('${ids.owner}','${ids.company}','Owner','owner',true),('${ids.broker}','${ids.company}','Broker','broker',true),('${ids.otherBroker}','${ids.company}','Other broker','broker',true),('${ids.disabled}','${ids.company}','Disabled','owner',false),('${ids.foreignOwner}','${ids.otherCompany}','Foreign owner','owner',true);
    INSERT INTO conversations VALUES('${ids.conversation}','${ids.company}','${ids.lead}','open','${ids.broker}','Broker',true),('${ids.foreignConversation}','${ids.otherCompany}','${id(202)}','open','${ids.foreignOwner}','Other',true);
    INSERT INTO leads VALUES('${ids.lead}','${ids.company}');
    INSERT INTO messages(id,company_id,conversation_id,content,direction,external_message_id,media_urls,delivery_status) VALUES
      ('${id(301)}','${ids.company}','${ids.conversation}','Original incoming','incoming','incoming-dedupe','["whatsapp-media/example.jpg"]',NULL),
      ('${id(302)}','${ids.company}','${ids.conversation}','Original sent','outgoing','sent-dedupe','[]','sent'),
      ('${id(303)}','${ids.otherCompany}','${ids.foreignConversation}','Foreign secret','incoming',NULL,'[]',NULL);
    INSERT INTO message_outbox VALUES('${id(302)}','${ids.company}','sent',1,NULL,'human:${ids.broker}:${id(901)}');
    INSERT INTO inbound_reply_jobs VALUES('${id(301)}','pending');
    INSERT INTO attendance_replies VALUES('reply:incoming-dedupe','accepted');
    INSERT INTO demo_conversation_threads(company_id,contact_id,assigned_broker_id,messages) VALUES('${ids.company}','mariana','${ids.broker}','[{"id":"${id(501)}","text":"Demo original","side":"outgoing","time":"12:00"}]');`);
  await db.exec(fs.readFileSync(path.resolve(root, '../../supabase/migrations/20260924120000_dashboard_message_visibility.sql'), 'utf8'));
  const api = load('lib/conversation-visibility.ts', mocks), conversations = load('lib/conversations.ts', mocks);
  const before = (await db.query('SELECT * FROM message_outbox')).rows;
  await api.hideConversationMessage(id(302));
  await api.hideConversationMessage(id(302));
  assert.deepEqual((await db.query('SELECT * FROM message_outbox')).rows, before, 'Outbox and idempotency key remain byte-for-byte unchanged');
  await rpc('hide_dashboard_message', ids.company, ids.broker, id(301));
  assert.equal((await db.query('SELECT content FROM messages WHERE id=$1', [id(301)])).rows[0].content, 'Original incoming');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM inbound_reply_jobs')).rows[0].n, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM attendance_replies')).rows[0].n, 1);
  const originalExternal = (await db.query('SELECT external_message_id FROM messages WHERE id=$1', [id(301)])).rows[0].external_message_id;
  assert.equal(originalExternal, 'incoming-dedupe', 'Hidden inbound remains deduplicated and available for recovery');
  await assert.rejects(() => db.query('INSERT INTO messages(id,company_id,external_message_id) VALUES($1,$2,$3)',[id(399),ids.company,originalExternal]),/duplicate key/);
  await assert.rejects(() => rpc('hide_dashboard_message', ids.company, ids.owner, id(303)), /message_missing/);
  await assert.rejects(() => rpc('hide_dashboard_message', ids.otherCompany, ids.owner, id(303)), /invalid_broker/);
  await assert.rejects(() => rpc('hide_dashboard_message', ids.company, ids.otherBroker, id(301)), /visibility_forbidden/);
  await assert.rejects(() => rpc('hide_dashboard_message', ids.company, ids.disabled, id(301)), /invalid_broker/);
  await db.query('UPDATE conversations SET assigned_broker_id=$1 WHERE id=$2',[ids.otherBroker,ids.conversation]);
  await assert.rejects(() => rpc('hide_dashboard_message', ids.company, ids.broker, id(301)), /visibility_forbidden/);
  await db.query('UPDATE conversations SET assigned_broker_id=$1 WHERE id=$2',[ids.broker,ids.conversation]);
  for (const state of ['pending', 'sending', 'uncertain']) {
    await db.query('INSERT INTO messages(id,company_id,conversation_id,content,direction) VALUES($1,$2,$3,$4,$5)', [id(400),ids.company,ids.conversation,'Unresolved','outgoing']);
    await db.query('INSERT INTO message_outbox VALUES($1,$2,$3,0,NULL,$4)', [id(400),ids.company,state,`unresolved-${state}`]);
    await assert.rejects(() => api.hideConversationMessage(id(400)), /message_in_flight/);
    assert.equal((await db.query('SELECT state FROM message_outbox WHERE id=$1', [id(400)])).rows[0].state,state);
    assert.equal((await db.query('SELECT dashboard_hidden_at FROM messages WHERE id=$1', [id(400)])).rows[0].dashboard_hidden_at,null);
    await db.query('DELETE FROM messages WHERE id=$1', [id(400)]); // disposable local fixture only
  }
  const listed = await conversations.listConversationData({ leadId: ids.lead });
  assert.equal(listed.messages.length,2,'Tombstone keeps timeline positions');
  for(const message of listed.messages) { assert.equal(message.hidden,true); assert.equal(message.text,'Mensagem removida do painel.'); assert.equal(message.images.length,0); assert.equal(message.canHide,false); assert.equal(message.canRetry,false); }
  await assert.rejects(() => conversations.readConversationImage(id(301),0), /Foto não encontrada/);
  account = { companyId: ids.otherCompany, brokerId: ids.foreignOwner, role: 'owner' };
  assert.equal((await conversations.listConversationData()).messages[0].text,'Foreign secret');
  account = { companyId: ids.company, brokerId: ids.owner, role: 'owner' };
  await db.exec('SET ROLE anon');
  await assert.rejects(() => rpc('hide_dashboard_message', ids.company, ids.owner, id(301)), /permission denied/);
  await db.exec('RESET ROLE');
  console.log('PASS tenant/account/ownership enforcement, unauthorized RPC denied, pending/sending/uncertain blocked, outbox + inbound/dedup intact, tombstone content and media masked');

  const shared = load('lib/shared-demo-conversations.ts', mocks);
  const count = (await db.query('SELECT count(*)::int AS n FROM messages')).rows[0].n;
  let demo = await shared.hideSharedDemoMessage('example-mariana','example-0');
  assert.equal(demo.messages[0].hidden,true);
  assert.equal(demo.messages[1].canHide,true);
  demo = await shared.hideSharedDemoMessage('example-mariana',id(501));
  assert.equal(demo.messages.at(-1).text,'Mensagem removida do painel.');
  const rev=demo.revision;
  assert.equal((await shared.hideSharedDemoMessage('example-mariana',id(501))).revision,rev,'Hide is idempotent');
  await assert.rejects(() => rpc('hide_demo_dashboard_message',ids.company,ids.otherBroker,'example-0','mariana'),/visibility_forbidden/);
  await assert.rejects(() => rpc('hide_demo_dashboard_message',ids.company,ids.owner,'example-0','ana'),/demo_claim_required/);
  await assert.rejects(() => rpc('hide_demo_dashboard_message',ids.company,ids.owner,'example-7','mariana'),/message_missing/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM messages')).rows[0].n,count,'Demo writes never touch live messages');
  assert.equal((await db.query('SELECT messages FROM demo_conversation_threads')).rows[0].messages[0].text,'Demo original');
  const reducer=load('lib/demo-conversations.ts'), visibility=load('lib/message-visibility.ts');
  let state=reducer.createLiveConversationState();
  const raw={id:'m',text:'Secret',side:'incoming',time:'12:00',images:['photo']};
  state=reducer.demoConversationReducer(state,{type:'hydrate',contacts:[{id:'lead',messages:[visibility.hideMessageContent(raw)]}]});
  for (const merge of [true,false]) { state=reducer.demoConversationReducer(state,{type:'hydrate',merge,contacts:[{id:'lead',messages:[raw]}]}); assert.equal(state.threads.lead.messages[0].hidden,true);assert.equal(state.threads.lead.messages[0].text,'Mensagem removida do painel.'); }
  for (const type of ['send','share-property']) {
    state=reducer.demoConversationReducer(state,{type,id:'lead',messageId:`replay-${type}`,time:'12:00',text:'Original hidden text',images:['photo'],propertyTitle:'Hidden property',message:visibility.hideMessageContent({...raw,id:`replay-${type}`})});
    assert.equal(state.threads.lead.messages.at(-1).hidden,true);
    assert.equal(state.threads.lead.messages.at(-1).text,'Mensagem removida do painel.');
    assert.equal(state.threads.lead.messages.at(-1).images.length,0);
  }
  const Bubble=load('app/conversation-message.tsx').ConversationMessageBubble;
  const html=renderToStaticMarkup(createElement(Bubble,{message:visibility.hideMessageContent(raw),demo:false,onHide:async()=>{}}));
  assert.doesNotMatch(html,/Secret|<img|Remover do painel|Tentar novamente/);
  assert.match(html,/Mensagem removida do painel/);
  assert.match(renderToStaticMarkup(createElement(Bubble,{message:{...raw,canHide:true},demo:false,onHide:async()=>{}})),/Remover mensagem do painel/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(Bubble,{message:{...raw,canHide:false},demo:false,onHide:async()=>{}})),/Remover mensagem do painel/);
  console.log('PASS persistent isolated demo, duplicate hide, broker restrictions, stale poll does not resurrect content, hidden UI no attachments/actions');

  const routeMocks={...mocks,'@/lib/accounts':{protectedRoute:fn=>async request=>request.cookies.get('imobflow_session')?.value?fn(request):Response.json({error:'Unauthorized'},{status:401})},
    'next/server':{NextResponse:Response},'@/lib/conversations':conversations,'@/lib/conversation-visibility':api,
    '@/lib/admin-auth':{isAdminRequest:request=>Boolean(request.cookies.get('imobflow_session')?.value)},
    '@/lib/request-security':{hasSameOrigin:request=>request.headers.get('origin')==='https://imobflow.test'}};
  const route=load('app/api/conversations/route.ts',routeMocks);
  function req(auth,origin,messageId){return{url:`https://imobflow.test/api/conversations?id=${encodeURIComponent(messageId)}`,cookies:{get:()=>auth?{value:'valid-session'}:undefined},headers:new Headers({origin})};}
  assert.equal((await route.DELETE(req(false,'https://imobflow.test',id(302)))).status,401);
  assert.equal((await route.DELETE(req(true,'https://foreign.test',id(302)))).status,403);
  assert.equal((await route.DELETE(req(true,'https://imobflow.test','bad-id'))).status,400);
  assert.equal((await route.DELETE(req(true,'https://imobflow.test',id(303)))).status,404);
  assert.equal((await route.DELETE(req(true,'https://imobflow.test',id(302)))).status,200);
  account = { companyId: ids.company, brokerId: ids.broker, role: 'broker' };
  const replay = await route.POST({...req(true,'https://imobflow.test',id(302)),json:async()=>({leadId:ids.lead,requestId:id(901),content:'Original sent'})});
  assert.equal(replay.status,201);
  const replayed = (await replay.json()).data;
  assert.equal(replayed.hidden,true); assert.equal(replayed.text,'Mensagem removida do painel.');
  assert.equal(replayed.images.length,0); assert.equal(replayed.audios.length,0);
  const read = await route.GET(req(true,'https://imobflow.test',id(302)));
  const readMessage = (await read.json()).data.find(message=>message.id===id(302));
  assert.equal(readMessage.text,replayed.text);assert.equal(readMessage.hidden,replayed.hidden);
  assert.deepEqual((await db.query('SELECT * FROM message_outbox')).rows,before,'POST replay changes neither dedup entry nor delivery state');
  assert.ok(calls.every(call=>call.method!=='DELETE'));
  console.log('PASS route guards, same-origin requirement, input/error mapping, hidden POST replay matches GET and no physical DELETE API calls');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await db?.close();});
