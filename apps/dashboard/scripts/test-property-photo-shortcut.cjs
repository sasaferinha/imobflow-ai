const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../app/dashboard-client.tsx'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  useEffect(() => {\n    if (!propertyPhotoRequest) return;');
assert(start >= 0);
const end = source.indexOf('  useEffect(() => {', start + 10);
const code = ts.transpileModule(source.slice(start, end), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
async function run(data, ok = true, abort = false) {
  const state = {}, calls = []; let cleanup;
  vm.runInNewContext(code, {
    AbortController, propertyPhotoRequest:{id:'wanted'}, focusPropertyPhotos:{current:false},
    useEffect: fn => { cleanup = fn(); },
    fetch: async (url, options) => { calls.push({url, options}); return {ok, json:async()=>({data, error:'Falha simulada'})}; },
    setSelectedProperty:value=>state.selected=value,
    setEditingProperty:value=>state.editing=value,
    setPropertyImages:value=>state.images=value,
    setPropertyModalOpen:value=>state.open=value,
    setToast:value=>state.error=value,
  });
  if (abort) cleanup();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0].url,'/api/properties');
  assert.equal(calls[0].options.method,undefined, 'Opening photos must not write');
  return state;
}
(async()=>{
  const property={id:'wanted',title:'Casa teste',images:['https://example.com/existing.jpg']};
  const result=await run([{id:'other',images:[]},property]);
  assert.equal(result.editing,property); assert.equal(result.images,property.images); assert.equal(result.open,true);
  assert.match((await run([])).error,/não encontrado/);
  assert.equal((await run([],false)).error,'Falha simulada');
  assert.deepEqual(await run([property],true,true),{});
  console.log('PASS photo shortcut: exact property, existing images, missing/failed load, cancelled request; no writes');
})().catch(error=>{console.error(error);process.exitCode=1;});
