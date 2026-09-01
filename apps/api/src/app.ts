import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import type { AppEnv } from './config/env.js';
import { AppError } from './domain/errors.js';
import { loggerOptions } from './infrastructure/logging/logger.js';
import { createContainer, type AppContainer } from './container.js';
import { registerAppointmentRoutes } from './routes/appointment-routes.js';
import { registerConversationRoutes } from './routes/conversation-routes.js';
import { registerDevRoutes } from './routes/dev-routes.js';
import { registerHealthRoutes } from './routes/health-routes.js';
import { registerLeadRoutes } from './routes/lead-routes.js';
import { registerPropertyRoutes } from './routes/property-routes.js';
import { createInternalAuth } from './routes/route-utils.js';
import { registerWebhookRoutes } from './routes/webhook-routes.js';

export interface BuildAppOptions {
  env: AppEnv;
  container?: AppContainer;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<{ app: FastifyInstance; container: AppContainer }> {
  const serverOptions: FastifyServerOptions = {
    logger: options.logger === false ? false : loggerOptions(options.env),
    requestIdHeader: 'x-correlation-id',
    requestIdLogLabel: 'correlationId',
    disableRequestLogging: true,
    bodyLimit: 1_048_576,
  };
  const app: FastifyInstance = Fastify(serverOptions);
  installRawJsonParser(app);
  const container = options.container ?? createContainer(options.env, app.log);

  await app.register(rateLimit, {
    global: true,
    max: options.env.NODE_ENV === 'production' ? 120 : 1_000,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Real Estate AI MVP API', version: '0.1.0' },
      servers: [{ url: `http://localhost:${options.env.PORT}` }],
      components: {
        securitySchemes: {
          InternalApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
          TenantId: { type: 'apiKey', in: 'header', name: 'X-Tenant-Id' },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    uiConfig: { docExpansion: 'list', deepLinking: false },
  });

  await registerHealthRoutes(app, container);
  await registerWebhookRoutes(app, container);

  await app.register(async (internal) => {
    internal.addHook('preHandler', createInternalAuth(container));
    await registerPropertyRoutes(internal, container);
    await registerLeadRoutes(internal, container);
    await registerConversationRoutes(internal, container);
    await registerAppointmentRoutes(internal, container);
    if (options.env.NODE_ENV === 'development') await registerDevRoutes(internal, container);
  });

  app.setNotFoundHandler(async (request, reply) => {
    return reply.status(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: 'Rota não encontrada', correlationId: request.id } });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}), correlationId: request.id },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Payload inválido', details: error.flatten(), correlationId: request.id } });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'Registro duplicado', correlationId: request.id } });
    }
    if (typeof (error as { statusCode?: unknown }).statusCode === 'number' && (error as { statusCode: number }).statusCode < 500) {
      const statusCode = (error as { statusCode: number }).statusCode;
      const message = error instanceof Error ? error.message : 'Requisição inválida';
      return reply.status(statusCode).send({ error: { code: 'REQUEST_ERROR', message, correlationId: request.id } });
    }
    request.log.error({ err: error, correlationId: request.id }, 'unhandled_request_error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno', correlationId: request.id } });
  });

  app.addHook('onClose', async () => {
    container.outboxWorker.stop();
    await container.prisma.$disconnect();
  });

  await app.ready();
  return { app, container };
}

function installRawJsonParser(app: FastifyInstance): void {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    ['application/json', 'application/*+json'],
    { parseAs: 'buffer' },
    (request, body, done) => {
      const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
      request.rawBody = rawBody;
      try {
        done(null, JSON.parse(rawBody.toString('utf8')) as unknown);
      } catch (error) {
        done(error instanceof Error ? error : new Error('JSON inválido'), undefined);
      }
    },
  );
}
