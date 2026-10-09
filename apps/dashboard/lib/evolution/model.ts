import { CAPTURE_STAGES, MODULES, NEGOTIATION_STAGES, type Kind } from './schema';
import { REGISTRATION_ACTIONS, REGISTRATION_CHANNELS, REGISTRATION_OUTCOMES, type RegistrationAction, type RegistrationCommand } from './registration-contract';

export type Value = string | number | boolean;
export type Actor = { companyId: string; brokerId: string; name: string; role: 'owner' | 'broker' };
export type CrmMember = { id: string; name: string; role: 'owner' | 'broker'; specialization: 'Venda' | 'Aluguel' | 'Ambos'; teamId?: string; permissions?: Partial<Record<Kind, { readOthers: boolean; editOthers: boolean }>> };
export type LegacyRecordSource = { table: 'leads' | 'properties' | 'appointments'; id: string; access: 'assigned' | 'owner' | 'shared'; assignedTo?: string; label?: string; lifecycleStatus?: string; missingPurpose?: boolean };
export type CrmRecord = { id: string; kind: Kind; data: Record<string, Value>; createdAt: string; updatedAt: string; createdBy: string; legacy?: LegacyRecordSource };
export type CrmEvent = { id: string; recordId: string; caseId?: string; at: string; actorId: string; actorName: string; type: string; summary: string; changes?: Record<string, { from: Value; to: Value }>; registration?: { requestId: string; fingerprint: string; action: RegistrationAction } };
export type CrmSettings = { inactivityDays: Record<string, number>; sources: string[]; categories: string[]; lossReasons: string[]; distributionEnabled: boolean };
export type CrmState = { companyId: string; version: number; records: CrmRecord[]; events: CrmEvent[]; members: CrmMember[]; settings: CrmSettings; sourceRevision?: string };
export type CrmCommand = { type: 'save'; kind: Kind; id?: string; data: Record<string, Value> } | { type: 'comment'; id: string; text: string } | { type: 'settings'; settings: Partial<CrmSettings> } | { type: 'member'; id: string; specialization: CrmMember['specialization']; teamId?: string; permissions?: CrmMember['permissions'] } | RegistrationCommand;
export type CaseFilter = { purpose?: string; assignedTo?: string; from?: string; to?: string; stage?: string; freshness?: string; journey?: string; status?: string; query?: string };
export class CrmError extends Error { constructor(message: string, public status = 400) { super(message); this.name = 'CrmError'; } }
const deny = () => { throw new CrmError('Você não tem permissão para acessar ou alterar este registro.', 403); };
export const normalize = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
export const label = (state: CrmState, id: Value | undefined) => state.records.find(r => r.id === id)?.data.name as string || state.members.find(m => m.id === id)?.name || 'Não informado';
export function emptyState(companyId: string): CrmState {
  return { companyId, version: 0, records: [], events: [], members: [], settings: { inactivityDays: { Lead: 3, Atendimento: 7, Agendamento: 7, Visita: 7, Proposta: 3, Negociado: 30, Avaliação: 7, Captado: 30 }, sources: ['Site', 'WhatsApp', 'Indicação', 'Portal', 'Importação'], categories: ['Cliente', 'Proprietário', 'Corretor'], lossReasons: ['Desistência', 'Sem retorno', 'Preço', 'Outra imobiliária'], distributionEnabled: false } };
}
function checkActor(state: CrmState, actor: Actor) {
  const member = state.members.find(m => m.id === actor.brokerId);
  if (state.companyId !== actor.companyId || !member || member.role !== actor.role) deny();
}
function parentCase(state: CrmState, record: CrmRecord) { return state.records.find(r => r.kind === 'cases' && r.id === record.data.caseId); }
export function canAccess(state: CrmState, actor: Actor, record: CrmRecord, action: 'read' | 'write' = 'read'): boolean {
  if (state.companyId !== actor.companyId) return false;
  if (record.kind === 'notes') return record.createdBy === actor.brokerId;
  if (record.kind === 'messages') return record.createdBy === actor.brokerId || (action === 'read' && record.data.recipientId === actor.brokerId);
  if (actor.role === 'owner') return true;
  // Canonical portfolio ownership cannot be expanded by workspace preferences.
  // Inactive or ambiguous historical assignments remain visible to the owner.
  if (record.legacy) {
    if (record.legacy.access === 'owner') return false;
    if (record.legacy.access === 'shared') return action === 'read';
    return record.legacy.assignedTo === actor.brokerId;
  }
  if (['proposals', 'tasks'].includes(record.kind)) {
    const parent = parentCase(state, record);
    return Boolean(parent && canAccess(state, actor, parent, action));
  }
  // A case explicitly assigned to this portfolio carries read access to the
  // contacts/assets needed to understand it, not permission to edit them.
  if (action === 'read' && ['people','leads','properties'].includes(record.kind)) {
    const key = record.kind === 'people' ? 'personId' : record.kind === 'leads' ? 'leadId' : 'propertyId';
    if (state.records.some(r => r.kind === 'cases' && r.data[key] === record.id && canAccess(state,actor,r,'read'))) return true;
  }
  if (MODULES[record.kind].admin) return action === 'read' && record.kind === 'notices';
  const permission = state.members.find(m => m.id === actor.brokerId)?.permissions?.[record.kind];
  if (action === 'write' ? permission?.editOthers : permission?.readOthers) return true;
  if (['neighborhoods', 'condominiums', 'links'].includes(record.kind) && action === 'read') return true;
  if (record.data.assignedTo) return record.data.assignedTo === actor.brokerId;
  return record.createdBy === actor.brokerId;
}
export function visibleState(state: CrmState, actor: Actor): CrmState {
  checkActor(state, actor);
  const records = state.records.filter(r => canAccess(state, actor, r));
  const ids = new Set(records.map(r => r.id));
  return { ...state, records, events: state.events.filter(e => ids.has(e.recordId) && (!e.caseId || ids.has(e.caseId))), members: state.members.map(m => actor.role === 'owner' || m.id === actor.brokerId ? { ...m } : { id: m.id, name: m.name, role: m.role, specialization: m.specialization }) };
}
function text(value: unknown, max = 500): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new CrmError('Campo inválido.');
  const clean = String(value).trim();
  if (clean.length > max) throw new CrmError(`Limite de ${max} caracteres excedido.`);
  return clean;
}
const find = (state: CrmState, id: string, kind?: Kind) => {
  const record = state.records.find(r => r.id === id && (!kind || r.kind === kind));
  if (!record) throw new CrmError('Registro não encontrado.', 404);
  return record;
};
function validCalendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function editable(state: CrmState, actor: Actor, id: string, kind?: Kind) {
  const record = find(state, id, kind);
  if (!canAccess(state, actor, record, 'write')) deny();
  return record;
}
function addEvent(state: CrmState, actor: Actor, record: CrmRecord, now: string, type: string, summary: string, changes?: CrmEvent['changes']) {
  state.events.push({ id: crypto.randomUUID(), recordId: record.id, caseId: record.kind === 'cases' ? record.id : typeof record.data.caseId === 'string' ? record.data.caseId : undefined, at: now, actorId: actor.brokerId, actorName: actor.name, type, summary, changes });
}
function change(state: CrmState, actor: Actor, record: CrmRecord, data: Record<string, Value>, now: string, summary: string) {
  const changes: NonNullable<CrmEvent['changes']> = {};
  for (const [key, to] of Object.entries(data)) if (record.data[key] !== to) changes[key] = { from: record.data[key] ?? '', to };
  if (!Object.keys(changes).length) return;
  record.data = { ...record.data, ...data }; record.updatedAt = now;
  addEvent(state, actor, record, now, 'updated', summary, changes);
}
function validateData(state: CrmState, actor: Actor, kind: Kind, raw: Record<string, Value>, existing?: CrmRecord) {
  if (!Object.hasOwn(MODULES, kind)) throw new CrmError('Tipo de cadastro inválido.');
  const definition = MODULES[kind];
  if (!definition || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CrmError('Cadastro inválido.');
  if (definition.admin && actor.role !== 'owner') deny();
  const fields = new Set(definition.fields.map(f => f.key));
  if (Object.keys(raw).some(key => !fields.has(key))) throw new CrmError('Campo não permitido.');
  const merged = { ...existing?.data, ...raw }, data: Record<string, Value> = {};
  for (const field of definition.fields) {
    const unchangedLegacy = Boolean(existing?.legacy && (raw[field.key] === undefined || raw[field.key] === existing.data[field.key]));
    if (unchangedLegacy && field.type === 'url' && String(merged[field.key] || '').startsWith('data:')) { data[field.key] = String(merged[field.key]); continue; }
    const value = text(merged[field.key], field.type === 'textarea' ? 6000 : 500);
    if (!value) { if (field.required && !unchangedLegacy) throw new CrmError(`Preencha ${field.label}.`); data[field.key] = ''; continue; }
    if (field.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number) || number < (field.min ?? 0) || number > 1e12) throw new CrmError(`${field.label}: valor inválido.`);
      data[field.key] = number;
    } else data[field.key] = value;
    const options = kind === 'people' && field.key === 'category' ? [...state.settings.categories, 'Cliente e proprietário'] : field.options;
    if (options && !options.includes(value) && !unchangedLegacy) throw new CrmError(`${field.label}: opção inválida.`);
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new CrmError('Email inválido.');
    if (field.type === 'url') { try { if (!['https:', 'http:'].includes(new URL(value).protocol)) throw new Error(); } catch { throw new CrmError(`${field.label}: use um endereço http ou https.`); } }
    if (field.type === 'date' && !validCalendarDay(value)) throw new CrmError(`${field.label}: data inválida.`);
    if (field.type === 'datetime-local') { if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value) || !validCalendarDay(value.slice(0,10)) || Number.isNaN(Date.parse(value))) throw new CrmError(`${field.label}: horário inválido.`); data[field.key] = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? new Date(value).toISOString() : new Date(value + '-03:00').toISOString(); }
    if (field.ref === 'members') {
      if (!state.members.some(m => m.id === value)) throw new CrmError('Responsável não pertence à equipe ativa.');
      if (field.key === 'assignedTo' && actor.role !== 'owner' && value !== actor.brokerId && existing?.data.assignedTo !== value) deny();
    } else if (field.ref) {
      const related = find(state, value, field.ref);
      if (!canAccess(state, actor, related)) deny();
    }
  }
  return data;
}
function validateBusiness(state: CrmState, actor: Actor, record: CrmRecord, previous?: CrmRecord) {
  const d = record.data;
  if (record.kind === 'people') {
    const duplicate = state.records.find(r => r.kind === 'people' && r.id !== record.id && ((d.email && normalize(r.data.email) === normalize(d.email)) || (String(d.phone || '').replace(/\D/g, '') && String(r.data.phone || '').replace(/\D/g, '') === String(d.phone).replace(/\D/g, ''))));
    if (duplicate) throw new CrmError('Já existe uma pessoa com este email ou telefone. Revise o cadastro existente; nenhuma fusão foi realizada.', 409);
  }
  if (record.kind === 'leads' && Number(d.budgetMax) && Number(d.budgetMin) > Number(d.budgetMax)) throw new CrmError('Orçamento máximo deve ser maior ou igual ao mínimo.');
  if (record.kind === 'cases') {
    const stages = d.journey === 'Captação' ? CAPTURE_STAGES : NEGOTIATION_STAGES;
    if (!stages.includes(String(d.stage))) throw new CrmError('Etapa incompatível com a jornada.');
    if (['Pausado', 'Perdido'].includes(String(d.status)) && !d.reason && !(previous?.legacy && previous.data.status === d.status && !previous.data.reason)) throw new CrmError('Informe o motivo da pausa ou encerramento.');
    if (previous && (previous.data.source !== d.source || previous.data.leadId !== d.leadId || previous.data.personId !== d.personId || previous.data.journey !== d.journey)) throw new CrmError('Origem, cliente, lead e jornada são preservados. Abra outro atendimento para uma nova negociação.');
    if (d.leadId) {
      const lead = find(state, String(d.leadId), 'leads');
      if (lead.data.personId !== d.personId || lead.data.source !== d.source) throw new CrmError('Cliente e origem devem corresponder ao lead vinculado.');
    }
    const accepted = state.records.find(r => r.kind === 'proposals' && r.data.caseId === record.id && r.data.status === 'Aceita');
    const legacyClosed = previous?.legacy?.lifecycleStatus === 'Convertido';
    if (legacyClosed && ['status','stage','purpose','assignedTo','propertyId'].some(key => previous.data[key] !== d[key])) throw new CrmError('O resultado anterior está preservado. Registre uma nova negociação para outro interesse.');
    if (d.journey === 'Negociação' && (d.status === 'Ganho' || d.stage === 'Negociado') && !accepted && !legacyClosed) throw new CrmError('Registre uma proposta aceita para concluir a negociação. Não é necessário ter uma visita.');
    if (accepted && (d.status !== 'Ganho' || d.stage !== 'Negociado')) throw new CrmError('O atendimento possui resultado confirmado. Abra uma nova negociação; o resultado anterior será preservado.');
    if (accepted && previous && ['purpose','assignedTo','propertyId'].some(key => previous.data[key] !== d[key])) throw new CrmError('Finalidade, responsável e imóvel do resultado confirmado são preservados.');
    if (d.journey === 'Captação' && ((d.status === 'Ganho') !== (d.stage === 'Captado'))) throw new CrmError('Uma captação ganha deve estar na etapa Captado.');
    if (previous?.data.status === 'Perdido' && d.status === 'Aberto' && !d.reason) throw new CrmError('Registre o motivo da reabertura.');
  }
  if (['tasks', 'proposals'].includes(record.kind)) {
    const parent = editable(state, actor, String(d.caseId), 'cases');
    if (previous && previous.data.caseId !== d.caseId) throw new CrmError('Não é permitido transferir o histórico para outro atendimento.');
    if (!previous && parent.data.status !== 'Aberto') throw new CrmError('Reabra o atendimento antes de incluir atividades ou propostas.');
  }
  if (record.kind === 'tasks') {
    const assignee = state.members.find(m => m.id === d.assignedTo);
    const parent = find(state, String(d.caseId), 'cases');
    const unresolvedLegacyAssignee = previous?.legacy?.table === 'appointments' && !previous.data.assignedTo && !d.assignedTo;
    if (!unresolvedLegacyAssignee && (!assignee || !canAccess(state, {companyId:state.companyId,brokerId:assignee.id,name:assignee.name,role:assignee.role}, parent))) throw new CrmError('O responsável pela atividade precisa ter acesso ao atendimento. Ajuste a carteira ou as permissões antes de atribuir.');
    if (d.type === 'Visita' && !d.propertyId && !(previous?.legacy?.table === 'appointments' && !previous.data.propertyId)) throw new CrmError('Selecione o imóvel da visita.');
    if (['Ausência', 'Cancelada'].includes(String(d.status)) && !d.reason) throw new CrmError('Informe o motivo / feedback.');
  }
  if (record.kind === 'proposals') {
    const parent = find(state, String(d.caseId), 'cases');
    if (parent.data.journey !== 'Negociação') throw new CrmError('Propostas pertencem à jornada de negociação.');
    if (previous?.data.status === 'Aceita') throw new CrmError('Resultado confirmado é preservado. Correções de fechamento exigem um fluxo de estorno, ainda não disponível.', 409);
    const prop = find(state, String(d.propertyId), 'properties');
    if (prop.data.purpose !== parent.data.purpose) throw new CrmError('A finalidade do imóvel deve corresponder à do atendimento.');
    if (['Vendido', 'Alugado', 'Arquivado'].includes(String(prop.data.status))) throw new CrmError('O imóvel não está disponível para proposta.');
    if (d.status === 'Recusada' && !d.reason) throw new CrmError('Informe o motivo da recusa.');
    if (d.status === 'Aceita') {
      editable(state, actor, prop.id, 'properties');
      if (parent.data.status !== 'Aberto') throw new CrmError('O atendimento não está aberto.');
      if (state.records.some(r => r.id !== record.id && r.kind === 'proposals' && r.data.caseId === d.caseId && r.data.status === 'Aceita')) throw new CrmError('Este atendimento já tem uma proposta aceita.', 409);
    }
  }
  if (['neighborhoods', 'condominiums'].includes(record.kind)) {
    const names = [d.name, ...String(d.aliases || '').split(',')].map(normalize).filter(Boolean);
    if (state.records.some(r => r.kind === record.kind && r.id !== record.id && normalize(r.data.city) === normalize(d.city) && [r.data.name, ...String(r.data.aliases || '').split(',')].map(normalize).some(n => names.includes(n)))) throw new CrmError('Nome ou apelido já cadastrado nesta cidade.', 409);
  }
  if (record.kind === 'properties' && state.records.some(r => r.kind === 'properties' && r.id !== record.id && normalize(r.data.code) === normalize(d.code))) throw new CrmError('Código do imóvel já cadastrado.', 409);
  if (record.kind === 'keys') {
    if (previous?.data.status === 'Devolvida') throw new CrmError('Devolução registrada é preservada. Crie uma nova retirada.', 409);
    if (!previous && d.status !== 'Retirada') throw new CrmError('Registre a retirada antes da devolução.');
    if (previous && (d.propertyId !== previous.data.propertyId || d.keyCode !== previous.data.keyCode)) throw new CrmError('O imóvel e a chave de uma retirada não podem ser trocados.');
    if (d.status === 'Retirada' && state.records.some(r => r.kind === 'keys' && r.id !== record.id && r.data.propertyId === d.propertyId && normalize(r.data.keyCode) === normalize(d.keyCode) && r.data.status === 'Retirada')) throw new CrmError('Esta chave já está emprestada.', 409);
  }
  if (record.kind === 'goals') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(d.month))) throw new CrmError('Informe o mês no formato AAAA-MM.');
    if (state.records.some(r => r.id !== record.id && r.kind === 'goals' && r.data.month === d.month && r.data.assignedTo === d.assignedTo && r.data.purpose === d.purpose)) throw new CrmError('Já existe uma meta desta finalidade para o responsável neste mês.', 409);
  }
}
const registrationFields: Record<RegistrationAction, readonly string[]> = {
  lead: ['reason'], attendance: ['channel', 'outcome'], schedule: ['taskId', 'propertyId', 'dueAt'],
  visit: ['taskId', 'propertyId', 'occurredAt'], proposal: ['propertyId', 'amount', 'conditions', 'expiresAt', 'status'], close: ['proposalId', 'confirmed', 'reason'],
};
function registrationFingerprint(command: RegistrationCommand): string {
  if (Object.keys(command).some(key => !['type', 'caseId', 'requestId', 'action', 'data'].includes(key))
    || !REGISTRATION_ACTIONS.includes(command.action)
    || typeof command.caseId !== 'string' || !command.caseId.trim() || command.caseId.length > 150
    || typeof command.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.requestId)
    || !command.data || typeof command.data !== 'object' || Array.isArray(command.data)) throw new CrmError('Registro inválido. Revise a opção selecionada.');
  const allowed = ['purpose', 'notes', ...registrationFields[command.action]];
  for (const [key, value] of Object.entries(command.data)) {
    if (!allowed.includes(key)) throw new CrmError('Campo não permitido no registro.');
    if (key === 'confirmed') { if (value !== true) throw new CrmError('Confirme expressamente o fechamento.'); }
    else if (key === 'amount') { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.01 || value > 1e12) throw new CrmError('Informe um valor de proposta válido.'); }
    else if (typeof value !== 'string' || value.length > (['notes', 'conditions'].includes(key) ? 2000 : 500)) throw new CrmError('Campo de registro inválido ou muito longo.');
  }
  if (command.data.purpose !== undefined && !['Venda', 'Aluguel'].includes(command.data.purpose)) throw new CrmError('Selecione Venda ou Aluguel.');
  // An exact, canonical payload fingerprint avoids lossy hashes and collision-based replays.
  return JSON.stringify({ caseId: command.caseId, action: command.action, data: Object.fromEntries(Object.entries(command.data).sort(([a], [b]) => a.localeCompare(b))) });
}
/** A confirmed retry is safe even when the browser still holds the pre-commit version. */
export function registrationReplay(state: CrmState, actor: Actor, command: CrmCommand): boolean {
  if (command.type !== 'register') return false;
  checkActor(state, actor);
  const fingerprint = registrationFingerprint(command);
  editable(state, actor, command.caseId, 'cases');
  const previous = state.events.find(event => event.registration?.requestId === command.requestId);
  if (!previous) return false;
  if (previous.actorId !== actor.brokerId || previous.recordId !== command.caseId || previous.registration?.fingerprint !== fingerprint) throw new CrmError('Este identificador já foi usado por outro registro. Atualize a conversa antes de continuar.', 409);
  return true;
}
function applyRegistration(original: CrmState, actor: Actor, command: RegistrationCommand, now: string): CrmState {
  const fingerprint = registrationFingerprint(command);
  if (registrationReplay(original, actor, command)) return original;
  const initial = editable(original, actor, command.caseId, 'cases');
  if (initial.data.journey !== 'Negociação') throw new CrmError('Este registro pertence à jornada de negociação.');
  if (initial.data.status !== 'Aberto' || initial.data.stage === 'Negociado' || initial.legacy?.lifecycleStatus === 'Convertido'
    || original.records.some(record => record.kind === 'proposals' && record.data.caseId === initial.id && record.data.status === 'Aceita')) throw new CrmError('O atendimento não está aberto. O resultado e o histórico existentes foram preservados.', 409);
  if (!NEGOTIATION_STAGES.includes(String(initial.data.stage))) throw new CrmError('A etapa atual precisa ser revisada antes deste registro.', 409);
  const purpose = command.data.purpose || initial.data.purpose;
  if (purpose !== 'Venda' && purpose !== 'Aluguel') throw new CrmError('Informe se este atendimento é de Venda ou Aluguel.');
  if (initial.data.purpose && purpose !== initial.data.purpose) throw new CrmError('A finalidade do atendimento não pode ser trocada neste registro.');
  let state = original;
  const save = (kind: Kind, data: Record<string, Value>, id?: string) => { state = applyCommand(state, actor, { type: 'save', kind, ...(id ? { id } : {}), data }, now); };
  const parent = () => find(state, command.caseId, 'cases');
  const caseUpdate = (data: Record<string, Value>) => save('cases', data, command.caseId);
  if (!initial.data.purpose) caseUpdate({ purpose });
  const advance = (stage: string, extra: Record<string, Value> = {}) => {
    const forward = NEGOTIATION_STAGES.indexOf(stage) > NEGOTIATION_STAGES.indexOf(String(parent().data.stage));
    caseUpdate({ ...(forward ? { stage } : {}), ...extra });
  };
  const propertyFor = (id: unknown, requireAvailability = true) => {
    if (typeof id !== 'string' || !id) throw new CrmError('Selecione o imóvel.');
    const property = find(state, id, 'properties');
    if (!canAccess(state, actor, property)) deny();
    if (property.data.purpose !== purpose) throw new CrmError('A finalidade do imóvel deve corresponder à do atendimento.');
    if (requireAvailability && !['Disponível', 'Reservado'].includes(String(property.data.status))) throw new CrmError('O imóvel não está disponível para este registro.');
    return property;
  };
  const visitFor = (id: string) => {
    const task = editable(state, actor, id, 'tasks');
    if (task.data.caseId !== command.caseId || task.data.type !== 'Visita') throw new CrmError('Selecione uma visita deste atendimento.');
    if (!['Pendente', 'Confirmada'].includes(String(task.data.status))) throw new CrmError('Esta visita já foi concluída ou cancelada. O histórico foi preservado.', 409);
    return task;
  };
  const nextActivity = () => state.records.filter(record => record.kind === 'tasks' && record.data.caseId === command.caseId && ['Pendente', 'Confirmada'].includes(String(record.data.status)) && Date.parse(String(record.data.dueAt)) > Date.parse(now)).map(record => String(record.data.dueAt)).sort()[0] || '';
  let summary = '';
  if (command.action === 'lead') {
    const reason = text(command.data.reason);
    if (initial.data.stage !== 'Lead' && !reason) throw new CrmError('Informe o motivo para voltar este contato à etapa Lead.');
    caseUpdate({ stage: 'Lead' });
    summary = `Contato classificado como Lead${reason ? ` · Motivo: ${reason}` : ''}. Atividades e propostas anteriores foram preservadas.`;
  } else if (command.action === 'attendance') {
    if (!REGISTRATION_CHANNELS.includes(command.data.channel) || !REGISTRATION_OUTCOMES.includes(command.data.outcome)) throw new CrmError('Informe o canal e o resultado do atendimento.');
    advance('Atendimento');
    summary = `Atendimento registrado · ${command.data.channel} · ${command.data.outcome}`;
  } else if (command.action === 'schedule') {
    const property = propertyFor(command.data.propertyId);
    const existing = command.data.taskId ? visitFor(command.data.taskId) : undefined;
    // Reuse the shared strict calendar/time validation, including São Paulo for local input.
    const assignedTo = existing?.data.assignedTo || parent().data.assignedTo || actor.brokerId;
    const taskData = validateData(state, actor, 'tasks', { name: existing?.data.name || `Visita · ${label(state, parent().data.personId)}`, caseId: command.caseId, assignedTo, type: 'Visita', propertyId: property.id, dueAt: command.data.dueAt, priority: existing?.data.priority || 'Normal', status: 'Confirmada', reason: existing?.data.reason || '', notes: command.data.notes ?? existing?.data.notes ?? '' }, existing);
    if (Date.parse(String(taskData.dueAt)) <= Date.parse(now)) throw new CrmError('O agendamento deve ter uma data e um horário futuros.');
    if (state.records.some(record => record.kind === 'tasks' && record.id !== existing?.id && record.data.caseId === command.caseId && record.data.type === 'Visita' && record.data.propertyId === property.id && ['Pendente', 'Confirmada'].includes(String(record.data.status)) && Date.parse(String(record.data.dueAt)) === Date.parse(String(taskData.dueAt)))) throw new CrmError('Já existe uma visita ativa para este cliente, imóvel e horário. Abra o agendamento existente.', 409);
    save('tasks', taskData, existing?.id);
    advance('Agendamento', { nextActivityAt: nextActivity(), ...(NEGOTIATION_STAGES.indexOf(String(parent().data.stage)) <= 2 ? { propertyId: property.id } : {}) });
    summary = `${existing ? 'Visita reagendada' : 'Visita agendada'} · ${property.data.name} · ${taskData.dueAt}`;
  } else if (command.action === 'visit') {
    if (command.data.taskId && (command.data.propertyId !== undefined || command.data.occurredAt !== undefined)) throw new CrmError('Selecione uma visita existente ou registre uma visita sem agendamento, não ambos.');
    const existing = command.data.taskId ? visitFor(command.data.taskId) : undefined;
    const property = propertyFor(existing?.data.propertyId || command.data.propertyId, false);
    const taskData = existing ? { ...existing.data, status: 'Realizada', ...(command.data.notes !== undefined ? { notes: command.data.notes } : {}) } : validateData(state, actor, 'tasks', { name: `Visita · ${label(state, parent().data.personId)}`, caseId: command.caseId, assignedTo: parent().data.assignedTo || actor.brokerId, type: 'Visita', propertyId: property.id, dueAt: command.data.occurredAt || '', priority: 'Normal', status: 'Realizada', reason: '', notes: command.data.notes || '' });
    if (!Number.isFinite(Date.parse(String(taskData.dueAt))) || Date.parse(String(taskData.dueAt)) > Date.parse(now)) throw new CrmError('Uma visita futura não pode ser marcada como realizada. Informe quando a visita realmente aconteceu.');
    if (!existing && state.records.some(record => record.kind === 'tasks' && record.data.caseId === command.caseId && record.data.type === 'Visita' && record.data.propertyId === property.id && ['Pendente', 'Confirmada', 'Realizada'].includes(String(record.data.status)) && Date.parse(String(record.data.dueAt)) === Date.parse(String(taskData.dueAt)))) throw new CrmError('Já existe uma visita para este cliente, imóvel e horário. Selecione o registro existente.', 409);
    save('tasks', taskData, existing?.id);
    advance('Visita', { nextActivityAt: nextActivity(), ...(NEGOTIATION_STAGES.indexOf(String(parent().data.stage)) <= 3 ? { propertyId: property.id } : {}) });
    summary = `Visita realizada${existing ? '' : ' sem agendamento anterior'} · ${property.data.name} · ${taskData.dueAt}`;
  } else if (command.action === 'proposal') {
    const property = propertyFor(command.data.propertyId);
    if (!['Enviada', 'Em negociação'].includes(command.data.status)) throw new CrmError('Selecione Enviada ou Em negociação.');
    const today = new Date(Date.parse(now) - 3 * 3600000).toISOString().slice(0, 10);
    if (!validCalendarDay(command.data.expiresAt) || command.data.expiresAt < today) throw new CrmError('A validade da proposta deve ser hoje ou uma data futura.');
    save('proposals', { name: `Proposta · ${property.data.name}`, caseId: command.caseId, propertyId: property.id, amount: command.data.amount, conditions: command.data.conditions, expiresAt: command.data.expiresAt, status: command.data.status, reason: '' });
    advance('Proposta', { propertyId: property.id });
    summary = `Proposta registrada · ${property.data.name} · ${command.data.status}. Nenhuma mensagem foi enviada.`;
  } else {
    if (command.data.confirmed !== true || typeof command.data.proposalId !== 'string' || !command.data.proposalId) throw new CrmError('Selecione a proposta e confirme o fechamento.');
    const proposal = editable(state, actor, command.data.proposalId, 'proposals');
    if (proposal.data.caseId !== command.caseId || !['Enviada', 'Em negociação'].includes(String(proposal.data.status))) throw new CrmError('Selecione uma proposta enviada ou em negociação deste atendimento.');
    const today = new Date(Date.parse(now) - 3 * 3600000).toISOString().slice(0, 10);
    if (!validCalendarDay(String(proposal.data.expiresAt)) || String(proposal.data.expiresAt) < today) throw new CrmError('A proposta está vencida. Revise sua validade antes de confirmar o fechamento.');
    propertyFor(proposal.data.propertyId);
    // Existing acceptance validation includes WRITE access to the property; never bypass it.
    save('proposals', { status: 'Aceita', reason: text(command.data.reason) || 'Fechamento confirmado na conversa' }, proposal.id);
    summary = `Negociação concluída por confirmação explícita · ${proposal.data.name}`;
  }
  const linkedLead = parent().data.leadId && state.records.find(record => record.kind === 'leads' && record.id === parent().data.leadId);
  // Canonical legacy lead status is derived from the case by the atomic SQL bridge.
  if (linkedLead && !linkedLead.legacy) save('leads', { status: command.action === 'lead' ? 'Pendente' : 'Em atendimento', ...(!linkedLead.data.purpose ? { purpose } : {}) }, linkedLead.id);
  // Even an already-current stage is a new, dated human event. No bot takeover or last_contact_at update.
  state = structuredClone(state);
  const registeredCase = find(state, command.caseId, 'cases'); registeredCase.updatedAt = now;
  state.events.push({ id: crypto.randomUUID(), recordId: command.caseId, caseId: command.caseId, at: now, actorId: actor.brokerId, actorName: actor.name, type: 'registration', summary: summary + (command.data.notes?.trim() ? `\n${command.data.notes.trim()}` : ''), registration: { requestId: command.requestId, fingerprint, action: command.action } });
  state.version = original.version + 1;
  return state;
}
/** Pure transaction: all validation succeeds before caller atomically persists version+1. */
export function applyCommand(original: CrmState, actor: Actor, command: CrmCommand, now = new Date().toISOString()): CrmState {
  checkActor(original, actor);
  if (!command || typeof command !== 'object') throw new CrmError('Comando inválido.');
  if (original.events.length > 30000 || original.records.length > 5000) throw new CrmError('Limite de armazenamento desta versão atingido. Seus dados foram preservados; entre em contato com o suporte antes de continuar.', 413);
  if (command.type === 'register') return applyRegistration(original, actor, command, now);
  const state: CrmState = structuredClone(original);
  if (command.type === 'save') {
    const previous = command.id ? editable(state, actor, text(command.id), command.kind) : undefined;
    const data = validateData(state, actor, command.kind, command.data, previous);
    const record: CrmRecord = { id: previous?.id || crypto.randomUUID(), kind: command.kind, data: { ...previous?.data, ...data }, createdBy: previous?.createdBy || actor.brokerId, createdAt: previous?.createdAt || now, updatedAt: now, ...(previous?.legacy ? { legacy: previous.legacy } : {}) };
    if (!canAccess(state, actor, record, 'write')) deny();
    validateBusiness(state, actor, record, previous);
    if (record.kind === 'keys') { record.data.checkedOutAt = previous?.data.checkedOutAt || now; if (record.data.status === 'Devolvida') record.data.returnedAt = now; }
    if (record.kind === 'cases' && record.data.stage !== previous?.data.stage) record.data.stageEnteredAt = now;
    if (record.kind === 'proposals' && record.data.status === 'Aceita') record.data.acceptedAt = now;
    if (previous) change(state, actor, previous, record.data, now, `${MODULES[record.kind].singular} atualizado`);
    else { state.records.push(record); addEvent(state, actor, record, now, 'created', `${MODULES[record.kind].singular} criado`, Object.fromEntries(Object.entries(record.data).filter(([,v]) => v !== '').map(([k,v]) => [k,{from:'',to:v}]))); }
    const saved = find(state, record.id);
    if (saved.kind === 'proposals' && saved.data.status === 'Aceita') {
      const parent = find(state, String(saved.data.caseId), 'cases'), prop = find(state, String(saved.data.propertyId), 'properties');
      change(state, actor, parent, { stage: 'Negociado', status: 'Ganho', stageEnteredAt: now, closedAt: now, reason: 'Proposta aceita', propertyId: prop.id }, now, 'Negociação concluída por proposta aceita');
      change(state, actor, prop, { status: parent.data.purpose === 'Aluguel' ? 'Alugado' : 'Vendido' }, now, 'Situação atualizada por proposta aceita');
    }
  } else if (command.type === 'comment') {
    const record = editable(state, actor, text(command.id));
    const message = text(command.text, 6000); if (!message) throw new CrmError('Escreva a observação.');
    record.updatedAt = now; addEvent(state, actor, record, now, 'comment', message);
  } else if (command.type === 'settings') {
    if (actor.role !== 'owner') deny();
    const settings = command.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new CrmError('Configuração inválida.');
    if (Object.keys(settings).some(k => !['inactivityDays','sources','categories','lossReasons','distributionEnabled'].includes(k))) throw new CrmError('Configuração não permitida.');
    if (settings.distributionEnabled !== undefined && settings.distributionEnabled !== false) throw new CrmError('Distribuição automática ainda não liberada. A especialização não transfere nem oculta atendimentos existentes.');
    if (settings.inactivityDays) {
      for (const [stage, days] of Object.entries(settings.inactivityDays)) { if (![...NEGOTIATION_STAGES, ...CAPTURE_STAGES].includes(stage) || !Number.isInteger(days) || days < 1 || days > 365) throw new CrmError('Prazo por etapa deve ser de 1 a 365 dias.'); }
      state.settings.inactivityDays = { ...state.settings.inactivityDays, ...settings.inactivityDays };
    }
    for (const key of ['sources','categories','lossReasons'] as const) if (settings[key]) {
      const list = settings[key]; if (!Array.isArray(list) || !list.length || list.length > 50) throw new CrmError('Informe de 1 a 50 opções.');
      state.settings[key] = Array.from(new Set(list.map(item => text(item, 100)).filter(Boolean)));
    }
  } else if (command.type === 'member') {
    if (actor.role !== 'owner') deny();
    const member = state.members.find(m => m.id === command.id); if (!member) throw new CrmError('Usuário não encontrado.',404);
    if (!['Venda','Aluguel','Ambos'].includes(command.specialization)) throw new CrmError('Atuação inválida.');
    if (command.teamId) find(state, text(command.teamId), 'teams');
    member.specialization = command.specialization; member.teamId = command.teamId || undefined;
    if (command.permissions) {
      const permissions: NonNullable<CrmMember['permissions']> = {};
      for (const [key, value] of Object.entries(command.permissions)) {
        if (!Object.hasOwn(MODULES,key) || !value || typeof value.readOthers !== 'boolean' || typeof value.editOthers !== 'boolean') throw new CrmError('Permissão inválida.');
        if (value.editOthers && !value.readOthers) throw new CrmError('Editar a carteira de outros exige também permissão de leitura.');
        permissions[key as Kind] = { readOthers: value.readOthers, editOthers: value.editOthers };
      }
      member.permissions = permissions;
    }
  } else throw new CrmError('Comando não permitido.');
  state.version += 1;
  return state;
}

