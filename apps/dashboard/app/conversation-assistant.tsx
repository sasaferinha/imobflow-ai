'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { dashboardFetch, isProductDemo } from '@/lib/dashboard-transport';
import type { BrokerAssistance, AssistantField, AssistantSector } from '@/lib/ai/broker-assistant';
import type { CrmRecord } from '@/lib/evolution/model';
import s from './conversation-assistant.module.css';

type Result = { assistance: BrokerAssistance; review: { record: CrmRecord; expectedVersion: number; expectedSourceRevision?: string }; messageCount: number };
type Props = { leadId: string; customerName: string; demonstration?: boolean; disabled?: boolean; onUseReply: (text: string) => void; onSaved?: () => void; notify?: (message: string) => void };
const labels: Record<AssistantField, string> = { purpose: 'Finalidade', propertyType: 'Tipo de imóvel', region: 'Região desejada', budgetMin: 'Orçamento mínimo', budgetMax: 'Orçamento máximo', features: 'Preferências' };
const showValue = (value: unknown, field: AssistantField) => value === '' || value == null ? 'Não informado' : field === 'budgetMin' || field === 'budgetMax' ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value)) : String(value);
function demoResult(leadId: string): Result {
  return { messageCount: 1, assistance: {
    reply: 'Olá! Para eu separar as opções mais adequadas, qual faixa de valor você pretende investir e quantos quartos procura?',
    explanation: 'Exemplo simulado: nenhuma conversa real foi analisada. Na operação real, cada sugestão de cadastro vem acompanhada do trecho informado pelo cliente.',
    changes: [{ field: 'region', value: 'Centro', messageId: 'demo-evidence', evidence: 'Procuro um apartamento no Centro.' }],
    missing: ['budgetMax'],
  }, review: { expectedVersion: 0, record: { id: `lead:${leadId}`, kind: 'leads', data: { region: '' }, createdAt: '', updatedAt: '', createdBy: '' } } };
}
function isResult(value: unknown): value is Result {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<Result>;
  return Boolean(row.assistance && typeof row.assistance.reply === 'string' && Array.isArray(row.assistance.changes) && Array.isArray(row.assistance.missing)
    && row.review?.record?.kind === 'leads' && row.review.record.data && Number.isSafeInteger(row.review.expectedVersion));
}

