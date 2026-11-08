import { createHmac } from 'node:crypto';
import { supabaseServiceRequest as db } from './supabase';
import { currentAccount } from './tenant-context';
import { socialLeadId, type SocialEvent } from './meta-social';
import { decryptSocialToken, encryptSocialToken, type SocialAccountRow } from './social-connections';
import { publicSocialMessage, publicSocialProfile, SocialError, socialImageUrl, socialObject, socialUuid, type SocialChannel, type SocialContact, type SocialMessage, type SocialMode } from './social-model';

export type SocialIncomingResult = { saved: boolean; companyId?: string; threadId: string; leadId: string; messageId?: string; mode?: SocialMode };
type ThreadRow = { id: string; company_id: string; lead_id: string; account_id: string; mode: SocialMode; assigned_broker_id: string | null; assigned_to: string | null; last_inbound_at: string | null; last_inbound_message_id: string | null };
const actor = () => { const a = currentAccount(); if (!a) throw new SocialError('Entre na conta para acessar as mensagens.', 401); return a; };

export async function receiveSocialMessage(event: SocialEvent): Promise<SocialIncomingResult> {
  const c = event.connection;
  let accountId = c.databaseId;
  if (!accountId) {
    accountId = await db<string>('rpc/bind_social_account', { method: 'POST', body: { p_company_id: c.companyId, p_actor_id: null, p_channel: event.kind, p_account_id: event.kind === 'instagram' ? c.instagramId : c.pageId, p_page_id: c.pageId || c.instagramId, p_name: event.kind === 'instagram' ? 'Instagram conectado' : 'Página conectada', p_token: c.accessToken ? encryptSocialToken(c.accessToken, c.companyId) : null, p_api_version: c.apiVersion } });
  }
  return db<SocialIncomingResult>('rpc/receive_social_message', { method: 'POST', body: { p_account_id: accountId, p_lead_id: socialLeadId(event), p_recipient_id: event.senderId, p_external_id: event.externalId, p_content: event.text || '', p_media: event.mediaUrls || [], p_media_type: event.mediaType || null, p_occurred_at: event.occurredAt || null } });
}

