import { supabaseServiceRequest } from "./supabase";
import { defaultBusinessHours, validateBusinessHours } from "./business-hours";
export async function readBusinessHours(companyId: string) {
  const rows = await supabaseServiceRequest<Array<{ business_hours: unknown }>>(
    `conversation_settings?company_id=eq.${companyId}&select=business_hours&limit=1`,
  );
  if (!rows[0] || !Object.keys(rows[0].business_hours as object).length)
    return defaultBusinessHours;
  return validateBusinessHours(rows[0].business_hours);
}
