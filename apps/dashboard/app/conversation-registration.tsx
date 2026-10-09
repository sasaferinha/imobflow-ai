'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { dashboardFetch, isProductDemo } from '@/lib/dashboard-transport';
import { applyCommand, canAccess, createDemoState, type Actor, type CrmRecord, type CrmState } from '@/lib/evolution/model';
import { REGISTRATION_CHANNELS, REGISTRATION_OUTCOMES, type RegistrationAction, type RegistrationCommand } from '@/lib/evolution/registration-contract';
import s from './conversation-registration.module.css';

type Props = { leadId: string; customerName: string; demonstration?: boolean; disabled?: boolean; onSaved?: () => void; notify?: (message: string) => void };
type Snapshot = { state: CrmState; actor: Actor };
type FormValues = { purpose: string; notes: string; reason: string; channel: string; outcome: string; propertyId: string; date: string; time: string; taskId: string; proposalId: string; amount: string; conditions: string; expiresAt: string; status: string; confirmed: boolean };
const options: { action: RegistrationAction; label: string; description: string; number: string }[] = [
  { action: 'lead', label: 'Lead', description: 'Manter no catálogo, aguardando atendimento', number: '01' },
  { action: 'attendance', label: 'Iniciar atendimento', description: 'Registrar o contato e seu resultado', number: '02' },
  { action: 'schedule', label: 'Agendar visita', description: 'Adicionar ou ajustar uma visita na agenda', number: '03' },
  { action: 'visit', label: 'Visita realizada', description: 'Confirmar uma visita que já aconteceu', number: '04' },
  { action: 'proposal', label: 'Proposta', description: 'Registrar os detalhes da negociação', number: '05' },
  { action: 'close', label: 'Negociado', description: 'Confirmar o fechamento de uma proposta', number: '06' },
];
const blankForm = (): FormValues => ({ purpose: '', notes: '', reason: '', channel: 'WhatsApp', outcome: 'Contato realizado', propertyId: '', date: '', time: '', taskId: '', proposalId: '', amount: '', conditions: '', expiresAt: '', status: 'Enviada', confirmed: false });
const value = (record: CrmRecord | undefined, key: string) => String(record?.data[key] || '');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = (date: string) => Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(date)) : 'Horário não informado';
function localParts(date: string) {
  if (!Number.isFinite(Date.parse(date))) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(date));
  const part = (key: string) => parts.find(item => item.type === key)?.value || '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}
function isSnapshot(input: unknown): input is Snapshot {
  if (!input || typeof input !== 'object') return false;
  const data = input as Partial<Snapshot>;
  return Boolean(data.state && Array.isArray(data.state.records) && Array.isArray(data.state.events) && Array.isArray(data.state.members) && Number.isSafeInteger(data.state.version) && data.actor?.brokerId && data.actor?.companyId);
}
function demonstrationSnapshot(leadId: string, customerName: string): Snapshot {
  const actor: Actor = { companyId: 'registration-demo', brokerId: 'registration-demo-owner', name: 'Administrador de demonstração', role: 'owner' };
  const state = createDemoState(actor.companyId, actor.brokerId);
  for (const record of state.records) {
    if (record.id === 'demo-person-1') record.data.name = customerName;
    if (record.id === 'demo-case-1') { record.id = `case:${leadId}`; record.data.name = `Demonstração · ${customerName}`; record.data.assignedTo = actor.brokerId; }
    if (record.data.caseId === 'demo-case-1') record.data.caseId = `case:${leadId}`;
  }
  return { actor, state };
}
function Icon({ chevron = false }: { chevron?: boolean }) {
  return <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{chevron ? <path d="m7 10 5 5 5-5" /> : <><path d="M9 5H5v16h14V5h-4" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="m8 14 2 2 5-5" /></>}</svg>;
}

