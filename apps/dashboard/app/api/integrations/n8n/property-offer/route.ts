import { NextRequest, NextResponse } from 'next/server';
import { parsePropertyPreferencesEvent, propertyAutomationConnection } from '@/lib/n8n-property-auth';
import { dispatchImmediateProperty } from '@/lib/n8n-property-dispatch';
import { consumeRateLimit } from '@/lib/request-security';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store, max-age=0' },
});

export async function POST(request: NextRequest) {
  const connection = propertyAutomationConnection(request.headers.get('authorization'));
  // Fail closed without relying on browser sessions or a caller-provided company.
  if (!connection) return json({ error: 'Integração indisponível ou credencial inválida.' }, 401);
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Evento ausente.' }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 2048) { await reader.cancel(); return json({ error: 'Evento muito grande.' }, 413); }
      chunks.push(part.value);
    }
    const source = Buffer.concat(chunks).toString('utf8');
    let input: unknown;
    try { input = JSON.parse(source); } catch { return json({ error: 'JSON inválido.' }, 400); }
    const event = parsePropertyPreferencesEvent(input);
    if (!event) return json({ error: 'Evento de preferências inválido.' }, 400);
    if (!await consumeRateLimit(request, `n8n-property:${connection.companyId}`, 120, 60)) return json({ error: 'Limite de eventos atingido.' }, 429);
    const result = await dispatchImmediateProperty(connection, event);
    return json(result, result.status === 'uncertain' ? 409 : 200);
  } catch {
    // Before reservation errors are retryable; after it, dispatch never sends twice.
    console.error('n8n_property_offer_failed');
    return json({ error: 'Não foi possível processar o evento.' }, 503);
  }
}
