import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LeadProfileSchema, mergeLeadProfiles } from '../domain/leads/lead-profile.js';
import { calculateLeadScore } from '../domain/leads/lead-scoring.js';
import type { AppContainer } from '../container.js';
import { parseWith, tenantIdFrom } from './route-utils.js';

const IdParamsSchema = z.object({ id: z.string().min(1) }).strict();
const LeadPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.string().trim().min(1).max(50).optional(),
  profile: LeadProfileSchema.partial().optional(),
}).strict();

export async function registerLeadRoutes(app: FastifyInstance, container: AppContainer): Promise<void> {
  app.get('/leads', { schema: { tags: ['leads'], summary: 'Lista leads do tenant' } }, async (request) => {
    const data = await container.leads.list(tenantIdFrom(request));
    return { data, count: data.length };
  });

  app.get('/leads/:id', { schema: { tags: ['leads'], summary: 'Detalha um lead' } }, async (request) => {
    const { id } = parseWith(IdParamsSchema, request.params);
    return { data: await container.leads.getById(tenantIdFrom(request), id) };
  });

  app.patch('/leads/:id', { schema: { tags: ['leads'], summary: 'Atualiza um lead' } }, async (request) => {
    const tenantId = tenantIdFrom(request);
    const { id } = parseWith(IdParamsSchema, request.params);
    const input = parseWith(LeadPatchSchema, request.body);
    let lead = await container.leads.getById(tenantId, id);
    if (input.profile) {
      const profile = mergeLeadProfiles(lead.profile, input.profile);
      lead = await container.leads.updateProfile(tenantId, id, profile, lead.intent, calculateLeadScore(profile));
    }
    if (input.name !== undefined || input.status !== undefined) {
      lead = await container.leads.patch(tenantId, id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
    }
    return { data: lead };
  });
}
