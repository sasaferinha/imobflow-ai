const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'..');const source=fs.readFileSync(path.join(root,'app/opportunity-photos.tsx'),'utf8');
const jsx=(type,props)=>({type,props});let shared=[],index=0;let supported=true;
const file={name:'foto.jpg'};let states=[['photo'],[{source:'photo',file,url:'blob:fake'}],'',false,''];const moduleExports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:moduleExports,DOMException,navigator:{canShare:()=>supported,share:async data=>shared.push(data)},require:id=>id==='react'?{useEffect:()=>{},useState:()=>{const i=index++;return [states[i],value=>states[i]=typeof value==='function'?value(states[i]):value]}}:id==='react/jsx-runtime'?{jsx,jsxs:jsx}:{default:{}}});
function nodes(x){if(!x||typeof x!=='object')return [];if(Array.isArray(x))return x.flatMap(nodes);return [x,...nodes(x.props?.children)]}
function render(){index=0;return nodes(moduleExports.default({images:['photo'],message:'Mensagem editada',customer:'Cliente fictício'}))}
(async()=>{
let tree=render();assert(tree.some(n=>n.type==='a'&&n.props.download==='foto.jpg'));
await tree.find(n=>n.type==='button').props.onClick();await new Promise(r=>setImmediate(r));
assert.equal(shared[0].text,'Mensagem editada');assert.equal(shared[0].files[0],file);assert.match(states[4],/finalize o envio/);
supported=false;tree=render();assert(!tree.some(n=>n.type==='button'));assert(tree.some(n=>n.type==='a'&&n.props.href==='blob:fake'));
tree.find(n=>n.type==='input').props.onChange();assert.equal(states[0].length,0);assert.equal(states[1].length,0);
console.log('PASS opportunity photos: edited text+files, honest share status, download fallback and deselection; no real sends');
})().catch(e=>{console.error(e);process.exitCode=1});
