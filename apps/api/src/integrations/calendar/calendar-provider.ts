import { AppError } from '../../domain/errors.js';

export interface CalendarSlotInput {
  tenantId: string;
  scheduledAt: Date;
  duration: number;
  brokerId?: string | null;
}

export interface CalendarEventInput extends CalendarSlotInput {
  leadId: string;
  propertyId?: string | null;
  notes?: string | null;
}

export interface CalendarEvent {
  externalId: string;
  tenantId: string;
  leadId: string;
  propertyId: string | null;
  brokerId: string | null;
  scheduledAt: Date;
  endsAt: Date;
  duration: number;
  notes: string | null;
  createdAt: Date;
}

export interface CalendarProvider {
  readonly providerName: string;

  isAvailable(input: CalendarSlotInput): Promise<boolean>;

  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;

  /**
   * Optional compensation hook for providers that can remove an external event
   * when local persistence fails after the event was created.
   */
  cancelEvent?(tenantId: string, externalId: string): Promise<void>;
}

export class CalendarSlotUnavailableError extends AppError {
  constructor(input: CalendarSlotInput) {
    super('O horário solicitado não está disponível', 'CALENDAR_SLOT_UNAVAILABLE', 409, {
      scheduledAt: input.scheduledAt.toISOString(),
      duration: input.duration,
      brokerId: input.brokerId ?? null,
    });
  }
}
