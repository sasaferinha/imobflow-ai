import { supabaseServiceRequest } from './supabase';
import { isSimpleGreeting, qualificationQuestion, qualificationSummary, QUALIFICATION_COMPLETE_MESSAGE, FINANCING_SIMULATOR_URL, extractedPreferences, toAIProfile, type InterestProfile } from './ai/qualification';
import { configuredAIProvider } from './ai/openai-provider';
import { changedPreferences, needsBrokerAnswer } from './ai/conversation-understanding';
import type { LLMConversationMessage } from './ai/provider';
import { basicPreferences, requestsHuman } from './ai/basic-qualification';
import { clarificationReply } from './ai/natural-qualification';
import { businessTime } from './business-hours';
import { readBusinessHours } from './conversation-settings';
import {sendQueuedMessage} from './message-outbox';
import { setTimeout as delay } from 'node:timers/promises';
import { ATTENDANCE_DEBOUNCE_MS, claimAttendanceTurn, enqueueAttendanceTurn, releaseAttendanceTurn, reconcileAttendanceHandoffs } from './attendance-turns';

const FALLBACK_MESSAGE = 'Recebemos sua mensagem. Um corretor dará continuidade ao seu atendimento.';
const AFTER_HOURS_COMPLETE_MESSAGE = 'Muito obrigado pelas informações! Seu cadastro foi concluído. No momento não há corretores disponíveis. Nossa equipe dará continuidade ao seu atendimento no próximo horário comercial.';
export const attendanceTime = businessTime;
export type AttendanceInput = {
  companyId: string; leadId: string; conversationId: string; incomingExternalMessageId: string;
  message: string; hasImage: boolean; hasAudio?: boolean; recipientPhone: string; phoneNumberId: string;
  accessToken: string | null; apiVersion: string; occurredAt: string;
};
type LeadRow = { interest_profile: InterestProfile; goal: string; property_type: string; region: string; budget_max: number; updated_at: string };
type AttendanceDraft = { profile: InterestProfile; skipAI?: boolean; summaryUnseen?: boolean };
function currentPreferences(row: LeadRow): InterestProfile {
  const known = (value: string) => Boolean(value && !['não informado','nao informado','null','undefined','-'].includes(value.trim().toLowerCase()));
  return { ...row.interest_profile,
    ...(['Comprar','Alugar'].includes(row.goal) ? { purpose: row.goal === 'Comprar' ? 'Venda' as const : 'Aluguel' as const } : {}),
    ...(known(row.property_type) ? { propertyType: row.property_type } : {}),
    ...(known(row.region) ? { regions: row.region.split(/[,;/]/).map(s => s.trim()).filter(Boolean) } : {}),
    ...(row.budget_max > 0 ? { budgetMax: Number(row.budget_max) } : {}) };
}

function profileAcknowledgement(patch: InterestProfile) {
  const details: string[]=[];
  if(patch.purpose)details.push(patch.purpose === 'Venda' ? 'compra' : 'aluguel');
  if(patch.propertyType)details.push(patch.propertyType.toLocaleLowerCase('pt-BR'));
  if(patch.city)details.push(`em ${patch.city}`);
  if(patch.regions?.length)details.push(patch.regions[0] === 'Qualquer região' ? 'sem preferência de bairro' : `na região de ${patch.regions.join(', ')}`);
  if(patch.budgetMax)details.push(`até ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}).format(patch.budgetMax)}`);
  if(patch.bedrooms != null)details.push(patch.bedrooms === 0 ? 'sem preferência de quartos' : `${patch.bedrooms} ${patch.bedrooms === 1 ? 'quarto' : 'quartos'}`);
  if(patch.parkingSpaces != null)details.push(patch.parkingSpaces === 0 ? 'sem necessidade de garagem' : `${patch.parkingSpaces} ${patch.parkingSpaces === 1 ? 'vaga' : 'vagas'}`);
  if(patch.features?.length)details.push(patch.features.join(', ').toLocaleLowerCase('pt-BR'));
  return details.length ? `Perfeito, anotei: ${details.join(', ')}.` : 'Entendi.';
}

function informationalReply(message: string, current: InterestProfile) {
  const text=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const next=qualificationQuestion(current);
  if(/\b(como funciona|como voces trabalham|o que voces fazem)\b/.test(text))return `Vou entender o imóvel que você procura e encaminhar seu perfil para um corretor com as informações organizadas.\n\n${next}`;
  if(/\b(tem|possuem|ha)\s+(?:algum|imovel|casa|apartamento)|\btem imoveis\b/.test(text))return `Posso ajudar a encontrar opções compatíveis. Primeiro preciso entender melhor o que você procura.\n\n${next}`;
  if(/\b(?:financiamento|financiar)\b/.test(text) && /\b(como|posso|consegue|faz|aceita)\b/.test(text))return `É possível simular o financiamento, mas a aprovação e as condições dependem do banco.\n\n${next}`;
  return null;
}

