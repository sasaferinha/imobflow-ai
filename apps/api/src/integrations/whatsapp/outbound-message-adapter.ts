import type { OutboundMessagePort } from '../../application/ingestion/message-ingestion-service.js';
import type { WhatsAppProvider } from './whatsapp-provider.js';

/** Mantém nomes específicos do WhatsApp fora da camada de aplicação. */
export class WhatsAppOutboundMessageAdapter implements OutboundMessagePort {
  constructor(private readonly provider: WhatsAppProvider) {}

  async sendText(input: {
    to: string;
    text: string;
    correlationId: string;
  }): Promise<{ externalMessageId?: string }> {
    const sent = await this.provider.sendText({ to: input.to, text: input.text });
    return { externalMessageId: sent.whatsappMessageId };
  }
}
