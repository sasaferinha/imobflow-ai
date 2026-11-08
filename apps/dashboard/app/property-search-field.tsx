'use client';
import { useEffect, useRef, useState } from 'react';
import s from './property-search-field.module.css';

type Option = { id: string; name: string; detail: string; search: string };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function searchProperties(options: Option[], query: string) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (normalize(query).length < 2) return [];
  return options.filter(item => terms.every(term => normalize(`${item.name} ${item.detail} ${item.search}`).includes(term)));
}

export default function PropertySearchField({ id, value, options, onChange, required, disabled }: {
  id: string; value: string; options: Option[]; onChange: (id: string) => void; required?: boolean; disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = options.find(item => item.id === value);
  const matches = searchProperties(options, query);
  const visible = matches.slice(0, 8);
  const expanded = open && !value && !disabled;
  useEffect(() => {
    input.current?.setCustomValidity(!value && (required || query.trim()) ? 'Selecione um imóvel nos resultados da busca.' : '');
  }, [value, query, required]);
  useEffect(() => { if (expanded && active >= 0) list.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [active, expanded]);
  function choose(item: Option) { if (disabled) return; onChange(item.id); setQuery(''); setOpen(false); setActive(-1); }
  return <div className={s.field} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <div className={s.control}>
      <input ref={input} id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-results`} aria-describedby={`${id}-hint`} aria-activedescendant={expanded && active >= 0 && visible[active] ? `${id}-option-${active}` : undefined}
        required={required} disabled={disabled} value={value ? selected?.name || 'Imóvel vinculado' : query} placeholder="Buscar casa, apartamento, bairro ou código…"
        onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); onChange(''); setOpen(true); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(current => visible.length ? Math.max(0, Math.min(visible.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))) : -1); }
          if (event.key === 'Enter' && expanded) { event.preventDefault(); if (visible[active]) choose(visible[active]); }
        }} />
      {(value || query) && <button type="button" disabled={disabled} aria-label="Limpar imóvel selecionado ou pesquisa" onClick={() => { onChange(''); setQuery(''); setActive(-1); input.current?.focus(); }}>×</button>}
    </div>
    <small id={`${id}-hint`}>{value ? selected?.detail || 'Vínculo atual preservado.' : 'Digite pelo menos 2 letras para encontrar um imóvel.'}</small>
    {expanded && <div className={s.results}>
      <div ref={list} id={`${id}-results`} role="listbox" aria-label="Imóveis encontrados">
        {visible.map((item,index) => <div key={item.id} id={`${id}-option-${index}`} role="option" aria-selected={active === index} className={s.option} onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}><strong>{item.name}</strong><small>{item.detail}</small></div>)}
      </div>
      <p role="status">{query.trim().length < 2 ? 'Pesquise para ver os imóveis.' : matches.length === 0 ? 'Nenhum imóvel encontrado. Tente outro termo.' : matches.length > 8 ? `Mostrando 8 de ${matches.length}. Digite mais detalhes para refinar.` : `${matches.length} imóvel(is) encontrado(s).`}</p>
    </div>}
  </div>;
}