export function freshness(record: CrmRecord, settings: CrmSettings, now = new Date().toISOString()): 'current' | 'near' | 'overdue' {
  const days = settings.inactivityDays[String(record.data.stage)] ?? 7;
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(record.updatedAt)) / 86400000;
  return elapsed >= days ? 'overdue' : elapsed >= days * 0.8 ? 'near' : 'current';
}
export function filterCases(state: CrmState, filter: CaseFilter = {}, now = new Date().toISOString()): CrmRecord[] {
  return state.records.filter(r => r.kind === 'cases' && (!filter.purpose || r.data.purpose === filter.purpose) && (!filter.assignedTo || r.data.assignedTo === filter.assignedTo) && (!filter.stage || r.data.stage === filter.stage) && (!filter.journey || r.data.journey === filter.journey) && (!filter.status || r.data.status === filter.status) && (!filter.from || Date.parse(r.createdAt) >= Date.parse(`${filter.from}T00:00:00-03:00`)) && (!filter.to || Date.parse(r.createdAt) < Date.parse(`${filter.to}T00:00:00-03:00`) + 86400000) && (!filter.freshness || r.data.status === 'Aberto' && freshness(r,state.settings,now) === filter.freshness) && (!filter.query || normalize([r.data.name,label(state,r.data.personId),r.data.source].join(' ')).includes(normalize(filter.query))));
}
export function dashboardMetrics(state: CrmState, filter: CaseFilter = {}, now = new Date().toISOString()) {
  const cases = filterCases(state, filter, now), caseIds = new Set(cases.map(r => r.id)), active = cases.filter(r => r.data.status === 'Aberto');
  const proposals = state.records.filter(r => r.kind === 'proposals' && caseIds.has(String(r.data.caseId)));
  const tasks = state.records.filter(r => r.kind === 'tasks' && caseIds.has(String(r.data.caseId)));
  return { cases, active, stages: Object.fromEntries([...new Set([...NEGOTIATION_STAGES,...CAPTURE_STAGES])].map(stage => [stage,cases.filter(r => r.data.stage === stage).length])), freshness: { current: active.filter(r => freshness(r,state.settings,now)==='current').length, near: active.filter(r => freshness(r,state.settings,now)==='near').length, overdue: active.filter(r => freshness(r,state.settings,now)==='overdue').length }, proposals, accepted: proposals.filter(r => r.data.status==='Aceita'), upcoming: tasks.filter(r => ['Pendente','Confirmada'].includes(String(r.data.status))).sort((a,b)=>String(a.data.dueAt).localeCompare(String(b.data.dueAt))), visits: tasks.filter(r => r.data.type==='Visita'), inventory: state.records.filter(r=>r.kind==='properties' && (!filter.purpose||r.data.purpose===filter.purpose) && (!filter.assignedTo||r.data.assignedTo===filter.assignedTo)), sources: Object.fromEntries([...new Set(cases.map(r=>String(r.data.source)))].map(source=>[source,cases.filter(r=>r.data.source===source).length])) };
}

