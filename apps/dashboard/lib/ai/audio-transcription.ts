import { supabaseServiceRequest } from '../supabase';
import { isWhatsAppAudioPath, matchesAudioSignature, readStoredWhatsAppImage } from '../whatsapp-media';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = 'Transcrição automática do áudio (confira no original):\n';
const formats: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a' };
export const audioNeedsTranscription = (text: string) => /^(?:Áudio recebido|\[Áudio[^\]]*\])(?:\s|$)/i.test(text.trim());
export const audioTranscriptText = (text: string) => text.startsWith(PREFIX) ? text.slice(PREFIX.length) : null;

/** Fixed provider URL, bounded private media, no model/tool instructions from the recording. */
export async function transcribeAudio(bytes: ArrayBuffer, contentType: string, timeoutMs = 12_000): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  const extension = formats[contentType];
  if (!key || !extension || !bytes.byteLength || bytes.byteLength > 16 * 1024 * 1024
    || !matchesAudioSignature(new Uint8Array(bytes), contentType)) return null;
  const form = new FormData();
  form.set('model', process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'gpt-transcribe');
  form.set('response_format', 'json');
  form.set('file', new Blob([bytes], { type: contentType }), `audio.${extension}`);
  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(Math.max(1000, Math.min(timeoutMs, 12_000))),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('text' in body) || typeof body.text !== 'string') return null;
    const text = body.text.trim();
    // Truncating speech could reverse a correction. Refuse instead of processing a partial transcript.
    if (!text || text.length > 6000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) return null;
    return text;
  } catch { return null; }
}

type AudioMessage = { id: string; company_id: string; conversation_id: string; direction: string; content: string; media_urls: unknown };
/** Caller has already checked either the bot lease or the broker's portfolio access. */
export async function transcribeConversationAudio(input: { companyId: string; conversationId: string; messageId?: string; externalMessageId?: string; deadline?: number }): Promise<string | null> {
  if (!UUID.test(input.companyId) || !UUID.test(input.conversationId) || (input.messageId && !UUID.test(input.messageId))
    || (!input.messageId && (!input.externalMessageId || input.externalMessageId.length > 300))) return null;
  if (!process.env.OPENAI_API_KEY?.trim() || (input.deadline && Date.now() + 3000 > input.deadline)) return null;
  try {
    const scope = `company_id=eq.${input.companyId}&conversation_id=eq.${input.conversationId}`;
    const selector = input.messageId ? `id=eq.${input.messageId}` : `external_message_id=eq.${encodeURIComponent(input.externalMessageId!)}`;
    const rows = await supabaseServiceRequest<AudioMessage[]>(`messages?${scope}&${selector}&select=id,company_id,conversation_id,direction,content,media_urls&limit=2`, { timeoutMs: 3000 });
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row = rows[0];
    if (row.company_id !== input.companyId || row.conversation_id !== input.conversationId || !UUID.test(row.id)
      || !['incoming', 'Entrada'].includes(row.direction) || typeof row.content !== 'string') return null;
    const cached = audioTranscriptText(row.content);
    if (cached) return cached;
    if (!audioNeedsTranscription(row.content) || !Array.isArray(row.media_urls)) return null;
    const paths = row.media_urls.filter((path): path is string => typeof path === 'string' && isWhatsAppAudioPath(path, input.companyId));
    if (paths.length !== 1 || (input.deadline && Date.now() + 3000 > input.deadline)) return null;
    const media = await readStoredWhatsAppImage(paths[0]);
    if (input.deadline && Date.now() + 1500 > input.deadline) return null;
    const transcript = await transcribeAudio(media.bytes, media.contentType, input.deadline ? input.deadline - Date.now() : 12_000);
    if (!transcript) return null;
    // Never overwrite a concurrent correction. The media remains attached and playable.
    const saved = await supabaseServiceRequest<Array<{ id: string }>>(`messages?${scope}&id=eq.${row.id}&content=eq.${encodeURIComponent(row.content)}`, {
      method: 'PATCH', body: { content: PREFIX + transcript }, prefer: 'return=representation', timeoutMs: 3000,
    });
    return Array.isArray(saved) && saved.length === 1 && saved[0].id === row.id ? transcript : null;
  } catch { return null; }
}
