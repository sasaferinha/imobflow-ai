import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { hasSameOrigin, hasSafeRequestSize, consumeRateLimit } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';
import { canAccess, CrmError } from '@/lib/evolution/model';
import { getEvolutionSnapshot, EvolutionServerError } from '@/lib/evolution/server';
import { BrokerAssistantError, generateBrokerAssistance, type AssistantMessage, type AssistantSector } from '@/lib/ai/broker-assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = protectedRoute(async (request: NextRequest) => {
  if (!request.headers.get('origin') || !hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  if (!hasSafeRequestSize(request, 2048)) return NextResponse.json({ error: 'Requisição muito grande.' }, { status: 413 });
  let leadId: string, sector: AssistantSector;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 2048) return NextResponse.json({ error: 'Requisição muito grande.' }, { status: 413 });
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('body');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !['leadId', 'sector'].includes(key)) || typeof input.leadId !== 'string' || !uuid.test(input.leadId)
      || !['automatic', 'Venda', 'Aluguel', 'Geral'].includes(String(input.sector))) throw new Error('body');
    leadId = input.leadId; sector = input.sector as AssistantSector;
  } catch { return NextResponse.json({ error: 'Dados de análise inválidos.' }, { status: 400 }); }
  try {
    const actor = currentAccount()!;
    const snapshot = await getEvolutionSnapshot(actor);
    const lead = snapshot.state.records.find(record => record.kind === 'leads' && record.id === `lead:${leadId}`);
    if (!lead || lead.legacy?.id !== leadId || lead.legacy.table !== 'leads' || !canAccess(snapshot.state, actor, lead, 'write')) {
      return NextResponse.json({ error: 'Este cliente não está disponível para análise na sua carteira.' }, { status: 403 });
    }
    // Existing rate-limit storage caps bucket names at 80 characters.
    const bucket = `assist:${actor.companyId.replaceAll('-', '')}:${actor.brokerId.replaceAll('-', '')}`;
    if (!await consumeRateLimit(request, bucket, 6, 60) || !await consumeRateLimit(request, `${bucket}:hour`, 60, 3600)) {
      return NextResponse.json({ error: 'Limite de análises atingido. Aguarde antes de solicitar novamente.' }, { status: 429 });
    }
    const company = encodeURIComponent(actor.companyId);
    const conversations = await supabaseRequest<Array<{ id: string; company_id: string; lead_id: string }>>(`conversations?company_id=eq.${company}&lead_id=eq.${leadId}&select=id,company_id,lead_id&limit=101`);
    if (!Array.isArray(conversations) || conversations.length > 100 || conversations.some(row => !uuid.test(row.id) || row.company_id !== actor.companyId || row.lead_id !== leadId)) throw new Error('scope');
    if (!conversations.length) return NextResponse.json({ error: 'Este cliente ainda não possui conversa para analisar.' }, { status: 409 });
    const conversationIds = new Set(conversations.map(row => row.id));
    const rows = await supabaseRequest<Array<{ id: string; company_id: string; conversation_id: string; direction: string; content: string }>>(`messages?company_id=eq.${company}&conversation_id=in.(${[...conversationIds].join(',')})&select=id,company_id,conversation_id,direction,content&order=created_at.desc,id.desc&limit=40`);
    if (!Array.isArray(rows) || rows.length > 40 || rows.some(row => !uuid.test(row.id) || row.company_id !== actor.companyId || !conversationIds.has(row.conversation_id))) throw new Error('scope');
    const messages: AssistantMessage[] = rows.slice().reverse().filter(row => typeof row.content === 'string' && row.content.trim()).map(row => ({ id: row.id, side: row.direction === 'incoming' || row.direction === 'Entrada' ? 'incoming' : 'outgoing', text: row.content.slice(0, 2000) }));
    const assistance = await generateBrokerAssistance({ sector, profile: lead.data, messages });
    // Recheck access after the external request; never return stale review data after reassignment.
    const fresh = await getEvolutionSnapshot(actor);
    const current = fresh.state.records.find(record => record.id === lead.id && record.kind === 'leads');
    if (!current || !canAccess(fresh.state, actor, current, 'write')) return NextResponse.json({ error: 'Seu acesso a este cliente mudou. Atualize a conversa.' }, { status: 403 });
    if (fresh.state.version !== snapshot.state.version || fresh.state.sourceRevision !== snapshot.state.sourceRevision) return NextResponse.json({ error: 'A ficha foi atualizada durante a análise. Analise novamente para revisar os dados atuais.' }, { status: 409 });
    return NextResponse.json({ assistance, review: { record: current, expectedVersion: fresh.state.version, expectedSourceRevision: fresh.state.sourceRevision }, messageCount: messages.length });
  } catch (error) {
    if (error instanceof BrokerAssistantError || error instanceof EvolutionServerError || error instanceof CrmError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('broker_assistant_failed');
    return NextResponse.json({ error: 'Não foi possível analisar a conversa com segurança. Nada foi enviado ou alterado.' }, { status: 503 });
  }
});
