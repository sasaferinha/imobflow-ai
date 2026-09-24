'use client';
import { dashboardFetch as fetch } from '@/lib/dashboard-transport';
import { useEffect, useState } from 'react';
import type { Opportunity, ReactivationLead } from '@/lib/opportunities';
import { announceDashboardChange, subscribeDashboardSync } from '@/lib/dashboard-sync';
import styles from './opportunity-center.module.css';

export async function actOnOpportunity(id: string, action: string) {
  const response = await fetch('/api/opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
  const body = await response.json() as { error?: string; data?: { message?: string; url?: string } };
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a ação.');
  announceDashboardChange('opportunities');
  return body.data || {};
}
export default function OpportunityCenter({ onLead, onProperty, focusedId }: {
  onLead: (id: string) => void; onProperty: (id: string) => void; focusedId?: string;
}) {
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<{ id: string; message: string; url: string } | null>(null);
  useEffect(() => subscribeDashboardSync({ entities: ['opportunities','leads','properties'], interval: 30000,
    load: async signal => {
      const response = await fetch(`/api/opportunities?offset=${offset}`, { signal, cache: 'no-store' });
      const body = await response.json() as { error?: string; data?: Opportunity[] };
      if (!response.ok) throw new Error(body.error);
      return body.data || [];
    }, apply: data => { setItems(data); setError(''); }, onError: () => setError('Não foi possível carregar as oportunidades. Tente novamente.') }), [offset]);
  useEffect(() => { if (focusedId) document.getElementById(`opportunity-${focusedId}`)?.scrollIntoView({ block: 'center' }); }, [focusedId, items]);
  async function act(id: string, action: string) {
    setPending(true); setError(''); setDraft(null);
    try {
      const result = await actOnOpportunity(id, action);
      if (action === 'draft' && result.message && result.url) setDraft({ id, message: result.message, url: result.url });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha na operação.'); }
    finally { setPending(false); }
  }
  const money = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
  return <div className={styles.center}>
    <ReactivationLeads onLead={onLead}/>
    <h2 className={styles.reactivationTitle}>Imóveis compatíveis</h2>
    <div className={styles.intro}>
      <p>Imóveis que combinam com o que seus clientes procuram.</p>
      {items && <span>{items.length} {items.length === 1 ? 'oportunidade nesta página' : 'oportunidades nesta página'}</span>}
    </div>
    {error && <p role="alert" className={styles.warning}>{error}</p>}
    {!items && !error && <p role="status" className={styles.empty}>Carregando oportunidades…</p>}
    {items?.length === 0 && <section className={styles.empty}><h2>Nenhuma oportunidade por aqui</h2><p>Quando objetivo, tipo de imóvel, região e orçamento combinarem, a oportunidade aparecerá aqui.</p></section>}
    <div className={styles.grid}>{items?.map(item => <article className={styles.card} key={item.id} id={`opportunity-${item.id}`} aria-labelledby={`opportunity-title-${item.id}`}>
      <header className={styles.header}>
        <div className={styles.person}>
          <span className={styles.avatar} aria-hidden="true">{item.leadName.trim().slice(0, 1).toLocaleUpperCase('pt-BR')}</span>
          <div><span className={styles.eyebrow}>Cliente</span><h2 id={`opportunity-title-${item.id}`}>{item.leadName}</h2></div>
        </div>
        <span className={styles.status} data-contacted={item.status === 'contacted'}>{item.status === 'contacted' ? 'Contato realizado' : 'A revisar'}</span>
      </header>
      <div className={styles.property}>
        <span className={styles.eyebrow}>Imóvel compatível</span>
        <h3>{item.propertyTitle}</h3>
        <p>{[item.district, item.city].filter(Boolean).join(', ')}</p>
        <div className={styles.propertyDetails}>
          <strong>{money(item.price)}</strong>
          <span>{item.bedrooms} quartos <span aria-hidden="true">·</span> {item.parkingSpaces ?? '—'} vagas</span>
        </div>
      </div>
      <div className={styles.compatibility}>
        <span className={styles.eyebrow}>Por que combina</span>
        <ul>{item.reasons.map(reason => <li key={reason}><span aria-hidden="true">✓</span>{reason}</li>)}</ul>
      </div>
      <p className={styles.meta}>{item.assignedTo || 'Sem corretor responsável'}<span aria-hidden="true"> · </span>{item.inactivityDays === 0 ? 'Contato recente' : `Sem contato há ${item.inactivityDays} ${item.inactivityDays === 1 ? 'dia' : 'dias'}`}</p>
      <div className={styles.actions}>
        <div className={styles.links}>
          <button type="button" onClick={() => onLead(item.leadId)}>Ver lead <span aria-hidden="true">↗</span></button>
          <button type="button" onClick={() => onProperty(item.propertyId)}>Ver imóvel <span aria-hidden="true">↗</span></button>
        </div>
        <button className={styles.primary} type="button" disabled={pending} aria-expanded={draft?.id === item.id} onClick={() => void act(item.id, 'draft')}>Preparar mensagem <span aria-hidden="true">→</span></button>
      </div>
      {draft?.id === item.id && <div className={styles.review}>
        <div className={styles.reviewHeading}><label htmlFor={`opportunity-message-${item.id}`}>Mensagem para o cliente</label><button type="button" aria-label="Fechar mensagem" onClick={() => setDraft(null)}>×</button></div>
        <textarea id={`opportunity-message-${item.id}`} readOnly rows={4} value={draft.message}/>
        <a className={styles.primary} href={draft.url} target="_blank" rel="noopener noreferrer">Continuar no WhatsApp <span aria-hidden="true">↗</span></a>
        <p>Após enviar no WhatsApp, registre o contato abaixo.</p>
      </div>}
      <footer className={styles.workflow}>
        <button type="button" disabled={pending || item.status === 'contacted'} onClick={() => void act(item.id, 'contacted')}>{item.status === 'contacted' ? 'Contato registrado' : 'Registrar contato'}</button>
        <button type="button" disabled={pending} onClick={() => void act(item.id, 'converted')}>Marcar como convertida</button>
        <button className={styles.dismiss} type="button" disabled={pending} onClick={() => void act(item.id, 'dismissed')}>Descartar</button>
      </footer>
    </article>)}</div>
    {(offset > 0 || items?.length === 50) && <nav className={styles.pagination} aria-label="Páginas de oportunidades"><button type="button" disabled={offset === 0} onClick={() => { setDraft(null); setOffset(Math.max(0, offset-50)); }}>Anterior</button>
      <span>Página {offset/50+1}</span><button type="button" disabled={items?.length !== 50} onClick={() => { setDraft(null); setOffset(offset+50); }}>Próxima</button></nav>}
  </div>;
}

function ReactivationLeads({ onLead }: { onLead: (id: string) => void }) {
  const [page, setPage] = useState<{ data: ReactivationLead[]; hasMore: boolean } | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => subscribeDashboardSync({ entities: ['leads','conversations','opportunities'], interval: 30000,
    load: async signal => {
      const response = await fetch(`/api/opportunities?mode=inactive&offset=${offset}`, { signal, cache: 'no-store' });
      const body = await response.json() as { error?: string; data: ReactivationLead[]; hasMore: boolean };
      if (!response.ok) throw new Error(body.error);
      return body as { data: ReactivationLead[]; hasMore: boolean };
    }, apply: data => { setPage(data); setError(''); }, onError: () => {
      setPage(null); setError('Não foi possível verificar os contatos. Tente novamente.');
    } }), [offset]);
  function paginate(next: number) { setPage(null); setError(''); setOffset(next); }
  return <section className={styles.reactivationSection} aria-label="Automação de retomada de contato">
    <div className={styles.intro}><div><h2 className={styles.reactivationTitle}>Retome boas conversas</h2>
      <p>Leads abertos com 15 dias ou mais sem contato registrado. A lista é atualizada automaticamente.</p></div>
    </div>
    <p className={styles.meta}>Considera mensagens recebidas, envios confirmados e contatos registrados. Sem histórico, conta desde o cadastro. Não envia mensagens automaticamente.</p>
    {error && <p role="alert" className={styles.warning}>{error}</p>}
    {!page && !error && <p role="status" className={styles.empty}>Verificando contatos…</p>}
    {page?.data.length === 0 && <div className={styles.empty}><h2>Nenhum contato pendente por aqui</h2><p>Leads convertidos ou perdidos não entram nesta lista.</p></div>}
    <div className={styles.reactivationList}>{page?.data.map(lead => <article className={styles.reactivationRow} key={lead.id}>
      <div><h3>{lead.name}</h3><p>{[lead.goal, lead.propertyType, lead.region].filter(Boolean).join(' · ') || 'Preferências ainda não informadas'}</p>
        <p>{lead.assignedTo || 'Sem corretor responsável'}</p></div>
      <div className={styles.reactivationAge}><strong>{lead.inactivityDays} dias</strong><span>{lead.lastContactAt ? 'sem contato registrado' : 'desde o cadastro, sem contato'}</span></div>
      <button type="button" className={styles.primary} onClick={() => onLead(lead.id)}>Ver lead <span aria-hidden="true">↗</span></button>
    </article>)}</div>
    {page && (offset > 0 || page.hasMore) && <nav className={styles.pagination} aria-label="Páginas de leads sem contato">
      <button type="button" disabled={offset === 0} onClick={() => paginate(Math.max(0,offset-50))}>Anterior</button>
      <span>Página {offset/50+1}</span><button type="button" disabled={!page.hasMore} onClick={() => paginate(offset+50)}>Próxima</button>
    </nav>}
  </section>;
}