export default function ConversationAssistant({ leadId, customerName, demonstration = false, disabled = false, onUseReply, onSaved, notify }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null), request = useRef<AbortController | null>(null);
  const mounted = useRef(false), sequence = useRef(0), busy = useRef(false);
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [sector, setSector] = useState<AssistantSector>('automatic'), [result, setResult] = useState<Result | null>(null);
  const [reply, setReply] = useState(''), [selected, setSelected] = useState<AssistantField[]>([]), [error, setError] = useState(''), [saved, setSaved] = useState(false), [refreshRequired, setRefreshRequired] = useState(false);
  const demo = demonstration || isProductDemo();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { if (open && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [open]);
  function close() {
    if (saving) return;
    sequence.current++; request.current?.abort(); busy.current = false; setLoading(false);
    dialog.current?.close(); setOpen(false); trigger.current?.focus();
  }
  async function analyze() {
    if (busy.current) return;
    busy.current = true; const current = ++sequence.current;
    setLoading(true); setError(''); setResult(null); setSelected([]); setSaved(false); setRefreshRequired(false);
    const controller = new AbortController(); request.current = controller;
    try {
      let data: unknown;
      if (demo) data = demoResult(leadId);
      else {
        const response = await dashboardFetch('/api/conversations/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ leadId, sector }) });
        data = await response.json();
        if (!response.ok) throw new Error((data as { error?: string })?.error || 'Não foi possível analisar a conversa.');
      }
      if (!isResult(data) || data.review.record.id !== `lead:${leadId}`) throw new Error('A análise recebida é inválida. Nenhum dado foi alterado.');
      if (mounted.current && current === sequence.current) { setResult(data); setReply(data.assistance.reply); }
    } catch (failure) { if (mounted.current && current === sequence.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Não foi possível analisar a conversa.'); }
    finally { if (mounted.current && current === sequence.current) { setLoading(false); busy.current = false; } }
  }
  async function saveProfile() {
    if (!result || !selected.length || busy.current || saved || refreshRequired) return;
    busy.current = true; setSaving(true); setError('');
    const current = ++sequence.current, controller = new AbortController(); request.current = controller;
    const changes = Object.fromEntries(result.assistance.changes.filter(change => selected.includes(change.field)).map(change => [change.field, change.value]));
    try {
      if (!demo) {
        const response = await dashboardFetch('/api/evolution', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ expectedVersion: result.review.expectedVersion, expectedSourceRevision: result.review.expectedSourceRevision,
            command: { type: 'save', kind: 'leads', id: result.review.record.id, data: { ...result.review.record.data, ...changes } } }),
        });
        const data = await response.json() as { state?: { records?: CrmRecord[] }; error?: string };
        if (!response.ok) throw new Error(data.error || 'Não foi possível confirmar a atualização.');
        if (!data.state?.records?.some(record => record.id === result.review.record.id && Object.entries(changes).every(([key, value]) => record.data[key] === value))) throw new Error('Não foi possível confirmar os dados salvos. Confira a ficha antes de repetir.');
      }
      if (mounted.current && current === sequence.current) {
        setSaved(true); setResult({ ...result, review: { ...result.review, record: { ...result.review.record, data: { ...result.review.record.data, ...changes } } } });
        if (!demo) onSaved?.();
        notify?.(demo ? 'Alteração simulada. Nenhum cadastro real foi modificado.' : 'Ficha atualizada com os dados que você revisou.');
      }
    } catch (failure) {
      if (mounted.current && current === sequence.current) { setRefreshRequired(true); setError(`${failure instanceof Error ? failure.message : 'Não foi possível confirmar a atualização.'} Confira a ficha ou analise novamente antes de tentar salvar.`); }
    } finally { if (mounted.current && current === sequence.current) { setSaving(false); busy.current = false; } }
  }
  return <div className={s.root}>
    <button type="button" className={s.trigger} ref={trigger} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /></svg>Assistente
    </button>
    {open && <dialog ref={dialog} className={s.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); close(); }}>
      <div className={s.heading}><div><span>APOIO AO ATENDIMENTO</span><h2 id={`${id}-title`}>Assistente da conversa</h2><p>{customerName}</p></div><button type="button" className={s.close} aria-label="Fechar assistente" disabled={saving} onClick={close}>×</button></div>
      <div className={s.body}>
        <p id={`${id}-description`} className={s.intro}>{demo ? 'Demonstração simulada e isolada. Nenhum dado real é enviado à IA.' : 'Analisa até 40 mensagens de texto recentes. Ao solicitar, esse texto e as preferências comerciais são enviados ao provedor de IA configurado.'} A IA pode errar. Revise tudo antes de usar; nada é enviado ao cliente automaticamente.</p>
        <div className={s.controls}><label htmlFor={`${id}-sector`}>Foco do atendimento<select id={`${id}-sector`} value={sector} disabled={loading || saving} onChange={event => setSector(event.target.value as AssistantSector)}><option value="automatic">Usar finalidade da ficha</option><option value="Venda">Compra e venda</option><option value="Aluguel">Locação</option><option value="Geral">Esclarecer necessidade</option></select></label><button type="button" className={s.primary} disabled={loading || saving} onClick={() => void analyze()}>{loading ? 'Analisando…' : result ? 'Analisar novamente' : 'Analisar conversa'}</button></div>
        {error && <p role="alert" className={s.error}>{error}</p>}
        {loading && <p role="status" className={s.loading}>Lendo o contexto e separando sugestões para sua revisão…</p>}
        {result && <>
          <section className={s.section} aria-labelledby={`${id}-reply`}><div className={s.sectionHeading}><h3 id={`${id}-reply`}>Sugestão de resposta</h3><span>{demo ? 'Exemplo' : `${result.messageCount} textos analisados`}</span></div>
            <textarea aria-label="Editar resposta sugerida" rows={4} value={reply} maxLength={1600} onChange={event => setReply(event.target.value)} />
            <p className={s.hint}>A mensagem vai para o rascunho. Você decide quando enviar.</p><button type="button" className={s.secondary} disabled={!reply.trim() || saving} onClick={() => { close(); onUseReply(reply.trim()); }}>Adicionar ao rascunho</button>
          </section>
          <section className={s.section} aria-labelledby={`${id}-profile`}><h3 id={`${id}-profile`}>Dados para a ficha</h3><p className={s.hint}>Marque somente as alterações que você conferiu. A etapa do atendimento não muda; use Registro para visitas e propostas.</p>
            {result.assistance.changes.length ? <div className={s.changes}>{result.assistance.changes.map(change => <label key={change.field} className={s.change}>
              <input type="checkbox" checked={selected.includes(change.field)} disabled={saving || saved || refreshRequired} onChange={event => setSelected(previous => event.target.checked ? [...previous, change.field] : previous.filter(field => field !== change.field))} />
              <span><strong>{labels[change.field]}</strong><span className={s.old}>Atual: {showValue(result.review.record.data[change.field], change.field)}</span><span className={s.proposed}>Sugerido: {showValue(change.value, change.field)}</span><span className={s.evidence}>Cliente: “{change.evidence}”</span></span>
            </label>)}</div> : <p className={s.empty}>Nenhuma nova preferência explícita foi encontrada. A ficha permanece como está.</p>}
            {result.assistance.missing.length > 0 && <p className={s.hint}>Ainda vale confirmar: {result.assistance.missing.map(field => labels[field as AssistantField] || field).join(', ')}.</p>}
            {result.assistance.changes.length > 0 && <button type="button" className={s.primary} disabled={saving || !selected.length || saved || refreshRequired} onClick={() => void saveProfile()}>{saving ? 'Salvando…' : saved ? demo ? 'Revisão simulada' : 'Ficha atualizada' : demo ? 'Simular atualização da ficha' : 'Salvar dados revisados'}</button>}
          </section>
          {result.assistance.explanation && <p className={s.explanation}>{result.assistance.explanation}</p>}
        </>}
      </div>
      <div className={s.footer}><span>{demo ? 'Ambiente de demonstração' : 'Sem envio automático · revisão humana'}</span><button type="button" className={s.secondary} disabled={saving} onClick={close}>Fechar</button></div>
    </dialog>}
  </div>;
}
