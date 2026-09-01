import type { FastifyReply, FastifyRequest } from 'fastify';
import { type output, type ZodTypeAny } from 'zod';
import { UnauthorizedError, ValidationError } from '../domain/errors.js';
import type { AppContainer } from '../container.js';

export function parseWith<TSchema extends ZodTypeAny>(schema: TSchema, value: unknown): output<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError('Payload inválido', parsed.error.flatten());
  return parsed.data;
}

export function tenantIdFrom(request: FastifyRequest): string {
  if (!request.tenantId) throw new UnauthorizedError('Tenant não identificado');
  return request.tenantId;
}

export function createInternalAuth(container: AppContainer) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const apiKey = scalarHeader(request.headers['x-api-key']);
    if (!apiKey || !safeEqual(apiKey, container.env.INTERNAL_API_KEY)) throw new UnauthorizedError();
    const tenantId = scalarHeader(request.headers['x-tenant-id']) ?? container.env.DEFAULT_TENANT_ID;
    const tenant = await container.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new UnauthorizedError('Tenant inválido');
    request.tenantId = tenantId;
  };
}

function scalarHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}
