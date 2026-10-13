/** Session-local timing only. No message content or customer identifiers leave the panel. */
export const REMINDER_MINUTES = [5, 15, 30, 60] as const;
export function reminderDue(lastAt: number, now: number, minutes: number) {
  return Number.isFinite(now) && REMINDER_MINUTES.some(value => value === minutes)
    && (!lastAt || now - lastAt >= minutes * 60000);
}
