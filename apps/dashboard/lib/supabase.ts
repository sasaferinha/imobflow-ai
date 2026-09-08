const COMPANY_ID = process.env.SUPABASE_COMPANY_ID || '00000000-0000-4000-8000-000000000001';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  prefer?: string;
};

export function supabaseCompanyId() {
  return COMPANY_ID;
}

export function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export async function supabaseRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !secretKey) throw new Error('Supabase não configurado');

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Supabase ${response.status}: ${details}`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