async function financingSimulatorUrl(companyId: string) {
  try {
    const [company] = await supabaseServiceRequest<Array<{ id: string; slug: unknown }>>(
      `companies?id=eq.${encodeURIComponent(companyId)}&select=id,slug&limit=1`, { timeoutMs: 4000 },
    );
    if (company?.id === companyId && typeof company.slug === 'string'
      && company.slug !== companyId && /^[a-z0-9][a-z0-9-]{0,159}$/.test(company.slug)) {
      const url = new URL(FINANCING_SIMULATOR_URL);
      url.searchParams.set('empresa', company.slug);
      return url.toString();
    }
  } catch {
    // The calculator remains usable if the optional company lookup fails.
  }
  return FINANCING_SIMULATOR_URL;
}

async function recentConversation(input: AttendanceInput): Promise<LLMConversationMessage[]> {
  try {
    if (!input.conversationId) return [];
    const before = Number.isFinite(Date.parse(input.occurredAt)) ? `&created_at=lte.${encodeURIComponent(input.occurredAt)}` : '';
    const rows = await supabaseServiceRequest<Array<{ direction: string; content: string; external_message_id: string | null }>>(
      `messages?company_id=eq.${encodeURIComponent(input.companyId)}&conversation_id=eq.${encodeURIComponent(input.conversationId)}&select=direction,content,external_message_id&order=created_at.desc&limit=6${before}`, { timeoutMs: 4000 });
    if (!Array.isArray(rows)) return [];
    return rows.filter(row => row.external_message_id !== input.incomingExternalMessageId && typeof row.content === 'string')
      .reverse().map(row => ({ role: row.direction === 'incoming' ? 'user' as const : 'assistant' as const, content: row.content.slice(0, 800) }));
  } catch { return []; }
}

