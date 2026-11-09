'use client';

import { useEffect, useRef } from 'react';
import DashboardClient, { type DashboardView } from '../dashboard-client';
import EvolutionClient, { type OperationalPage } from './evolution-client';
import type { Actor, CrmState } from '@/lib/evolution/model';
import { announceDashboardChange } from '@/lib/dashboard-sync';

type LiveActor = Actor & { company?: string };
const VIEWS: Record<OperationalPage, DashboardView> = {
  conversations: 'conversations', opportunities: 'opportunities', appointments: 'agenda',
  imports: 'imports', integrations: 'integrations', account: 'overview', brokers: 'overview',
  results: 'overview', 'operational-goals': 'goals', portfolio: 'properties', 'customer-base': 'leads',
};
const PAGES: Record<DashboardView, OperationalPage> = {
  conversations: 'conversations', opportunities: 'opportunities', agenda: 'appointments',
  imports: 'imports', integrations: 'integrations', overview: 'results', goals: 'operational-goals',
  properties: 'portfolio', leads: 'customer-base',
};

function OperationalPanel({ actor, page, refreshKey, onNavigate, onOpenProperty }: { actor: LiveActor; page: OperationalPage; refreshKey: number; onNavigate: (page: OperationalPage) => void; onOpenProperty: (id: string) => void }) {
  const lastRefresh = useRef(refreshKey);
  useEffect(() => {
    if (lastRefresh.current === refreshKey) return;
    lastRefresh.current = refreshKey;
    // Invalidate remote reads without remounting the conversation reducer or forms.
    for (const entity of ['leads', 'conversations', 'properties', 'appointments', 'opportunities', 'performance']) announceDashboardChange(entity);
  }, [refreshKey]);
  const account = { brokerId: actor.brokerId, name: actor.name, company: actor.company || 'ImobFlow', role: actor.role };
  return <DashboardClient account={account} embedded initialView={VIEWS[page]}
    onVisitProperty={property => onOpenProperty(property.id)}
    initialUtility={page === 'account' ? 'profile' : page === 'brokers' ? 'team' : null}
    onViewChange={view => { if (view !== VIEWS[page]) onNavigate(PAGES[view]); }} />;
}

/** The isolated preview never imports this production-only client boundary. */
export default function LiveEvolutionClient({ initialState, actor, integrated = false, initialPage }: { initialState: CrmState; actor: LiveActor; integrated?: boolean; initialPage?: 'integrations' | 'settings' }) {
  return <EvolutionClient initialState={initialState} actor={actor} mode="live" integrated={integrated} initialPage={initialPage}
    renderOperationalPanel={(page, refreshKey, onNavigate, onOpenProperty) => <OperationalPanel actor={actor} page={page} refreshKey={refreshKey} onNavigate={onNavigate} onOpenProperty={onOpenProperty} />}
  />;
}
