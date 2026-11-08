'use client';
/* eslint-disable @next/next/no-img-element -- existing catalog photos */
import { useRef, useState } from 'react';
import { dashboardFetch } from '@/lib/dashboard-transport';
import { channelLabel } from '@/lib/lead-channel';
import type { SocialChannel, SocialMessage } from '@/lib/social-model';
import { announceDashboardChange } from '@/lib/dashboard-sync';
import s from './opportunity-photos.module.css';
export default function OpportunitySocialSend({ opportunityId, channel, images, message, customer }: { opportunityId: string; channel: SocialChannel; images: string[]; message: string; customer: string }) {
  const [selected, setSelected] = useState(images.filter(url => url.startsWith('https://')).slice(0,5)), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const intent = useRef<{ payload: string; id: string } | null>(null), lock = useRef(false);
  async function send() {
    if (lock.current) return;
    const payload = JSON.stringify({ opportunityId, content: message, images: selected });
    if (intent.current?.payload !== payload) intent.current = { payload, id: crypto.randomUUID() };
    lock.current = true; setBusy(true); setNotice('');
    try {
      const response = await dashboardFetch('/api/opportunities/social-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opportunityId, content: message, images: selected, confirmed: true, requestId: intent.current!.id }) });
      const result = await response.json() as { error?: string; data?: { messages?: SocialMessage[] } };
      if (!response.ok) throw new Error(result.error || 'Falha no envio.');
      const messages: SocialMessage[] = result.data?.messages || [];
      setNotice(messages.length && messages.every(item => item.status === 'sent') ? `Envio confirmado pelo ${channelLabel(channel)}. O histórico está em Conversas.` : 'Envio ainda sem confirmação completa. Confira o histórico em Conversas antes de repetir.');
      announceDashboardChange('social-conversations'); announceDashboardChange('opportunities');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível confirmar o envio.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className={s.box}><strong>Enviar pelo {channelLabel(channel)} para {customer}</strong><div className={s.gallery}>{images.filter(url => url.startsWith('https://')).slice(0,5).map((image,index) => <label className={s.photo} key={image}><img src={image} alt={`Foto ${index+1}`}/><span><input type="checkbox" disabled={busy} checked={selected.includes(image)} onChange={() => setSelected(old => old.includes(image) ? old.filter(url => url !== image) : [...old,image])}/>Foto {index+1}</span></label>)}</div><p>Confira o texto e as fotos. O envio usa a conversa deste cliente no {channelLabel(channel)} e depende da janela de resposta do canal.</p><button type="button" className={s.primary} disabled={busy || !message.trim() || message.length > 2000} onClick={() => void send()}>{busy ? 'Enviando…' : `Confirmar envio pelo ${channelLabel(channel)}`}</button>{notice && <p role="status">{notice}</p>}</section>;
}