export async function buildAttendanceReply(input: AttendanceInput, onHandoff?: () => void, draft?: AttendanceDraft): Promise<string> {
  if (input.hasAudio) return 'Recebemos seu áudio. Para continuar o atendimento automático, envie também sua solicitação por texto.';
  const lead = draft ? undefined : (await supabaseServiceRequest<LeadRow[]>(`leads?company_id=eq.${input.companyId}&id=eq.${input.leadId}&select=interest_profile,goal,property_type,region,budget_max,updated_at&limit=1`))[0];
  if (!lead && !draft) return FALLBACK_MESSAGE;
  const current = draft ? draft.profile : currentPreferences(lead!);
  if (isSimpleGreeting(input.message) && !basicPreferences(input.message, current).summaryConfirmed) {
    const question = qualificationQuestion(current);
    if (question === QUALIFICATION_COMPLETE_MESSAGE) {
      onHandoff?.();
      return 'Seu cadastro já está registrado. Vou direcionar sua conversa para um corretor continuar o atendimento.';
    }
    if (question === qualificationSummary(current)) return 'Olá! Já tenho suas preferências registradas.\n\nVocê quer manter essa busca ou mudar alguma informação?';
    return !current.purpose ? `Olá! Sou o assistente da imobiliária. Vou te ajudar a encontrar um imóvel.\n\n${question}` : question;
  }
  if (input.hasImage && (!input.message.trim() || input.message === '[Foto]')) return 'Recebemos sua foto. Pode descrever o que você gostaria de encontrar nesse imóvel?';
  try {
    if (requestsHuman(input.message)) {
      return FALLBACK_MESSAGE;
    }
    let patch = basicPreferences(input.message, current);
    let confirmed = patch.summaryConfirmed === true;
    let rejected = patch.correctionRequested === true;
    let needsHuman = needsBrokerAnswer(input.message);
    if (needsHuman) patch = confirmed ? { summaryConfirmed: true, correctionRequested: false } : {};
    const simpleControl = /^(sim|nao|não|ok|isso|correto|certo|está certo|esta certo)[.!\s]*$/i.test(input.message.trim());
    // Recent context is scoped to this company and conversation, never other leads.
    if (!needsHuman && !simpleControl && !rejected && !draft?.skipAI && input.message.length <= 4000) {
      try {
        const provider = configuredAIProvider();
        if (provider) {
          const history = await recentConversation(input);
          const { data } = await provider.extractLeadProfile({ message: input.message,
            currentProfile: toAIProfile(current), recentMessages: [...history.slice(-5), { role: 'assistant', content: qualificationQuestion(current) }] });
          // Explicit deterministic corrections win over stale fields echoed by a model.
          patch = { ...extractedPreferences(data), ...patch };
          if (Number.isFinite(data.confidence) && data.confidence >= .85) {
            needsHuman ||= data.requestsHumanHandoff;
            if (qualificationQuestion(current) === qualificationSummary(current)) {
              confirmed ||= data.summaryDecision === 'confirmed';
              rejected ||= data.summaryDecision === 'correction';
            }
          }
          console.info('whatsapp_ai_extraction_ok');
        }
      } catch { console.warn('whatsapp_ai_fallback'); }
    }
    // Echoed fields from the model are not a profile update or a reason to repeat the summary.
    delete patch.summaryConfirmed;
    delete patch.correctionRequested;
    patch = changedPreferences(patch, current);
    // A short confirmation cannot approve a summary composed only in memory:
    // it has not been shown to the customer yet.
    if (draft?.summaryUnseen) confirmed = false;
    // A concrete correction takes priority over a classifier's generic rejection.
    const preferenceChanged = Object.keys(patch).some(key => key !== 'correctionField');
    if (rejected && !preferenceChanged) patch.correctionRequested = true;
    else if (rejected && preferenceChanged) { patch.summaryConfirmed = false; patch.correctionRequested = false; }
    else if (confirmed && !preferenceChanged) {
      patch.summaryConfirmed = true;
      patch.correctionRequested = false;
    } else if (preferenceChanged && (current.summaryConfirmed || current.correctionRequested)) {
      patch.summaryConfirmed = false;
      patch.correctionRequested = false;
    }
    if (!needsHuman && !Object.keys(patch).length) {
      const information=informationalReply(input.message,current);
      if(information)return information;
      if (/^(?:oi|olá|ola|bom dia|boa tarde|boa noite)\b/i.test(input.message.trim())
        && qualificationQuestion(current) === qualificationSummary(current)) {
        return 'Olá! Já tenho suas preferências registradas.\n\nVocê quer manter essa busca ou mudar alguma informação?';
      }
      needsHuman = current.summaryConfirmed === true || /\?|\b(onde|como|qual|quanto|quando|por que|porque|me diga|me explica)\b/i.test(input.message);
    }
    if (Object.keys(patch).length) {
      if (draft) draft.profile = { ...current, ...patch };
      else {
        const saved = await supabaseServiceRequest<boolean>('rpc/merge_attendance_profile', { method: 'POST', body: {
          p_company_id: input.companyId, p_lead_id: input.leadId, p_version: lead!.updated_at, p_profile: patch,
        } });
        if (!saved) throw new Error('attendance_profile_conflict');
      }
    }
    if (needsHuman) {
      onHandoff?.();
      return `${confirmed ? 'Cadastro confirmado. ' : ''}Para te passar essa informação com segurança, vou direcionar sua conversa para um corretor continuar o atendimento.`;
    }
    const next = qualificationQuestion({ ...current, ...patch });
    if(patch.financingIntent === 'Sim' && current.financingIntent !== 'Sim') {
      const simulatorUrl = await financingSimulatorUrl(input.companyId);
      return `Ótimo! Você pode fazer sua simulação de financiamento aqui:\n${simulatorUrl}\n\nO resultado é uma estimativa e não representa aprovação ou condições definitivas do banco.\n\n${next}`;
    }
    if(next === QUALIFICATION_COMPLETE_MESSAGE) return next;
    if (next === qualificationSummary({ ...current, ...patch })) return next;
    if(Object.keys(patch).length) return `${profileAcknowledgement(patch)}\n\n${next}`;
    return clarificationReply(current);
  } catch (error) { console.error('attendance_profile_unavailable'); throw error; }
}

/** Only called with an inbound event verified and saved by the Meta webhook.
 * Opportunities never call this function. All failures remain outside webhook ACK. */
