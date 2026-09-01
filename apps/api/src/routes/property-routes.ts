import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PropertySearchFiltersSchema } from '../domain/properties/property.js';
import type { AppContainer } from '../container.js';
import { PropertyCreateSchema, PropertyPatchSchema } from '../modules/properties/property-schemas.js';
import { parseWith, tenantIdFrom } from './route-utils.js';

const IdParamsSchema = z.object({ id: z.string().min(1) }).strict();

export async function registerPropertyRoutes(app: FastifyInstance, container: AppContainer): Promise<void> {
  app.get('/properties', { schema: { tags: ['properties'], summary: 'Busca e ranqueia imóveis' } }, async (request) => {
    const raw = request.query as Record<string, unknown>;
    const filters = parseWith(PropertySearchFiltersSchema, {
      ...raw,
      ...(raw.neighborhoods ? { neighborhoods: csv(raw.neighborhoods) } : {}),
      ...(raw.features ? { features: csv(raw.features) } : {}),
    });
    const data = await container.properties.list(tenantIdFrom(request), filters);
    return { data, count: data.length };
  });

  app.get('/properties/:id', { schema: { tags: ['properties'], summary: 'Detalha um imóvel' } }, async (request) => {
    const { id } = parseWith(IdParamsSchema, request.params);
    return { data: await container.properties.getById(tenantIdFrom(request), id) };
  });

  app.post('/properties', { schema: { tags: ['properties'], summary: 'Cadastra um imóvel' } }, async (request, reply) => {
    const input = parseWith(PropertyCreateSchema, request.body);
    const data = await container.properties.create(tenantIdFrom(request), input);
    await container.outbox.add({
      tenantId: tenantIdFrom(request),
      type: 'property.created',
      aggregateType: 'Property',
      aggregateId: data.id,
      payload: { externalId: data.externalId },
    });
    return reply.status(201).send({ data });
  });

  app.patch('/properties/:id', { schema: { tags: ['properties'], summary: 'Atualiza um imóvel' } }, async (request) => {
    const { id } = parseWith(IdParamsSchema, request.params);
    const input = parseWith(PropertyPatchSchema, request.body);
    const data = await container.properties.update(tenantIdFrom(request), id, input);
    return { data };
  });
}

function csv(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}
