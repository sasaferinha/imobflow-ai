const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const slots=[],effects=[],changes=[];let cursor=0,validity='';const jsx=(type,props)=>({type,props});const exported={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/property-search-field.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
 exports:exported,require:n=>n==='react'?{useState:v=>{const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},useRef:()=>({current:{setCustomValidity:v=>validity=v,querySelector:()=>null,focus(){}}}),useEffect:f=>effects.push(f)}:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:{default:{}}
});
const options=Array.from({length:30},(_,i)=>({id:`p${i}`,name:`Apartamento ${i}`,detail:`AP-${i} · São José · Venda`,search:'Rua das Flores'}));options.push({id:'house',name:'Residência das Palmeiras',detail:'Casa · Centro · Aluguel',search:''});
assert.equal(exported.searchProperties(options,'').length,0);
assert.equal(exported.searchProperties(options,'a').length,0);
assert.equal(exported.searchProperties(options,'casa')[0].id,'house');
assert.equal(exported.searchProperties(options,'apartamento sao jose').length,30);
assert.equal(exported.searchProperties(options,'casa venda').length,0);
assert.equal(exported.searchProperties(options,'flores').length,30);
let value='';function nodes(v){return !v||typeof v!=='object'?[]:Array.isArray(v)?v.flatMap(nodes):[v,...nodes(v.props?.children)]}
function render(){cursor=0;effects.length=0;const tree=nodes(exported.default({id:'property',value,options,required:true,onChange:v=>{value=v;changes.push(v)}}));effects.forEach(f=>f());return tree;}
let tree=render();assert(!tree.some(n=>n.props?.role==='option'));assert(validity);
tree.find(n=>n.type==='input').props.onFocus();tree=render();assert(!tree.some(n=>n.props?.role==='option'));
tree.find(n=>n.type==='input').props.onChange({target:{value:'apartamento'}});tree=render();assert.equal(tree.filter(n=>n.props?.role==='option').length,8);assert(validity,'Typed text must not qualify as a selected property');
tree.find(n=>n.type==='input').props.onKeyDown({key:'ArrowDown',preventDefault(){}});tree=render();
tree.find(n=>n.type==='input').props.onKeyDown({key:'Enter',preventDefault(){}});tree=render();assert.equal(value,'p0');assert.equal(validity,'');assert.equal(tree.find(n=>n.type==='input').props.value,'Apartamento 0');
tree.find(n=>n.type==='button').props.onClick();tree=render();assert.equal(value,'');assert(validity);
value='existing-not-loaded';tree=render();assert.equal(value,'existing-not-loaded');assert.equal(validity,'');
console.log('PASS property search: no initial list, accents/type/location/multiple terms, eight-result bound, explicit selection validation, keyboard selection, clear and preserved existing reference. No network.');
