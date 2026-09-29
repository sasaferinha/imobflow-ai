import { whatsappConversationLink } from '@/lib/whatsapp-handoff';

export function ConversationWhatsAppHandoff({ phone, text }: { phone: string; text: string }) {
  const href = whatsappConversationLink(phone, text);
  return <div className="conversation-whatsapp-handoff" role="status">
    <strong>Continue pelo WhatsApp da empresa</strong>
    <p>A janela de 24 horas do painel encerrou. Abra a conversa e confirme o envio no WhatsApp.</p>
    {href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Abrir conversa no WhatsApp ↗</a>
      : <p>Confira o telefone do cliente, incluindo o código do país, para abrir a conversa.</p>}
    <small>Use o WhatsApp Business ou WhatsApp Web conectado ao número da empresa, não ao seu número pessoal. O link não escolhe a conta. Somente o texto é levado; nada é enviado automaticamente.</small>
  </div>;
}
