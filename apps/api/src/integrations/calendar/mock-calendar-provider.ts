import { randomUUID } from 'node:crypto';
import {
  CalendarSlotUnavailableError,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarProvider,
  type CalendarSlotInput,
} from './calendar-provider.js';

export interface MockCalendarProviderOptions {
  now?: () => Date;
  idGenerator?: () => string;
  busySlots?: readonly CalendarSlotInput[];
}

interface StoredCalendarEntry {
  event: CalendarEvent;
  busyOnly: boolean;
}

/**
 * In-memory calendar used by local development and tests. Slots use half-open
 * intervals, so an event may start exactly when the previous event ends.
 */
export class MockCalendarProvider implements CalendarProvider {
  readonly providerName = 'mock';

  private readonly now: () => Date;
  private readonly idGenerator: () => string;
  private readonly entries = new Map<string, StoredCalendarEntry>();

  constructor(options: MockCalendarProviderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;

    for (const slot of options.busySlots ?? []) {
      this.addBusySlot(slot);
    }
  }

  async isAvailable(input: CalendarSlotInput): Promise<boolean> {
    assertValidSlot(input);
    const requestedStart = input.scheduledAt.getTime();
    const requestedEnd = endTime(input);

    for (const { event } of this.entries.values()) {
      if (event.tenantId !== input.tenantId || event.brokerId !== (input.brokerId ?? null)) continue;
      if (requestedStart < event.endsAt.getTime() && event.scheduledAt.getTime() < requestedEnd) return false;
    }

    return true;
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    if (!(await this.isAvailable(input))) throw new CalendarSlotUnavailableError(input);

    const externalId = `mock-calendar-${this.idGenerator()}`;
    const event = toEvent(externalId, input, this.now());
    this.entries.set(externalId, { event, busyOnly: false });
    return cloneEvent(event);
  }

  async cancelEvent(tenantId: string, externalId: string): Promise<void> {
    const entry = this.entries.get(externalId);
    if (entry?.event.tenantId === tenantId && !entry.busyOnly) this.entries.delete(externalId);
  }

  addBusySlot(input: CalendarSlotInput): string {
    assertValidSlot(input);
    const externalId = `mock-busy-${this.idGenerator()}`;
    const event = toEvent(
      externalId,
      {
        ...input,
        leadId: 'mock-busy-slot',
      },
      this.now(),
    );
    this.entries.set(externalId, { event, busyOnly: true });
    return externalId;
  }

  getEvents(tenantId?: string): readonly CalendarEvent[] {
    return [...this.entries.values()]
      .filter((entry) => !entry.busyOnly && (tenantId === undefined || entry.event.tenantId === tenantId))
      .map((entry) => cloneEvent(entry.event));
  }

  clear(): void {
    this.entries.clear();
  }
}

function assertValidSlot(input: CalendarSlotInput): void {
  if (!input.tenantId.trim()) throw new TypeError('tenantId é obrigatório');
  if (!(input.scheduledAt instanceof Date) || !Number.isFinite(input.scheduledAt.getTime())) {
    throw new TypeError('scheduledAt deve ser uma data válida');
  }
  if (!Number.isSafeInteger(input.duration) || input.duration <= 0) {
    throw new RangeError('duration deve ser um número inteiro positivo de minutos');
  }
}

function endTime(input: CalendarSlotInput): number {
  return input.scheduledAt.getTime() + input.duration * 60_000;
}

function toEvent(externalId: string, input: CalendarEventInput, createdAt: Date): CalendarEvent {
  return {
    externalId,
    tenantId: input.tenantId,
    leadId: input.leadId,
    propertyId: input.propertyId ?? null,
    brokerId: input.brokerId ?? null,
    scheduledAt: new Date(input.scheduledAt),
    endsAt: new Date(endTime(input)),
    duration: input.duration,
    notes: input.notes ?? null,
    createdAt: new Date(createdAt),
  };
}

function cloneEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    scheduledAt: new Date(event.scheduledAt),
    endsAt: new Date(event.endsAt),
    createdAt: new Date(event.createdAt),
  };
}
