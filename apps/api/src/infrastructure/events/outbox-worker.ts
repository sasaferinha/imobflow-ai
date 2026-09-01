import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { AppEnv } from '../../config/env.js';

export class OutboxWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly logger: FastifyBaseLogger,
  ) {}

  start(): void {
    if (!this.env.N8N_EVENTS_WEBHOOK_URL || this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.env.OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running || !this.env.N8N_EVENTS_WEBHOOK_URL) return;
    this.running = true;
    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: { status: { in: ['PENDING', 'FAILED'] }, availableAt: { lte: new Date() }, attempts: { lt: 10 } },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const event of events) await this.publish(event);
    } finally {
      this.running = false;
    }
  }

  private async publish(event: Awaited<ReturnType<PrismaClient['outboxEvent']['findFirstOrThrow']>>): Promise<void> {
    await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'PROCESSING', attempts: { increment: 1 } } });
    try {
      const response = await fetch(this.env.N8N_EVENTS_WEBHOOK_URL!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.env.N8N_SHARED_SECRET ? { 'x-n8n-secret': this.env.N8N_SHARED_SECRET } : {}),
        },
        body: JSON.stringify({
          id: event.id,
          type: event.type,
          tenantId: event.tenantId,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          occurredAt: event.createdAt.toISOString(),
          payload: event.payload,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      const retryMinutes = Math.min(60, 2 ** Math.min(event.attempts + 1, 6));
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', lastError: message.slice(0, 500), availableAt: new Date(Date.now() + retryMinutes * 60_000) },
      });
      this.logger.error({ eventId: event.id, eventType: event.type, err: message }, 'outbox_publish_failed');
    }
  }
}
