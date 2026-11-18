import { currentAccount } from './tenant-context';
import { supabaseRequest } from './supabase';

type ClassicTable = 'leads' | 'properties' | 'appointments';
type ClassicAction = 'insert' | 'update' | 'delete' | 'check';
type ClassicRow = Record<string, unknown> & { id: string; company_id: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ClassicCrmError extends Error {
  constructor(message: string, public status = 403) { super(message); }
}
function actor() {
  const account = currentAccount();
  if (!account || !uuid.test(account.companyId) || !uuid.test(account.brokerId)) throw new ClassicCrmError('Entre na sua conta para continuar.', 401);
  return account;
}
function failure(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('classic_crm_forbidden')) throw new ClassicCrmError('Este registro não está disponível para alteração na sua carteira.');
  if (message.includes('classic_crm_conflict')) throw new ClassicCrmError('O registro foi alterado. Atualize a página e confira os dados antes de tentar novamente.', 409);
  if (message.includes('classic_crm_invalid')) throw new ClassicCrmError('Confira os dados e o responsável selecionado.', 400);
  throw error;
}
function checkedRow(value: unknown, companyId: string): ClassicRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ClassicCrmError('Não foi possível conferir este registro.', 503);
  const row = value as ClassicRow;
  if (row.company_id !== companyId || typeof row.id !== 'string' || !uuid.test(row.id)) throw new ClassicCrmError('Não foi possível conferir este registro.', 503);
  return row;
}

/** Canonical portfolio rules are checked in SQL, including active identity and
 * ambiguous ownership. Never return an entire company for a broker session. */
export async function readClassicRows(table: ClassicTable, limit = 10000): Promise<ClassicRow[]> {
  const account = actor(), maximum = Math.max(1, Math.min(Math.floor(limit), 10000));
  let values: unknown;
  try { values = await supabaseRequest<unknown>('rpc/read_classic_crm_records', { method: 'POST', body: { p_company_id: account.companyId, p_actor_id: account.brokerId, p_table: table, p_limit: maximum + 1 } }); }
  catch (error) { return failure(error); }
  if (!Array.isArray(values) || values.length > maximum) throw new ClassicCrmError('A base ultrapassa o limite de leitura. Peça ao administrador para revisar o volume.', 503);
  const rows = values.map(value => checkedRow(value, account.companyId));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new ClassicCrmError('Não foi possível conferir os registros.', 503);
  return rows;
}

/** The same transaction locks the row and its current portfolio before writes.
 * A previous UI read or ownership preflight is never the authorization boundary. */
export async function writeClassicRow(table: ClassicTable, id: string | null, action: ClassicAction, data: Record<string, unknown> = {}): Promise<ClassicRow | null> {
  const account = actor();
  if (id !== null && !uuid.test(id) || action !== 'insert' && !id) throw new ClassicCrmError('Registro inválido.', 400);
  let value: unknown;
  try { value = await supabaseRequest<unknown>('rpc/write_classic_crm_record', { method: 'POST', body: { p_company_id: account.companyId, p_actor_id: account.brokerId, p_table: table, p_id: id, p_action: action, p_data: data } }); }
  catch (error) { return failure(error); }
  return value === null ? null : checkedRow(value, account.companyId);
}

export async function assertClassicPropertyWrite(id: string) {
  if (!await writeClassicRow('properties', id, 'check')) throw new ClassicCrmError('Imóvel não encontrado.', 404);
}
