'use client';

import s from './conversation-channels.module.css';

export type ConversationChannel = 'whatsapp' | 'instagram';

export function ChannelIcon({ channel }: { channel: ConversationChannel }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {channel === 'instagram'
      ? <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" fill="currentColor" stroke="none" /></>
      : <><path d="M20.5 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.2-4.6A8.5 8.5 0 1 1 20.5 11.5Z" /><path d="m8 7.5 1.7 2.8-1 1.1a8 8 0 0 0 3.9 3.3l1-1.3 2.9 1.3c-.2 1.5-1.4 2.3-2.7 2-3.5-.8-6.5-3.4-7.1-6.6-.2-1 .2-2 1.3-2.6Z" /></>}
  </svg>;
}

export default function ConversationChannels({ channel, onChange, busy = false }: {
  channel: ConversationChannel; onChange: (channel: ConversationChannel) => void; busy?: boolean;
}) {
  return <div className={s.channelBar}>
    <div className={s.switcher} role="group" aria-label="Canal de conversas">
      {(['whatsapp', 'instagram'] as const).map(item => <button
        type="button" key={item} className={s.channel} data-channel={item}
        aria-pressed={channel === item} aria-controls="conversation-channel-content"
        disabled={busy && channel !== item} onClick={() => onChange(item)}>
        <ChannelIcon channel={item} /><span>{item === 'whatsapp' ? 'WhatsApp' : 'Instagram'}</span>
      </button>)}
    </div>
    <span className={s.channelHint}>{busy ? 'Aguarde a operação em andamento.' : channel === 'instagram' ? 'DMs · envio ainda não habilitado' : 'Atendimento pelo WhatsApp'}</span>
  </div>;
}
