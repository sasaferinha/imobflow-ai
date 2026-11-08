const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const root=path.resolve(__dirname,'..');
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
const text=t=>t==null||typeof t==='boolean'?'':Array.isArray(t)?t.map(text).join(''):typeof t==='object'?text(t.props?.children):String(t);
const find=(tree,p)=>nodes(tree).find(p),button=(tree,label)=>find(tree,n=>n.type==='button'&&text(n).trim()===label);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(initial,environment={}) {
 let cursor=0,dirty=false,effects=[],tree,props=initial; const slots=[];
 const differs=(a,b)=>!a||!b||a.length!==b.length||a.some((v,i)=>v!==b[i]);
 const hooks={...React,useState(value){const i=cursor++;if(!(i in slots))slots[i]={value:typeof value==='function'?value():value};return[slots[i].value,update=>{const next=typeof update==='function'?update(slots[i].value):update;if(next!==slots[i].value){slots[i].value=next;dirty=true;}}];},useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},useEffect(effect,deps){const i=cursor++;if(!(i in slots)||differs(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}};
 const cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const mod={exports:{}};cache.set(file,mod.exports);const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{module:mod,exports:mod.exports,Date,Intl,URL,queueMicrotask,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000999'},console,require:name=>{
   if(name==='react')return hooks;if(name==='react/jsx-runtime')return require(name);
   if(name.endsWith('.css'))return{default:new Proxy({},{get:(_,key)=>String(key)})};
   if(name==='@/lib/dashboard-transport')return{dashboardFetch:environment.fetch||(()=>{throw Error('Unexpected network');}),isProductDemo:()=>false};
   if(name==='@/lib/dashboard-sync')return{subscribeDashboardSync:environment.subscribe||(()=>{throw Error('Unexpected subscription');}),announceDashboardChange:()=>{}};
   if(name==='@/lib/lead-channel')return{channelLabel:channel=>channel==='facebook'?'Facebook Messenger':'Instagram'};
   if(name==='./conversation-channels')return{ChannelIcon:()=>null};
   if(['./conversation-assistant','./conversation-registration'].includes(name))return{default:()=>null};
   if(name==='@/lib/social-model')return load('lib/social-model.ts');
   throw Error(`Unexpected dependency ${name}`);
  }});return mod.exports;
 }
 const Component=load('app/social-conversations.tsx').default;
 function render(update){props={...props,...update};let count=0;do{dirty=false;cursor=0;effects=[];tree=Component(props);effects.forEach(effect=>effect());assert(++count<20,'Render must settle');}while(dirty);return tree;}
 render();return{render,get tree(){return tree;}};
}
const contact=(id,extra={})=>({id,leadId:`lead-${id}`,channel:'instagram',name:`Cliente ${id}`,assignedTo:null,assignedBrokerId:null,lastMessageAt:new Date().toISOString(),lastInboundAt:new Date().toISOString(),mode:'human',messages:[],nextCursor:null,windowEndsAt:new Date(Date.now()+3600000).toISOString(),canSend:false,connectionReady:true,claimBlockedReason:null,leadProfile:{goal:'Comprar',propertyType:'Apartamento',region:'Centro'},...extra});
(async()=>{
 let subscription;const requests=[];let release;
 let savedDrafts={drafts:{},photos:{}};
 const props={channel:'instagram',currentBrokerId:'owner',isAdministrator:true,initialLeadId:'lead-b',memory:{read:()=>savedDrafts,write:(drafts,photos)=>{savedDrafts={drafts,photos};},requests:new Map()},onBusyChange:()=>{},notify:()=>{}};
 const h=harness(props,{subscribe:options=>{subscription=options;return()=>{};},fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});await new Promise(resolve=>release=resolve);return{ok:true,json:async()=>({ok:true})};}});
 const rows=[contact('a'),contact('b',{assignedTo:'Outro corretor',assignedBrokerId:'other',urgent:true,waitingSince:new Date(Date.now()-7200000).toISOString()})];
 subscription.apply(rows);h.render();await tick();h.render();
 assert.equal(h.tree.props['data-selected'],true,'external lead opens mobile conversation');
 assert.equal(text(find(h.tree,n=>n.type==='h3')),'Cliente b');
 assert.ok(text(h.tree).includes('Aguardando resposta'),'server-confirmed alert is visible');
 assert.equal(button(h.tree,'Assumir atendimento').props.disabled,false,'administrator can explicitly take another portfolio');
 button(h.tree,'Voltar').props.onClick();h.render();
 assert.equal(h.tree.props['data-selected'],false,'back returns to list despite initialLeadId prop');
 h.render({initialLeadId:'lead-a'});await tick();h.render();assert.equal(text(find(h.tree,n=>n.type==='h3')),'Cliente a','new external target is followed');
 h.render({initialLeadId:'lead-b'});await tick();h.render();
 const claim=button(h.tree,'Assumir atendimento');claim.props.onClick();claim.props.onClick();h.render();
 assert.equal(requests.length,1,'same-tick double click makes one handoff');
 assert.equal(requests[0].body.threadId,'b');assert.equal(requests[0].body.mode,'human');
 release();await tick();h.render();
 subscription.apply([contact('a',{claimBlockedReason:'broker_compliance_pending'})]);h.render({initialLeadId:'lead-a',isAdministrator:false,currentBrokerId:'broker'});
 assert.equal(button(h.tree,'Assumir atendimento').props.disabled,true);
 assert.ok(text(h.tree).includes('Conclua os registros'),'compliance reason is actionable');
 subscription.apply([contact('a',{connectionReady:false})]);h.render();
 assert.ok(text(h.tree).includes('conexão deste canal está incompleta'),'connection problem is not misreported as messaging window');
 let demoCalls=0;
 const demo=harness({...props,demonstration:true},{subscribe:()=>{demoCalls++;},fetch:()=>{demoCalls++;}});
 assert.equal(demoCalls,0);assert.ok(text(demo.tree).includes('não envia mensagens'));
 console.log('PASS social UI: initial target changes, mobile back, owner takeover, same-tick guard, compliance hint, connection status and demo no network.');
})().catch(error=>{console.error(error);process.exitCode=1;});
