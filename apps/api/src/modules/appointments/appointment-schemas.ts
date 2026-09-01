import { z } from 'zod';

export const AppointmentCreateSchema = z
  .object({
    leadId: z.string().min(1),
    propertyId: z.string().min(1).nullable().optional(),
    brokerId: z.string().min(1).nullable().optional(),
    scheduledAt: z.coerce.date(),
    duration: z.number().int().min(15).max(480).default(60),
    notes: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();

export type AppointmentCreateInput = z.infer<typeof AppointmentCreateSchema>;
