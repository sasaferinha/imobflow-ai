'use client';

import { useRef, useState } from 'react';
import { applyCommand, type CrmCommand } from '@/lib/evolution/model';
import { createProductDemoVisitState, productDemoVisitActor } from '@/lib/product-demo-visits';
import type { PropertyRecord } from '@/lib/operations';
import { PropertyVisitStartPanel, VisitWorkflowPanel } from '../evolution/property-workflows';

export default function PropertyVisitDemo({ property, close }: { property: PropertyRecord; close: () => void }) {
  const [state, setState] = useState(() => createProductDemoVisitState(property));
  const current = useRef(state);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const record = state.records.find(item => item.id === property.id)!;
  const visit = state.records.find(item => item.id === selectedId && item.kind === 'tasks');
  async function execute(command: CrmCommand) {
    try {
      const next = applyCommand(current.current, productDemoVisitActor, command);
      current.current = next; setState(next); setError(''); return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível simular a visita.'); return false; }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}>
    <article className="modal-card product-demo-visit" role="dialog" aria-modal="true" aria-label={`Visita · ${property.title}`} onMouseDown={event => event.stopPropagation()}>
      <header className="modal-head"><div><p className="eyebrow">Demonstração · dados fictícios</p><h2>{property.title}</h2></div><button type="button" aria-label="Fechar visita" onClick={close}>×</button></header>
      <p>Experimente escolher o cliente, iniciar e encerrar a visita. Nada é enviado ou salvo na conta de uma imobiliária.</p>
      {visit ? <VisitWorkflowPanel key={visit.id} record={visit} canEdit busy={false} execute={execute} demonstration />
        : <PropertyVisitStartPanel record={record} state={state} actor={productDemoVisitActor} busy={false} execute={execute} onSelect={setSelectedId} demonstration />}
      {error && <p role="alert">{error}</p>}
      <footer className="modal-actions"><button type="button" onClick={close}>Fechar demonstração</button></footer>
    </article>
  </div>;
}
