// Local contracts only; all delivery and database calls are mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function load(file,mocks) {
  const mod={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:mod,exports:mod.exports,require:n=>{if(!(n in mocks)) throw Error(n);return mocks[n]},process:{env:{SUPABASE_URL:'https://fixture.supabase.co'}},Date});
  return mod.exports;
}
(async()=>{
  let queued=0,sent=0;const background=[];
  const route=load('app/api/opportunities/send/route.ts',{
    'next/server':{NextResponse:Response,after:f=>background.push(f)},
    '@/lib/accounts':{protectedRoute:f=>f},
    '@/lib/request-security':{hasSameOrigin:r=>r.headers.get('origin')==='https://app.test'},
    '@/lib/property-whatsapp':{
      propertyWhatsAppContext:async()=>({recipient:'Teste',phone:'5500000000'}),
      queuePropertyOffer:async()=>{queued++;return{companyId:id(1),ids:[id(8),id(9)]}},
      sendPropertyOffer:async()=>{sent++},propertyOfferStatus:async()=>[],propertyOfferError:()=> 'Falha'
    }
  });
  const body={opportunityId:id(2),requestId:id(3),content:'Texto editado',images:[],confirmed:true};
  const req=(body,origin='https://app.test')=>new Request('https://app.test/api/opportunities/send',{method:'POST',headers:{origin},body:JSON.stringify(body)});
  assert.equal((await route.POST(req(body,'https://other.test'))).status,403);
  assert.equal((await route.POST(req({...body,confirmed:false}))).status,400);
  assert.equal((await route.POST(req({...body,images:Array(6).fill('x')}))).status,400);
  assert.equal(queued,0);assert.equal(sent,0);
  const get=new Request('https://app.test/api/opportunities/send?opportunityId='+id(2));get.nextUrl=new URL(get.url);
  assert.equal((await route.GET(get)).status,200);assert.equal(queued,0);
  const result=await route.POST(req(body));assert.equal(result.status,202);assert.equal(queued,1);assert.equal(sent,0);
  await background[0]();assert.equal(sent,1);

  const dbCalls=[];
  const service=load('lib/property-whatsapp.ts',{
    './tenant-context':{currentAccount:()=>({companyId:id(1),brokerId:id(11)})},
    './supabase':{supabaseServiceRequest:async(p,o)=>{dbCalls.push(p);if(p.startsWith('property_whatsapp_batches?'))return[{message_ids:[id(8),id(9)]}];if(p.startsWith('messages?'))return[{id:id(9),delivery_status:'sent'},{id:id(8),delivery_status:'delivered'}];if(p==='rpc/property_whatsapp_context')return{phoneNumberId:'12345'};throw Error(p)}},
    './meta-whatsapp-connections':{loadMetaWhatsAppConnectionForCompany:async()=>[{enabled:true,accessToken:'fixture',phoneNumberId:'12345'}]},
    './message-outbox':{sendQueuedMessage:async()=>{throw Error('No delivery permitted')}}
  });
  const status=await service.propertyOfferStatus(id(3));assert.equal(status[0].id,id(8));assert.equal(status[1].id,id(9));
  assert(dbCalls[0].includes('broker_id=eq.'+id(11)));assert(dbCalls.every(p=>p.includes('company_id=eq.'+id(1))));
  await assert.rejects(service.queuePropertyOffer({...body,images:['https://evil.test/photo.jpg']}),/invalid_offer_images/);
  assert(!dbCalls.includes('rpc/enqueue_property_whatsapp_offer'));
  console.log('PASS property WhatsApp: explicit confirmation, origin, input limits, read-only preflight, scoped receipts in photo order, foreign images denied; no real sends.');
})().catch(e=>{console.error(e);process.exitCode=1});
