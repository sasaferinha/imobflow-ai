import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../container.js';

export async function registerHealthRoutes(app: FastifyInstance, container: AppContainer): Promise<void> {
  app.get('/health', {
    schema: { tags: ['system'], summary: 'Health check', response: { 200: { type: 'object' }, 503: { type: 'object' } } },
  }, async (_request, reply) => {
    try {
      await container.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up', timestamp: new Date().toISOString() };
    } catch (error) {
      app.log.error({ err: error }, 'health_database_unavailable');
      return reply.status(503).send({ status: 'degraded', database: 'down', timestamp: new Date().toISOString() });
    }
  });
}