function cursor(at: string, id: string) { return Buffer.from(JSON.stringify([at,id])).toString('base64url'); }
function parseCursor(value?: string | null): [string | null, string | null] {
  if (!value) return [null,null];
  try { if (value.length > 220 || !/^[\w-]+$/.test(value)) throw new Error(); const data: unknown = JSON.parse(Buffer.from(value,'base64url').toString('utf8')); if (!Array.isArray(data) || data.length !== 2 || typeof data[0] !== 'string' || !Number.isFinite(Date.parse(data[0])) || !socialUuid(data[1])) throw new Error(); return [data[0],data[1]]; }
  catch { throw new SocialError('Página de mensagens inválida.', 400); }
}
export async function readSocialInbox(input: { channel: SocialChannel; threadId?: string | null; before?: string | null; contactsBefore?: string | null }) {
  const a = actor();
  if (!['instagram','facebook'].includes(input.channel) || input.threadId && !socialUuid(input.threadId)) throw new SocialError('Canal ou conversa inválida.', 400);
  const [beforeAt,beforeId] = parseCursor(input.before), [contactsAt,contactsId] = parseCursor(input.contactsBefore);
  const rows = await db<Array<Record<string,unknown>>>('rpc/read_social_inbox', { method: 'POST', body: { p_company_id: a.companyId, p_actor_id: a.brokerId, p_channel: input.channel, p_thread_id: input.threadId || null, p_before_at: beforeAt, p_before_id: beforeId, p_contacts_before_at: contactsAt, p_contacts_before_id: contactsId } });
  const attentionRows = rows.length ? await db<Array<Record<string,unknown>>>('rpc/social_attention_state', { method: 'POST', body: { p_company_id: a.companyId, p_actor_id: a.brokerId, p_channel: input.channel, p_thread_ids: rows.slice(0,100).map(row => row.id) } }) : [];
  const attentionById = new Map(attentionRows.map(row => [row.threadId, row]));
  const contacts: SocialContact[] = rows.slice(0,100).map(r => {
    const messages = Array.isArray(r.messages) ? r.messages.map(publicSocialMessage) : [], visible = messages.slice(0,40), lastInboundAt = typeof r.lastInboundAt === 'string' ? r.lastInboundAt : null;
    const windowEndsAt = lastInboundAt ? new Date(Date.parse(lastInboundAt)+86400000).toISOString() : null, p = socialObject(r.leadProfile);
    const attention = attentionById.get(r.id);
    return { id: String(r.id), leadId: String(r.leadId), channel: input.channel, name: String(r.name), assignedTo: typeof r.assignedTo === 'string' ? r.assignedTo : null, assignedBrokerId: typeof r.assignedBrokerId === 'string' ? r.assignedBrokerId : null, lastMessageAt: typeof r.lastMessageAt === 'string' ? r.lastMessageAt : null, lastInboundAt, mode: r.mode as SocialMode, messages: visible.slice().reverse(), nextCursor: messages.length > 40 && visible.length ? cursor(visible.at(-1)!.at,visible.at(-1)!.id) : null, windowEndsAt, canSend: r.enabled === true && Boolean(windowEndsAt && Date.parse(windowEndsAt)>Date.now()) && r.assignedBrokerId === a.brokerId && r.mode !== 'automatic', connectionReady: r.enabled === true, claimBlockedReason: typeof attention?.claimBlockedReason === 'string' ? attention.claimBlockedReason : null, dutyPriorityUntil: typeof attention?.dutyPriorityUntil === 'string' ? attention.dutyPriorityUntil : null, dutyPreferred: attention?.dutyPreferred === true, waitingSince: typeof attention?.waitingSince === 'string' ? attention.waitingSince : null, urgent: attention?.urgent === true, leadProfile: { goal: typeof p.goal === 'string' ? p.goal : null, region: typeof p.region === 'string' ? p.region : null, propertyType: typeof p.propertyType === 'string' ? p.propertyType : null, budgetMin: typeof p.budgetMin === 'number' ? p.budgetMin : null, budgetMax: typeof p.budgetMax === 'number' ? p.budgetMax : null, interestProfile: publicSocialProfile(p.interestProfile) } };
  });
  return { contacts, nextCursor: rows.length > 100 && contacts.at(-1)?.lastMessageAt ? cursor(contacts.at(-1)!.lastMessageAt!,contacts.at(-1)!.id) : null, limit: 100, readOnly: false };
}
export async function handoffSocialThread(threadId: string, mode: SocialMode) {
  const a = actor(); if (!socialUuid(threadId) || !['human','suggestions','automatic'].includes(mode)) throw new SocialError('Atendimento inválido.', 400);
  await db('rpc/social_handoff', { method: 'POST', body: { p_company_id: a.companyId, p_actor_id: a.brokerId, p_thread_id: threadId, p_mode: mode } });
}
export async function resolveSocialThreadForLead(leadId: string, channel?: SocialChannel): Promise<{ id: string; threadId: string; leadId: string; channel: SocialChannel } | null> {
  const a = actor(); if (!socialUuid(leadId)) throw new SocialError('Cliente inválido.');
  const rows = await db<ThreadRow[]>(`social_threads?company_id=eq.${a.companyId}&lead_id=eq.${leadId}&select=id,company_id,lead_id,account_id,assigned_broker_id&limit=10`);
  const allowed = [];
  for (const row of rows) {
    const [account] = await db<SocialAccountRow[]>(`social_accounts?company_id=eq.${a.companyId}&id=eq.${row.account_id}&select=channel&limit=1`);
    if (account && (!channel || account.channel === channel)) {
      const visible = await readSocialInbox({ channel: account.channel, threadId: row.id });
      if (visible.contacts.length) allowed.push({ id: row.id, threadId: row.id, leadId, channel: account.channel });
    }
  }
  if (allowed.length > 1) throw new SocialError('Escolha a conversa e o canal para enviar.', 409, 'ambiguous_channel');
  return allowed[0] || null;
}
function socialTimeout(deadline?: number, maximum = 3000) {
  if (!deadline) return 15000;
  const remaining = deadline - Date.now();
  if (remaining < 250) throw new SocialError('A verificação será retomada pelo agendador.', 503, 'deadline');
  return Math.min(maximum, remaining);
}
function socialDb<T>(path: string, options: Parameters<typeof db>[1] = {}, deadline?: number) { return db<T>(path, { ...options, timeoutMs: socialTimeout(deadline) }); }
export async function readSocialThreadForAI(companyId: string, threadId: string, deadline?: number) {
  if (!socialUuid(companyId) || !socialUuid(threadId)) throw new SocialError('Conversa inválida.');
  const [thread] = await socialDb<ThreadRow[]>(`social_threads?company_id=eq.${companyId}&id=eq.${threadId}&select=id,company_id,lead_id,account_id,mode,assigned_broker_id,assigned_to,last_inbound_at,last_inbound_message_id&limit=1`, {}, deadline);
  if (!thread) return null;
  const [account] = await socialDb<SocialAccountRow[]>(`social_accounts?company_id=eq.${companyId}&id=eq.${thread.account_id}&select=channel,enabled&limit=1`, {}, deadline);
  if (!account?.enabled) return null;
  const [lead] = await socialDb<Array<Record<string,unknown>>>(`leads?company_id=eq.${companyId}&id=eq.${thread.lead_id}&select=id,name,goal,region,property_type,budget_min,budget_max,interest_profile&limit=1`, {}, deadline);
  const messages = await socialDb<unknown[]>(`social_messages?company_id=eq.${companyId}&thread_id=eq.${threadId}&select=id,content,occurred_at,direction,status,error_message,media_urls,media_type,source&order=occurred_at.desc,id.desc&limit=40`, {}, deadline);
  const profileSnapshot = { interestProfile: lead?.interest_profile ?? {}, goal: lead?.goal ?? null, region: lead?.region ?? null, propertyType: lead?.property_type ?? null, budgetMin: lead?.budget_min ?? null, budgetMax: lead?.budget_max ?? null };
  return { threadId, leadId: thread.lead_id, channel: account.channel, mode: thread.mode, lastInboundAt: thread.last_inbound_at, incomingMessageId: thread.last_inbound_message_id, assignedBrokerId: thread.assigned_broker_id, profileSnapshot, lead: { ...lead, interest_profile: publicSocialProfile(lead?.interest_profile) }, messages: messages.map(publicSocialMessage).reverse() };
}
type SendInput = { threadId: string; content: string; requestId: string; images?: string[]; source?: 'human' | 'workflow'; deadline?: number };
export async function sendSocialMessage(input: SendInput): Promise<{ threadId: string; messages: SocialMessage[] }> {
  const a = actor(), deadline = Math.min(input.deadline ?? Infinity, Date.now() + 45000);
  if (!Number.isFinite(deadline) || deadline - Date.now() < 12000) throw new SocialError('A preparação demorou. Atualize o atendimento antes de tentar enviar.', 503, 'deadline');
  return sendParts(a.companyId, a.brokerId, input, input.source || 'human', null, deadline);
}
export async function sendSocialAutomatedMessage(input: { companyId: string; threadId: string; content: string; requestId: string; incomingMessageId: string; images?: string[]; deadline?: number }) {
  if (!socialUuid(input.companyId) || !socialUuid(input.incomingMessageId)) throw new SocialError('Resposta automática inválida.');
  return sendParts(input.companyId, null, input, 'ai', input.incomingMessageId, input.deadline);
}
async function sendParts(companyId: string, actorId: string | null, input: { threadId: string; content: string; requestId: string; images?: string[] }, source: string, replyTo: string | null, deadline?: number) {
  if (!socialUuid(input.threadId) || !socialUuid(input.requestId) || typeof input.content !== 'string' || input.content.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(input.content)) throw new SocialError('Mensagem inválida. Use até 2.000 caracteres.', 400);
  const images = input.images || []; if (!Array.isArray(images) || images.length > 5 || images.some(url => !socialImageUrl(url))) throw new SocialError('Use até cinco fotos públicas HTTPS.', 400);
  const parts = [...(input.content.trim() ? [{ content: input.content.trim(), media: [] as string[] }] : []), ...images.map(image => ({ content: '', media: [socialImageUrl(image)!] }))];
  if (!parts.length) throw new SocialError('Escreva uma mensagem ou escolha uma foto.', 400);
  // Enqueue the complete intent before touching the provider. Replays use the same keys.
  const ids = await socialDb<string[]>('rpc/enqueue_social_batch', { method: 'POST', body: { p_company_id: companyId, p_thread_id: input.threadId, p_actor_id: actorId, p_key: `${source}:${actorId || 'automatic'}:${input.requestId}`, p_parts: parts, p_source: source, p_reply_to: replyTo } }, deadline);
  for (const id of ids) {
    if (source !== 'ai' && deadline && Date.now() + 12000 > deadline) {
      // Never leave the remaining manual parts queued for an unrequested later
      // send. Reserve enough time to persist the stop and return the history.
      await socialDb(`social_messages?company_id=eq.${companyId}&id=in.(${ids.join(',')})&status=eq.pending`, { method: 'PATCH', body: { status: 'failed', error_code: 'manual_deadline', error_message: 'Esta parte não foi enviada porque o tempo de envio terminou. Confira o histórico antes de preparar outro envio.', updated_at: new Date().toISOString() } }, deadline);
      break;
    }
    const state = await dispatchSocialMessage(companyId,id,source !== 'ai' && deadline ? deadline - 3500 : deadline);
    if (state && state !== 'sent') {
      await socialDb(`social_messages?company_id=eq.${companyId}&id=in.(${ids.join(',')})&status=eq.pending`, { method: 'PATCH', body: { status: 'failed', error_code: 'previous_part_failed', error_message: 'Esta parte não foi enviada porque o envio anterior não foi confirmado.', updated_at: new Date().toISOString() } }, deadline);
      break;
    }
  }
  const rows = await socialDb<unknown[]>(`social_messages?company_id=eq.${companyId}&id=in.(${ids.join(',')})&select=id,content,occurred_at,direction,status,error_message,media_urls,media_type,source&order=created_at.asc,id.asc`, {}, deadline);
  return { threadId: input.threadId, messages: rows.map(publicSocialMessage) };
}
export function socialSendFailure(status: number, body: unknown): { code: string; message: string; uncertain: boolean } {
  const error = socialObject(socialObject(body).error), code = Number(error.code);
  if (status >= 500) return { code: 'provider_uncertain', message: 'A Meta não confirmou o envio. Confira no canal antes de enviar novamente.', uncertain: true };
  if (status === 429 || [4,17,32,613].includes(code)) return { code: 'provider_rate_limit', message: 'A Meta limitou os envios. Aguarde antes de tentar novamente.', uncertain: false };
  if (code === 190) return { code: 'token_expired', message: 'A autorização Meta expirou. Peça ao administrador para reconectar.', uncertain: false };
  if (Number(error.error_subcode) === 2018278 || Number(error.error_subcode) === 2534022) return { code: 'window_closed', message: 'A janela de resposta da Meta terminou. Aguarde uma nova mensagem do cliente.', uncertain: false };
  return { code: 'provider_rejected', message: 'A Meta recusou o envio. Confira as permissões e a disponibilidade da conta.', uncertain: false };
}
async function dispatchSocialMessage(companyId: string, messageId: string, deadline?: number): Promise<string | null> {
  if (deadline && Date.now()+4000 > deadline) throw new SocialError('O envio será retomado pelo agendador.', 503, 'deadline');
  const claimed = await socialDb<{ messageId: string; threadId: string; accountId: string; recipientId: string; content: string; mediaUrls: string[] } | null>('rpc/claim_social_message', { method: 'POST', body: { p_company_id: companyId, p_message_id: messageId } }, deadline);
  if (!claimed) {
    const [old] = await socialDb<Array<{ status: string }>>(`social_messages?company_id=eq.${companyId}&id=eq.${messageId}&select=status&limit=1`, {}, deadline); return old?.status || null;
  }
  let state: 'sent' | 'failed' | 'unknown' = 'failed', externalId: string | null = null, errorCode: string | null = null, errorMessage: string | null = null;
  let dispatched = false;
  try {
    const [account] = await socialDb<SocialAccountRow[]>(`social_accounts?company_id=eq.${companyId}&id=eq.${claimed.accountId}&select=*&limit=1`, {}, deadline);
    if (!account?.enabled || !account.token_ciphertext || account.channel === 'instagram' && account.account_id === account.page_id) throw new SocialError('A conexão deste canal está incompleta. Peça ao administrador para reconectar.', 409, 'connection_incomplete');
    const token = decryptSocialToken(account.token_ciphertext,companyId);
    const message = claimed.mediaUrls.length ? { attachment: { type: 'image', payload: { url: claimed.mediaUrls[0], is_reusable: false } } } : { text: claimed.content };
    const body = { recipient: { id: claimed.recipientId }, messaging_type: 'RESPONSE', message, ...(process.env.META_APP_SECRET ? { appsecret_proof: createHmac('sha256',process.env.META_APP_SECRET).update(token).digest('hex') } : {}) };
    // Keep time for the confirmed/uncertain result and thread timestamp writes.
    const sendTimeout = socialTimeout(deadline ? deadline-4500 : undefined, 15000);
    dispatched = true;
    const response = await fetch(`https://graph.facebook.com/${account.api_version}/${account.page_id}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' }, body: JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(sendTimeout) });
    const payload = await response.json().catch(() => null), result = socialObject(payload);
    if (!response.ok || result.error) { const failure = socialSendFailure(response.status,payload); state = failure.uncertain ? 'unknown' : 'failed'; errorCode = failure.code; errorMessage = failure.message; }
    else if (typeof result.message_id === 'string' && result.message_id.length <= 255 && result.recipient_id === claimed.recipientId) { state = 'sent'; externalId = result.message_id; }
    else { state = 'unknown'; errorCode = 'confirmation_missing'; errorMessage = 'A Meta não confirmou o destinatário e o envio. Confira no canal antes de enviar novamente.'; }
  } catch (error) {
    state = dispatched ? 'unknown' : 'failed'; errorCode = error instanceof SocialError ? error.code : 'provider_unavailable'; errorMessage = error instanceof SocialError ? error.message : dispatched ? 'A conexão caiu durante o envio. Ele pode ter ocorrido; confira no canal antes de enviar novamente.' : 'Não foi possível preparar o envio. Confira a conexão do canal.';
  }
  await socialDb(`social_messages?company_id=eq.${companyId}&id=eq.${messageId}&status=eq.sending`, { method: 'PATCH', body: { status: state, external_id: externalId, error_code: errorCode, error_message: errorMessage, updated_at: new Date().toISOString() } }, deadline);
  if (state === 'sent') await socialDb(`social_threads?company_id=eq.${companyId}&id=eq.${claimed.threadId}`, { method: 'PATCH', body: { last_message_at: new Date().toISOString() } }, deadline);
  return state;
}
