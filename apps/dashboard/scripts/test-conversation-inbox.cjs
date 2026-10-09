// Real SQL in isolated PostgreSQL/WASM; fictional tenants, no provider requests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const root=path.resolve(__dirname,'..');
function load(file,deps={},globals={},suffix='') {
  const mod={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8')+suffix,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {module:mod,exports:mod.exports,require:name=>name in deps?deps[name]:require(name),Date,Intl,URL,Buffer,console,...globals});
  return mod.exports;
}
(async()=>{
  const db=await PGlite.create();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE broker_accounts(id uuid PRIMARY KEY,company_id uuid,active boolean,UNIQUE(company_id,id));
      CREATE TABLE conversations(id uuid PRIMARY KEY,company_id uuid,lead_id uuid,UNIQUE(company_id,id));
      CREATE TABLE messages(id uuid PRIMARY KEY,company_id uuid,conversation_id uuid,direction text,content text,created_at timestamptz,UNIQUE(company_id,conversation_id,id));
      INSERT INTO broker_accounts VALUES('${id(10)}','${id(1)}',true),('${id(11)}','${id(1)}',true),('${id(12)}','${id(2)}',true);
      INSERT INTO conversations VALUES('${id(20)}','${id(1)}','${id(30)}'),('${id(21)}','${id(1)}','${id(31)}'),('${id(22)}','${id(2)}','${id(32)}');
      INSERT INTO messages VALUES('${id(40)}','${id(1)}','${id(20)}','incoming','Before migration','2026-09-28T10:00:00Z');`);
    await db.exec(fs.readFileSync(path.resolve(root,'../../supabase/migrations/20260928210000_conversation_inbox.sql'),'utf8'));
    const inbox=async(broker=10,tenant=1,lead=null)=>(await db.query('SELECT get_conversation_inbox($1,$2,$3) AS data',[id(tenant),id(broker),lead?id(lead):null])).rows[0].data;
    const mark=async(position,broker=10,tenant=1,conv=20,lead=30)=>db.query('SELECT mark_conversation_read($1,$2,$3,$4)',[id(tenant),id(broker),id(lead),JSON.stringify([{conversationId:id(conv),position}])]);
    const message=async(n,conv,direction,time='2026-09-28T11:00:00Z')=>db.query('INSERT INTO messages VALUES($1,$2,$3,$4,$5,$6)',[id(n),id(conv===22?2:1),id(conv),direction,`Message ${n}`,time]);
    assert.equal((await inbox())[0].unread,1,'Existing history counted without fabricating previous reads');
    await message(41,21,'outgoing');
    assert.equal((await inbox())[0].leadId,id(31));assert.equal((await inbox())[0].unread,0,'Outgoing does not increase unread');
    await message(42,20,'incoming','2026-09-28T12:00:00Z');
    let snapshot=await inbox();assert.equal(snapshot[0].leadId,id(30));assert.equal(snapshot[0].unread,2);
    // Arrival after boundary must survive the acknowledgement; provider timestamp can even be old.
    await message(43,20,'incoming','2026-09-27T10:00:00Z');
    await mark(snapshot[0].incomingCount);
    assert.equal((await inbox())[0].unread,1);
    assert.equal((await inbox(11))[0].unread,3,'Read state belongs to the broker, not whole company');
    await mark(1);assert.equal((await inbox())[0].unread,1,'Delayed acknowledgement cannot move cursor backwards');
    await mark(3);await mark(3);assert.equal((await inbox())[0].unread,0,'Reload/idempotent reads keep count zero');
    await assert.rejects(()=>message(43,20,'incoming'),/duplicate key/);
    assert.equal((await inbox())[0].incomingCount,3,'Duplicate rolled back without counting twice');
    await message(44,22,'incoming');
    assert.equal((await inbox(12,2)).length,1);assert.equal((await inbox()).length,2);
    await assert.rejects(()=>inbox(12,1),/account_required/);
    await assert.rejects(()=>mark(1,10,1,22,32),/invalid_read_boundary/);
    await assert.rejects(()=>mark(999),/invalid_read_boundary/);
    await db.exec(`UPDATE broker_accounts SET active=false WHERE id='${id(11)}'`);
    await assert.rejects(()=>inbox(11),/account_required/);
    await assert.rejects(()=>mark(1,11),/account_required/);
    const privileges=(await db.query("SELECT has_function_privilege('anon','get_conversation_inbox(uuid,uuid,uuid)','EXECUTE') AS a,has_table_privilege('authenticated','conversation_reads','SELECT') AS b")).rows[0];
    assert.equal(privileges.a||privileges.b,false);
    // Many same-time messages must be counted beyond the 50/200 message display limits.
    await db.exec(`INSERT INTO messages SELECT gen_random_uuid(),'${id(1)}','${id(20)}','incoming','Bulk fictitious','2026-09-28T13:00:00Z' FROM generate_series(1,250)`);
    assert.equal((await inbox())[0].unread,250);
    assert.equal((await inbox(10,1,31))[0].incomingCount,0);
    console.log('PASS SQL inbox: backfill, recency, exact counters beyond display limits, per-user persistent reads, late arrivals, stale writes, duplicate rollback, tenant/grant guards');
  } finally {await db.close();}

  const helpers=load('lib/conversation-inbox.ts');
  const rows=[{leadId:'b',lastMessageAt:'2026-09-28T10:00:00Z',lastMessageId:'1',unread:2},{leadId:'a',lastMessageAt:'2026-09-28T11:00:00Z',lastMessageId:'2',unread:1}];
  rows.sort(helpers.compareInboxActivity);assert.equal(rows[0].leadId,'a');
  const grouped=helpers.inboxByLead([...rows,{...rows[0],lastMessageAt:'2026-09-28T12:00:00Z',unread:3}]);
  assert.equal(grouped.get('a').unread,4);assert.equal(grouped.get('a').lastMessageAt,'2026-09-28T12:00:00Z');

  let calls=[];
  const actor={companyId:id(1),brokerId:id(10)};
  const api=load('app/api/conversations/inbox/route.ts',{
    'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200})}},
    '@/lib/accounts':{protectedRoute:fn=>fn},'@/lib/tenant-context':{currentAccount:()=>actor},
    '@/lib/request-security':{hasSameOrigin:request=>request.safe!==false},
    '@/lib/supabase':{supabaseRequest:async(route,options)=>{calls.push({route,options});return []; }},
  });
  const request=(body,safe=true)=>({safe,text:async()=>JSON.stringify(body)});
  assert.equal((await api.GET({url:'https://test.invalid/api/conversations/inbox?leadId=invalid'})).status,400);
  await api.GET({url:'https://test.invalid/api/conversations/inbox?companyId=foreign&brokerId=foreign'});
  assert.equal(calls[0].options.body.p_company_id,actor.companyId);assert.equal(calls[0].options.body.p_broker_id,actor.brokerId);
  const body={leadId:id(30),positions:[{conversationId:id(20),position:4}],brokerId:'forged',companyId:'forged'};
  assert.equal((await api.POST(request(body,false))).status,403);
  for(const bad of [null,{}, {...body,positions:[null]},{...body,positions:[{conversationId:id(20),position:-1}]}]) assert.equal((await api.POST(request(bad))).status,400);
  assert.equal((await api.POST(request(body))).status,200);
  assert.equal(calls.at(-1).options.body.p_broker_id,actor.brokerId);
  console.log('PASS API: session-bound identity, same-origin, validated positions; recency and grouped unread helpers');

  const events=new EventTarget();const doc=new EventTarget();const scroller=new EventTarget();
  Object.assign(scroller,{scrollHeight:500,scrollTop:400,clientHeight:100});
  let focused=true;Object.assign(doc,{visibilityState:'hidden',hasFocus:()=>focused});
  let effects=[],requests=[],fail=false,refreshes=0;
  const readState={leadId:id(30),cursor:null,ready:true,positions:[{conversationId:id(20),position:3}]};
  const ui=load('app/conversation-center.tsx',{
    react:{useState:initial=>[initial?.leadId===''?readState:initial,()=>{}],useEffect:fn=>effects.push(fn),useMemo:fn=>fn(),useRef:initial=>({current:initial===null?scroller:initial})},
    'react/jsx-runtime':require('react/jsx-runtime'),
    '@/lib/dashboard-transport':{dashboardFetch:async(url,options)=>{requests.push({url,options});return {ok:!fail};}},
    '@/lib/demo-conversations':{demoContacts:[]},'@/lib/conversation-inbox':helpers,
    '@/lib/dashboard-sync':{announceDashboardChange:()=>refreshes++},
    './conversation-message':{},'./conversation-settings':{},'./conversation-whatsapp-handoff':{},
    './conversation-registration':{default:()=>null},
    './conversation-assistant':{default:()=>null}, './conversation-alerts':{default:()=>null},
    '@/lib/whatsapp-handoff':load('lib/whatsapp-handoff.ts'),
    './conversation-attendance':{describeConversationAttendance:()=>({canSend:true,owner:null})},
  },{window:events,document:doc,AbortController},'\nexport { ConversationWorkspace };');
  const lead={id:id(30),name:'Fictional',goal:'Compra',propertyType:'Casa',details:'',region:'Centro',lifecycleStatus:'Novo',temperature:'Frio'};
  const props={state:{selectedId:`lead-${lead.id}`,threads:{}},dispatch(){},notify(){},currentBrokerName:'Test',leads:[lead],ready:true};
  ui.ConversationWorkspace(props);
  const cleanup=effects.at(-1)();
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await flush();assert.equal(requests.length,0,'Hidden tab must not mark read');
  doc.visibilityState='visible';focused=false;doc.dispatchEvent(new Event('visibilitychange'));await flush();
  assert.equal(requests.length,0,'Unfocused window must not mark read');
  focused=true;scroller.scrollTop=0;events.dispatchEvent(new Event('focus'));await flush();
  assert.equal(requests.length,0,'Reading older history must not mark unseen arrivals');
  scroller.scrollTop=400;fail=true;scroller.dispatchEvent(new Event('scroll'));await flush();
  assert.equal(refreshes,0,'Failed acknowledgement cannot clear a count');
  fail=false;events.dispatchEvent(new Event('focus'));await flush();
  assert.equal(refreshes,1);assert.equal(JSON.parse(requests.at(-1).options.body).positions[0].position,3);
  events.dispatchEvent(new Event('focus'));await flush();assert.equal(requests.length,2,'Already acknowledged boundary is not posted again');
  cleanup();events.dispatchEvent(new Event('focus'));await flush();assert.equal(requests.length,2);
  effects=[];ui.ConversationWorkspace({...props,demonstration:true});assert.equal(effects.at(-1)(),undefined,'Demo cannot mark real reads');
  console.log('PASS real read effect: hidden/unfocused/scrolled-up guards, failed acknowledgement, success refresh, deduplication, cleanup and demo isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
