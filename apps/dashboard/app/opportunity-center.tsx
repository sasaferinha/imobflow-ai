'use client';
import { useEffect, useState } from 'react';
import type { Opportunity } from '@/lib/opportunities';
import { announceDashboardChange, subscribeDashboardSync } from '@/lib/dashboard-sync';

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
  return <div className="automation-center">
    <p>Confira os matches e revise a mensagem. O envio é feito por você no WhatsApp.</p>
    {error && <p role="alert" className="automation-warning">{error}</p>}
    {!items && !error && <p role="status">Carregando oportunidades…</p>}
    {items?.length === 0 && <section className="panel empty-live-data"><h2>Nenhuma oportunidade disponível</h2><p>Os matches aparecem quando um imóvel combina com o perfil de um lead inativo. Confira cidade, bairro, orçamento e quartos no cadastro.</p></section>}
    <div className="automation-grid">{items?.map(item => <article className="panel automation-card" key={item.id} id={`opportunity-${item.id}`}>
      <h2>{item.score >= 90 ? '🔥 ' : ''}{item.leadName}</h2>
      <strong>{item.score}% de compatibilidade · {item.score >= 90 ? 'Match forte' : 'Match possível'}</strong>
      <p>Sem contato há {item.inactivityDays} dias · {item.assignedTo || 'Sem corretor responsável'}</p>
      <h3>{item.propertyTitle}</h3><p>{item.district}, {item.city} · {money(item.price)}</p>
      <p>{item.bedrooms} quartos · {item.parkingSpaces ?? 'Não informado'} vagas</p>
      <ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      <p>{item.status === 'contacted' ? 'Contato registrado pelo corretor' : 'Aguardando revisão'}</p>
      <footer><div>
        <button type="button" onClick={() => onLead(item.leadId)}>Ver lead</button>
        <button type="button" onClick={() => onProperty(item.propertyId)}>Ver imóvel</button>
        <button type="button" disabled={pending} onClick={() => void act(item.id, 'draft')}>Abrir WhatsApp</button>
        <button type="button" disabled={pending} onClick={() => void act(item.id, 'dismissed')}>Descartar</button>
        <button type="button" disabled={pending} onClick={() => void act(item.id, 'contacted')}>Registrar contato feito</button>
        <button type="button" disabled={pending} onClick={() => void act(item.id, 'converted')}>Marcar como convertida</button>
      </div></footer>
      {draft?.id === item.id && <div className="match-review"><label>Revise a mensagem<textarea readOnly rows={5} value={draft.message}/></label>
        <a className="primary-button" href={draft.url} target="_blank" rel="noopener noreferrer">Continuar no WhatsApp</a>
        <p>Abrir o WhatsApp não registra uma mensagem enviada.</p></div>}
    </article>)}</div>
    <div><button type="button" disabled={offset === 0} onClick={() => { setDraft(null); setOffset(Math.max(0, offset-50)); }}>Anterior</button>
      <span> Página {offset/50+1} </span><button type="button" disabled={items?.length !== 50} onClick={() => { setDraft(null); setOffset(offset+50); }}>Próxima</button></div>
  </div>;
}
