import { supabaseServiceRequest as db } from './supabase';
import { socialUuid } from './social-model';
import { transcribeAudio } from './ai/audio-transcription';

/** Only media persisted from a verified Meta webhook is eligible, never a caller-supplied URL. */
export async function transcribeSocialAudio(companyId: string, threadId: string, messageId: string, deadline = Date.now()+20000): Promise<string | null> {
  if (![companyId,threadId,messageId].every(socialUuid) || !process.env.OPENAI_API_KEY || deadline-Date.now()<3000) return null;
  try {
    const timeout = () => Math.max(1, Math.min(3000, deadline-Date.now()));
    const scope = `company_id=eq.${companyId}&thread_id=eq.${threadId}&id=eq.${messageId}`;
    const [message] = await db<Array<{ direction: string; media_type: string; media_urls: unknown; transcript_text: string | null }>>(`social_messages?${scope}&select=direction,media_type,media_urls,transcript_text&limit=1`, { timeoutMs: timeout() });
    if (!message || message.direction !== 'incoming' || message.media_type !== 'audio') return null;
    if (message.transcript_text) return message.transcript_text;
    if (!Array.isArray(message.media_urls) || message.media_urls.length !== 1 || typeof message.media_urls[0] !== 'string' || deadline-Date.now()<1500) return null;
    const url = new URL(message.media_urls[0]);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['fbcdn.net','facebook.com','cdninstagram.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    const response = await fetch(url, { cache: 'no-store', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(Math.min(7000,deadline-Date.now())) });
    const type = response.headers.get('content-type')?.split(';')[0].trim() || '';
    if (!response.ok || !['audio/ogg','audio/mpeg','audio/mp4'].includes(type) || Number(response.headers.get('content-length')) > 16*1024*1024 || !response.body) return null;
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length=0;
    for (;;) { const next = await reader.read(); if (next.done) break; length+=next.value.byteLength; if (length>16*1024*1024 || Date.now()>deadline) { await reader.cancel(); return null; } chunks.push(next.value); }
    const bytes = new Uint8Array(length); let offset=0; for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
    if (deadline-Date.now()<1500) return null;
    const text = await transcribeAudio(bytes.buffer, type, deadline-Date.now());
    if (!text) return null;
    const saved = await db<Array<{ transcript_text: string }>>(`social_messages?${scope}&transcript_text=is.null&select=transcript_text`, { method: 'PATCH', body: { transcript_text: text }, prefer: 'return=representation', timeoutMs: timeout() });
    if (saved.length === 1 && saved[0].transcript_text === text) return text;
    // A simultaneous analysis may have persisted a different transcription.
    // Use only the stored text so citations and later reviews remain consistent.
    if (deadline-Date.now()<250) return null;
    const [canonical] = await db<Array<{ transcript_text: string | null }>>(`social_messages?${scope}&select=transcript_text&limit=1`, { timeoutMs: timeout() });
    return canonical?.transcript_text || null;
  } catch { return null; }
}
