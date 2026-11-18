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
let state = [], index = 0, pendingEffects = [], performanceRequests = 0;
const react = {
  useState(initial) { const slot=index++; if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial; return [state[slot],next=>{state[slot]=typeof next==='function'?next(state[slot]):next;}]; },
  useEffect(fn){pendingEffects.push(fn);},useMemo:fn=>fn(),useRef:value=>({current:value}),useReducer:()=>[{},()=>{}],
};
const source=fs.readFileSync(path.join(__dirname,'../app/dashboard-client.tsx'),'utf8');
const api=compile(source+'\nexport { Overview, GoalsManagement, BrokerProfileModal, PeriodLoadNotice };', name => {
  if(name==='react')return react;
  if(name==='react/jsx-runtime')return require(name);
  if(name==='@/lib/calendar-date')return dates;
  if(name==='@/lib/dashboard-transport')return {dashboardFetch:async()=>{performanceRequests++;return {ok:false,json:async()=>({error:'Synthetic financial access denied'})};}};
  return {default:()=>null};
},{window:{addEventListener(){},removeEventListener(){}}});
const snapshot={month:'2026-09',companyGoal:1000,totalSold:200,salesCount:1,brokers:[],sales:[],history:[],conversionRate:0,averageTicket:200};
const props={notify(){},canEditGoals:true,canViewTeam:true,properties:[],refreshProperties:async()=>{},brokerName:'Teste',company:'Empresa',close(){}};
const visit=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(visit)];
function render(name, values, overrides = {}) { state=values;index=0;pendingEffects=[];return api[name]({...props,...overrides}); }
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
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);
const personal={...snapshot,leadsReceived:2,convertedLeads:1,recoveredLeads:0,
  brokers:[{broker:'Teste',sold:200,goal:1000,salesCount:1,progress:20,history:[],leadsReceived:2,convertedLeads:1,recoveredLeads:0,conversionRate:50,visits:1}],
  sales:[{id:'sale-synthetic',broker:'Teste',client:'Cliente sintético',property:'Imóvel sintético',dealType:'Venda',date:'2026-09-10',amount:200}]};
const personalOverview=render('Overview',['2026-09',0,personal,null,'Venda',false,false,null],{canEditGoals:false});
assert.match(text(personalOverview),/registre os fechamentos nas negociações/);
assert.doesNotMatch(text(personalOverview),/Resultado da empresa|Meta mensal da imobiliária|Líder do mês|Registrar negócio|Editar metas/);
pendingEffects.forEach(effect=>effect());
assert.equal(performanceRequests,0,'broker overview never requests the owner-only legacy financial API');
assert(!visit(personalOverview).some(node=>node.type==='button'&&String(node.props['aria-label']).startsWith('Excluir venda')));
assert(visit(personalOverview).some(node=>node.type==='a'&&node.props.href==='#conversations'),'broker receives the validated negotiation entry point');
const staleModal=render('Overview',['2026-09',0,personal,'sale','Venda',false,false,null],{canEditGoals:false});
assert(!visit(staleModal).some(node=>node.type==='form'),'an old open registration state never shows the owner form to a broker');
const ownerOverview=render('Overview',['2026-09',0,personal,'sale','Venda',false,false,null],{canEditGoals:true});
assert.match(text(ownerOverview),/Registrar negócio/); assert.match(text(ownerOverview),/Meta mensal da imobiliária/);
assert(visit(ownerOverview).some(node=>node.type==='form'),'owner keeps direct registration');
assert(visit(ownerOverview).some(node=>node.type==='button'&&String(node.props['aria-label']).startsWith('Excluir venda')));
const brokerProfile=render('BrokerProfileModal',['2026-09',0,personal,false,null],{canViewTeam:false});
assert.doesNotMatch(text(brokerProfile),/Posição na equipe|Participação no VGV|1º lugar/,'a portfolio-only snapshot cannot fabricate a company rank or 100% team share');
assert.match(text(brokerProfile),/Abrir minhas conversas/);
assert.doesNotMatch(text(brokerProfile),/Meta individual|Ticket médio|Negócios fechados/,'legacy financial records are not presented as a personal report');
pendingEffects.forEach(effect=>effect());
assert.equal(performanceRequests,0,'broker profile never requests the owner-only legacy financial API');
const ownerProfile=render('BrokerProfileModal',['2026-09',0,personal,false,null],{canViewTeam:true});
assert.match(text(ownerProfile),/Posição na equipe/); assert.match(text(ownerProfile),/Participação no VGV/);
console.log('PASS scoped performance UI: brokers never fetch/display legacy financial records, no direct sale/goal/delete controls, stale modal protection, negotiation guidance and no invented team ranking; owner controls preserved');
console.log('PASS Brazilian calendar boundaries, invalid/empty month, stale indicator hiding, retry state and goal-save period lock');
const config=fs.readFileSync(path.join(__dirname,'../next.config.ts'),'utf8');
const release=env=>compile(config,()=>({execSync:()=>{throw new Error('no checkout');}}),{process:{env}}).default.env.NEXT_PUBLIC_APP_RELEASE;
assert.equal(release({VERCEL_DEPLOYMENT_ID:'dpl_new',VERCEL_GIT_COMMIT_SHA:'same-sha'}),'dpl_new');
assert.notEqual(release({VERCEL_DEPLOYMENT_ID:'dpl_old',VERCEL_GIT_COMMIT_SHA:'same-sha'}),release({VERCEL_DEPLOYMENT_ID:'dpl_new',VERCEL_GIT_COMMIT_SHA:'same-sha'}));
assert.equal(release({VERCEL_URL:'unique.vercel.app'}),'unique.vercel.app');
assert.equal(release({VERCEL_GIT_COMMIT_SHA:'source-only'}),'source-only');
assert.equal(release({}),'development');
console.log('PASS release notice distinguishes deployments with identical Git revisions');
