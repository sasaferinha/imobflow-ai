import { requireCompanyId } from './tenant-context';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  prefer?: string;
  allRows?: boolean;
};

export function supabaseCompanyId() {
  return requireCompanyId();
}

export function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export async function supabaseRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return supabaseServiceRequest<T>(path, options);
}

/**
 * Server-only REST client. Unlike supabaseRequest, this does not derive a
 * company from the current browser session. It is reserved for verified
 * provider webhooks, which establish the company from their own connection.
 */
export async function supabaseServiceRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (options.allRows) {
    if (options.method && options.method !== 'GET') throw new Error('Paginação disponível somente para leitura.');
    const [table, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    const maximum = Math.min(Number(params.get('limit') || 10000), 10001);
    const order = params.get('order');
    params.set('order', order ? `${order},id.asc` : 'id.asc');
    const rows: unknown[] = [];
    while (true) {
      params.set('offset', String(rows.length));
      params.set('limit', String(Math.min(500, maximum + 1 - rows.length)));
      const page = await supabaseServiceRequest<unknown[]>(`${table}?${params}`, { ...options, allRows: false });
      if (!Array.isArray(page)) throw new Error('Resposta inválida do banco.');
      if (!page.length) return rows as T;
      rows.push(...page);
      if (rows.length > maximum) throw new Error('Base acima do limite de leitura. Refine a consulta antes de continuar.');
    }
  }
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
  const payload = await response.text();
  return (payload ? JSON.parse(payload) : undefined) as T;
}
