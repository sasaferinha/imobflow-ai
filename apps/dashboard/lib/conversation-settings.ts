import { supabaseServiceRequest } from "./supabase";
import { defaultBusinessHours, validateBusinessHours } from "./business-hours";
export async function readBusinessHours(companyId: string) {
  const rows = await supabaseServiceRequest<Array<{ business_hours: unknown }>>(
    `conversation_settings?company_id=eq.${companyId}&select=business_hours&limit=1`,
    { timeoutMs: 4000 },
  );
  if (!rows[0]) return defaultBusinessHours;
  const settings = rows[0].business_hours;
  if (settings !== null && typeof settings === 'object' && !Array.isArray(settings)
    && Object.keys(settings).length === 0) return defaultBusinessHours;
  return validateBusinessHours(settings);
}
