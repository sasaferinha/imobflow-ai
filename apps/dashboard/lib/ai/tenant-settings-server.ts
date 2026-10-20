import { supabaseServiceRequest } from '../supabase';
import { getTenantAISettings, type TenantAISettings } from './tenant-settings';

export class TenantAISettingsReadError extends Error {
  constructor() { super('Não foi possível consultar a configuração da IA. Tente novamente em instantes.'); this.name = 'TenantAISettingsReadError'; }
}
export type TenantAISettingsSnapshot = {
  settings: TenantAISettings; configuration: 'default' | 'saved'; updatedAt: string | null; updatedBy: string | null;
};
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Only callers with a verified session/webhook tenant may supply companyId. Never infer a legacy/default tenant. */
export async function readTenantAISettingsSnapshot(companyId: string): Promise<TenantAISettingsSnapshot> {
  if (typeof companyId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) throw new TenantAISettingsReadError();
  try {
    const rows = await supabaseServiceRequest<unknown>(
      `crm_evolution_workspaces?company_id=eq.${encodeURIComponent(companyId)}&select=company_id,document_company_id:document->>companyId,settings:document->settings&limit=1`, { timeoutMs: 4000 },
    );
    if (!Array.isArray(rows) || rows.length > 1) throw new TenantAISettingsReadError();
    if (!rows.length) return { settings: getTenantAISettings(), configuration: 'default', updatedAt: null, updatedBy: null };
    const row: unknown = rows[0];
    if (!isObject(row) || row.company_id !== companyId || row.document_company_id !== companyId
      || !isObject(row.settings)) throw new TenantAISettingsReadError();
    const raw = row.settings.ai;
    const settings = getTenantAISettings(raw);
    return { settings, configuration: raw === undefined ? 'default' : 'saved',
      updatedAt: isObject(raw) && typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      updatedBy: isObject(raw) && typeof raw.updatedBy === 'string' ? raw.updatedBy : null };
  } catch { throw new TenantAISettingsReadError(); }
}

export async function readTenantAISettings(companyId: string): Promise<TenantAISettings> {
  return (await readTenantAISettingsSnapshot(companyId)).settings;
}
