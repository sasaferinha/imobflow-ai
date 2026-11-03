import type { CrmState } from './model';

export type BuyerReportFrequency = 'weekly' | 'monthly';
type Distribution = Array<{ label: string; count: number }>;
export type BuyerReportRow = {
  caseId: string; customerId: string; name: string; closedAt: string; broker: string; source: string;
  amount: number | null; property: string; propertyType: string; region: string;
  wantedRegion: string; budgetMax: number | null; financing: string; timeline: string; preferences: string;
};
export type BuyerReportPeriod = {
  key: string; start: string; end: string; current: boolean; sales: number; customers: number;
  totalAmount: number; averageAmount: number | null; missingAmount: number;
  sources: Distribution; regions: Distribution; propertyTypes: Distribution; budgets: Distribution; financing: Distribution;
  buyers: BuyerReportRow[];
};
export type BuyerReport = { frequency: BuyerReportFrequency; generatedAt: string; undatedSales: number; periods: BuyerReportPeriod[] };
const text = (value: unknown, fallback = 'Não informado') => typeof value === 'string' && value.trim() ? value.trim().slice(0, 600) : fallback;
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const distribution = (values: string[]): Distribution => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
};
const priceBand = (amount: number | null) => amount === null ? 'Não informado' : amount < 300000 ? 'Até R$ 300 mil' : amount < 600000 ? 'R$ 300 a 600 mil' : amount < 1000000 ? 'R$ 600 mil a 1 milhão' : 'R$ 1 milhão ou mais';

/** Calendar periods in São Paulo, matching the CRM's existing reporting timezone. */
export function buyerReportPeriods(frequency: BuyerReportFrequency, now = new Date()) {
  const local = new Date(now.getTime() - 3 * 3600000);
  const year = local.getUTCFullYear(), month = local.getUTCMonth(), date = local.getUTCDate();
  const monday = date - (local.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => {
    const start = frequency === 'weekly' ? new Date(Date.UTC(year, month, monday - index * 7, 3)) : new Date(Date.UTC(year, month - index, 1, 3));
    const end = frequency === 'weekly' ? new Date(start.getTime() + 7 * 86400000) : new Date(Date.UTC(year, month - index + 1, 1, 3));
    return { key: start.toISOString().slice(0, frequency === 'weekly' ? 10 : 7), start: start.toISOString(), end: end.toISOString(), current: index === 0 };
  });
}

/** Administrative report from recorded purchases only. No inferred demographic persona. */
export function buildBuyerReport(state: CrmState, frequency: BuyerReportFrequency, now = new Date()): BuyerReport {
  const records = new Map(state.records.map(record => [record.id, record]));
  const latestWin = new Map<string, string>();
  for (const event of state.events) {
    if (event.changes?.status?.to !== 'Ganho' || !Number.isFinite(Date.parse(event.at))) continue;
    if (!latestWin.has(event.recordId) || Date.parse(event.at) > Date.parse(latestWin.get(event.recordId)!)) latestWin.set(event.recordId, event.at);
  }
  let undatedSales = 0;
  const buyers: BuyerReportRow[] = [];
  for (const item of state.records) {
    if (item.kind !== 'cases' || item.data.status !== 'Ganho' || item.data.purpose !== 'Venda' || item.data.journey === 'Captação') continue;
    const date = latestWin.get(item.id) || String(item.data.closedAt || '');
    if (!Number.isFinite(Date.parse(date)) || Date.parse(date) > now.getTime()) { undatedSales++; continue; }
    const leadCandidate = records.get(String(item.data.leadId)), personCandidate = records.get(String(item.data.personId));
    const lead = leadCandidate?.kind === 'leads' ? leadCandidate : undefined, person = personCandidate?.kind === 'people' ? personCandidate : undefined;
    const propertyCandidate = records.get(String(item.data.propertyId));
    const property = propertyCandidate?.kind === 'properties' ? propertyCandidate : undefined;
    const accepted = state.records.filter(record => record.kind === 'proposals' && record.data.caseId === item.id && record.data.status === 'Aceita' && record.data.propertyId === item.data.propertyId);
    buyers.push({ caseId: item.id, customerId: person?.id || lead?.id || item.id, name: text(person?.data.name || lead?.data.name || item.data.name),
      closedAt: new Date(date).toISOString(), broker: text(state.members.find(member => member.id === item.data.assignedTo)?.name), source: text(item.data.source || lead?.data.source),
      amount: accepted.length === 1 ? money(accepted[0].data.amount) : null,
      property: text(property?.data.name), propertyType: text(property?.data.propertyType),
      region: [text(property?.data.district, ''), text(property?.data.city, '')].filter(Boolean).join(' · ') || 'Não informado',
      wantedRegion: text(lead?.data.region), budgetMax: money(lead?.data.budgetMax), financing: text(lead?.data.financing),
      timeline: text(lead?.data.purchaseTimeline), preferences: text(lead?.data.features),
    });
  }
  const periods = buyerReportPeriods(frequency, now).map(period => {
    const selected = buyers.filter(row => Date.parse(row.closedAt) >= Date.parse(period.start) && Date.parse(row.closedAt) < Date.parse(period.end)).sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt));
    const amounts = selected.flatMap(row => row.amount === null ? [] : [row.amount]);
    const totalAmount = amounts.reduce((sum, amount) => sum + amount, 0);
    return { ...period, sales: selected.length, customers: new Set(selected.map(row => row.customerId)).size,
      totalAmount, averageAmount: amounts.length ? totalAmount / amounts.length : null, missingAmount: selected.length - amounts.length,
      sources: distribution(selected.map(row => row.source)), regions: distribution(selected.map(row => row.region)),
      propertyTypes: distribution(selected.map(row => row.propertyType)), budgets: distribution(selected.map(row => priceBand(row.budgetMax))),
      financing: distribution(selected.map(row => row.financing)), buyers: selected };
  });
  return { frequency, generatedAt: now.toISOString(), undatedSales, periods };
}
