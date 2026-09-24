// Route-level regressions. All storage and outgoing work are isolated mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, Date, Error, console,
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name === 'next/server') return { NextResponse: { json: Response.json }, after: () => {} };
      if (name === '@/lib/accounts') return { protectedRoute: fn => fn };
      if (name === '@/lib/admin-auth') return { isAdminRequest: () => true };
      if (name === '@/lib/request-security') return { hasSameOrigin: () => true };
      if (name === '@/lib/tenant-context') return { currentAccount: () => ({ role: 'owner' }) };
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected test dependency: ${name}`);
    },
  });
  return mod.exports;
}

async function run() {
  const propertyId = '00000000-0000-4000-8000-000000000001';
  const context = { params: Promise.resolve({ id: propertyId }) };
  const request = body => ({ json: async () => body });
  let propertyWrites = 0, imageWrites = 0;
  const propertyDependencies = {
    '@/lib/property-input': load('lib/property-input.ts'),
    '@/lib/database': {
      createProperty: async input => { propertyWrites++; return { ...input, id: propertyId }; },
      updateProperty: async (id, input) => { propertyWrites++; return { ...input, id }; },
    },
    '@/lib/opportunities': { onPropertyChanged: async () => {} },
    '@/lib/supabase': { supabaseCompanyId: () => 'company-a' },
    '@/lib/property-images': { persistPropertyImages: async images => { imageWrites++; return images; } },
  };
  const properties = load('app/api/properties/route.ts', propertyDependencies);
  const property = load('app/api/properties/[id]/route.ts', propertyDependencies);
  const valid = { code: 'C-1', title: 'Casa', description: 'Casa de teste', district: 'Centro', city: 'Lavras', price: '500 mil', propertyType: 'Casa', bedrooms: 2, parkingSpaces: 0, area: 75.5, images: [] };
  const mutations = [body => properties.POST(request(body)), body => property.PATCH(request(body), context)];
  for (const mutate of mutations) {
    for (const field of ['bedrooms', 'parkingSpaces', 'area']) {
      for (const invalid of ['abc', 'Infinity', '1e309', -1, true, [], {}, null, '   ']) {
        assert.equal((await mutate({ ...valid, [field]: invalid })).status, 400, `${field} must reject ${JSON.stringify(invalid)}`);
      }
    }
    for (const field of ['bedrooms', 'parkingSpaces']) {
      for (const invalid of [1.5, 2147483648]) {
        assert.equal((await mutate({ ...valid, [field]: invalid })).status, 400);
      }
    }
  }
  assert.equal(propertyWrites, 0, 'invalid catalog fields must never reach storage');
  assert.equal(imageWrites, 0, 'invalid catalog fields must not upload images');
  for (const mutate of mutations) {
    const response = await mutate({ ...valid, bedrooms: '2', parkingSpaces: '0', area: '75.5' });
    assert.ok([200, 201].includes(response.status));
    const saved = (await response.json()).data;
    assert.equal(saved.bedrooms, 2); assert.equal(saved.parkingSpaces, 0); assert.equal(saved.area, 75.5);
  }

  let catalog = { title:'Casa',status:'Disponível',purpose:'Venda' };
  const sales = new Map();
  let actor={role:'owner',brokerId:'00000000-0000-4000-8000-000000000011'};
  const performance = load('app/api/performance/route.ts', {
    '@/lib/database': {
      createSale: async input => {
        if (!['Disponível','Reservado'].includes(catalog.status)) throw new Error('property_unavailable');
        if (catalog.purpose !== input.dealType) throw new Error('deal_purpose_mismatch');
        catalog.status=input.dealType === 'Aluguel' ? 'Alugado' : 'Vendido';
        const row={...input,id:`sale-${sales.size+1}`};sales.set(row.id,row);return row;
      },
    },
    '@/lib/tenant-context': {currentAccount:()=>actor},
  });
  const sale = { propertyId,date:'2026-09-13',brokerId:'00000000-0000-4000-8000-000000000012',client:'Cliente',amount:500000,dealType:'Venda' };
  for(const date of ['2026-02-30','2025-02-29','2026-13-01','2026-00-10','0000-01-01']) assert.equal((await performance.POST(request({...sale,date}))).status,400);
  for(const invalid of [null,'500',-1,Infinity,{},1e15]) assert.equal((await performance.POST(request({...sale,amount:invalid}))).status,400);
  assert.equal(sales.size,0);
  const responses=await Promise.all([performance.POST(request(sale)),performance.POST(request(sale))]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);assert.equal(sales.size,1);assert.equal(catalog.status,'Vendido');
  assert.equal((await performance.POST(request(sale))).status,409);
  catalog={title:'Apartamento',status:'Reservado',purpose:'Aluguel'};
  assert.equal((await performance.POST(request({...sale,date:'2024-02-29',dealType:'Aluguel',amount:2000}))).status,201);
  assert.equal(catalog.status,'Alugado');
  actor={role:'broker',brokerId:'00000000-0000-4000-8000-000000000019'};
  catalog={title:'Casa',status:'Disponível',purpose:'Venda'};
  assert.equal((await performance.POST(request(sale))).status,201);assert.equal(sales.get('sale-3').brokerId,actor.brokerId,'broker cannot attribute a sale to another account');
  console.log('PASS property API: validated catalogue numbers, valid dates/amounts, stable actor binding and atomic deal error responses.');
}

module.exports = run;
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
