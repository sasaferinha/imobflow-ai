// Synthetic in-memory rows only. No environment credentials or external network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const cache = new Map();
const requests = [];
const stageRequests = [];
let conversationStages = new Map();
let transportRows = {};
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const source = fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const output = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod = {exports:{}};
  const localRequire = name => {
    if (name === '../supabase') return { supabaseRequest:async (url,options) => { requests.push({url,options}); assert.ok(!options.method,'read adapter cannot mutate'); return transportRows[url.split('?')[0]]; } };
    if (name === '../conversation-stage-reader') return { readAutomaticConversationStages: async (companyId, ids) => { stageRequests.push({ companyId, ids: [...ids] }); return new Map([...conversationStages].filter(([id]) => ids.includes(id))); } };
    if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+'.ts');
    return require(name);
  };
  vm.runInNewContext(output,{module:mod,exports:mod.exports,require:localRequire,Date,URL,URLSearchParams,Buffer,structuredClone,crypto:crypto.webcrypto,console,process:{env:{}}});
  cache.set(file,mod.exports); return mod.exports;
}
const bridge = load('lib/evolution/legacy-bridge.ts'), model = load('lib/evolution/model.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const company = id(1), owner={companyId:company,brokerId:id(10),name:'Gestor sintético',role:'owner'}, broker={companyId:company,brokerId:id(11),name:'Corretor sintético A',role:'broker'};
const members=[{id:owner.brokerId,name:owner.name,role:'owner',specialization:'Ambos'},{id:broker.brokerId,name:broker.name,role:'broker',specialization:'Ambos'},{id:id(12),name:'Corretor sintético B',role:'broker',specialization:'Ambos'}];
const stamp='2026-10-07T12:00:00.000Z';
const lead={id:id(101),company_id:company,name:'Contato sintético',phone:'5535999990101',email:'contato@example.invalid',goal:'Comprar',property_type:'Apartamento',region:'Centro',budget_min:100000,budget_max:600000,bedrooms:2,parking_spaces:1,details:'Preferência sintética',summary:'Resumo anterior',score:80,temperature:'Quente',lifecycle_status:'Em atendimento',assigned_to:broker.name,source:'WhatsApp',last_contact_at:stamp,interest_profile:{city:'Lavras',financingIntent:'Sim',bedrooms:2,features:['Elevador'],summaryConfirmed:true},created_at:stamp,updated_at:stamp};
const property={id:id(201),company_id:company,code:'SINT-201',title:'Imóvel sintético',description:'Descrição sintética',purpose:'Venda',price:500000,district:'Centro',city:'Lavras',address:'Endereço sintético',property_type:'Apartamento',bedrooms:2,parking_spaces:1,area:80,images:['https://example.invalid/front.jpg','https://example.invalid/back.jpg'],public_url:'https://example.invalid/imovel',status:'Disponível',key_in_office:true,occupied:false,cataloged_on_instagram:true,cataloged_on_site:true,created_at:stamp,updated_at:stamp};
const appointment={id:id(301),company_id:company,lead_id:lead.id,property_id:property.id,scheduled_at:'2026-10-08T13:00:00.000Z',assigned_to:broker.name,status:'Confirmada',notes:'Visita sintética',created_at:stamp};
const conversation={id:id(401),company_id:company,lead_id:lead.id,assigned_broker_id:broker.brokerId,assigned_to:broker.name};
function source(changes={}) { return bridge.legacyBridgeFromRows(company,members,{leads:[structuredClone(lead)],properties:[structuredClone(property)],appointments:[structuredClone(appointment)],conversations:[structuredClone(conversation)],...changes}); }
function snapshot(s=source()) { const state=model.emptyState(company);state.members=members;return bridge.mergeLegacyBridge(state,s); }
function edit(state,actor,kind,recordId,data) { return model.applyCommand(state,actor,{type:'save',kind,id:recordId,data},'2026-10-07T13:00:00.000Z'); }
function applyRows(s,writes) { const next=structuredClone(s); for(const w of writes) { if(w.operation==='insert')next[w.table].push({...w.data,created_at:stamp,updated_at:stamp});else {const index=next[w.table].findIndex(r=>r.id===w.id);next[w.table][index]={...next[w.table][index],...w.data};} }return source(next); }
async function run() {
  const s=source(), state=snapshot(s);
  assert.equal(state.records.length,5);assert.equal(state.events.length,0,'snapshot must never fabricate transitions');
  const person=state.records.find(r=>r.kind==='people'), interest=state.records.find(r=>r.kind==='leads'), mainCase=state.records.find(r=>r.kind==='cases'), listing=state.records.find(r=>r.kind==='properties'), visit=state.records.find(r=>r.kind==='tasks');
  assert.equal(person.id,`person:${lead.id}`);assert.equal(interest.data.personId,person.id);assert.equal(mainCase.data.leadId,interest.id);assert.equal(visit.data.caseId,mainCase.id);
  assert.equal(person.createdAt,stamp);assert.equal(mainCase.data.stageEnteredAt,undefined,'stage timestamp is unknown, not creation date');
  assert.equal(listing.data.parkingSpaces,1);assert.equal(state.sourceRevision,s.sourceRevision);
  assert.equal(model.visibleState(state,broker).records.length,5);
  const other={companyId:company,brokerId:id(12),name:members[2].name,role:'broker'};
  assert.equal(model.visibleState(state,other).records.length,1,'only shared property, never another broker contact');
  const expanded=structuredClone(state);expanded.members.find(m=>m.id===other.brokerId).permissions={people:{readOthers:true,editOthers:true},leads:{readOthers:true,editOthers:true},cases:{readOthers:true,editOthers:true},properties:{readOthers:true,editOthers:true},tasks:{readOthers:true,editOthers:true},proposals:{readOthers:true,editOthers:true}};
  expanded.records.push({id:id(950),kind:'tasks',data:{name:'Tarefa sintética',caseId:mainCase.id,assignedTo:other.brokerId,type:'Tarefa'},createdAt:stamp,updatedAt:stamp,createdBy:other.brokerId},{id:id(951),kind:'proposals',data:{name:'Proposta sintética',caseId:mainCase.id,propertyId:listing.id},createdAt:stamp,updatedAt:stamp,createdBy:other.brokerId});
  assert.equal(model.visibleState(expanded,other).records.length,1,'workspace grants and creator/assignee cannot widen canonical case scope');
  assert.equal(model.canAccess(expanded,other,expanded.records.at(-1),'write'),false);assert.equal(model.canAccess(expanded,other,expanded.records.at(-2),'write'),false);assert.equal(model.canAccess(expanded,other,listing,'write'),false);
  assert.throws(()=>bridge.legacyBridgeFromRows(company,members,{leads:[{...lead,company_id:id(2)}],properties:[],appointments:[],conversations:[]}),/validar/);
  const unqualified=snapshot(source({leads:[{...lead,goal:null,assigned_to:null,temperature:null,created_at:null,updated_at:null}],conversations:[],appointments:[]}));
  const unknown=unqualified.records.find(r=>r.kind==='cases');assert.equal(unknown.data.purpose,'');assert.equal(unknown.legacy.access,'owner');assert.equal(unknown.createdAt,'');assert.equal(unknown.legacy.missingPurpose,true);
  assert.equal(model.visibleState(unqualified,broker).records.length,1);
  const ambiguous=bridge.legacyBridgeFromRows(company,[...members,{...members[2],name:broker.name}],{leads:[lead],properties:[],appointments:[],conversations:[]});
  assert.equal(bridge.mapLegacyRecords(ambiguous)[0].legacy.access,'owner','duplicate display names never grant ownership');
  const conflicting=source({conversations:[conversation,{...conversation,id:id(402),assigned_broker_id:null,assigned_to:members[2].name}]});
  assert.equal(bridge.mapLegacyRecords(conflicting)[0].legacy.access,'owner');
  const changedRaw=source({leads:[{...lead,name:'Atualização sintética',lifecycle_status:'Proposta',updated_at:'2026-10-07T14:00:00Z'}]});
  assert.notEqual(s.sourceRevision,changedRaw.sourceRevision);
  const overlay=structuredClone(state);overlay.records.find(r=>r.kind==='cases').data.notes='Anotação local';overlay.records.find(r=>r.kind==='cases').data.stageEnteredAt=stamp;
  const refreshed=bridge.mergeLegacyBridge(overlay,changedRaw);
  assert.equal(refreshed.records.find(r=>r.kind==='people').data.name,'Atualização sintética');assert.equal(refreshed.records.find(r=>r.kind==='cases').data.stage,'Proposta');assert.equal(refreshed.records.find(r=>r.kind==='cases').data.stageEnteredAt,undefined);assert.equal(refreshed.records.find(r=>r.kind==='cases').data.notes,'Anotação local');
  const waiting = source({ automaticStages: { [lead.id]: 'Lead' } });
  const engaging = source({ automaticStages: { [lead.id]: 'Atendimento' } });
  assert.notEqual(waiting.sourceRevision, engaging.sourceRevision, 'the effective automatic stage participates in stale-snapshot protection');
  assert.equal(snapshot(waiting).records.find(r => r.kind === 'cases').data.stage, 'Lead');
  assert.equal(snapshot(waiting).records.find(r => r.kind === 'leads').data.status, 'Pendente');
  assert.equal(snapshot(engaging).records.find(r => r.kind === 'cases').data.stage, 'Atendimento');
  assert.equal(waiting.leads[0].lifecycle_status, 'Em atendimento', 'automatic reading never rewrites the canonical lifecycle');
  const waitingState = snapshot(waiting);
  const manualRequest = { type: 'register', action: 'new_negotiation', requestId: crypto.randomUUID(), caseId: mainCase.id, data: { name: 'Outro objetivo informado', purpose: 'Aluguel', notes: 'Cadastro manual' } };
  const manualCreated = model.applyCommand(waitingState, broker, manualRequest, stamp);
  const manualPlan = bridge.planLegacyWrites(waitingState, manualCreated, waiting, broker);
  assert.equal(manualPlan.writes.length, 1);
  assert.deepEqual(Object.keys(manualPlan.writes[0].data), [], 'extra case creation only locks the canonical contact; it does not rewrite it');
  const manualDocument = bridge.serializeLegacyWorkspace(manualPlan.state, model.emptyState(company));
  const manualRefreshed = bridge.mergeLegacyBridge({ ...manualDocument, members }, engaging);
  assert.equal(manualRefreshed.records.find(record => record.id === mainCase.id).data.stage, 'Atendimento', 'an extra manual case cannot freeze the primary automatic stage');
  assert.equal(manualRefreshed.records.find(record => record.id === manualRequest.requestId).data.stage, 'Lead');
  assert.equal(manualRefreshed.records.find(record => record.id === manualRequest.requestId).data.purpose, 'Aluguel');
  const handoffSource = source({ leads: [{ ...lead, source: 'Facebook', goal: 'Comprar' }], conversations: [{ ...conversation, assigned_broker_id: other.brokerId, assigned_to: other.name }] });
  const manualHandoff = bridge.mergeLegacyBridge({ ...manualDocument, members }, handoffSource);
  assert.equal(model.visibleState(manualHandoff, broker).records.some(record => record.id === manualRequest.requestId), false, 'former owner cannot keep the extra case through its saved assignment');
  const handedCase = model.visibleState(manualHandoff, other).records.find(record => record.id === manualRequest.requestId);
  assert.equal(handedCase.data.assignedTo, other.brokerId);
  assert.equal(handedCase.data.source, 'WhatsApp', 'extra origin is independent of a later canonical qualification edit');
  assert.equal(handedCase.data.purpose, 'Aluguel');
  const expandedManual = structuredClone(manualHandoff);
  expandedManual.members.find(member => member.id === broker.brokerId).permissions = { cases: { readOthers: true, editOthers: true }, tasks: { readOthers: true, editOthers: true }, proposals: { readOthers: true, editOthers: true } };
  assert.equal(model.canAccess(expandedManual, broker, expandedManual.records.find(record => record.id === manualRequest.requestId)), false);
  const disconnected = structuredClone(manualRefreshed);
  disconnected.records = disconnected.records.filter(record => record.id !== person.id);
  assert.equal(model.visibleState(disconnected, owner).records.some(record => record.id === manualRequest.requestId), false, 'missing canonical contact fails closed, including for owners');
  const wrongAppointmentBinding = structuredClone(manualRefreshed);
  wrongAppointmentBinding.records.find(record => record.kind === 'tasks').negotiationCaseId = mainCase.id;
  assert.throws(() => bridge.mergeLegacyBridge(wrongAppointmentBinding, engaging), /vínculo da visita/, 'invalid workspace binding cannot silently redirect an appointment to a different case');
  const leadRegistration = model.applyCommand(waitingState, broker, { type: 'register', caseId: mainCase.id, requestId: crypto.randomUUID(), action: 'lead', data: {} }, stamp);
  assert.equal(bridge.planLegacyWrites(waitingState, leadRegistration, waiting, broker).writes.find(write => write.table === 'leads').data.lifecycle_status, 'Novo', 'explicit registration persists a derived stage even when the displayed stage already matches');
  assert.equal(bridge.mergeLegacyBridge(overlay, waiting).records.find(r => r.kind === 'cases').data.stage, 'Lead', 'a notes-only overlay cannot freeze the derived stage');
  for (const lifecycle of ['Visita', 'Proposta', 'Convertido', 'Perdido']) {
    const existing = source({ leads: [{ ...lead, lifecycle_status: lifecycle }], automaticStages: { [lead.id]: 'Lead' } });
    const expected = { Visita: 'Visita', Proposta: 'Proposta', Convertido: 'Negociado', Perdido: 'Atendimento' }[lifecycle];
    assert.equal(snapshot(existing).records.find(r => r.kind === 'cases').data.stage, expected, 'untraced legacy/imported human stages must survive');
  }
  for (const humanStage of ['Lead', 'Atendimento', 'Agendamento', 'Visita', 'Proposta']) {
    const manual = structuredClone(overlay), savedCase = manual.records.find(r => r.kind === 'cases');
    savedCase.data.stage = humanStage;
    manual.events.push({ id: id(890), recordId: savedCase.id, actorId: broker.brokerId, type: 'registration', registration: { action: humanStage === 'Lead' ? 'lead' : 'attendance' } });
    const rawChange = source({ leads: [{ ...lead, lifecycle_status: 'Novo' }], automaticStages: { [lead.id]: 'Atendimento' } });
    assert.equal(bridge.mergeLegacyBridge(manual, rawChange).records.find(r => r.kind === 'cases').data.stage, humanStage, 'a human registration takes precedence over message classification');
  }
  const manualEdit = structuredClone(overlay);
  manualEdit.events.push({ id: id(891), recordId: mainCase.id, actorId: broker.brokerId, changes: { stage: { from: 'Lead', to: 'Atendimento' } } });
  assert.equal(bridge.mergeLegacyBridge(manualEdit, waiting).records.find(r => r.kind === 'cases').data.stage, 'Atendimento');
  const paused = structuredClone(overlay); paused.records.find(r => r.kind === 'cases').data.status = 'Pausado';
  assert.equal(bridge.mergeLegacyBridge(paused, waiting).records.find(r => r.kind === 'cases').data.status, 'Pausado');
  const edited=edit(state,broker,'leads',interest.id,{budgetMax:700000,region:'Centro, Sul'});
  const plan=bridge.planLegacyWrites(state,edited,s,broker);assert.equal(plan.writes.length,1);assert.equal(plan.writes[0].table,'leads');assert.equal(plan.writes[0].expected.budget_max,600000);assert.equal(plan.writes[0].data.budget_max,700000);
  assert.equal(plan.writes[0].data.interest_profile.financingIntent,'Sim');assert.equal(plan.writes[0].data.interest_profile.bedrooms,2);assert.equal(plan.writes[0].data.interest_profile.features[0],'Elevador');assert.equal(plan.writes[0].data.interest_profile.regions[1],'Sul');assert.ok(!('last_contact_at' in plan.writes[0].data));
  const persisted=bridge.serializeLegacyWorkspace(plan.state,model.emptyState(company));assert.equal(persisted.records.length,1,'only touched canonical overlay persists');assert.ok(!('sourceRevision' in persisted));
  assert.ok(!('budgetMax' in persisted.records[0].data));assert.ok(!('name' in persisted.records[0].data));assert.ok(!('notes' in persisted.records[0].data),'canonical details stay solely in leads');
  const reconciled=bridge.mergeLegacyBridge({...persisted,members},applyRows(s,plan.writes));assert.equal(reconciled.records.length,5);assert.equal(reconciled.records.find(r=>r.kind==='leads').data.budgetMax,700000);
  const assignment=edit(state,owner,'people',person.id,{assignedTo:owner.brokerId});assert.throws(()=>bridge.planLegacyWrites(state,assignment,s,owner),/Conversas/,'conversation ownership uses bot-safe established action');
  const patchedProperty=edit(state,owner,'properties',listing.id,{price:550000});const propertyPlan=bridge.planLegacyWrites(state,patchedProperty,s,owner);assert.equal(propertyPlan.writes[0].data.price,550000);assert.ok(!('images' in propertyPlan.writes[0].data));assert.ok(!('parking_spaces' in propertyPlan.writes[0].data));assert.ok(!('cataloged_on_site' in propertyPlan.writes[0].data));
  const propertyDocument=bridge.serializeLegacyWorkspace(propertyPlan.state,model.emptyState(company));assert.ok(!('photoUrl' in propertyDocument.records[0].data));assert.ok(!('address' in propertyDocument.records[0].data));assert.equal(bridge.mergeLegacyBridge({...propertyDocument,members},s).records.find(r=>r.id===listing.id).data.photoUrl,property.images[0]);
  assert.equal(model.canAccess(state,broker,listing,'write'),false,'a broker cannot edit another broker’s inventory');
  const assignedPropertyState=structuredClone(state), assignedListing=assignedPropertyState.records.find(r=>r.id===listing.id);
  assignedListing.data.assignedTo=broker.brokerId;
  const brokerInventory=edit(assignedPropertyState,broker,'properties',listing.id,{price:525000});
  const brokerInventoryPlan=bridge.planLegacyWrites(assignedPropertyState,brokerInventory,s,broker);
  assert.equal(brokerInventoryPlan.writes[0].data.price,525000,'the assigned broker can update the canonical listing');
  assert.throws(()=>bridge.planLegacyWrites(assignedPropertyState,edit(assignedPropertyState,other,'properties',listing.id,{price:1}),s,other),/permissão|carteira/,'another broker cannot change the assigned listing');
  const newPropertyByBroker=model.applyCommand(state,broker,{type:'save',kind:'properties',data:{name:'Imóvel do corretor sintético',code:'SINT-BROKER',purpose:'Venda',price:300000,status:'Disponível',district:'Centro',city:'Lavras',propertyType:'Casa'}},'2026-10-07T13:00:00.000Z');
  const brokerCreatePlan=bridge.planLegacyWrites(state,newPropertyByBroker,s,broker);
  assert.equal(brokerCreatePlan.writes[0].operation,'insert','broker creation writes to the canonical catalog');
  assert.equal(brokerCreatePlan.state.records.find(record=>record.kind==='properties'&&record.data.code==='SINT-BROKER').data.assignedTo,broker.brokerId,'new broker listings are assigned to their creator');
  const brokerCreateDocument=bridge.serializeLegacyWorkspace(brokerCreatePlan.state,model.emptyState(company));
  const brokerCreatedRow=applyRows(s,brokerCreatePlan.writes);
  assert.equal(bridge.mergeLegacyBridge({...brokerCreateDocument,members},brokerCreatedRow).records.find(record=>record.kind==='properties'&&record.data.code==='SINT-BROKER').data.assignedTo,broker.brokerId,'ownership overlay survives a canonical catalog reload');
  const changedOrigin=edit(state,owner,'leads',interest.id,{source:'Site'});assert.throws(()=>bridge.planLegacyWrites(state,changedOrigin,s,owner),/origem original/);
  const originCommand = { type: 'register', action: 'attendance', requestId: crypto.randomUUID(), caseId: mainCase.id, data: { channel: 'WhatsApp', outcome: 'Contato realizado', source: 'Tráfego pago' } };
  const originState = model.applyCommand(state, broker, originCommand, stamp);
  const originPlan = bridge.planLegacyWrites(state, originState, s, broker);
  assert.equal(originPlan.writes.length, 1, 'origin updates the existing contact in the same write plan');
  assert.equal(originPlan.writes[0].data.source, 'Tráfego pago');
  assert.equal(originPlan.writes[0].expected.source, 'WhatsApp', 'source participates in canonical compare-and-swap');
  assert.ok(!('last_contact_at' in originPlan.writes[0].data));
  assert.ok(!('assigned_to' in originPlan.writes[0].data));
  assert.ok(!('interest_profile' in originPlan.writes[0].data));
  const originDocument = bridge.serializeLegacyWorkspace(originPlan.state, model.emptyState(company));
  assert(originDocument.records.every(record => !('source' in record.data)), 'canonical source is not duplicated in overlays');
  const originReloaded = bridge.mergeLegacyBridge({ ...originDocument, members }, applyRows(s, originPlan.writes));
  assert.equal(originReloaded.records.find(record => record.id === mainCase.id).data.source, 'Tráfego pago');
  assert.equal(originReloaded.records.find(record => record.id === interest.id).data.source, 'Tráfego pago');
  for (const tamper of [
    value => { value.events = value.events.filter(event => !event.registration); },
    value => { value.events = value.events.filter(event => !event.changes?.source); },
    value => { value.events.find(event => event.registration).registration.fingerprint = 'null'; },
    value => { value.records.find(record => record.id === interest.id).data.source = 'Facebook'; },
  ]) {
    const forged = structuredClone(originState); tamper(forged);
    assert.throws(() => bridge.planLegacyWrites(state, forged, s, broker), /origem original/, 'source writes need coherent explicit registration evidence');
  }
  assert.throws(()=>edit(state,broker,'properties',listing.id,{price:1}),/permissão/);
  const photo=bridge.planLegacyWrites(state,edit(state,owner,'properties',listing.id,{photoUrl:'https://example.invalid/new.jpg'}),s,owner);assert.deepEqual(Array.from(photo.writes[0].data.images),['https://example.invalid/new.jpg','https://example.invalid/back.jpg']);
  const status=bridge.planLegacyWrites(state,edit(state,broker,'tasks',visit.id,{status:'Cancelada',reason:'Cliente indisponível'}),s,broker);assert.equal(status.writes[0].table,'appointments');assert.equal(status.writes[0].data.status,'Cancelada');assert.ok(!('scheduled_at' in status.writes[0].data));
  const withoutProperty=source({appointments:[{...appointment,property_id:null}]});const oldVisit=snapshot(withoutProperty);const nextVisit=structuredClone(oldVisit);nextVisit.records.find(r=>r.kind==='tasks').data.status='Realizada';assert.equal(bridge.planLegacyWrites(oldVisit,nextVisit,withoutProperty,broker).writes[0].data.status,'Realizada');
  const discard=bridge.planLegacyWrites(state,edit(state,broker,'leads',interest.id,{status:'Descartado'}),s,broker);assert.equal(discard.state.records.find(r=>r.kind==='cases').data.status,'Perdido');
  const closedSource=source({leads:[{...lead,lifecycle_status:'Convertido'}]}), closedState=snapshot(closedSource), reopened=edit(closedState,owner,'leads',interest.id,{status:'Pendente'});assert.throws(()=>bridge.planLegacyWrites(closedState,reopened,closedSource,owner),/resultado confirmado/);
  const newPerson=model.applyCommand(state,owner,{type:'save',kind:'people',data:{name:'Pessoa nova sintética',personType:'Pessoa física',category:'Cliente',assignedTo:owner.brokerId,phone:'5535999990202'}},'2026-10-07T13:00:00.000Z');
  const inserted=bridge.planLegacyWrites(state,newPerson,s,owner);assert.equal(inserted.writes[0].operation,'insert');assert.equal(inserted.writes[0].data.goal,null);assert.equal(inserted.writes[0].data.property_type,null);assert.equal(inserted.writes[0].data.region,null);assert.equal(inserted.writes[0].data.source,'Cadastro manual');
  const savedPerson=inserted.state.records.find(r=>r.data.name==='Pessoa nova sintética');assert.match(savedPerson.id,/^person:/);assert.equal(savedPerson.legacy.table,'leads');assert.equal(inserted.state.events.at(-1).recordId,savedPerson.id);
  const newRows=applyRows(s,inserted.writes), newState=bridge.mergeLegacyBridge(inserted.state,newRows);assert.equal(newState.records.filter(r=>r.legacy?.id===inserted.writes[0].id).length,3,'one row, three views, no duplicates');
  const createInterest={type:'save',kind:'leads',data:{name:'Novo interesse',personId:savedPerson.id,assignedTo:owner.brokerId,purpose:'Venda',source:'Cadastro manual',temperature:'Morno',status:'Pendente'}};
  assert.equal(bridge.prepareLegacyCommand(newState,newRows,createInterest).id,`lead:${inserted.writes[0].id}`);
  const newProperty=model.applyCommand(state,owner,{type:'save',kind:'properties',data:{name:'Casa sintética nova',code:'SINT-NEW',purpose:'Venda',price:300000,status:'Disponível',assignedTo:owner.brokerId,district:'Centro',city:'Lavras',propertyType:'Casa'}},'2026-10-07T13:00:00.000Z');
  const newPropertyPlan=bridge.planLegacyWrites(state,newProperty,s,owner);assert.equal(newPropertyPlan.writes[0].data.parking_spaces,0);assert.equal(newPropertyPlan.writes[0].data.bedrooms,0);assert.match(newPropertyPlan.state.records.at(-1).id,/^property:/);
  const completion=edit(state,owner,'proposals',undefined,{name:'Proposta sintética',caseId:mainCase.id,propertyId:listing.id,amount:510000,conditions:'Condição sintética',expiresAt:'2026-10-09',status:'Aceita'});
  const dealPlan=bridge.planLegacyWrites(state,completion,s,owner);assert.equal(dealPlan.writes.length,2);assert.equal(dealPlan.writes.find(w=>w.table==='leads').data.lifecycle_status,'Convertido');assert.equal(dealPlan.writes.find(w=>w.table==='properties').data.status,'Vendido');assert.ok(dealPlan.writes.every(w=>w.table!=='site_sales'),'no duplicate financial booking');
  const completedRows = applyRows(s, dealPlan.writes), completedState = bridge.mergeLegacyBridge(bridge.serializeLegacyWorkspace(dealPlan.state, state), completedRows);
  const accepted = completedState.records.find(record => record.kind === 'proposals' && record.data.status === 'Aceita');
  const correction = { type: 'register', action: 'correct_close', caseId: mainCase.id, requestId: crypto.randomUUID(), data: { mode: 'reopen', proposalId: accepted.id, reason: 'Fechamento registrado por engano.', confirmed: true } };
  const corrected = model.applyCommand(completedState, owner, correction, '2026-10-08T13:00:00.000Z');
  const correctionPlan = bridge.planLegacyWrites(completedState, corrected, completedRows, owner);
  assert.equal(correctionPlan.writes.find(write => write.table === 'leads').data.lifecycle_status, 'Proposta');
  assert.equal(correctionPlan.writes.find(write => write.table === 'properties').data.status, 'Disponível');
  assert.ok(correctionPlan.writes.every(write => write.table !== 'site_sales'));
  const correctedRows = applyRows(completedRows, correctionPlan.writes);
  const correctedReloaded = bridge.mergeLegacyBridge(bridge.serializeLegacyWorkspace(correctionPlan.state, completedState), correctedRows);
  assert.equal(correctedReloaded.records.find(record => record.id === mainCase.id).data.stage, 'Proposta');
  assert.equal(correctedReloaded.records.find(record => record.id === mainCase.id).data.status, 'Aberto');
  assert.equal(correctedReloaded.records.find(record => record.id === mainCase.id).data.closedAt, '');
  assert.equal(correctedReloaded.records.find(record => record.id === accepted.id).data.status, 'Rascunho', 'a directly-created acceptance reopens as draft');
  assert.equal(correctedReloaded.records.find(record => record.id === mainCase.id).data.source, lead.source);
  for (const tamper of [
    value => { value.events = value.events.filter(event => event.registration?.action !== 'correct_close'); },
    value => { value.events.find(event => event.registration?.action === 'correct_close').registration.fingerprint = 'null'; },
    value => { value.events = value.events.filter(event => !(event.recordId === mainCase.id && event.changes?.status?.to === 'Aberto')); },
  ]) {
    const forged = structuredClone(corrected); tamper(forged);
    assert.throws(() => bridge.planLegacyWrites(completedState, forged, completedRows, owner), /resultado confirmado/, 'a generic or unaudited change cannot reopen Convertido');
  }
  const forged=structuredClone(state);forged.records.push({id:id(900),kind:'leads',data:{name:'Tentativa sintética',personId:person.id,assignedTo:other.brokerId,purpose:'Venda',status:'Pendente'},createdAt:stamp,updatedAt:stamp,createdBy:other.brokerId});assert.throws(()=>bridge.planLegacyWrites(state,forged,s,other),/carteira/);
  const nativeCase=model.applyCommand(state,owner,{type:'save',kind:'cases',data:{name:'Captação sintética',personId:person.id,source:'WhatsApp',assignedTo:other.brokerId,purpose:'Venda',journey:'Captação',stage:'Lead',status:'Aberto'}});
  const unrelated=nativeCase.records.at(-1), hiddenParentVisit=model.applyCommand(nativeCase,other,{type:'save',kind:'tasks',data:{name:'Tentativa via captação',caseId:unrelated.id,assignedTo:other.brokerId,type:'Visita',propertyId:listing.id,dueAt:'2026-10-09T10:00',priority:'Normal',status:'Pendente'}});
  assert.throws(()=>bridge.planLegacyWrites(nativeCase,hiddenParentVisit,s,other),/carteira/,'native case must not grant write access to canonical contact');
  transportRows={leads:[lead],properties:[property],appointments:[appointment],conversations:[conversation]};await bridge.readLegacyBridge(owner,members);assert.equal(requests.length,4);assert.ok(requests.every(r=>r.url.includes(`company_id=eq.${company}`)&&r.options.allRows));assert.ok(requests.every(r=>!r.url.includes('messages')));
  assert.deepEqual(stageRequests.at(-1), { companyId: company, ids: [conversation.id] });
  transportRows.conversations.push({ ...conversation, id: id(403) });
  conversationStages = new Map([[conversation.id, 'Lead'], [id(403), 'Atendimento']]);
  const multichannel = await bridge.readLegacyBridge(owner, members);
  assert.equal(multichannel.automaticStages[lead.id], 'Atendimento', 'one independently engaged channel is enough');
  conversationStages.set(conversation.id, 'Atendimento');
  assert.equal((await bridge.readLegacyBridge(owner, members)).sourceRevision, multichannel.sourceRevision, 'unchanged effective lead stage keeps the revision stable');
  conversationStages = new Map([[conversation.id, 'Lead']]);
  const partialChannels = await bridge.readLegacyBridge(owner, members);
  assert.equal(partialChannels.automaticStages[lead.id], undefined, 'Lead plus an unavailable channel is unknown, never evidence for a downgrade');
  assert.equal(snapshot(partialChannels).records.find(r => r.kind === 'cases').data.stage, 'Atendimento');
  conversationStages.set(conversation.id, 'Atendimento');
  assert.equal((await bridge.readLegacyBridge(owner, members)).automaticStages[lead.id], 'Atendimento', 'one proved exchange survives an unavailable second channel');
  await bridge.readLegacyBridge(owner, members, manualEdit);
  assert.deepEqual(stageRequests.at(-1).ids, [], 'human stages do not read message histories');
  transportRows.leads[0] = { ...lead, lifecycle_status: 'Visita' };
  await bridge.readLegacyBridge(owner, members);
  assert.deepEqual(stageRequests.at(-1).ids, [], 'advanced canonical stages do not read message histories');
  console.log('PASS: legacy bridge snapshot, provenance, assignment, canonical CAS plans, bidirectional reconciliation, no duplicate identities/history, visit lifecycle and synthetic-only transport.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