/** ONLY for the independently hosted preview; never used by live data adapters. */
export function createDemoState(companyId: string, actorId: string, now = new Date().toISOString()): CrmState {
  const state = emptyState(companyId);
  state.members = [{id:actorId,name:'Administrador de demonstração',role:'owner',specialization:'Ambos'},{id:'demo-broker-1',name:'Corretora exemplo A',role:'broker',specialization:'Venda'},{id:'demo-broker-2',name:'Corretor exemplo B',role:'broker',specialization:'Aluguel'}];
  const day = (n:number) => new Date(Date.parse(now)+n*86400000).toISOString();
  const add = (id:string,kind:Kind,data:Record<string,Value>,age=0) => {state.records.push({id,kind,data,createdAt:day(-age),updatedAt:day(-Math.min(age,9)),createdBy:actorId});};
  add('demo-neighborhood','neighborhoods',{name:'Bairro de demonstração',city:'Cidade exemplo',aliases:'',notes:''});
  add('demo-condo','condominiums',{name:'Residencial exemplo',city:'Cidade exemplo',address:'Endereço fictício',features:'Elevador, área comum',notes:''});
  for(let i=1;i<=8;i++) {
    const assignedTo = i%3===0 ? actorId : i%2===0 ? 'demo-broker-2' : 'demo-broker-1', purpose=i%2===0?'Aluguel':'Venda';
    add(`demo-person-${i}`,'people',{name:`Cliente fictício ${String(i).padStart(2,'0')}`,personType:'Pessoa física',category:i===8?'Cliente e proprietário':'Cliente',phone:'',email:`exemplo${i}@example.invalid`,address:'Endereço fictício',assignedTo,notes:'Cadastro exclusivamente sintético.'},i+2);
    add(`demo-property-${i}`,'properties',{name:`${i%2?'Apartamento':'Casa'} de demonstração ${i}`,code:`DEMO-${100+i}`,purpose,price:purpose==='Venda'?320000+i*27000:1300+i*200,status:'Disponível',ownerId:'demo-person-8',assignedTo,condominiumId:'demo-condo',neighborhoodId:'demo-neighborhood',city:'Cidade exemplo',address:'Endereço fictício',bedrooms:2,area:75,notes:'Imóvel fictício; não está à venda.'},i);
    add(`demo-lead-${i}`,'leads',{name:`Interesse de demonstração ${i}`,personId:`demo-person-${i}`,assignedTo,source:['Site','WhatsApp','Indicação'][i%3],purpose,propertyId:`demo-property-${i}`,temperature:i%2?'Quente':'Morno',propertyType:i%2?'Apartamento':'Casa',region:'Bairro de demonstração',budgetMin:0,budgetMax:purpose==='Venda'?650000:4000,features:'2 quartos',status:'Em atendimento',notes:''},i+1);
    const stage=NEGOTIATION_STAGES[(i-1)%5];
    add(`demo-case-${i}`,'cases',{name:`${purpose==='Venda'?'Compra':'Locação'} · Cliente fictício ${i}`,personId:`demo-person-${i}`,leadId:`demo-lead-${i}`,source:['Site','WhatsApp','Indicação'][i%3],assignedTo,purpose,journey:'Negociação',stage,status:'Aberto',propertyId:`demo-property-${i}`,nextActivityAt:day(i-2),reason:'',notes:'Cenário sintético de avaliação.'},i);
  }
  add('demo-capture','cases',{name:'Captação de demonstração',personId:'demo-person-8',source:'Indicação',assignedTo:actorId,purpose:'Venda',journey:'Captação',stage:'Avaliação',status:'Aberto',reason:'',notes:''},2);
  add('demo-task-1','tasks',{name:'Visita de demonstração',caseId:'demo-case-1',assignedTo:'demo-broker-1',type:'Visita',propertyId:'demo-property-1',dueAt:day(1),priority:'Alta',status:'Confirmada',reason:'',notes:''});
  add('demo-task-2','tasks',{name:'Retorno pendente de demonstração',caseId:'demo-case-2',assignedTo:'demo-broker-2',type:'Tarefa',dueAt:day(-1),priority:'Normal',status:'Pendente',reason:'',notes:''});
  add('demo-goal','goals',{name:'Meta de demonstração',assignedTo:actorId,purpose:'Venda',month:now.slice(0,7),amount:1000000,notes:'Meta sintética informada manualmente.'});
  // Snapshot data intentionally has no fabricated transition events or conversion rate.
  return state;
}
