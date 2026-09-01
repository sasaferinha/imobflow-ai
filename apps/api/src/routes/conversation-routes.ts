import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../container.js';
import { parseWith, tenantIdFrom } from './route-utils.js';

const IdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export async function registerConversationRoutes(app: FastifyInstance, container: AppContainer): Promise<void> {
  app.get('/conversations/:id', { schema: { tags: ['conversations'], summary: 'Conversa, mensagens e resumo' } }, async (request) => {
    const { id } = parseWith(IdParamsSchema, request.params);
    return { data: await container.conversations.getById(tenantIdFrom(request), id) };
  });

  app.post('/conversations/:id/handoff', { schema: { tags: ['conversations'], summary: 'Transfere para atendimento humano' } }, async (request) => {
    const { id } = parseWith(IdParamsSchema, request.params);
    return { data: await container.handoff.request(tenantIdFrom(request), id, request.id) };
  });

  app.post('/conversations/:id/resume-ai', { schema: { tags: ['conversations'], summary: 'Reativa atendimento por IA' } }, async (request) => {
    const { id } = parseWith(IdParamsSchema, request.params);
    return { data: await container.handoff.resumeAi(tenantIdFrom(request), id, request.id) };
  });
}
