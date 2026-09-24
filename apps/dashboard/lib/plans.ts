export const plans = {
  basic: { name: 'Basic', brokers: 5 },
  plus: { name: 'Plus', brokers: 8 },
  pro: { name: 'Pro', brokers: 12 },
} as const;
export type PlanId = keyof typeof plans;
export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(plans, value);
}
export function planNameForLimit(limit: number) {
  return Object.values(plans).find(plan => plan.brokers === limit)?.name || 'Personalizado';
}
