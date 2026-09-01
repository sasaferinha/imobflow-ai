import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../container.js';
import { AppointmentCreateSchema } from '../modules/appointments/appointment-schemas.js';
import { parseWith, tenantIdFrom } from './route-utils.js';

const AppointmentQuerySchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).strict();

export async function registerAppointmentRoutes(app: FastifyInstance, container: AppContainer): Promise<void> {
  app.post('/appointments', { schema: { tags: ['appointments'], summary: 'Cria um agendamento' } }, async (request, reply) => {
    const tenantId = tenantIdFrom(request);
    const input = parseWith(AppointmentCreateSchema, request.body);
    const data = await container.appointmentService.create(tenantId, input);
    return reply.status(201).send({ data });
  });

  app.get('/appointments', { schema: { tags: ['appointments'], summary: 'Lista agendamentos' } }, async (request) => {
    const tenantId = tenantIdFrom(request);
    const query = parseWith(AppointmentQuerySchema, request.query);
    const data = await container.appointments.list(tenantId, query.from, query.to);
    return { data, count: data.length };
  });
}
