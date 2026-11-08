const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const jsx=(type,props)=>({type,props});const slots=[];let cursor=0,requests=[],rejectPost=false;
const exportsUI={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/opportunity-whatsapp-send.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports:exportsUI,crypto:{randomUUID:()=> 'request-fixture'},
  require:n=>{
    if(n==='react')return {useEffect:()=>{},useRef:v=>{const i=cursor++;return slots[i]??(slots[i]={current:v})},useState:v=>{const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],v=>{slots[i]=v}];}};
    if(n==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(n==='@/lib/dashboard-sync')return {announceDashboardChange:()=>{}};
    if(n==='@/lib/dashboard-transport')return {dashboardFetch:async(url,options)=>{requests.push({url,options});if(options?.method==='POST'&&rejectPost)throw Error('response lost');return{ok:true,json:async()=>({data:options?.method==='POST'?{requestId:'request-fixture',count:2}:{recipient:'Cliente fictício',phone:'5500000000',sender:'Imobiliária'}})}}};
    if(n.endsWith('.css'))return {default:{}};
    throw Error(n);
  }
});
function nodes(v){return !v||typeof v!=='object'?[]:Array.isArray(v)?v.flatMap(nodes):[v,...nodes(v.props?.children)]}
function text(v){return v==null?'':Array.isArray(v)?v.map(text).join(''):typeof v==='object'?text(v.props?.children):String(v)}
const props={opportunityId:'fixture',message:'Mensagem editada',images:['foto']};
function render(p=props){cursor=0;return nodes(exportsUI.default(p))}
function button(tree,label){return tree.find(n=>n.type==='button'&&text(n.props.children).includes(label))}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve()}
(async()=>{
  let tree=render();assert.equal(requests.length,0);
  button(tree,'Enviar pelo').props.onClick();await flush();tree=render();assert.equal(requests.length,1);assert(!requests[0].options.method);
  tree=render({...props,message:'Outra mensagem'});const changed=button(tree,'Confirmar e enviar');assert(changed.props.disabled);changed.props.onClick();await flush();assert.equal(requests.length,1);
  tree=render();rejectPost=true;button(tree,'Confirmar e enviar').props.onClick();await flush();
  const first=JSON.parse(requests[1].options.body);assert.equal(first.content,props.message);assert.equal(first.images[0],'foto');assert.equal(first.confirmed,true);
  tree=render();rejectPost=false;button(tree,'Confirmar e enviar').props.onClick();await flush();
  assert.equal(JSON.parse(requests[2].options.body).requestId,first.requestId,'Uncertain response must keep the idempotency key');
  tree=render();assert(!button(tree,'Confirmar e enviar'));assert(tree.some(n=>n.props?.role==='status'&&text(n).includes('Envio registrado')));
  console.log('PASS property WhatsApp UI: explicit preflight/confirm, changed draft blocked, edited text and selected files, stable retry key, honest queue status; no network.');
})().catch(e=>{console.error(e);process.exitCode=1});
