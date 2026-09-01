import type { Appointment } from '@prisma/client';
import { OutboxRepository } from '../../infrastructure/events/outbox-repository.js';
import {
  CalendarSlotUnavailableError,
  type CalendarEventInput,
  type CalendarProvider,
  type CalendarSlotInput,
} from '../../integrations/calendar/calendar-provider.js';
import { AppointmentRepository } from '../../modules/appointments/appointment-repository.js';
import type { AppointmentCreateInput } from '../../modules/appointments/appointment-schemas.js';

export class AppointmentService {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly calendar: CalendarProvider,
    private readonly outbox: OutboxRepository,
  ) {}

  async create(tenantId: string, input: AppointmentCreateInput): Promise<Appointment> {
    const slot = toCalendarSlot(tenantId, input);
    if (!(await this.calendar.isAvailable(slot))) throw new CalendarSlotUnavailableError(slot);

    const calendarEvent = await this.calendar.createEvent(toCalendarEvent(tenantId, input));
    let appointment: Appointment;
    try {
      appointment = await this.appointments.create(tenantId, input, calendarEvent.externalId);
    } catch (error) {
      await this.compensateCalendarEvent(tenantId, calendarEvent.externalId);
      throw error;
    }

    await this.outbox.add({
      tenantId,
      type: 'appointment.created',
      aggregateType: 'Appointment',
      aggregateId: appointment.id,
      payload: {
        appointmentId: appointment.id,
        leadId: appointment.leadId,
        propertyId: appointment.propertyId,
        brokerId: appointment.brokerId,
        scheduledAt: appointment.scheduledAt.toISOString(),
        duration: appointment.duration,
        status: appointment.status,
        calendarProvider: this.calendar.providerName,
        externalId: appointment.externalId,
      },
    });

    return appointment;
  }

  private async compensateCalendarEvent(tenantId: string, externalId: string): Promise<void> {
    if (!this.calendar.cancelEvent) return;
    try {
      await this.calendar.cancelEvent(tenantId, externalId);
    } catch {
      // Preserve the persistence error. A real provider should surface failed
      // compensations through its own operational monitoring/reconciliation.
    }
  }
}

function toCalendarSlot(tenantId: string, input: AppointmentCreateInput): CalendarSlotInput {
  return {
    tenantId,
    scheduledAt: input.scheduledAt,
    duration: input.duration,
    ...(input.brokerId !== undefined ? { brokerId: input.brokerId } : {}),
  };
}

function toCalendarEvent(tenantId: string, input: AppointmentCreateInput): CalendarEventInput {
  return {
    ...toCalendarSlot(tenantId, input),
    leadId: input.leadId,
    ...(input.propertyId !== undefined ? { propertyId: input.propertyId } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
}
