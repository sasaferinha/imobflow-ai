import { createDemoState, type Actor } from './evolution/model';
import type { PropertyRecord } from './operations';
import { productDemoAccount } from './product-demo-data';

export const productDemoVisitActor: Actor = {
  companyId: 'product-demo-visits', brokerId: productDemoAccount.brokerId,
  name: productDemoAccount.name, role: 'owner',
};

/** Synthetic local state only. Never used by the live CRM or its transport. */
export function createProductDemoVisitState(property: PropertyRecord, now = new Date().toISOString()) {
  const state = createDemoState(productDemoVisitActor.companyId, productDemoVisitActor.brokerId, now);
  const keep = new Set(['demo-person-1', 'demo-person-2', 'demo-lead-1', 'demo-lead-2', 'demo-case-1', 'demo-case-2']);
  state.records = state.records.filter(record => keep.has(record.id)).map(record => {
    const first = record.id.endsWith('-1'), name = first ? 'Ana Martins' : 'Lucas Oliveira';
    return { ...record, data: { ...record.data,
      name: record.kind === 'people' ? name : `${first ? 'Compra' : 'Locação'} · ${name}`,
      ...(record.kind !== 'people' ? { propertyId: record.data.purpose === property.purpose ? property.id : '' } : {}),
    } };
  });
  state.members = state.members.map(member => ({ ...member, name: member.role === 'owner' ? 'Administrador' : member.id === 'demo-broker-1' ? 'Marina Alves' : 'Rafael Costa' }));
  state.records.push({ id: property.id, kind: 'properties', createdAt: now, updatedAt: now,
    createdBy: productDemoVisitActor.brokerId, data: { name: property.title,
      purpose: property.purpose, status: property.status || 'Disponível',
      assignedTo: productDemoVisitActor.brokerId, city: property.city || '',
    } });
  return state;
}
