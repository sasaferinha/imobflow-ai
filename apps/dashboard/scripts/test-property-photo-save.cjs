const assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
let writes=[],persisted=[],authorized=true,sameOrigin=true;
const exportsRoute={};
const source=fs.readFileSync(path.join(__dirname,'../app/api/properties/[id]/route.ts'),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsRoute,console,require:id=>{
 if(id==='@/lib/accounts')return {protectedRoute:fn=>fn};
 if(id==='next/server')return {NextResponse:{json:(body,options)=>({body,status:options?.status||200})}};
 if(id==='@/lib/admin-auth')return {isAdminRequest:()=>authorized};
 if(id==='@/lib/request-security')return {hasSameOrigin:()=>sameOrigin};
 if(id==='@/lib/database')return {updatePropertyImages:async(id,images)=>{writes.push({id,images});return {id,images}},updateProperty:()=>{throw Error('Full update must not run')}};
 if(id==='@/lib/property-images')return {persistPropertyImages:async images=>{persisted.push(images);return images}};
 return {};
}});
async function call(body){return exportsRoute.PATCH({json:async()=>body},{params:Promise.resolve({id:'property-test'})});}
(async()=>{
 assert.equal((await call({action:'photos',images:['https://example.com/a.jpg']})).status,200);
 assert.equal(writes.length,1); assert.equal(writes[0].id,'property-test');
 assert.equal((await call({action:'photos',images:[]})).status,200);
 for(const images of [null,['javascript:bad'],Array(6).fill('https://example.com/a.jpg')])assert.equal((await call({action:'photos',images})).status,400);
 assert.equal((await call({action:'photos',images:[],price:'1'})).status,400);
 authorized=false;assert.equal((await call({action:'photos',images:[]})).status,401);authorized=true;
 sameOrigin=false;assert.equal((await call({action:'photos',images:[]})).status,403);
 assert.equal(writes.length,2);assert.equal(persisted.length,2);
 console.log('PASS photo-only save: existing/empty gallery, invalid formats/count, unrelated fields, authentication and origin; no production calls');
})().catch(e=>{console.error(e);process.exitCode=1});
