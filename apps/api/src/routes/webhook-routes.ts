import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UnauthorizedError, ValidationError } from '../domain/errors.js';
import type { AppContainer } from '../container.js';

const WebhookVerificationQuerySchema = z.object({
  'hub.mode': z.string(),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string(),
}).passthrough();

export async function registerWebhookRoutes(app: FastifyInstance, container: AppContainer): Promise<void> {
  app.get('/webhooks/whatsapp', { schema: { tags: ['webhooks'], summary: 'Verificação do webhook Meta' } }, async (request, reply) => {
    const parsed = WebhookVerificationQuerySchema.safeParse(request.query);
    if (
      !parsed.success ||
      parsed.data['hub.mode'] !== 'subscribe' ||
      !container.env.WHATSAPP_VERIFY_TOKEN ||
      parsed.data['hub.verify_token'] !== container.env.WHATSAPP_VERIFY_TOKEN
    ) {
      throw new UnauthorizedError('Falha na verificação do webhook');
    }
    return reply.type('text/plain').send(parsed.data['hub.challenge']);
  });

  app.post('/webhooks/whatsapp', { schema: { tags: ['webhooks'], summary: 'Recebe eventos da Meta WhatsApp' } }, async (request, reply) => {
    const signatureValue = request.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureValue) ? signatureValue[0] : signatureValue;
    const rawBody = request.rawBody;
    if (!rawBody) throw new ValidationError('Corpo bruto não disponível para validar assinatura');
    if (!container.whatsapp.verifyWebhookSignature(rawBody, signature)) throw new UnauthorizedError('Assinatura do webhook inválida');

    const messages = container.whatsapp.parseWebhook(request.body);
    for (const message of messages) {
      try {
        await container.whatsapp.markAsRead(message.whatsappMessageId);
        await container.ingestion.ingest({
          tenantId: container.env.DEFAULT_TENANT_ID,
          phone: message.from,
          content: message.content,
          externalMessageId: message.whatsappMessageId,
          messageType: message.messageType,
          timestamp: message.timestamp,
          metadata: { ...message.metadata, senderName: message.senderName, phoneNumberId: message.phoneNumberId },
          correlationId: request.id,
        });
      } catch (error) {
        app.log.error({ err: error, whatsappMessageId: message.whatsappMessageId, correlationId: request.id }, 'whatsapp_message_processing_failed');
      }
    }
    return reply.status(200).send({ received: true, messages: messages.length });
  });
}
