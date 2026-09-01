import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../container.js';
import { parseWith, tenantIdFrom } from './route-utils.js';

const SimulateMessageSchema = z.object({
  phone: z.string().trim().min(10).max(30),
  message: z.string().max(4_000).default(''),
  messageType: z.enum(['TEXT', 'IMAGE', 'AUDIO', 'DOCUMENT', 'UNKNOWN']).default('TEXT'),
  whatsappMessageId: z.string().min(1).max(200).optional(),
}).strict();

export async function registerDevRoutes(app: FastifyInstance, container: AppContainer): Promise<void> {
  app.post('/dev/simulate-message', { schema: { tags: ['development'], summary: 'Simula mensagem no pipeline completo (somente development)' } }, async (request) => {
    const input = parseWith(SimulateMessageSchema, request.body);
    const result = await container.ingestion.ingest({
      tenantId: tenantIdFrom(request),
      phone: input.phone,
      content: input.message,
      externalMessageId: input.whatsappMessageId ?? `dev_${randomUUID()}`,
      messageType: input.messageType,
      metadata: { source: 'DEV_SIMULATOR' },
      correlationId: request.id,
    });
    return { data: result };
  });
}
