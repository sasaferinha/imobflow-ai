import type { PerformanceSnapshot, SaleRecord } from './operations';

export type MetricRow = { broker_id: string | null; leads_received: number; converted_leads: number; recovered_leads: number; cohort_converted: number; visits: number };
export type PerformanceBroker = { id: string; name: string; active: boolean };
export type BrokerAlias = { broker_id: string; name: string };

export function performanceMonths(month: string) {
  const anchor = new Date(`${month}-01T12:00:00Z`);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(anchor); date.setUTCMonth(date.getUTCMonth() - 5 + index);
    return date.toISOString().slice(0, 7);
  });
}

export function performanceBrokerId(name: string, brokers: PerformanceBroker[], aliases: BrokerAlias[]) {
  if (name.startsWith('id:')) return brokers.some(b => b.id === name.slice(3)) ? name.slice(3) : undefined;
  const ids = new Set([...brokers.filter(b => b.name === name).map(b => b.id), ...aliases.filter(a => a.name === name).map(a => a.broker_id)]);
  return ids.size === 1 ? [...ids][0] : undefined;
}

export function buildPerformance(input: {
  month: string; companyGoal: number; brokers: PerformanceBroker[]; aliases: BrokerAlias[];
  goals: Array<{ broker: string; goal: number }>; sales: SaleRecord[]; metrics: MetricRow[]; trackingStartedAt: string;
}): PerformanceSnapshot {
  const { month, brokers, aliases } = input;
  const historyMonths = performanceMonths(month);
  const allSales = input.sales.map(sale => {
    const brokerId = sale.brokerId || performanceBrokerId(sale.broker, brokers, aliases);
    return { ...sale, brokerId, broker: brokers.find(b => b.id === brokerId)?.name || sale.broker };
  });
  const sales = allSales.filter(sale => sale.date.slice(0, 7) === month).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const soldSales = sales.filter(sale => sale.dealType !== 'Aluguel');
  const totalSold = soldSales.reduce((sum,sale) => sum + sale.amount, 0);
  const keyFor = (id: string | undefined, name: string) => id || `legacy:${name}`;
  const identities = new Map(brokers.map(b => [b.id, { brokerId:b.id, broker:b.name, active:b.active }]));
  for (const sale of allSales) if (!sale.brokerId) identities.set(keyFor(undefined,sale.broker), { brokerId:'', broker:sale.broker, active:false });
  for (const goal of input.goals) {
    const brokerId = performanceBrokerId(goal.broker, brokers, aliases);
    if (!brokerId) identities.set(keyFor(undefined,goal.broker), { brokerId:'', broker:goal.broker, active:false });
  }
  const metricsFor = (brokerId: string | null) => {
    const row = input.metrics.find(m => m.broker_id === brokerId);
    const leadsReceived = Number(row?.leads_received || 0);
    return { leadsReceived, convertedLeads:Number(row?.converted_leads || 0), recoveredLeads:Number(row?.recovered_leads || 0), visits:Number(row?.visits || 0), conversionRate:leadsReceived ? Number(row?.cohort_converted || 0) / leadsReceived * 100 : 0 };
  };
  const historyFor = (filter: (sale:SaleRecord)=>boolean) => historyMonths.map(historyMonth => ({ month:historyMonth, sold:allSales.filter(sale => sale.dealType !== 'Aluguel' && sale.date.slice(0,7) === historyMonth && filter(sale)).reduce((sum,sale) => sum + sale.amount, 0) }));
  return {
    dataMode:'live', month, companyGoal:input.companyGoal, totalSold, salesCount:soldSales.length,
    averageTicket:soldSales.length ? totalSold / soldSales.length : 0, ...metricsFor(null),
    trackingStartedAt:input.trackingStartedAt, sales, history:historyFor(() => true),
    brokers:[...identities.values()].map(identity => {
      const matches = (sale:SaleRecord) => identity.brokerId ? sale.brokerId === identity.brokerId : !sale.brokerId && sale.broker === identity.broker;
      const ownSales = soldSales.filter(matches);
      const sold = ownSales.reduce((sum,sale) => sum + sale.amount, 0);
      const goal = Number((input.goals.find(g => g.broker === `id:${identity.brokerId}`) || input.goals.find(g => identity.brokerId ? performanceBrokerId(g.broker,brokers,aliases) === identity.brokerId : g.broker === identity.broker))?.goal || 0);
      return { ...identity, brokerId:identity.brokerId || undefined, goal, sold, salesCount:ownSales.length, progress:goal ? sold / goal * 100 : 0,
        ...(identity.brokerId ? metricsFor(identity.brokerId) : { leadsReceived:0, convertedLeads:0, recoveredLeads:0, visits:0, conversionRate:0 }), history:historyFor(matches) };
    }).filter(b => b.active || b.goal || b.history.some(h => h.sold) || b.leadsReceived || b.convertedLeads || b.recoveredLeads || b.visits)
      .sort((a,b) => b.sold-a.sold || b.salesCount-a.salesCount || a.broker.localeCompare(b.broker,'pt-BR')),
  };
}
