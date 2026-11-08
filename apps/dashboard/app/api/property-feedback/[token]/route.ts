import { NextRequest, NextResponse } from 'next/server';
import { consumeRateLimit, hasSafeRequestSize, hasSameOrigin } from '@/lib/request-security';
import { feedbackTokenHash, getPublicFeedback, validFeedbackToken, validateFeedbackAnswer } from '@/lib/evolution/property-feedback';
import { supabaseServiceRequest } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ token: string }> };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } });
export async function GET(request: NextRequest, context: Context) {
  try {
    if (!await consumeRateLimit(request, 'property-feedback-read', 60, 900)) return reply({ error: 'Aguarde alguns minutos e tente novamente.' }, 429);
    const { token } = await context.params;
    const result = await getPublicFeedback(token);
    return result ? reply(result) : reply({ error: 'Este link não está disponível ou expirou.' }, 404);
  } catch { return reply({ error: 'Avaliação temporariamente indisponível. Tente novamente mais tarde.' }, 503); }
}
export async function POST(request: NextRequest, context: Context) {
  if (!request.headers.get('origin') || !hasSameOrigin(request)) return reply({ error: 'Origem não permitida.' }, 403);
  if (!hasSafeRequestSize(request, 12000)) return reply({ error: 'Resposta muito grande.' }, 413);
  try {
    if (!await consumeRateLimit(request, 'property-feedback-submit', 10, 900)) return reply({ error: 'Aguarde alguns minutos e tente novamente.' }, 429);
    const { token } = await context.params;
    if (!validFeedbackToken(token)) return reply({ error: 'Este link não está disponível ou expirou.' }, 404);
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > 12000) return reply({ error: 'Resposta muito grande.' }, 413);
    let answer;
    try { answer = validateFeedbackAnswer(JSON.parse(text)); } catch { answer = null; }
    if (!answer) return reply({ error: 'Escolha de 1 a 5 estrelas para o imóvel. A observação é opcional e deve ter até 2.000 caracteres.' }, 400);
    const saved = await supabaseServiceRequest<boolean>('rpc/submit_property_feedback', { method: 'POST', body: { p_token_hash: feedbackTokenHash(token), p_visit_score: answer.visitScore, p_property_score: answer.propertyScore, p_interest: answer.interest, p_comment: answer.comment } });
    return saved ? reply({ saved: true }) : reply({ error: 'Esta avaliação já foi respondida ou o link expirou.' }, 409);
  } catch { return reply({ error: 'Não foi possível salvar. Tente novamente mais tarde.' }, 503); }
}
