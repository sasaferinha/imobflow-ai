// Execute the real component effects against a fake transport; never contacts production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies, globals = {}) {
  const module = {exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText, {module,exports:module.exports,require: name => dependencies[name] || {default:()=>null},Date,Intl,console,...globals});
  return module.exports;
}
let state=[], index=0, effects=[], subscriptions=[], calls=[], actions=[];
const react={
  useState(initial) { const slot=index++; if(!(slot in state)) state[slot]=typeof initial==='function'?initial():initial; return [state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}]; },
  useEffect(fn){effects.push(fn);},useMemo:fn=>fn(),useRef:value=>({current:value}),useReducer:()=>[{},action=>actions.push(action)],
};
let payload = [], succeed = true, confirm = false;
const transport={dashboardFetch:async(url,options)=>{calls.push({url,options});return {ok:succeed,json:async()=>({data:payload,ok:succeed,attendance:[]})};}};
const globals={window:{addEventListener(){},removeEventListener(){},localStorage:{getItem:()=>null},confirm:()=>confirm},document:{cookie:''}};
const dependencies={react,'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/dashboard-transport':transport,
  '@/lib/dashboard-sync':{subscribeDashboardSync:options=>{subscriptions.push(options);return ()=>{};}},
};
const dashboard=load('app/dashboard-client.tsx',dependencies,globals).default;
const renderDashboard=view=>{
  state=[];index=0;effects=[];subscriptions=[];calls=[];actions=[];
  dashboard({account:{name:'Owner',company:'Test',role:'owner'},initialView:view});
  effects.forEach(fn=>fn());
};
const visit=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(visit)];
(async()=>{
  for(const view of ['overview','integrations','leads','conversations','agenda']) {
    renderDashboard(view);
    for(const subscription of subscriptions) await subscription.load(new AbortController().signal);
    assert.equal(calls.some(call=>call.url==='/api/conversations'),view==='conversations',`${view}: message polling only in Conversations`);
    assert.equal(calls.some(call=>call.url==='/api/appointments'),view==='agenda',`${view}: agenda polling only in Agenda`);
    assert.equal(calls.filter(call=>call.url==='/api/conversations/inbox').length,1,'Lightweight unread summary works on every screen');
    const leads=subscriptions.find(sub=>sub.entities.includes('leads'));
    assert.equal(leads.interval,['leads','conversations'].includes(view)?15000:60000);
  }
  const lead={id:'lead-a',name:'First',goal:'Compra',propertyType:'Casa'};
  renderDashboard('conversations');
  subscriptions.find(sub=>sub.entities.includes('leads')).apply([lead,{...lead,name:'Duplicate'},{...lead,id:'lead-b'}]);
  const stored=state.find(value=>Array.isArray(value)&&value[0]?.id==='lead-a');
  assert.equal(stored.length,2);assert.equal(stored[0].name,'First');
  const messages={data:[{id:'m1',leadId:'lead-a',text:'Message'}],attendance:[{leadId:'lead-b',attendanceMode:'human'}]};
  subscriptions.filter(sub=>sub.entities.includes('leads'))[1].apply(messages);
  assert.equal(actions[0].merge,true);
  assert.equal(actions[0].contacts.length,2,'Attendance without recent messages is preserved');
  assert.equal(actions[0].contacts[0].messages[0].id,'m1');
  subscriptions.find(sub=>sub.entities.includes('conversation-inbox')).apply([{unread:2},{unread:3}]);
  index=0;
  let tree=dashboard({account:{name:'Owner',company:'Test',role:'owner'},initialView:'conversations'});
  assert.equal(visit(tree).find(node=>node.props?.className==='conversation-unread-badge').props.children,5);
  subscriptions.find(sub=>sub.entities.includes('conversation-inbox')).apply([]);
  index=0;tree=dashboard({account:{name:'Owner',company:'Test',role:'owner'},initialView:'conversations'});
  assert.ok(!visit(tree).some(node=>node.props?.className==='conversation-unread-badge'),'Zero unread hides badge');
  console.log('PASS actual dashboard effects: no background message/agenda polling, independent lead refresh, linear dedup and preserved hydration');

  // Verify the destructive UI needs confirmation and does not optimistically hide failed deletions.
  const team=load('app/team-modal.tsx',{...dependencies,'@/lib/plans':{planNameForLimit:()=> 'Basic'}},globals).default;
  const owner={id:'owner',name:'Owner',role:'owner',active:true};
  const broker={id:'broker',name:'Broker',role:'broker',active:true};
  state=[[owner,broker],5,false];index=0;effects=[];calls=[];
  const renderTeam=()=>{index=0;return team({close(){},notify(){}});};
  const button=()=>visit(renderTeam()).filter(node=>node.type==='button'&&node.props.children==='Excluir');
  assert.equal(button().length,1,'Owner cannot be removed');
  await button()[0].props.onClick();assert.equal(calls.length,0,'Cancel must not issue a request');
  confirm=true;succeed=false;
  await button()[0].props.onClick();assert.equal(state[0].length,2,'Failed deletion preserves the visible broker');
  succeed=true;
  await button()[0].props.onClick();assert.equal(state[0].length,1);assert.equal(state[0][0].id,'owner');
  assert.equal(calls.at(-1).options.method,'DELETE');assert.equal(JSON.parse(calls.at(-1).options.body).confirm,true);
  console.log('PASS team UI: confirmation/cancellation, owner protection, error preservation and removal only after success');

  // Agenda labels should never transfer photos, full lead profiles, or scan when empty.
  let rows=[];calls=[];
  const database=load('lib/database.ts',{'./supabase':{supabaseCompanyId:()=> 'tenant',supabaseRequest:async url=>{
    calls.push(url);assert.ok(url.includes('company_id=eq.tenant'));
    return url.startsWith('appointments?')?rows:[];
  }}});
  await database.listAppointments();assert.equal(calls.length,1);
  rows=[{id:'appointment',scheduled_at:'2026-09-28T18:00:00Z',created_at:'2026-09-28T18:00:00Z',notes:'Client · House'}];
  calls=[];const agenda=await database.listAppointments();
  assert.equal(agenda[0].name,'Client');assert.equal(agenda[0].property,'House');
  assert.ok(calls.some(url=>url.endsWith('select=id,name')));
  assert.ok(calls.some(url=>url.endsWith('select=id,title')));
  console.log('PASS agenda skips empty joins and reads tenant-scoped name-only projections');
})().catch(error=>{console.error(error);process.exitCode=1;});