export default function ConversationRegistration({ leadId, customerName, demonstration = false, disabled = false, onSaved, notify }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDialogElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false), busyRef = useRef(false), readSequence = useRef(0), requests = useRef(new Set<AbortController>());
  const pending = useRef<RegistrationCommand | null>(null);
  const localDemo = useRef<Snapshot | null>(null);
  const [open, setOpen] = useState(false), [action, setAction] = useState<RegistrationAction | null>(null), [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [review, setReview] = useState<'conflict' | 'uncertain' | null>(null), [checked, setChecked] = useState(false), [refreshed, setRefreshed] = useState(false);
  const [form, setForm] = useState<FormValues>(blankForm);
  const [contextAt, setContextAt] = useState(() => Date.now());
  const demo = demonstration || isProductDemo();
  const caseRecord = snapshot?.state.records.find(record => record.kind === 'cases' && record.id === `case:${leadId}`);
  const canEdit = Boolean(snapshot && caseRecord && canAccess(snapshot.state, snapshot.actor, caseRecord, 'write'));
  const editable = canEdit && value(caseRecord, 'status') === 'Aberto' && value(caseRecord, 'journey') === 'Negociação';
  const purpose = value(caseRecord, 'purpose') || form.purpose;
  const properties = snapshot?.state.records.filter(record => record.kind === 'properties' && value(record, 'purpose') === purpose && (action === 'visit' || ['Disponível', 'Reservado'].includes(value(record, 'status')))) || [];
  const visits = snapshot?.state.records.filter(record => record.kind === 'tasks' && record.data.caseId === caseRecord?.id && record.data.type === 'Visita' && ['Pendente', 'Confirmada'].includes(value(record, 'status'))) || [];
  const completedCandidates = visits.filter(record => Date.parse(value(record, 'dueAt')) <= contextAt);
  const proposals = snapshot?.state.records.filter(record => record.kind === 'proposals' && record.data.caseId === caseRecord?.id && ['Enviada', 'Em negociação'].includes(value(record, 'status'))) || [];
  const closableProposals = proposals.filter(record => {
    const property = snapshot?.state.records.find(item => item.kind === 'properties' && item.id === record.data.propertyId);
    return Boolean(snapshot && property && value(record, 'expiresAt') >= localParts(new Date().toISOString()).date && canAccess(snapshot.state, snapshot.actor, property, 'write') && ['Disponível', 'Reservado'].includes(value(property, 'status')));
  });
  const selectedProposal = proposals.find(record => record.id === form.proposalId);
  const selectedProperty = snapshot?.state.records.find(record => record.id === selectedProposal?.data.propertyId);
  const activeOption = options.find(option => option.action === action);
  const locked = saving || review === 'uncertain';

  useEffect(() => {
    mounted.current = true;
    const controllers = requests.current;
    return () => { mounted.current = false; controllers.forEach(controller => controller.abort()); controllers.clear(); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const element = menu.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const position = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      element.style.left = `${Math.max(16, Math.min(anchor.right - element.offsetWidth, window.innerWidth - element.offsetWidth - 16))}px`;
      element.style.top = `${Math.max(16, Math.min(anchor.bottom + 7, window.innerHeight - element.offsetHeight - 16))}px`;
    };
    position(); window.addEventListener('resize', position);
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => window.removeEventListener('resize', position);
  }, [open, loading]);
  useEffect(() => {
    if (action && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [action]);

  async function boundedFetch(init?: RequestInit) {
    const controller = new AbortController();
    requests.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await dashboardFetch('/api/evolution', { ...init, cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      const result: unknown = await response.json();
      return { response, result };
    }
    finally { clearTimeout(timer); requests.current.delete(controller); }
  }
  async function loadContext() {
    if (demo) { localDemo.current ??= demonstrationSnapshot(leadId, customerName); setSnapshot(localDemo.current); return localDemo.current; }
    const sequence = ++readSequence.current;
    setLoading(true);
    try {
      const { response, result } = await boundedFetch();
      if (!response.ok || !isSnapshot(result)) throw new Error(response.status === 401 ? 'Sua sessão expirou. Entre novamente para registrar.' : (result as { error?: string })?.error || 'Não foi possível carregar o atendimento. Tente novamente.');
      if (!mounted.current || sequence !== readSequence.current) return null;
      setSnapshot(result);
      return result;
    } catch (cause) {
      if (mounted.current && sequence === readSequence.current) setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'O atendimento demorou a responder. Tente carregar novamente.');
      return null;
    } finally { if (mounted.current && sequence === readSequence.current) setLoading(false); }
  }
  function openMenu() {
    if (disabled || saving) return;
    setContextAt(new Date().getTime());
    if (open) { setOpen(false); return; }
    if (pending.current && review === 'uncertain') { setAction(pending.current.action); return; }
    setOpen(true); setError(''); setSnapshot(null);
    void loadContext();
  }
  function closeDialog() {
    if (busyRef.current) return;
    dialog.current?.close(); setAction(null); setOpen(false);
    if (review !== 'uncertain') { setError(''); setReview(null); setChecked(false); setRefreshed(false); pending.current = null; }
    trigger.current?.focus();
  }
  function selectAction(next: RegistrationAction) {
    if (!editable || !caseRecord || loading) return;
    pending.current = null; setReview(null); setChecked(false); setRefreshed(false); setError('');
    setForm({ ...blankForm(), purpose: value(caseRecord, 'purpose'), propertyId: value(caseRecord, 'propertyId'), taskId: next === 'visit' && completedCandidates.length === 1 ? completedCandidates[0].id : '', proposalId: next === 'close' && closableProposals.length === 1 ? closableProposals[0].id : '' });
    setOpen(false); setAction(next);
  }
  function update<K extends keyof FormValues>(key: K, newValue: FormValues[K]) { setForm(current => ({ ...current, [key]: newValue })); }
  function menuKey(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    if (event.key === 'Tab') setOpen(false);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && buttons.length) {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[index].focus();
    }
  }
  function buildCommand(): RegistrationCommand | null {
    if (!caseRecord || !action) return null;
    const common = { ...(value(caseRecord, 'purpose') ? {} : { purpose: form.purpose as 'Venda' | 'Aluguel' }), ...(form.notes.trim() ? { notes: form.notes.trim() } : {}) };
    const base = { type: 'register' as const, caseId: caseRecord.id, requestId: crypto.randomUUID() };
    if (action === 'lead') return { ...base, action, data: { ...common, ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) } };
    if (action === 'attendance') return { ...base, action, data: { ...common, channel: form.channel as typeof REGISTRATION_CHANNELS[number], outcome: form.outcome as typeof REGISTRATION_OUTCOMES[number] } };
    if (action === 'schedule') return { ...base, action, data: { ...common, ...(form.taskId ? { taskId: form.taskId } : {}), propertyId: form.propertyId, dueAt: `${form.date}T${form.time}` } };
    if (action === 'visit') return form.taskId ? { ...base, action, data: { ...common, taskId: form.taskId } } : { ...base, action, data: { ...common, propertyId: form.propertyId, occurredAt: `${form.date}T${form.time}` } };
    if (action === 'proposal') return { ...base, action, data: { ...common, propertyId: form.propertyId, amount: Number(form.amount), conditions: form.conditions.trim(), expiresAt: form.expiresAt, status: form.status as 'Enviada' | 'Em negociação' } };
    if (!form.confirmed) return null;
    return { ...base, action, data: { ...common, proposalId: form.proposalId, confirmed: true, ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) } };
  }
  function hasSaved(result: Snapshot, command: RegistrationCommand) {
    return result.state.events.some(event => event.actorId === result.actor.brokerId && event.recordId === command.caseId && (event as typeof event & { registration?: { requestId: string } }).registration?.requestId === command.requestId);
  }
  function success() {
    pending.current = null; setReview(null); setChecked(false); setRefreshed(false); setAction(null); setOpen(false); setError(''); dialog.current?.close();
    trigger.current?.focus();
    if (!demo) onSaved?.();
    notify?.(demo ? 'Registro de demonstração atualizado apenas nesta conversa de exemplo. Nenhum dado real foi alterado.' : 'Registro salvo. O atendimento e os dados vinculados foram atualizados.');
  }
  async function checkResult() {
    if (loading || saving) return;
    setError(''); setChecked(false); setRefreshed(false);
    const fresh = await loadContext();
    if (!fresh || !mounted.current) return;
    if (review === 'uncertain' && pending.current && hasSaved(fresh, pending.current)) { success(); return; }
    setRefreshed(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || loading || !snapshot || !editable || (review && !checked)) return;
    const command = pending.current || buildCommand();
    if (!command) return;
    pending.current = command; busyRef.current = true; setSaving(true); setError('');
    try {
      if (demo) {
        try {
          const updated = { ...snapshot, state: applyCommand(snapshot.state, snapshot.actor, command) };
          localDemo.current = updated; setSnapshot(updated); success();
        } catch (cause) { pending.current = null; setError(cause instanceof Error ? cause.message : 'Confira os dados da demonstração.'); }
        return;
      }
      const { response, result } = await boundedFetch({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, expectedVersion: snapshot.state.version, expectedSourceRevision: snapshot.state.sourceRevision }) });
      if (!mounted.current) return;
      if (response.ok && isSnapshot(result)) { setSnapshot(result); success(); return; }
      if (response.status === 409) {
        setChecked(false); setRefreshed(false); setError((result as { error?: string })?.error || 'O atendimento foi atualizado por outra pessoa. Confira os dados antes de salvar.');
        const fresh = await loadContext();
        if (!mounted.current) return;
        if (fresh && hasSaved(fresh, command)) { success(); return; }
        if (fresh) { pending.current = null; setReview('conflict'); setRefreshed(true); }
        else { setReview('uncertain'); setError('Não foi possível conferir o atendimento atualizado. Verifique o resultado antes de confirmar o mesmo registro.'); }
      }
      else if (response.status >= 500 || response.ok) { setReview('uncertain'); setChecked(false); setRefreshed(false); setError('Não foi possível confirmar o resultado. Verifique o atendimento antes de tentar confirmar novamente.'); }
      else { pending.current = null; setReview(null); setError((result as { error?: string })?.error || 'Não foi possível registrar. Confira os campos e tente novamente.'); }
    } catch {
      if (mounted.current) { setReview('uncertain'); setChecked(false); setRefreshed(false); setError('A conexão foi interrompida. O registro pode ter sido salvo; verifique o resultado antes de continuar.'); }
    } finally { busyRef.current = false; if (mounted.current) setSaving(false); }
  }
  const unavailable = snapshot && (!caseRecord ? 'O atendimento ainda não está disponível na sua carteira. Assuma o atendimento pelo controle da conversa ou peça ao administrador para conferir o vínculo.' : !canEdit ? 'Este atendimento está disponível apenas para consulta na sua conta.' : !editable ? 'Este atendimento não está aberto para negociação. Revise a situação na aba Atendimentos.' : '');
  const emptyAction = action === 'close' && !closableProposals.length ? proposals.length ? 'Nenhuma proposta pode ser fechada agora. Confira a validade, a disponibilidade do imóvel e sua permissão para alterá-lo; se necessário, peça ajuda ao administrador.' : 'Registre uma proposta enviada ou em negociação antes de confirmar o fechamento.' : '';
  const propertySelect = <label className={s.field}>Imóvel<select required value={form.propertyId} onChange={event => update('propertyId', event.target.value)}><option value="">Selecione o imóvel</option>{properties.map(record => <option key={record.id} value={record.id}>{value(record, 'code') ? `${value(record, 'code')} · ` : ''}{value(record, 'name')}{record.data.status === 'Reservado' ? ' · Reservado' : ''}</option>)}</select>{!properties.length && <small>Não há imóveis disponíveis para esta finalidade.</small>}</label>;

  return <div className={s.root} ref={root}>
    <button ref={trigger} className={s.trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`} onClick={openMenu} disabled={disabled || saving}><Icon />Registro<Icon chevron /></button>
    {open && <dialog className={s.menu} ref={menu} aria-label="Opções de registro" onCancel={event => { event.preventDefault(); setOpen(false); trigger.current?.focus(); }} onClick={event => { if (event.target === menu.current) { const bounds = menu.current.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) { setOpen(false); trigger.current?.focus(); } } }}><div id={`${id}-menu`} role="menu" aria-label="Registrar acontecimento" onKeyDown={menuKey}>
      <div className={s.menuHeader}><strong>Registrar acontecimento</strong><span>{customerName}</span></div>
      <>
        {demo && <p className={s.demoNotice} role="status">Exemplo interativo. Os registros ficam apenas nesta conversa de demonstração, até você sair dela.</p>}
        {loading && <p className={s.menuMessage} role="status">Carregando atendimento…</p>}
        {error && <p className={s.menuMessage} role="alert">{error}</p>}
        {unavailable && <p className={s.menuMessage} role="status">{unavailable}</p>}
        {options.map(option => <button key={option.action} type="button" role="menuitem" className={s.menuItem} disabled={!editable || loading} onClick={() => selectAction(option.action)}><span className={s.step}>{option.number}</span><span><strong>{option.label}</strong><small>{option.description}</small></span></button>)}
        {!loading && !snapshot && <button type="button" role="menuitem" className={s.reload} onClick={() => { setError(''); void loadContext(); }}>Tentar carregar novamente</button>}
      </>
      <p className={s.menuFoot}>Nenhuma mensagem é enviada ao cliente.</p>
    </div></dialog>}
    {action && <dialog ref={dialog} className={s.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); closeDialog(); }} onClick={event => { if (event.target === dialog.current) { const bounds = dialog.current.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(); } }}>
      <form onSubmit={submit}>
        <div className={s.dialogHeader}><div><span className={s.eyebrow}>{demo ? 'Registro de demonstração' : 'Registro da conversa'}</span><h2 id={`${id}-title`}>{activeOption?.label}</h2></div><button type="button" className={s.close} aria-label="Fechar registro" onClick={closeDialog} disabled={saving}>×</button></div>
        <div className={s.body}>
          <div className={s.context}><span className={s.customerIcon} aria-hidden="true">{customerName.trim().charAt(0).toLocaleUpperCase('pt-BR')}</span><div><strong>{customerName}</strong><span>{snapshot?.state.members.find(member => member.id === caseRecord?.data.assignedTo)?.name || 'Sem responsável definido'} · Etapa atual: <b>{value(caseRecord, 'stage')}</b></span></div></div>
          <p id={`${id}-description`} className={s.description}>{demo ? 'Teste o registro com dados fictícios. A etapa e as opções serão atualizadas apenas aqui, sem alterar a agenda real ou enviar mensagens.' : 'Confirme o que aconteceu. O histórico e os registros relacionados serão atualizados, sem enviar mensagens.'}</p>
          {error && <p className={s.error} role="alert">{error}</p>}
          {review && <div className={s.review}><p>{review === 'uncertain' ? 'O formulário está preservado. Verifique se o registro já foi salvo; se necessário, confirme novamente a mesma solicitação, sem duplicá-la.' : 'Mantivemos o que você preencheu. A etapa acima foi atualizada; revise os campos antes de confirmar novamente.'}</p><button type="button" className={s.secondary} disabled={saving || loading} onClick={checkResult}>{loading ? 'Verificando…' : 'Verificar dados atualizados'}</button>{refreshed && <label className={s.check}><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />Conferi os dados atualizados e desejo confirmar este registro.</label>}</div>}
          {emptyAction && <p className={s.notice} role="status">{emptyAction}</p>}
          <fieldset disabled={locked || loading} className={s.fields}>
            {!value(caseRecord, 'purpose') && <label className={s.field}>Finalidade<select required value={form.purpose} onChange={event => { update('purpose', event.target.value); update('propertyId', ''); }}><option value="">Selecione</option><option>Venda</option><option>Aluguel</option></select><small>Será registrada no cadastro deste atendimento.</small></label>}
            {action === 'lead' && <><p className={s.notice}>{value(caseRecord, 'stage') === 'Lead' ? 'O contato continuará no catálogo, aguardando atendimento.' : 'O atendimento voltará à etapa Lead. Agendamentos e propostas anteriores não serão apagados.'}</p>{value(caseRecord, 'stage') !== 'Lead' && <label className={s.field}>Motivo do retorno ao catálogo<textarea required maxLength={500} rows={2} value={form.reason} onChange={event => update('reason', event.target.value)} /></label>}</>}
            {action === 'attendance' && <><div className={s.twoColumns}><label className={s.field}>Canal<select required value={form.channel} onChange={event => update('channel', event.target.value)}>{REGISTRATION_CHANNELS.map(channel => <option key={channel}>{channel}</option>)}</select></label><label className={s.field}>Resultado<select required value={form.outcome} onChange={event => update('outcome', event.target.value)}>{REGISTRATION_OUTCOMES.map(outcome => <option key={outcome}>{outcome}</option>)}</select></label></div><p className={s.notice}>{form.outcome === 'Tentativa sem resposta' ? 'A tentativa ficará no histórico, sem confirmar uma conversa com o cliente.' : 'O contato será registrado. Etapas mais avançadas da negociação serão preservadas.'}</p></>}
            {action === 'schedule' && <>{visits.length > 0 && <label className={s.field}>Agendamento<select value={form.taskId} onChange={event => { const task = visits.find(item => item.id === event.target.value); setForm(current => ({ ...current, taskId: event.target.value, ...(task ? { ...localParts(value(task, 'dueAt')), propertyId: value(task, 'propertyId') } : { date: '', time: '' }) })); }}><option value="">Criar nova visita</option>{visits.map(task => <option key={task.id} value={task.id}>Reagendar · {dateTime(value(task, 'dueAt'))} · {value(snapshot?.state.records.find(record => record.id === task.data.propertyId), 'name') || value(task, 'name')}</option>)}</select></label>}{propertySelect}<div className={s.twoColumns}><label className={s.field}>Data da visita<input type="date" required min={localParts(new Date().toISOString()).date} value={form.date} onChange={event => update('date', event.target.value)} /></label><label className={s.field}>Horário<input type="time" required value={form.time} onChange={event => update('time', event.target.value)} /></label></div><p className={s.hint}>Horário de Brasília. O responsável atual do atendimento será mantido.</p></>}
            {action === 'visit' && <><label className={s.field}>Visita realizada<select value={form.taskId} onChange={event => update('taskId', event.target.value)}><option value="">Registrar visita sem agendamento anterior</option>{completedCandidates.map(task => <option key={task.id} value={task.id}>{dateTime(value(task, 'dueAt'))} · {value(snapshot?.state.records.find(record => record.id === task.data.propertyId), 'name') || value(task, 'name')}</option>)}</select></label>{!form.taskId && <>{propertySelect}<div className={s.twoColumns}><label className={s.field}>Data em que aconteceu<input type="date" required max={localParts(new Date().toISOString()).date} value={form.date} onChange={event => update('date', event.target.value)} /></label><label className={s.field}>Horário da visita<input type="time" required value={form.time} onChange={event => update('time', event.target.value)} /></label></div></>}<p className={s.hint}>Confirme apenas visitas já realizadas. Horário de Brasília.</p></>}
            {action === 'proposal' && <>{propertySelect}<div className={s.twoColumns}><label className={s.field}>Valor proposto (R$)<input type="number" min="0.01" max="1000000000000" step="0.01" required value={form.amount} onChange={event => update('amount', event.target.value)} /></label><label className={s.field}>Validade<input type="date" required min={localParts(new Date().toISOString()).date} value={form.expiresAt} onChange={event => update('expiresAt', event.target.value)} /></label></div><label className={s.field}>Situação<select value={form.status} onChange={event => update('status', event.target.value)}><option>Enviada</option><option>Em negociação</option></select></label><label className={s.field}>Condições da proposta<textarea required maxLength={2000} rows={3} placeholder="Forma de pagamento, condições e pontos combinados" value={form.conditions} onChange={event => update('conditions', event.target.value)} /></label></>}
            {action === 'close' && !emptyAction && <><label className={s.field}>Proposta aceita<select required value={form.proposalId} onChange={event => { update('proposalId', event.target.value); update('confirmed', false); }}><option value="">Selecione a proposta</option>{closableProposals.map(proposal => <option key={proposal.id} value={proposal.id}>{money.format(Number(proposal.data.amount))} · {value(snapshot?.state.records.find(record => record.id === proposal.data.propertyId), 'name') || value(proposal, 'name')} · {dateTime(proposal.createdAt)}</option>)}</select></label>{selectedProposal && <div className={s.proposalSummary}><strong>{money.format(Number(selectedProposal.data.amount))}</strong><span>Validade: {value(selectedProposal, 'expiresAt').split('-').reverse().join('/')}</span><p>{value(selectedProposal, 'conditions')}</p></div>}<div className={s.notice}><strong>Confirmação de fechamento</strong><p>A proposta será aceita, o atendimento ficará como Negociado e o imóvel {selectedProperty ? `“${value(selectedProperty, 'name')}” ` : ''}será marcado como {purpose === 'Aluguel' ? 'alugado' : 'vendido'}. Nenhum lançamento financeiro será criado. O resultado confirmado não pode ser desfeito por este botão.</p></div><label className={s.check}><input type="checkbox" required checked={form.confirmed} onChange={event => update('confirmed', event.target.checked)} />Confirmo que a negociação foi concluída e os dados estão corretos.</label></>}
            {!emptyAction && <label className={s.field}>Observação <span className={s.optional}>(opcional)</span><textarea maxLength={2000} rows={2} value={form.notes} onChange={event => update('notes', event.target.value)} placeholder="Acrescente um detalhe para o histórico" /></label>}
          </fieldset>
        </div>
        <div className={s.formActions}><button type="button" className={s.secondary} onClick={closeDialog} disabled={saving}>Cancelar</button><button type="submit" className={s.primary} disabled={saving || loading || !editable || Boolean(emptyAction) || Boolean(review && !checked)}>{saving ? 'Salvando…' : review === 'uncertain' ? 'Confirmar o mesmo registro' : action === 'close' ? 'Confirmar fechamento' : 'Salvar registro'}</button></div>
      </form>
    </dialog>}
  </div>;
}
