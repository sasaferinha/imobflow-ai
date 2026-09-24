'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LeadProfile } from '@/lib/leads';
import type { PropertyRecord } from '@/lib/operations';
import { filterPickerItems, type PickerItem } from '@/lib/appointment-picker';

export default function AppointmentRecordPicker({ kind, leads = [], properties = [] }: {
  kind: 'lead' | 'property'; leads?: LeadProfile[]; properties?: PropertyRecord[];
}) {
  const [open,setOpen]=useState(false);
  const [selectedId,setSelectedId]=useState('');
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('');
  const [status,setStatus]=useState('');
  const [order,setOrder]=useState('az');
  const [page,setPage]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null);
  const search=useRef<HTMLInputElement>(null);
  const titleId=useId();
  const isLead=kind==='lead';
  const label=isLead?'Cliente':'Imóvel';
  const items=useMemo<PickerItem[]>(()=>isLead ? leads.map(lead=>({
    id:lead.id,title:lead.name,detail:[lead.phone,lead.email].filter(Boolean).join(' · '),
    extra:[lead.goal,lead.region,lead.assignedTo || 'Sem corretor'].filter(Boolean).join(' · '),
    search:`${lead.phone.replace(/\D/g,'')} ${lead.propertyType}`,category:lead.goal,status:lead.lifecycleStatus,createdAt:lead.createdAt,
  })) : properties.map(property=>({
    id:property.id,title:property.title,detail:[property.code && `Cód. ${property.code}`,property.district,property.city].filter(Boolean).join(' · '),
    extra:[property.propertyType,property.price,property.purpose].filter(Boolean).join(' · '),search:property.address || '',
    category:property.purpose,status:property.status || 'Disponível',createdAt:property.createdAt,
    disabled:property.status==='Vendido'||property.status==='Alugado',
  })),[isLead,leads,properties]);
  const selected=items.find(item=>item.id===selectedId && !item.disabled);
  const filtered=useMemo(()=>filterPickerItems(items,{query,category,status,order}),[items,query,category,status,order]);
  const totalPages=Math.max(1,Math.ceil(filtered.length/20));
  const activePage=Math.min(page,totalPages-1);
  const visible=filtered.slice(activePage*20,activePage*20+20);
  useEffect(()=>{
    if(!open)return;
    const node=dialog.current;
    if(!node)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    node.showModal();search.current?.focus();
    return ()=>{node.close();document.body.style.overflow=previous;};
  },[open]);
  function begin(){setQuery('');setCategory('');setStatus('');setPage(0);setOpen(true);}
  return <div className="visit-record-field">
    <span id={`${titleId}-label`}>{label}</span>
    <button className="visit-record-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} aria-labelledby={`${titleId}-label ${titleId}-value`} onClick={begin}>
      <span id={`${titleId}-value`}>{selected?.title || `Selecionar ${isLead?'cliente':'imóvel'}`}</span>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
    </button>
    {selected && <small className="visit-record-selected-detail">{selected.detail}</small>}
    <input type="hidden" name={isLead?'name':'property'} value={selected?.title || ''}/>
    <input type="hidden" name={isLead?'leadId':'propertyId'} value={selected?.id || ''}/>
    <dialog className="visit-record-dialog" ref={dialog} aria-labelledby={titleId} onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)} onClick={event=>{if(event.target===event.currentTarget){const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)setOpen(false);}}}>
      <div className="visit-record-dialog-inner" onKeyDown={event=>{if(event.key==='Enter' && event.target instanceof HTMLInputElement)event.preventDefault();}}>
        <div className="visit-record-heading"><div><h2 id={titleId}>Selecionar {isLead?'cliente':'imóvel'}</h2><p>{isLead?'Encontre pelo nome, telefone, e-mail ou região.':'Encontre pelo nome, código, bairro ou cidade.'}</p></div><button type="button" aria-label="Fechar seleção" onClick={()=>setOpen(false)}>×</button></div>
        <label className="visit-record-search">Buscar {isLead?'cliente':'imóvel'}<input ref={search} type="search" value={query} placeholder={isLead?'Nome, telefone ou região':'Nome, código ou localização'} onChange={event=>{setQuery(event.target.value);setPage(0);}}/></label>
        <div className="visit-record-filters">
          <label>{isLead?'Objetivo':'Finalidade'}<select value={category} onChange={event=>{setCategory(event.target.value);setPage(0);}}><option value="">Todos</option>{Array.from(new Set(items.map(item=>item.category).filter(Boolean))).sort().map(value=><option key={value}>{value}</option>)}</select></label>
          <label>{isLead?'Etapa do cliente':'Situação do imóvel'}<select value={status} onChange={event=>{setStatus(event.target.value);setPage(0);}}><option value="">Todas</option>{Array.from(new Set(items.map(item=>item.status).filter(Boolean))).sort().map(value=><option key={value}>{value}</option>)}</select></label>
          <label>Ordenar por<select value={order} onChange={event=>{setOrder(event.target.value);setPage(0);}}><option value="az">Nome: A–Z</option><option value="za">Nome: Z–A</option><option value="recent">Mais recentes</option></select></label>
        </div>
        <p className="visit-record-count" role="status">{filtered.length} {filtered.length===1?'resultado':'resultados'}{!isLead?' · Vendidos e alugados não podem ser selecionados.':''}</p>
        <div className="visit-record-results">
          {visible.map(item=><button className="visit-record-result" key={item.id} type="button" disabled={item.disabled} aria-pressed={selectedId===item.id} onClick={()=>{setSelectedId(item.id);setOpen(false);}}>
            <span><strong>{item.title}</strong><small>{item.detail}</small><small>{item.extra}</small></span><span className="visit-record-result-status">{selectedId===item.id?'Selecionado':item.status}</span>
          </button>)}
          {!filtered.length && <div className="visit-record-empty"><strong>Nenhum resultado encontrado</strong><p>{items.length?'Tente outro termo ou limpe os filtros.':`Cadastre ${isLead?'um cliente':'um imóvel'} para agendar uma visita.`}</p>{items.length>0&&<button type="button" onClick={()=>{setQuery('');setCategory('');setStatus('');setPage(0);search.current?.focus();}}>Limpar filtros</button>}</div>}
        </div>
        <div className="visit-record-footer"><span>Página {activePage+1} de {totalPages}</span><div><button type="button" disabled={activePage===0} onClick={()=>setPage(activePage-1)}>Anterior</button><button type="button" disabled={activePage>=totalPages-1} onClick={()=>setPage(activePage+1)}>Próxima</button></div></div>
      </div>
    </dialog>
  </div>;
}
