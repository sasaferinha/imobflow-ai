const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function compile(source, imports, globals = {}) {
  const mod = { exports:{} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX} }).outputText, {
    module:mod,exports:mod.exports,require:imports,Date,Intl,console,...globals,
  });
  return mod.exports;
}
const dates = compile(fs.readFileSync(path.join(__dirname,'../lib/calendar-date.ts'),'utf8'), require);
assert.equal(dates.businessCalendarDate(new Date('2026-10-01T01:30:00Z')), '2026-09-30');
assert.equal(dates.businessCalendarDate(new Date('2027-01-01T02:59:00Z')), '2026-12-31');
assert.equal(dates.businessCalendarDate(new Date('2027-01-01T03:00:00Z')), '2027-01-01');
for(const value of ['', '2026-00','2026-13','0000-09','26-09','2026-09-01']) assert.equal(dates.isCalendarMonth(value),false);
assert.equal(dates.isCalendarMonth('2026-09'),true);

// Exercise actual component event handlers and rendered trees without network.
let state = [], index = 0;
const react = {
  useState(initial) { const slot=index++; if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial; return [state[slot],next=>{state[slot]=typeof next==='function'?next(state[slot]):next;}]; },
  useEffect(){},useMemo:fn=>fn(),useRef:value=>({current:value}),useReducer:()=>[{},()=>{}],
};
const source=fs.readFileSync(path.join(__dirname,'../app/dashboard-client.tsx'),'utf8');
const api=compile(source+'\nexport { Overview, GoalsManagement, BrokerProfileModal, PeriodLoadNotice };', name => {
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return require(name);
  if(name==='@/lib/calendar-date')return dates;
  return {default:()=>null};
});
const snapshot={month:'2026-09',companyGoal:1000,totalSold:200,salesCount:1,brokers:[],sales:[],history:[],conversionRate:0,averageTicket:200};
const props={notify(){},canEditGoals:true,properties:[],refreshProperties:async()=>{},brokerName:'Teste',company:'Empresa',close(){}};
const visit=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(visit)];
function render(name, values) { state=values;index=0;return api[name](props); }
for(const name of ['Overview','GoalsManagement','BrokerProfileModal']) {
  const overview=name==='Overview';
  const values=()=>overview?['2026-09',0,snapshot,null,'Venda',false,false,null]:name==='GoalsManagement'?['2026-09',0,snapshot,false,false,null]:['2026-09',0,snapshot,false,null];
  const tree=render(name,values());
  const picker=visit(tree).find(node=>node.type==='input'&&node.props.type==='month');
  assert.ok(picker,name+' renders a month picker');
  picker.props.onChange({target:{value:''}});
  assert.equal(state[0],'2026-09',name+' clearing month must not crash rendering');
  picker.props.onChange({target:{value:'2026-10'}});
  assert.equal(state[0],'2026-10');
  index=0;const pending=api[name](props);
  const notice=visit(pending).find(node=>node.type===api.PeriodLoadNotice);
  assert.ok(notice,name+' hides old month data immediately');
  assert.equal(notice.props.loading,true);
  const failed=values();failed[0]='2026-10';failed[overview?7:name==='GoalsManagement'?5:4]='Falha de conexão';
  const failureTree=render(name,failed);
  const failureNotice=visit(failureTree).find(node=>node.type===api.PeriodLoadNotice);
  assert.ok(failureNotice,name+' must not label stale data as updated after failure');
  assert.equal(failureNotice.props.error,'Falha de conexão');
}
const saving=render('GoalsManagement',['2026-09',0,snapshot,false,true,null]);
const lockedPicker=visit(saving).find(node=>node.type==='input'&&node.props.type==='month');
assert.equal(lockedPicker.props.disabled,true,'cannot change month while saving its goals');
lockedPicker.props.onChange({target:{value:'2026-10'}});
assert.equal(state[0],'2026-09');
console.log('PASS Brazilian calendar boundaries, invalid/empty month, stale indicator hiding, retry state and goal-save period lock');
const config=fs.readFileSync(path.join(__dirname,'../next.config.ts'),'utf8');
const release=env=>compile(config,()=>({execSync:()=>{throw new Error('no checkout');}}),{process:{env}}).default.env.NEXT_PUBLIC_APP_RELEASE;
assert.equal(release({VERCEL_DEPLOYMENT_ID:'dpl_new',VERCEL_GIT_COMMIT_SHA:'same-sha'}),'dpl_new');
assert.notEqual(release({VERCEL_DEPLOYMENT_ID:'dpl_old',VERCEL_GIT_COMMIT_SHA:'same-sha'}),release({VERCEL_DEPLOYMENT_ID:'dpl_new',VERCEL_GIT_COMMIT_SHA:'same-sha'}));
assert.equal(release({VERCEL_URL:'unique.vercel.app'}),'unique.vercel.app');
assert.equal(release({VERCEL_GIT_COMMIT_SHA:'source-only'}),'source-only');
assert.equal(release({}),'development');
console.log('PASS release notice distinguishes deployments with identical Git revisions');
