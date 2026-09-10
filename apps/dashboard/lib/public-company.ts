import { supabaseRequest } from './supabase';

export async function publicCompany(slug: unknown) {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,159}$/.test(slug)) return null;
  const [company] = await supabaseRequest<Array<{id:string;name:string;slug:string}>>(`companies?slug=eq.${encodeURIComponent(slug)}&select=id,name,slug&limit=1`);
  if (!company) return null;
  const [account] = await supabaseRequest<Array<{company_id:string}>>(`account_companies?company_id=eq.${company.id}&select=company_id&limit=1`);
  return account ? company : null;
}
