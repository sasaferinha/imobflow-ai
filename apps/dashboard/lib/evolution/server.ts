import { supabaseRequest } from '../supabase';
import { evolutionEnabled } from './feature';
import { applyCommand, emptyState, registrationReplay, visibleState, type Actor, type CrmCommand, type CrmMember, type CrmState } from './model';
import { readLegacyBridge, mergeLegacyBridge, prepareLegacyCommand, planLegacyWrites, serializeLegacyWorkspace } from './legacy-bridge';

export class EvolutionServerError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type WorkspaceRow = { company_id: string; version: number | string; document: CrmState };
type ActiveBroker = { id: string; name: string; role: 'owner' | 'broker' };

function assertEnabled(actor: Actor) {
  if (!evolutionEnabled(actor.companyId)) throw new EvolutionServerError(404, 'Esta experiência ainda não está disponível para esta empresa.');
}

/** Read-only metadata store. Real contacts/assets remain in their original tables. */
async function readWorkspace(actor: Actor): Promise<CrmState> {
  assertEnabled(actor);
  const company = encodeURIComponent(actor.companyId);
  const [rows, brokers] = await Promise.all([
    supabaseRequest<WorkspaceRow[]>(`crm_evolution_workspaces?company_id=eq.${company}&select=company_id,version,document&limit=1`),
    supabaseRequest<ActiveBroker[]>(`broker_accounts?company_id=eq.${company}&active=eq.true&select=id,name,role&order=created_at.asc`, { allRows: true }),
  ]);
  const current = brokers.find(broker => broker.id === actor.brokerId);
  if (!current || current.role !== actor.role) throw new EvolutionServerError(403, 'Seu acesso mudou. Entre novamente para continuar.');
  const row = rows[0];
  const state = row?.document ?? emptyState(actor.companyId);
  if (state.companyId !== actor.companyId || !Number.isSafeInteger(state.version) || state.version < 0
    || (row && (row.company_id !== actor.companyId || Number(row.version) !== state.version))
    || !Array.isArray(state.records) || !Array.isArray(state.events) || !Array.isArray(state.members)
    || !state.settings || typeof state.settings !== 'object') {
    throw new EvolutionServerError(503, 'Não foi possível validar o espaço de trabalho. Nenhuma alteração foi realizada.');
  }
  // Account activity, name and role always come from the authoritative roster.
  // Persisted CRM preferences cannot create an account or elevate its role.
  const members: CrmMember[] = brokers.map(broker => {
    const saved = state.members.find(member => member.id === broker.id);
    return {
      id: broker.id, name: broker.name, role: broker.role,
      specialization: saved && ['Venda', 'Aluguel', 'Ambos'].includes(saved.specialization) ? saved.specialization : 'Ambos',
      ...(saved?.teamId ? { teamId: saved.teamId } : {}),
      ...(saved?.permissions ? { permissions: saved.permissions } : {}),
    };
  });
  return { ...state, members };
}

export const evolutionIntegrated = () => process.env.CRM_EVOLUTION_INTEGRATED === 'true';

export async function readEvolutionState(actor: Actor): Promise<CrmState> {
  const stored = await readWorkspace(actor);
  return evolutionIntegrated() ? mergeLegacyBridge(stored, await readLegacyBridge(actor, stored.members)) : stored;
}

export async function getEvolutionSnapshot(actor: Actor) {
  const state = await readEvolutionState(actor);
  return { state: visibleState(state, actor), actor, mode: 'live' as const };
}

export async function executeEvolutionCommand(actor: Actor, command: CrmCommand, expectedVersion: number, expectedSourceRevision?: string, onCommittedProperties?: (ids: string[]) => void) {
  assertEnabled(actor);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new EvolutionServerError(400, 'Versão inválida. Atualize a página antes de continuar.');
  }
  const stored = await readWorkspace(actor);
  const bridge = evolutionIntegrated() ? await readLegacyBridge(actor, stored.members) : undefined;
  const state = bridge ? mergeLegacyBridge(stored, bridge) : stored;
  // A response can be lost after SQL has committed. Replaying the exact human
  // registration acknowledges the existing event instead of creating another visit/proposal.
  if (registrationReplay(state, actor, command)) return { state: visibleState(state, actor), actor, mode: 'live' as const };
  if (state.version !== expectedVersion) throw new EvolutionServerError(409, 'Os dados foram atualizados por outra pessoa. Recarregue antes de salvar.');
  if (bridge && (!expectedSourceRevision || expectedSourceRevision !== bridge.sourceRevision)) {
    throw new EvolutionServerError(409, 'A base real foi atualizada. Recarregue e revise os dados antes de salvar.');
  }
  const applied = applyCommand(state, actor, bridge ? prepareLegacyCommand(state, bridge, command) : command);
  const plan = bridge ? planLegacyWrites(state, applied, bridge, actor) : undefined;
  if (plan && bridge && command.type === 'register') {
    const registeredCase = state.records.find(record => record.kind === 'cases' && record.id === command.caseId);
    const contact = registeredCase && state.records.find(record => record.kind === 'people' && record.id === registeredCase.data.personId);
    const source = registeredCase?.legacy?.table === 'leads' ? registeredCase.legacy : contact?.legacy?.table === 'leads' ? contact.legacy : undefined;
    const row = source && bridge.leads.find(lead => lead.id === source.id);
    if (!row) throw new EvolutionServerError(409, 'O vínculo com o cliente precisa ser revisado antes deste registro.');
    if (!plan.writes.some(write => write.table === 'leads' && write.id === row.id)) {
      // The existing RPC locks and checks the row AND current conversation ownership
      // before skipping an empty update. Even a timeline-only registration therefore
      // cannot bypass a portfolio reassignment that raced with the initial read.
      plan.writes.unshift({ table: 'leads', id: row.id, operation: 'update', expected: { ...row }, data: {} });
    }
  }
  const next = plan ? serializeLegacyWorkspace(plan.state, stored) : applied;
  if (next.companyId !== actor.companyId || next.version !== expectedVersion + 1) {
    throw new EvolutionServerError(503, 'Não foi possível validar esta alteração.');
  }
  if (Buffer.byteLength(JSON.stringify(next), 'utf8') > 1_500_000) {
    throw new EvolutionServerError(413, 'Este espaço atingiu o limite de armazenamento desta versão. Os dados existentes foram preservados. Entre em contato com o suporte.');
  }
  const accepted = await supabaseRequest<boolean>(bridge ? 'rpc/commit_crm_evolution_changes' : 'rpc/save_crm_evolution_workspace', {
    method: 'POST', body: {
      p_company_id: actor.companyId, p_actor_id: actor.brokerId,
      p_expected_version: expectedVersion, p_document: next,
      ...(plan ? { p_writes: plan.writes } : {}),
    },
  });
  if (accepted !== true) throw new EvolutionServerError(409, 'Outra alteração foi salva ao mesmo tempo. Recarregue antes de tentar novamente.');
  const properties = plan?.writes.filter(write => write.table === 'properties').map(write => write.id) || [];
  if (properties.length && onCommittedProperties) {
    try { onCommittedProperties(properties); } catch { console.error('crm_evolution_matching_schedule_failed'); }
  }
  if (!bridge) return { state: visibleState(next, actor), actor, mode: 'live' as const };
  try { return await getEvolutionSnapshot(actor); }
  catch { throw new EvolutionServerError(503, 'A alteração foi salva, mas não foi possível atualizar a tela. Recarregue antes de fazer outra alteração.'); }
}
