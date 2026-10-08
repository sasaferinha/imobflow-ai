import { createHash } from 'node:crypto';
import { supabaseRequest } from '../supabase';
import { analyzeLead, explainProfile, type LeadInput, type LeadLifecycleStatus } from '../leads';
import { CrmError, normalize, type Actor, type CrmCommand, type CrmMember, type CrmRecord, type CrmState, type Value } from './model';

/** No network writes live here. The caller commits this plan and workspace CAS in ONE SQL transaction. */
export type LegacyTable = 'leads' | 'properties' | 'appointments';
export type LegacyRow = Record<string, unknown> & { id: string; company_id: string };
export type LegacySource = { table: LegacyTable; id: string; access: 'assigned' | 'owner' | 'shared'; assignedTo?: string; label?: string; lifecycleStatus?: string; missingPurpose?: boolean };
type MappedRecord = CrmRecord & { legacy?: LegacySource };
export type LegacyBridge = { companyId: string; members: CrmMember[]; leads: LegacyRow[]; properties: LegacyRow[]; appointments: LegacyRow[]; conversations: LegacyRow[]; sourceRevision: string };
export type LegacyWrite = { table: LegacyTable; id: string; operation: 'insert' | 'update'; expected: Record<string, unknown> | null; data: Record<string, unknown> };
export type LegacyPlan = { state: CrmState; writes: LegacyWrite[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEAD_COLUMNS = 'id,company_id,name,phone,email,goal,property_type,region,budget_min,budget_max,bedrooms,parking_spaces,details,summary,score,temperature,lifecycle_status,assigned_to,source,last_contact_at,interest_profile,created_at,updated_at';
const PROPERTY_COLUMNS = 'id,company_id,code,title,description,purpose,price,district,city,address,property_type,bedrooms,parking_spaces,area,images,public_url,status,key_in_office,occupied,cataloged_on_instagram,cataloged_on_site,created_at,updated_at';
const APPOINTMENT_COLUMNS = 'id,company_id,lead_id,property_id,scheduled_at,assigned_to,status,notes,created_at';
const CONVERSATION_COLUMNS = 'id,company_id,lead_id,assigned_broker_id,assigned_to';
const str = (value: unknown) => value == null ? '' : String(value);
const numeric = (value: unknown): Value => value == null || value === '' || !Number.isFinite(Number(value)) ? '' : Number(value);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const date = (value: unknown) => value && Number.isFinite(Date.parse(str(value))) ? new Date(str(value)).toISOString() : '';
const purpose = (goal: unknown) => /^(comprar|compra|venda)$/i.test(str(goal)) ? 'Venda' : /^(alugar|aluguel|locação|locacao)$/i.test(str(goal)) ? 'Aluguel' : '';
const canonicalId = (prefix: string, id: string) => `${prefix}:${id}`;
function rawId(id: unknown, prefix: string): string | undefined { const value = str(id).slice(prefix.length + 1); return str(id).startsWith(`${prefix}:`) && uuid.test(value) ? value : undefined; }
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
function checkedRows(rows: LegacyRow[], companyId: string, table: string) {
  if (!Array.isArray(rows) || rows.some(row => row.company_id !== companyId || !uuid.test(row.id)) || new Set(rows.map(row => row.id)).size !== rows.length) throw new CrmError(`Não foi possível validar os registros de ${table}. Nenhuma alteração foi realizada.`, 503);
  return rows;
}
/** Public for isolated synthetic tests. It does not fabricate customers, chronology or assignments. */
export function legacyBridgeFromRows(companyId: string, members: CrmMember[], input: { leads: LegacyRow[]; properties: LegacyRow[]; appointments: LegacyRow[]; conversations: LegacyRow[] }): LegacyBridge {
  if (!uuid.test(companyId)) throw new CrmError('Empresa inválida.', 403);
  const rows = { leads: checkedRows(input.leads, companyId, 'leads'), properties: checkedRows(input.properties, companyId, 'imóveis'), appointments: checkedRows(input.appointments, companyId, 'agenda'), conversations: checkedRows(input.conversations, companyId, 'conversas') };
  const sourceRevision = createHash('sha256').update(stable({ companyId, members: members.map(m => ({ id: m.id, name: m.name, role: m.role })).sort((a,b) => a.id.localeCompare(b.id)), ...Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, [...values].sort((a,b) => a.id.localeCompare(b.id))])) })).digest('hex');
  return { companyId, members, ...rows, sourceRevision };
}
export async function readLegacyBridge(actor: Actor, members: CrmMember[]): Promise<LegacyBridge> {
  if (!members.some(m => m.id === actor.brokerId && m.role === actor.role)) throw new CrmError('Seu acesso mudou. Entre novamente.', 403);
  const company = encodeURIComponent(actor.companyId);
  const query = <T>(table: string, columns: string) => supabaseRequest<T>(`${table}?company_id=eq.${company}&select=${columns}&order=id.asc`, { allRows: true });
  const [leads, properties, appointments, conversations] = await Promise.all([query<LegacyRow[]>('leads', LEAD_COLUMNS), query<LegacyRow[]>('properties', PROPERTY_COLUMNS), query<LegacyRow[]>('appointments', APPOINTMENT_COLUMNS), query<LegacyRow[]>('conversations', CONVERSATION_COLUMNS)]);
  return legacyBridgeFromRows(actor.companyId, members, { leads, properties, appointments, conversations });
}
function resolveName(bridge: LegacyBridge, value: unknown) {
  const matches = bridge.members.filter(member => normalize(member.name) === normalize(value) && normalize(value));
  return matches.length === 1 ? matches[0].id : undefined;
}
function leadOwner(bridge: LegacyBridge, row: LegacyRow): Pick<LegacySource, 'access' | 'assignedTo' | 'label'> {
  const conversations = bridge.conversations.filter(c => c.lead_id === row.id);
  const ids = new Set(conversations.map(c => str(c.assigned_broker_id)).filter(Boolean));
  if (ids.size > 1) return { access: 'owner', label: str(row.assigned_to) };
  if (ids.size === 1) {
    const id = [...ids][0];
    const member = bridge.members.find(m => m.id === id);
    if (member && conversations.every(c => c.assigned_broker_id === id || (!c.assigned_broker_id && (!c.assigned_to || normalize(c.assigned_to) === normalize(member.name))))) return { access: 'assigned', assignedTo: id, label: member.name };
    return { access: 'owner', label: str(row.assigned_to) };
  }
  const names = new Set([row.assigned_to, ...conversations.map(c => c.assigned_to)].map(normalize).filter(Boolean));
  const id = names.size === 1 ? resolveName(bridge, [...names][0]) : undefined;
  return id ? { access: 'assigned', assignedTo: id, label: str(row.assigned_to) } : { access: 'owner', label: str(row.assigned_to) };
}
function makeRecord(id: string, kind: CrmRecord['kind'], row: LegacyRow, data: Record<string, Value>, legacy: LegacySource): MappedRecord {
  return { id, kind, data, legacy, createdAt: date(row.created_at), updatedAt: date(row.updated_at) || date(row.created_at), createdBy: legacy.assignedTo || '' };
}
/** The same source row has stable, linked contact/interest/case views; it is never copied to a second live table. */
export function mapLegacyRecords(bridge: LegacyBridge): MappedRecord[] {
  const records: MappedRecord[] = [];
  for (const row of bridge.leads) {
    const owner = leadOwner(bridge, row), p = purpose(row.goal), profile = object(row.interest_profile), lifecycle = str(row.lifecycle_status) || 'Novo';
    const legacy: LegacySource = { table: 'leads', id: row.id, ...owner, lifecycleStatus: lifecycle, missingPurpose: !p };
    const assignedTo = owner.assignedTo || '', personId = canonicalId('person', row.id), leadId = canonicalId('lead', row.id), source = str(row.source);
    records.push(makeRecord(personId, 'people', row, { name: str(row.name), phone: str(row.phone), email: str(row.email), assignedTo, personType: 'Pessoa física', category: 'Cliente', address: '', notes: '' }, legacy));
    records.push(makeRecord(leadId, 'leads', row, { name: str(row.name), personId, assignedTo, source, purpose: p, propertyId: '', temperature: /muito quente|quente/i.test(str(row.temperature)) ? 'Quente' : ['Morno','Frio'].includes(str(row.temperature)) ? str(row.temperature) : '', propertyType: str(row.property_type), region: str(row.region), budgetMin: numeric(row.budget_min), budgetMax: numeric(row.budget_max), features: Array.isArray(profile.features) ? profile.features.map(str).join(', ') : '', status: lifecycle === 'Perdido' ? 'Descartado' : lifecycle === 'Novo' ? 'Pendente' : 'Em atendimento', notes: str(row.details) }, legacy));
    const stage = ({ Novo: 'Lead', 'Em atendimento': 'Atendimento', Visita: 'Visita', Proposta: 'Proposta', Convertido: 'Negociado', Perdido: 'Atendimento' } as Record<string,string>)[lifecycle] || 'Lead';
    records.push(makeRecord(canonicalId('case', row.id), 'cases', row, { name: `${p || 'Atendimento'} · ${str(row.name)}`, personId, leadId, source, assignedTo, purpose: p, journey: 'Negociação', stage, status: lifecycle === 'Convertido' ? 'Ganho' : lifecycle === 'Perdido' ? 'Perdido' : 'Aberto', propertyId: '', nextActivityAt: '', reason: '', notes: '' }, legacy));
  }
  for (const row of bridge.properties) {
    const images = Array.isArray(row.images) ? row.images : [];
    records.push(makeRecord(canonicalId('property', row.id), 'properties', row, { name: str(row.title), code: str(row.code), purpose: purpose(row.purpose), price: numeric(row.price), status: str(row.status), assignedTo: '', ownerId: '', condominiumId: '', neighborhoodId: '', district: str(row.district), address: str(row.address), city: str(row.city), propertyType: str(row.property_type), bedrooms: numeric(row.bedrooms), parkingSpaces:numeric(row.parking_spaces), area: numeric(row.area), description: str(row.description), photoUrl: str(images[0]), publicUrl: str(row.public_url), notes: '' }, { table: 'properties', id: row.id, access: 'shared' }));
  }
  for (const row of bridge.appointments) {
    const lead = bridge.leads.find(l => l.id === row.lead_id);
    if (!lead) throw new CrmError('A agenda contém um cliente indisponível. Nenhuma alteração foi realizada.', 503);
    const leadAccess = leadOwner(bridge, lead), assignedTo = resolveName(bridge, row.assigned_to) || leadAccess.assignedTo || '';
    const status = ['Aguardando','Agendada'].includes(str(row.status)) ? 'Pendente' : str(row.status);
    records.push(makeRecord(canonicalId('appointment', row.id), 'tasks', row, { name: `Visita · ${str(lead.name)}`, caseId: canonicalId('case', lead.id), assignedTo, type: 'Visita', propertyId: row.property_id ? canonicalId('property', str(row.property_id)) : '', dueAt: date(row.scheduled_at), priority: 'Normal', status, reason: '', notes: str(row.notes) }, { table: 'appointments', id: row.id, ...leadAccess }));
  }
  return records;
}
const canonicalFields: Partial<Record<CrmRecord['kind'], string[]>> = {
  people: ['name','phone','email','assignedTo'], leads: ['name','personId','assignedTo','source','purpose','temperature','propertyType','region','budgetMin','budgetMax','features','status','notes'],
  cases: ['personId','leadId','source','assignedTo','purpose','journey'], properties: ['name','code','purpose','price','status','district','address','city','propertyType','bedrooms','parkingSpaces','area','description','photoUrl','publicUrl'],
  tasks: ['caseId','dueAt','status','notes','propertyId','assignedTo','type'],
};
/** Only new-only fields are durable overlays. Canonical fields always reflect the database, including edits from WhatsApp/classic. */
export function mergeLegacyBridge(state: CrmState, bridge: LegacyBridge): CrmState {
  if (state.companyId !== bridge.companyId) throw new CrmError('Empresa inválida.', 403);
  const mapped = mapLegacyRecords(bridge), mappedIds = new Set(mapped.map(r => r.id));
  const native = (state.records as MappedRecord[]).filter(r => !r.legacy && !/^(person|lead|case|property|appointment):/.test(r.id));
  const merged = mapped.map(record => {
    const saved = (state.records as MappedRecord[]).find(r => r.id === record.id && r.kind === record.kind);
    if (!saved) return record;
    const data = { ...record.data, ...saved.data };
    for (const key of canonicalFields[record.kind] || []) data[key] = record.data[key];
    if (record.kind === 'cases' && saved.legacy?.lifecycleStatus !== record.legacy?.lifecycleStatus) {
      for (const key of ['stage','status']) data[key] = record.data[key];
      delete data.stageEnteredAt;
      delete data.closedAt;
    }
    // A legacy edit can invalidate a reference but must never attach data from another tenant.
    for (const key of ['propertyId','ownerId','personId','leadId','caseId']) if (data[key] && !mappedIds.has(str(data[key])) && !native.some(r => r.id === data[key])) data[key] = '';
    return { ...saved, ...record, data, updatedAt: [saved.updatedAt, record.updatedAt].filter(Boolean).sort().at(-1) || '', createdAt: record.createdAt };
  });
  return { ...state, records: [...native, ...merged], sourceRevision: bridge.sourceRevision } as CrmState;
}
/** Existing people already have a legacy interest/case, even if unqualified. Reuse that identity. */
export function prepareLegacyCommand(state: CrmState, bridge: LegacyBridge, command: CrmCommand): CrmCommand {
  if (command.type !== 'save' || command.id) return command;
  const person = rawId(command.data.personId, 'person');
  if (person && bridge.leads.some(row => row.id === person)) {
    if (command.kind === 'leads') return { ...command, id: canonicalId('lead', person) };
    if (command.kind === 'cases' && command.data.journey === 'Negociação') {
      const existing = state.records.find(r => r.id === canonicalId('case', person));
      if (existing && !['Ganho','Perdido'].includes(str(existing.data.status))) return { ...command, id: existing.id, data: { ...command.data, leadId: canonicalId('lead', person), source: existing.data.source } };
    }
  }
  return command;
}
/** Persist overlays/history, not an ever-growing duplicate snapshot of the live customer database. */
export function serializeLegacyWorkspace(next: CrmState, stored: CrmState): CrmState {
  if (next.companyId !== stored.companyId) throw new CrmError('Empresa inválida.',403);
  const keep = new Set([...stored.records.map(r => r.id),...next.events.map(event => event.recordId)]);
  const { sourceRevision: _revision, ...document } = next;
  return { ...document, records:next.records.filter(record => !record.legacy || keep.has(record.id)).map(record => record.legacy ? { ...record, data:Object.fromEntries(Object.entries(record.data).filter(([key]) => !(canonicalFields[record.kind] || []).includes(key))) } : record) };
}
function assertScope(actor: Actor, record: MappedRecord) {
  if (actor.role === 'owner') return;
  if (!record.legacy || record.legacy.access !== 'assigned' || record.legacy.assignedTo !== actor.brokerId) throw new CrmError('Este cadastro está fora da sua carteira.', 403);
}
function memberName(bridge: LegacyBridge, id: Value | undefined) {
  if (!id) return null;
  const member = bridge.members.find(m => m.id === id);
  if (!member) throw new CrmError('Responsável indisponível. Atualize a página.', 409);
  if (bridge.members.filter(m => normalize(m.name) === normalize(member.name)).length !== 1) throw new CrmError('Há responsáveis com nomes iguais. Use a gestão de contas antes de atribuir este registro.', 409);
  return member.name;
}
const changed = (before: CrmRecord | undefined, after: CrmRecord, key: string) => !before || before.data[key] !== after.data[key];
const nullable = (value: Value | undefined) => value === '' || value === undefined ? null : value;
function inputForAnalysis(row: Record<string, unknown>): LeadInput {
  return { name: str(row.name), phone: str(row.phone), email: row.email ? str(row.email) : null, goal: str(row.goal), propertyType: str(row.property_type), region: str(row.region), budget: row.budget_max ? `Até R$ ${row.budget_max}` : row.budget_min ? `A partir de R$ ${row.budget_min}` : 'Não informado', details: row.details ? str(row.details) : null, lifecycleStatus: str(row.lifecycle_status) as LeadLifecycleStatus, lastContactAt: row.last_contact_at ? str(row.last_contact_at) : null };
}
function renameState(state: CrmState, renames: Map<string,string>): CrmState {
  if (!renames.size) return state;
  const replaced = new Set(renames.values());
  const records = state.records.filter(r => !replaced.has(r.id) || renames.has(r.id)).map(record => ({ ...record, id: renames.get(record.id) || record.id, data: Object.fromEntries(Object.entries(record.data).map(([key,value]) => [key, ['personId','leadId','caseId','propertyId','ownerId'].includes(key) && typeof value === 'string' ? renames.get(value) || value : value])) }));
  return { ...state, records, events: state.events.map(event => ({ ...event, recordId: renames.get(event.recordId) || event.recordId, ...(event.caseId ? { caseId: renames.get(event.caseId) || event.caseId } : {}), ...(event.changes ? { changes:Object.fromEntries(Object.entries(event.changes).map(([key,value]) => [key,['personId','leadId','caseId','propertyId','ownerId'].includes(key) ? { from:typeof value.from === 'string' ? renames.get(value.from) || value.from : value.from,to:typeof value.to === 'string' ? renames.get(value.to) || value.to : value.to } : value])) } : {}) })) };
}
/** Validated model diff -> minimal canonical patches, all with raw compare-and-swap preconditions. */
export function planLegacyWrites(before: CrmState, after: CrmState, bridge: LegacyBridge, actor: Actor): LegacyPlan {
  if (actor.companyId !== bridge.companyId || before.companyId !== actor.companyId || after.companyId !== actor.companyId || !bridge.members.some(m => m.id === actor.brokerId && m.role === actor.role)) throw new CrmError('Empresa ou usuário inválido.', 403);
  const plans = new Map<string,LegacyWrite>(), renames = new Map<string,string>();
  const write = (table: LegacyTable, id: string, row?: LegacyRow) => {
    const key = `${table}:${id}`;
    if (!plans.has(key)) plans.set(key, { table, id, operation: row ? 'update' : 'insert', expected: row ? { ...row } : null, data: row ? {} : { id, company_id: actor.companyId } });
    return plans.get(key)!;
  };
  const modified = (after.records as MappedRecord[]).filter(r => { const previous = before.records.find(p => p.id === r.id); return !previous || stable(previous.data) !== stable(r.data); });
  // Allocate stable IDs before resolving the references of other records.
  for (const record of modified) {
    if (before.records.some(r => r.id === record.id) || record.legacy) continue;
    if (record.kind === 'people' || record.kind === 'properties') {
      if (!uuid.test(record.id)) throw new CrmError('Identificador de cadastro inválido.', 400);
      renames.set(record.id, canonicalId(record.kind === 'people' ? 'person' : 'property', record.id));
    }
  }
  for (const record of modified) {
    const previous = before.records.find(r => r.id === record.id) as MappedRecord | undefined, d = record.data;
    if (previous && !record.legacy && ['people','leads','properties'].includes(record.kind)) throw new CrmError('Este cadastro ainda não foi vinculado à base real. Solicite a integração antes de editá-lo; nenhuma cópia independente será criada.',409);
    if (previous && !record.legacy && record.kind === 'tasks' && previous.data.type !== 'Visita' && d.type === 'Visita') throw new CrmError('Crie uma nova visita para registrar o agendamento na base real. A tarefa original e seu histórico serão preservados.',409);
    if (record.legacy) assertScope(actor, record);
    if (record.kind === 'people' && (record.legacy?.table === 'leads' || !previous)) {
      const id = record.legacy?.id || record.id, row = bridge.leads.find(r => r.id === id), target = write('leads', id, row);
      if (!row) Object.assign(target.data, { name: str(d.name), phone: str(d.phone), email: nullable(d.email), goal: null, property_type: null, region: null, budget_min: null, budget_max: null, details: null, lifecycle_status: 'Novo', source: 'Cadastro manual', assigned_to: memberName(bridge, d.assignedTo), interest_profile: {} });
      for (const [key,column] of Object.entries({ name: 'name', phone: 'phone', email: 'email' })) if (changed(previous,record,key)) target.data[column] = key === 'email' ? nullable(d[key]) : str(d[key]);
      if (changed(previous,record,'assignedTo')) target.data.assigned_to = memberName(bridge,d.assignedTo);
    }
    if (record.kind === 'leads' && (record.legacy?.table === 'leads' || !previous)) {
      const personId = renames.get(str(d.personId)) || str(d.personId), id = record.legacy?.id || rawId(personId,'person');
      if (!id) throw new CrmError('Cadastre ou selecione uma pessoa vinculada à base real antes de criar o lead.', 409);
      if (personId !== canonicalId('person',id)) throw new CrmError('Este interesse pertence ao contato original. Não é permitido transferir o histórico para outra pessoa.',409);
      const row = bridge.leads.find(r => r.id === id), target = write('leads',id,row);
      if (!record.legacy && !previous) renames.set(record.id,canonicalId('lead',id));
      for (const [key,column] of Object.entries({ name:'name',source:'source', propertyType:'property_type',region:'region',budgetMin:'budget_min',budgetMax:'budget_max',notes:'details',temperature:'temperature' })) if (changed(previous,record,key)) target.data[column] = nullable(d[key]);
      if (changed(previous,record,'purpose') && d.purpose) target.data.goal = d.purpose === 'Aluguel' ? 'Alugar' : 'Comprar';
      if (changed(previous,record,'assignedTo')) target.data.assigned_to = memberName(bridge,d.assignedTo);
      if (changed(previous,record,'status')) target.data.lifecycle_status = d.status === 'Descartado' ? 'Perdido' : d.status === 'Pendente' ? 'Novo' : row?.lifecycle_status && !['Novo','Perdido'].includes(str(row.lifecycle_status)) ? row.lifecycle_status : 'Em atendimento';
      if (changed(previous,record,'features')) target.data.interest_profile = { ...object(row?.interest_profile), features: str(d.features).split(',').map(s => s.trim()).filter(Boolean) };
    }
    if (record.kind === 'cases') {
      let id = record.legacy?.table === 'leads' ? record.legacy.id : undefined;
      if (!id && !previous && d.journey === 'Negociação') {
        id = rawId(renames.get(str(d.personId)) || d.personId,'person');
        if (!id) throw new CrmError('Selecione uma pessoa vinculada à base real.',409);
        if (before.records.some(r => r.id === canonicalId('case',id!) && ['Ganho','Perdido'].includes(str(r.data.status)))) throw new CrmError('O resultado anterior está preservado. Uma nova negociação desse cliente exige o fluxo de múltiplos interesses; ele ainda não está disponível.',409);
        renames.set(record.id,canonicalId('case',id));
      }
      if (id) {
        const row = bridge.leads.find(r => r.id === id), target = write('leads',id,row);
        if (changed(previous,record,'assignedTo')) target.data.assigned_to = memberName(bridge,d.assignedTo);
        if (changed(previous,record,'purpose') && d.purpose) target.data.goal = d.purpose === 'Aluguel' ? 'Alugar' : 'Comprar';
        if (changed(previous,record,'stage') || changed(previous,record,'status')) target.data.lifecycle_status = d.status === 'Perdido' ? 'Perdido' : d.status === 'Ganho' ? 'Convertido' : d.stage === 'Proposta' ? 'Proposta' : d.stage === 'Visita' ? 'Visita' : d.stage === 'Lead' ? 'Novo' : 'Em atendimento';
      }
    }
    if (record.kind === 'properties' && (record.legacy?.table === 'properties' || !previous)) {
      if (actor.role !== 'owner') throw new CrmError('Somente o administrador pode alterar o catálogo de imóveis.',403);
      const id = record.legacy?.id || record.id, row = bridge.properties.find(r => r.id === id), target = write('properties',id,row);
      if (!row) Object.assign(target.data,{ images:[], bedrooms:0,parking_spaces:0, key_in_office:false,occupied:false,cataloged_on_instagram:false,cataloged_on_site:false });
      for (const [key,column] of Object.entries({ name:'title',code:'code',purpose:'purpose',price:'price',status:'status',district:'district',address:'address',city:'city',propertyType:'property_type',bedrooms:'bedrooms',parkingSpaces:'parking_spaces',area:'area',description:'description',publicUrl:'public_url' })) if (changed(previous,record,key)) {
        if (['bedrooms','parking_spaces'].includes(column) && !row && nullable(d[key]) === null) continue;
        if (['bedrooms','parking_spaces'].includes(column) && nullable(d[key]) === null) throw new CrmError('Quartos e vagas não podem ficar vazios. Informe zero quando não houver.',400);
        if (['bedrooms','parking_spaces'].includes(column) && !Number.isInteger(Number(d[key]))) throw new CrmError('Quartos e vagas devem ser números inteiros.',400);
        target.data[column] = nullable(d[key]);
      }
      if (!row && ['code','title','purpose','district','city','property_type'].some(key => !str(target.data[key]).trim())) throw new CrmError('Informe código, título, finalidade, bairro, cidade e tipo do imóvel.',400);
      if (changed(previous,record,'status') && d.status === 'Arquivado') throw new CrmError('O catálogo atual não possui arquivamento. Use a gestão de imóveis para retirar o anúncio com segurança.',409);
      if (changed(previous,record,'neighborhoodId') && d.neighborhoodId) { const neighborhood = after.records.find(r => r.kind === 'neighborhoods' && r.id === d.neighborhoodId); if (neighborhood) target.data.district = str(neighborhood.data.name); }
      if (changed(previous,record,'photoUrl')) {
        const value = str(d.photoUrl); if (value && !/^https:\/\//.test(value)) throw new CrmError('A foto do imóvel deve usar HTTPS.',400);
        const images = Array.isArray(row?.images) ? row.images.filter(v => typeof v === 'string') : [];
        target.data.images = value ? [value,...images.filter((image,index) => index > 0 && image !== value)] : images.slice(1);
      }
    }
    if (record.kind === 'tasks' && (record.legacy?.table === 'appointments' || (!previous && d.type === 'Visita'))) {
      const parent = after.records.find(r => r.id === d.caseId), leadId = parent && rawId(renames.get(str(parent.data.personId)) || parent.data.personId,'person');
      const propertyId = rawId(renames.get(str(d.propertyId)) || d.propertyId,'property');
      const id = record.legacy?.id || record.id, row = bridge.appointments.find(r => r.id === id), target = write('appointments',id,row);
      if (!leadId || (!propertyId && (!row || changed(previous,record,'propertyId')))) throw new CrmError('A visita precisa de cliente e imóvel da base real.',409);
      const canonicalContact = (before.records as MappedRecord[]).find(r => r.kind === 'people' && r.id === canonicalId('person',leadId));
      if (canonicalContact) assertScope(actor,canonicalContact);
      else if (!plans.has(`leads:${leadId}`)) throw new CrmError('Cliente indisponível. Atualize a página.',409);
      if (!row) { if (!uuid.test(id)) throw new CrmError('Identificador de agenda inválido.',400); renames.set(record.id,canonicalId('appointment',id)); Object.assign(target.data,{lead_id:leadId,property_id:propertyId}); }
      if (d.type !== 'Visita') throw new CrmError('Uma visita vinculada à agenda não pode mudar de tipo.',409);
      for (const [key,column] of Object.entries({ dueAt:'scheduled_at',notes:'notes' })) if (changed(previous,record,key)) target.data[column] = nullable(d[key]);
      if (changed(previous,record,'propertyId')) target.data.property_id = propertyId;
      if (changed(previous,record,'assignedTo')) target.data.assigned_to = memberName(bridge,d.assignedTo);
      if (changed(previous,record,'status')) target.data.status = d.status === 'Pendente' ? 'Aguardando' : d.status;
    }
  }
  for (const target of plans.values()) {
    const original = target.table === 'leads' ? bridge.leads.find(r => r.id === target.id) : target.table === 'properties' ? bridge.properties.find(r => r.id === target.id) : bridge.appointments.find(r => r.id === target.id);
    if (original) {
      const record = (before.records as MappedRecord[]).find(r => r.legacy?.table === target.table && r.legacy.id === target.id);
      if (!record) throw new CrmError('Cadastro indisponível. Atualize a página.',409);
      assertScope(actor,record);
    }
    if (target.table !== 'leads') continue;
    const row = bridge.leads.find(r => r.id === target.id), raw = { ...row, ...target.data };
    if (row?.source && Object.hasOwn(target.data,'source') && target.data.source !== row.source) throw new CrmError('A origem original deste contato é preservada. Utilize a origem já registrada ao atualizar o interesse.',409);
    if (row?.lifecycle_status === 'Convertido' && target.data.lifecycle_status && target.data.lifecycle_status !== 'Convertido') throw new CrmError('O resultado confirmado está preservado. Uma correção de fechamento exige um fluxo de estorno.',409);
    if (Object.hasOwn(target.data,'assigned_to') && str(target.data.assigned_to) !== str(row?.assigned_to) && bridge.conversations.some(c => c.lead_id === target.id)) throw new CrmError('Altere o responsável na área de Conversas. Isso preserva o atendimento automático e as mensagens em andamento.',409);
    if (['goal','property_type','region','budget_min','budget_max'].some(key => Object.hasOwn(target.data,key))) {
      const profile = { ...object(row?.interest_profile), ...object(target.data.interest_profile) };
      if (Object.hasOwn(target.data,'goal')) profile.purpose = purpose(raw.goal) || null;
      if (Object.hasOwn(target.data,'property_type')) profile.propertyType = raw.property_type;
      if (Object.hasOwn(target.data,'region')) profile.regions = str(raw.region).split(/[,;/]/).map(s=>s.trim()).filter(Boolean);
      if (Object.hasOwn(target.data,'budget_min')) profile.budgetMin = raw.budget_min;
      if (Object.hasOwn(target.data,'budget_max')) profile.budgetMax = raw.budget_max;
      // Keep unrelated qualifications, financing and confirmation flags intact.
      target.data.interest_profile = profile;
    }
    if (Object.keys(target.data).some(key => !['id','company_id'].includes(key))) {
      const input = inputForAnalysis(raw), analysis = analyzeLead(input);
      target.data.summary = explainProfile(input); target.data.score = analysis.score;
      if (!Object.hasOwn(target.data,'temperature')) target.data.temperature = analysis.temperature;
    }
  }
  const writes = [...plans.values()].filter(w => w.operation === 'insert' || Object.entries(w.data).some(([key,value]) => stable(w.expected?.[key]) !== stable(value))).sort((a,b) => ['leads','properties','appointments'].indexOf(a.table)-['leads','properties','appointments'].indexOf(b.table));
  // Annotate newly canonical records now, so they never become orphan native copies between reads.
  const next = renameState(after,renames);
  for (const record of next.records as MappedRecord[]) {
    const prefix = record.kind === 'people' ? 'person' : record.kind === 'leads' ? 'lead' : record.kind === 'cases' ? 'case' : record.kind === 'properties' ? 'property' : record.kind === 'tasks' ? 'appointment' : '';
    const id = prefix && rawId(record.id,prefix); if (!id) continue;
    const table: LegacyTable = prefix === 'property' ? 'properties' : prefix === 'appointment' ? 'appointments' : 'leads';
    const target = plans.get(`${table}:${id}`), row = target ? { ...target.expected, ...target.data } : undefined;
    if (target && record.kind === 'cases' && !modified.some(r => r.id === record.id) && target.data.lifecycle_status && target.data.lifecycle_status !== target.expected?.lifecycle_status) {
      const lifecycle = str(target.data.lifecycle_status);
      record.data.stage = ({Novo:'Lead','Em atendimento':'Atendimento',Visita:'Visita',Proposta:'Proposta',Convertido:'Negociado',Perdido:'Atendimento'} as Record<string,string>)[lifecycle] || 'Lead';
      record.data.status = lifecycle === 'Convertido' ? 'Ganho' : lifecycle === 'Perdido' ? 'Perdido' : 'Aberto';
      delete record.data.stageEnteredAt; delete record.data.closedAt;
    }
    if (target) record.legacy = { ...record.legacy, table,id,access:table === 'properties' ? 'shared' : record.data.assignedTo ? 'assigned' : 'owner', ...(record.data.assignedTo ? { assignedTo:str(record.data.assignedTo) } : {}), ...(table === 'leads' ? { lifecycleStatus:str(row?.lifecycle_status),missingPurpose:!purpose(row?.goal) } : {}) };
  }
  return { state:next,writes };
}
