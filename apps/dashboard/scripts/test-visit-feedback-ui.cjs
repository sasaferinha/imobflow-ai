const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const jsx=(type,props)=>({type,props:props||{}}),css=new Proxy({},{get:(_,key)=>String(key)});
const nodes=t=>t&&typeof t==='object'?[t,...[t.props?.children].flat(Infinity).flatMap(nodes)]:[];
const text=t=>typeof t==='string'||typeof t==='number'?String(t):t&&typeof t==='object'?[t.props?.children].flat(Infinity).map(text).join(' '):'';
function harness(file,props,fetcher){
  const slots=[],effects=[],calls=[];let index=0,tree;
  const react={
    useState(initial){const i=index++;slots[i]||=( {value:typeof initial==='function'?initial():initial});return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(value){const i=index++;return slots[i]||=( {current:value});},
    useEffect(fn,deps){const i=index++,old=slots[i];if(!old||deps.some((value,j)=>value!==old.deps[j]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}
  };
  const mod={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:mod,exports:mod.exports,require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name.endsWith('.css')?css:(()=>{throw Error(name);})(),AbortController,Date,console,fetch:async(url,options)=>{calls.push({url,options});return fetcher(url,options);},navigator:{clipboard:{writeText:async()=>{}}}});
  const render=()=>{index=0;tree=mod.exports.default(props);while(effects.length)effects.shift()();return tree;};
  render();return {calls,render,get tree(){return tree;},async settle(){for(let n=0;n<20;n++)await Promise.resolve();render();},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
(async()=>{
  let finish;
  const ui=harness('app/avaliacao/[token]/feedback-form.tsx',{token:'synthetic-token'},async(_url,options)=>options?.method==='POST'?new Promise(resolve=>{finish=()=>resolve(Response.json({saved:true}));}):Response.json({propertyName:'Imóvel fictício',brandName:'Imobiliária Teste',logoUrl:'',primaryColor:'#123456',submitted:false,visitEndedAt:'2026-11-08T12:00:00Z'}));
  await ui.settle();assert.match(text(ui.tree),/Imobiliária Teste/);assert.equal(nodes(ui.tree).filter(n=>n.type==='select').length,0,'no extra visit/interest dropdowns');
  let stars=nodes(ui.tree).filter(n=>n.type==='input'&&n.props.type==='radio');assert.equal(stars.length,5);assert.match(stars[4].props['aria-label'],/5 estrelas/);
  assert.equal(nodes(ui.tree).find(n=>n.type==='textarea').props.required,undefined);
  assert.equal(nodes(ui.tree).find(n=>n.type==='button').props.disabled,true);
  stars[4].props.onChange();ui.render();
  const form=nodes(ui.tree).find(n=>n.type==='form');const a=form.props.onSubmit({preventDefault(){}}),b=form.props.onSubmit({preventDefault(){}});
  await ui.settle();assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,1,'duplicate submit locked synchronously');
  assert.deepEqual(JSON.parse(ui.calls.at(-1).options.body),{propertyScore:5,comment:''},'only stars and optional note submitted');
  finish();await Promise.all([a,b]);await ui.settle();assert.match(text(ui.tree),/Obrigado pela sua opinião/);ui.unmount();
  const feedback={id:'request',propertyName:'Imóvel A',visitId:'visit-a',visitEndedAt:'2026-11-08T12:00:00Z',brokerName:'Corretor A',expiresAt:'2027-02-01T12:00:00Z',submittedAt:null,propertyScore:null,comment:null,url:'https://example.test/avaliacao/private'};
  const panel=harness('app/evolution/property-feedback-panel.tsx',{caseId:'case-a',visitId:'visit-a'},async()=>Response.json({requests:[feedback]}));
  await panel.settle();assert.match(panel.calls[0].url,/visitId=visit-a/);assert.match(text(panel.tree),/Copiar link/);assert.ok(!nodes(panel.tree).some(n=>n.type==='button'&&/Enviar pelo WhatsApp/.test(text(n))));
  const obtain=nodes(panel.tree).find(n=>n.type==='button'&&text(n)==='Obter link da avaliação');await obtain.props.onClick();await panel.settle();
  assert.deepEqual(JSON.parse(panel.calls.at(-1).options.body),{caseId:'case-a',visitId:'visit-a',send:false});panel.unmount();
  const demo=harness('app/evolution/property-feedback-panel.tsx',{caseId:'case-a',visitId:'visit-a',demonstration:true},()=>{throw Error('demo must not fetch');});
  const demoButton=nodes(demo.tree).find(n=>n.type==='button'&&text(n)==='Obter link da avaliação');await demoButton.props.onClick();await demo.settle();assert.equal(demo.calls.length,0);demo.unmount();
  console.log('PASS feedback UI: five keyboard-accessible stars, company brand, optional note, duplicate-submit guard, exact visit selection, manual copy, demo no network.');
})().catch(error=>{console.error(error);process.exitCode=1;});
