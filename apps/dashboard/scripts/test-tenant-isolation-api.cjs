// Actual account wrapper, AsyncLocalStorage, routes, database helpers and REST
// client, backed by isolated PostgreSQL. Only HTTP transport/Next after are
// adapted; the transport never injects or verifies a company filter for the app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { createDatabase, seedCompanies, id } = require('./helpers/tenant-test-database.cjs');

async function run() {
  const db = await createDatabase();
  try {
    await seedCompanies(db);
    const tokens = ['a'.repeat(64),'b'.repeat(64)];
    for (const [index,token] of tokens.entries()) {
      await db.query("INSERT INTO account_sessions(token_hash,broker_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [crypto.createHash('sha256').update(token).digest('hex'),id((index+1)*10+1)]);
    }
    await db.exec('SET ROLE service_role');
    const background = [], cache = new Map(), requests = [];
    const identifier = value => { assert.match(value,/^[a-z_][a-z0-9_]*$/); return `"${value}"`; };
    async function transport(input, options = {}) {
      const url = new URL(input);
      assert.equal(url.origin,'https://isolated.example.test','network is prohibited in isolation tests');
      assert.equal(options.headers.apikey,'isolated-key');
      const resource = url.pathname.replace('/rest/v1/','');
      const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({resource,method,body,params:new URLSearchParams(url.search)});
      try {
        let rows;
        if (resource.startsWith('rpc/')) {
          const fn = resource.slice(4), entries = Object.entries(body || {});
          rows = (await db.query(`SELECT * FROM public.${identifier(fn)}(${entries.map(([name],i)=>`${identifier(name)} => $${i+1}`).join(',')})`,entries.map(([,value])=>value))).rows;
          if (fn === 'consume_rate_limit') return Response.json(rows[0].consume_rate_limit);
          return Response.json(rows);
        }
        assert.ok(['leads','properties','appointments','companies','account_companies'].includes(resource),resource);
        const table = identifier(resource), values = [], predicates = [];
        for (const [key,value] of url.searchParams) {
          if (['select','order','limit','offset'].includes(key)) continue;
          assert.ok(value.startsWith('eq.'),value);
          values.push(value.slice(3)); predicates.push(`${identifier(key)}=$${values.length}`);
        }
        const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : '';
        if (method === 'GET') {
          const selected = url.searchParams.get('select') || '*';
          const columns = selected === '*' ? '*' : selected.split(',').map(identifier).join(',');
          const order = url.searchParams.get('order');
          const orderSql = order ? ` ORDER BY ${order.split(',').map(part => { const [field,direction] = part.split('.'); return `${identifier(field)} ${direction === 'desc'?'DESC':'ASC'}`; }).join(',')}` : '';
          const limit = Number(url.searchParams.get('limit') || 10000), offset = Number(url.searchParams.get('offset') || 0);
          assert.ok(Number.isInteger(limit) && limit>=0 && Number.isInteger(offset) && offset>=0);
          rows = (await db.query(`SELECT ${columns} FROM ${table}${where}${orderSql} LIMIT ${limit} OFFSET ${offset}`,values)).rows;
        } else if (method === 'PATCH') {
          const assignments = Object.entries(body).map(([column,value])=> { values.push(typeof value==='object'&&value!==null?JSON.stringify(value):value);return `${identifier(column)}=$${values.length}`; });
          rows = (await db.query(`UPDATE ${table} SET ${assignments.join(',')}${where} RETURNING *`,values)).rows;
        } else if (method === 'DELETE') {
          rows = (await db.query(`DELETE FROM ${table}${where} RETURNING *`,values)).rows;
        } else {
          assert.equal(method,'POST');
          rows=[];
          for (const row of Array.isArray(body)?body:[body]) {
            const entries = Object.entries(row);
            rows.push(...(await db.query(`INSERT INTO ${table}(${entries.map(([column])=>identifier(column)).join(',')}) VALUES(${entries.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,
              entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value))).rows);
          }
        }
        return Response.json(rows);
      } catch (error) { return Response.json({code:error.code,message:error.message},{status:400}); }
    }
    function load(file) {
      if (cache.has(file)) return cache.get(file);
      const source = fs.readFileSync(path.join(__dirname,'..',file),'utf8');
      const output = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      const mod = {exports:{}};
      function requireLocal(name) {
        if (name === 'next/server') return {NextResponse:{json:Response.json},after:fn=>background.push(fn)};
        if (name === '@neondatabase/serverless') return {neon:()=>{throw Error('Unexpected Neon access');}};
        if (name === '@/lib/automations') return {runAutomationsAfterEvent:async()=>{}};
        if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
        if (name.startsWith('.')) return load(`${path.posix.normalize(path.posix.join(path.posix.dirname(file),name))}.ts`);
        return require(name);
      }
      vm.runInNewContext(output,{module:mod,exports:mod.exports,require:requireLocal,Buffer,Date,URL,URLSearchParams,Response,Request,Headers,AbortSignal,console,
        process:{env:{SUPABASE_URL:'https://isolated.example.test',SUPABASE_SECRET_KEY:'isolated-key'}},fetch:transport});
      cache.set(file,mod.exports);return mod.exports;
    }
    const request = (method,token,body,url='/api/properties',origin='https://app.example.test') => {
      const req = new Request(`https://app.example.test${url}`,{method,headers:{origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
      req.nextUrl = new URL(req.url); req.cookies={get:name=>name==='imobflow_session'&&token?{value:token}:undefined};return req;
    };
    const context = row => ({params:Promise.resolve({id:row})});
    const properties=load('app/api/properties/route.ts'),property=load('app/api/properties/[id]/route.ts');
    const leads=load('app/api/leads/route.ts'),lead=load('app/api/leads/[id]/route.ts');
    const appointments=load('app/api/appointments/route.ts'),appointment=load('app/api/appointments/[id]/route.ts');
    const validProperty={code:'A-1',title:'Casa A',description:'Descrição',district:'Centro',city:'Lavras',price:'R$ 500.000,00',propertyType:'Casa',bedrooms:3,parkingSpaces:2,area:100,images:[],companyId:id(2),company_id:id(2)};

    for (const [api,field,expected] of [[properties,'title','Imóvel 1'],[leads,'name','Lead 1'],[appointments,'name','Lead 1']]) {
      const response=await api.GET(request('GET',tokens[0],undefined,`/api/anything?company_id=${id(2)}&companyId=${id(2)}`));
      assert.equal(response.status,200); assert.match(response.headers.get('cache-control'),/private.*no-store/);
      const data=(await response.json()).data;assert.equal(data.length,1);assert.equal(data[0][field],expected);
    }
    // Independent sessions are deliberately interleaved to exercise ALS isolation.
    const concurrent=await Promise.all(Array.from({length:12},(_,i)=>properties.GET(request('GET',tokens[i%2]))));
    for (const [i,response] of concurrent.entries()) assert.equal((await response.json()).data[0].title,`Imóvel ${i%2+1}`);
    assert.equal((await property.PATCH(request('PATCH',tokens[0],validProperty),context(id(401)))).status,404);
    assert.equal((await property.DELETE(request('DELETE',tokens[0]),context(id(401)))).status,404);
    assert.equal((await lead.PATCH(request('PATCH',tokens[0],{lifecycleStatus:'Perdido',company_id:id(2)}),context(id(201)))).status,404);
    assert.equal((await appointment.PATCH(request('PATCH',tokens[0],{status:'Confirmada'}),context(id(1001)))).status,404);
    assert.equal((await appointment.DELETE(request('DELETE',tokens[0]),context(id(1001)))).status,404);
    assert.equal((await property.DELETE(request('DELETE',tokens[0],undefined,'/api/properties','https://evil.example.test'),context(id(301)))).status,403);
    assert.equal(background.length,0,'denied mutations cannot schedule follow-up work');
    assert.equal((await db.query('SELECT title FROM properties WHERE id=$1',[id(401)])).rows[0].title,'Imóvel 2');
    assert.equal((await db.query('SELECT lifecycle_status FROM leads WHERE id=$1',[id(201)])).rows[0].lifecycle_status,'Novo');
    const created=await properties.POST(request('POST',tokens[0],validProperty));
    assert.equal(created.status,201);const createdId=(await created.json()).data.id;
    assert.equal((await db.query('SELECT company_id FROM properties WHERE id=$1',[createdId])).rows[0].company_id,id(1));
    assert.equal((await property.PATCH(request('PATCH',tokens[0],{...validProperty,title:'Alterado A'}),context(createdId))).status,200);
    assert.equal((await property.DELETE(request('DELETE',tokens[0]),context(createdId))).status,200);
    assert.equal((await lead.PATCH(request('PATCH',tokens[0],{lifecycleStatus:'Em atendimento'}),context(id(101)))).status,200);
    assert.equal((await appointment.PATCH(request('PATCH',tokens[0],{status:'Confirmada'}),context(id(901)))).status,200);

    for (const token of [undefined,'forged','c'.repeat(64)]) {
      assert.equal((await properties.GET(request('GET',token))).status,401);
      assert.equal((await property.DELETE(request('DELETE',token),context(id(401)))).status,401);
    }
    const publicLead={companySlug:'empresa-2',companyId:id(1),company_id:id(1),name:'Entrada pública',phone:'5535999988888',goal:'Comprar',propertyType:'Casa',region:'Centro',budget:'Até R$ 400.000'};
    const publicResponse=await leads.POST(request('POST',undefined,publicLead,'/api/leads'));
    assert.equal(publicResponse.status,201);assert.deepEqual(await publicResponse.json(),{ok:true});
    assert.equal((await db.query('SELECT company_id FROM leads WHERE name=$1',['Entrada pública'])).rows[0].company_id,id(2),'public slug is resolved server-side; raw tenant fields are ignored');
    assert.equal((await leads.POST(request('POST',undefined,{...publicLead,companySlug:undefined},'/api/leads'))).status,400);
    const imports=load('app/api/leads/import/route.ts');
    const historic={name:'Cliente importado',phone:'35988887777',email:'historico@example.test',goal:'Comprar',propertyType:'Casa',region:'Centro',budget:'500000',company_id:id(2)};
    const beforeImportBackground=background.length;
    const imported=await imports.POST(request('POST',tokens[0],{leads:[historic,{...historic,phone:'+55 (35) 98888-7777'}]},'/api/leads/import'));
    assert.equal(imported.status,201);const importedData=(await imported.json()).data;
    assert.equal(importedData.imported,1);assert.equal(importedData.skipped,1);
    assert.equal((await db.query('SELECT company_id,budget_max FROM leads WHERE id=$1',[importedData.leads[0].id])).rows[0].company_id,id(1));
    assert.equal(Number((await db.query('SELECT budget_max FROM leads WHERE id=$1',[importedData.leads[0].id])).rows[0].budget_max),500000);
    const repeated=await imports.POST(request('POST',tokens[0],{leads:[historic]},'/api/leads/import'));
    assert.equal((await repeated.json()).data.imported,0,'retry must preserve existing customer');
    const otherCompany=await imports.POST(request('POST',tokens[1],{leads:[historic]},'/api/leads/import'));
    assert.equal((await otherCompany.json()).data.imported,1,'same contact in another company is independent');
    assert.equal(background.length,beforeImportBackground,'import cannot trigger outbound automations');
    await db.query('DELETE FROM account_sessions WHERE broker_id=$1',[id(11)]);
    assert.equal((await properties.GET(request('GET',tokens[0]))).status,401,'revoked session cannot read even with a previously valid cookie');
    assert.equal((await properties.GET(request('GET',tokens[1]))).status,200);
    assert.ok(requests.filter(req=>['leads','properties','appointments'].includes(req.resource)&&req.method!=='POST').every(req=>req.params.get('company_id')?.startsWith('eq.')));
    console.log('PASS tenant API: real session/RPC/ALS/database code; A cannot read/edit/delete B; 12 interleaved requests, tenant spoofing, public slug resolution, CSRF, revoked cookies and allowed same-company CRUD');
    console.log('Transport is an isolated PostgREST-to-PGlite adapter; deployed HTTP middleware and real independent-connection concurrency remain separate checks.');
  } finally {await db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
