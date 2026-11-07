const assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app/dashboard-client.tsx'),'utf8');
assert(source.includes('onPhotos(property)'));assert(source.includes('Gerenciar fotos'));assert(!source.includes('propertyPhotoRequest'));assert(!source.includes('className="property-image-field"'));
const evolution=fs.readFileSync(path.join(root,'app/evolution/evolution-client.tsx'),'utf8');assert(!evolution.includes('Fotos e catálogo'));assert(!evolution.includes('setPropertyPhotoRequest'));
const exportsComponent={}; const jsx=(type,props)=>({type,props});let events=[];
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'app/property-photo-manager.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:exportsComponent,document:{body:{}},require:id=>id==='react'?{useEffect:()=>{},useRef:()=>({current:null})}:id==='react-dom'?{createPortal:node=>node}:id==='react/jsx-runtime'?{jsx,jsxs:jsx}:{default:{}}});
function nodes(x){if(!x||typeof x!=='object')return [];if(Array.isArray(x))return x.flatMap(nodes);return [x,...nodes(x.props?.children)]}
const base={title:'Casa fictícia',images:['a','b'],busy:false,saving:false,preparing:false,error:'',onAdd:x=>events.push(['add',x]),onRemove:x=>events.push(['remove',x]),onCover:x=>events.push(['cover',x]),onClose:()=>events.push(['close']),onSave:()=>events.push(['save'])};
let tree=nodes(exportsComponent.default(base));assert(tree.find(n=>n.props?.role==='dialog'));
tree.find(n=>n.props?.['aria-label']==='Remover foto 2').props.onClick();
tree.find(n=>n.type==='button'&&n.props.children==='Usar como capa').props.onClick();
tree.find(n=>n.type==='button'&&n.props.children==='Salvar fotos').props.onClick();
assert.deepEqual(events,[['remove',1],['cover',1],['save']]);
const target={files:['fake-image'],value:'file'};tree.find(n=>n.type==='input').props.onChange({target});assert.equal(target.value,'');
tree=nodes(exportsComponent.default({...base,busy:true}));assert(tree.filter(n=>n.type==='button').every(n=>n.props.disabled));
console.log('PASS catalog photo manager: direct card action, no registration redirect/upload, gallery, cover/removal/save, busy guards');