export async function respondToIncomingMessage(input: AttendanceInput, outerDeadline?: number) {
  const elapsed = Date.now() - Date.parse(input.occurredAt);
  if (!/^\d{5,30}$/.test(input.recipientPhone) || !/^\d{5,30}$/.test(input.phoneNumberId)
    || !/^v\d{1,3}\.\d{1,2}$/.test(input.apiVersion) || !Number.isFinite(elapsed) || elapsed < -300_000 || elapsed >= 86400000) return;
  // Persisted jobs survive the webhook process. Never hold an HTTP response for this pause.
  const deadline = Math.min(Date.now() + 48000, outerDeadline ?? Infinity);
  await delay(ATTENDANCE_DEBOUNCE_MS);
  for (let attempt = 0; attempt < 3 && Date.now() < deadline - 28000; attempt++) {
    const turn = await claimAttendanceTurn(input).catch(() => {
      console.error('attendance_turn_claim_deferred');
      return null;
    });
    if (!turn) return;
    if (turn.status === 'ignored') return;
    if (turn.status === 'deferred') {
      await delay(Math.min(Math.max(turn.retryAfterMs || ATTENDANCE_DEBOUNCE_MS, 250), 4000));
      continue;
    }
    try {
      const settings = await readBusinessHours(input.companyId);
      const now = attendanceTime(new Date(), settings);
      const [lead] = await supabaseServiceRequest<LeadRow[]>(`leads?company_id=eq.${input.companyId}&id=eq.${input.leadId}&select=interest_profile,goal,property_type,region,budget_max,updated_at&limit=1`, { timeoutMs: 4000 });
      if (!lead) throw new Error('attendance_lead_missing');
      const original = currentPreferences(lead);
      const draft: AttendanceDraft = { profile: { ...original } };
      const normalizeReply = (text: string) => text.replace(/\s+/g, ' ').trim();
      const summaryVisible = turn.lastReply === undefined || (typeof turn.lastReply === 'string'
        && (normalizeReply(turn.lastReply).endsWith(normalizeReply(qualificationSummary(original)))
          || turn.lastReply.includes('Você quer manter essa busca ou mudar alguma informação?')));
      let humanRequested = Boolean(turn.overflow);
      let content = humanRequested ? 'Recebi suas mensagens. Vou chamar um corretor para analisar tudo com você.' : '';
      let simulator: string | undefined;
      for (const [index, message] of turn.messages.entries()) {
        if (humanRequested) break;
        if (requestsHuman(message.message)) { humanRequested = true; content = FALLBACK_MESSAGE; break; }
        // Interpret short consecutive answers in order, then send only the final reply.
        // Only the last item may call the model; earlier items use the local parser.
        draft.skipAI = index < turn.messages.length - 1;
        draft.summaryUnseen = !summaryVisible || Object.keys(changedPreferences(draft.profile, original)).length > 0;
        content = await buildAttendanceReply({ ...input, ...message, incomingExternalMessageId: message.externalMessageId }, () => { humanRequested = true; }, draft);
        simulator ||= content.match(/https:\/\/www\.imobflow\.net\.br\/simulador-financiamento[^\s]*/)?.[0];
      }
      if (!content.trim()) throw new Error('attendance_empty_reply');
      if (simulator && !content.includes(simulator) && !humanRequested && draft.profile.financingIntent === 'Sim') {
        content = `Você pode simular o financiamento aqui:\n${simulator}\n\nO resultado é uma estimativa, não uma aprovação de crédito.\n\n${content}`;
      }
      if (now.afterHours && content.includes(QUALIFICATION_COMPLETE_MESSAGE)) {
        // Keep any preceding simulator link, but do not promise an immediate handoff.
        // Qualification remains available 24h; only the completed profile gets this notice.
        content = content.replace(QUALIFICATION_COMPLETE_MESSAGE, AFTER_HOURS_COMPLETE_MESSAGE);
      } else if(now.afterHours && humanRequested) {
        content += '\n\nNo momento não há corretores disponíveis. Sua solicitação já ficou registrada e a equipe continuará o atendimento no próximo horário comercial.';
      }
      const result = await enqueueAttendanceTurn(input, turn, content, { handoff: humanRequested,
        profilePatch: changedPreferences(draft.profile, original), profileVersion: lead.updated_at });
      if (result.status === 'queued') {
        await sendQueuedMessage(input.companyId, result.messageId, deadline);
        if (humanRequested) await reconcileAttendanceHandoffs(input);
        return;
      }
      if (result.status !== 'superseded') return;
      // A new input arrived while composing. Leave all inputs unconsumed and coalesce again.
    } catch {
      console.error('attendance_turn_deferred');
      return; // Durable recovery retries later; no generic error message is sent to the client.
    } finally {
      await releaseAttendanceTurn(input, turn).catch(() => { console.error('attendance_turn_release_failed'); });
    }
    await delay(ATTENDANCE_DEBOUNCE_MS);
  }
}
