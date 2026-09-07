'use client';

import { useEffect, useState } from 'react';
import { automationFlows, type FlowId } from '@/lib/automation-rules';

type Snapshot = {
  configured: boolean; schedulerConfigured: boolean;
  flows: { id: FlowId; active: boolean; total: number }[];
  results: { id: string; flow_id: string; summary: string; detail: { note?: string; summary?: string; assignedTo?: string; reasons?: string[]; matches?: { id: string; title: string; price: string; district: string }[] }; status: string; created_at: string }[];
  runs: { id: string; flow_id: string; status: string; processed: number; message: string | null; trigger: string; created_at: string }[];
};
const timestamp = (value: string) => new Date(value).toLocaleString('pt-BR');
const flowName = (id: string) => automationFlows.find((flow) => flow.id === id)?.name || 'Todos os fluxos';
type ApiResponse = { data?: Snapshot; error?: string; execution?: { busy: boolean; processed: number; failed: number } };

export default function AutomationCenter({ notify }: { notify: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<FlowId>('qualification');
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch('/api/automations', { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as ApiResponse;
        if (!response.ok || !body.data) throw new Error(body.error || 'Não foi possível carregar as automações.');
        setSnapshot(body.data); setError('');
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha de conexão.'); }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 30000);
    return () => { controller.abort(); clearInterval(interval); };
  }, []);
  async function act(action: Record<string, unknown>) {
    setPending(true); setError('');
    try {
      const response = await fetch('/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.data) throw new Error(body.error || 'Operação não concluída.');
      setSnapshot(body.data);
      notify(body.execution ? body.execution.busy ? 'Já existe uma execução em andamento. Aguarde a atualização do histórico.' : body.execution.failed ? `Execução com ${body.execution.failed} falha(s). Confira o histórico.` : `Execução concluída: ${body.execution.processed} novo(s) resultado(s).` : 'Alteração salva no servidor.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha de conexão.'); }
    finally { setPending(false); }
  }
  const current = automationFlows.find((flow) => flow.id === selected)!;
  const state = snapshot?.flows.find((flow) => flow.id === selected);
  const disabled = pending || !snapshot?.configured || Boolean(error);
  return <div className="automation-center" aria-busy={pending}>
    {error && <p className="automation-warning" role="alert">{error} A consulta será repetida automaticamente.</p>}
    {!snapshot && !error && <p role="status">Carregando automações do servidor…</p>}
    {snapshot && !snapshot.configured && <p className="automation-warning">Conecte o banco PostgreSQL pela variável DATABASE_URL na Vercel. Nenhuma automação está executando sem o banco.</p>}
    {snapshot?.configured && <p className="automation-notice">Execuções em novos cadastros, importações e atualizações de leads. {snapshot.schedulerConfigured ? 'Credencial do agendador configurada; habilite e confira a agenda na Vercel.' : 'Varredura diária pendente: configure CRON_SECRET e habilite a agenda na Vercel.'} Nenhuma mensagem externa é enviada.</p>}
    <div className="automation-layout"><section className="automation-grid">{automationFlows.map((flow) => {
      const saved = snapshot?.flows.find((item) => item.id === flow.id);
      return <article className="automation-card panel" key={flow.id}>
        <span className="automation-state">{!snapshot?.configured ? 'Não conectada' : saved?.active ? 'Ativa' : 'Pausada'}</span>
        <h3>{flow.name}</h3><p>{flow.detail}</p>
        <footer><strong>{saved?.total || 0} resultados salvos</strong><div>
          <button type="button" aria-pressed={selected === flow.id} onClick={() => setSelected(flow.id)}>Ver fluxo</button>
          <button type="button" disabled={disabled} onClick={() => void act({ action: 'toggle', flowId: flow.id, active: !saved?.active })}>{saved?.active ? 'Pausar' : 'Ativar'}</button>
        </div></footer>
      </article>;
    })}</section><aside className="panel flow-detail">
      <p className="eyebrow">Controle de execução</p><h3>{current.name}</h3><p>{current.detail}</p>
      <p>{state?.active ? 'Habilitada para processar novos dados.' : 'Fluxo desativado ou banco não conectado.'}</p>
      <button type="button" className="primary-button" disabled={disabled || !state?.active} onClick={() => void act({ action: 'run', flowId: selected })}>{pending ? 'Processando…' : 'Executar agora'}</button>
      <button type="button" className="profile-action" disabled={disabled} onClick={() => void act({ action: 'run' })}>Executar todos os ativos</button>
    </aside></div>
    <section className="panel automation-results"><h2>Resultados e tarefas internas</h2><p>Últimos 100 resultados. A conclusão marca a tarefa como revisada; não envia mensagens.</p>
      {!snapshot?.results.length && <p>Nenhum resultado registrado.</p>}
      {snapshot?.results.map((result) => <article key={result.id}>
        <div><small>{flowName(result.flow_id)} · {timestamp(result.created_at)}</small><h3>{result.summary}</h3>
          {result.detail.summary && <p>{result.detail.summary}</p>}
          {result.detail.assignedTo && <p>Responsável: {result.detail.assignedTo}</p>}
          {result.detail.note && <p>{result.detail.note}</p>}
          {result.detail.matches && <ul>{result.detail.matches.map((property) => <li key={property.id}>{property.title} · {property.district} · {property.price}</li>)}</ul>}
          {result.detail.reasons && <p>{result.detail.reasons.join(' • ')}</p>}
        </div><div><span>{result.status === 'done' ? 'Concluído' : result.status === 'cancelled' ? 'Cancelado por atualização do lead' : 'Pendente de revisão'}</span>
          {result.status === 'open' && <button type="button" disabled={disabled} onClick={() => void act({ action: 'complete', id: result.id })}>Marcar como revisado</button>}
        </div>
      </article>)}
    </section>
    <section className="panel automation-history"><h2>Histórico de execuções</h2><p>Últimas 40 execuções do servidor.</p>
      {!snapshot?.runs.length && <p>Nenhuma execução registrada.</p>}
      <ul>{snapshot?.runs.map((run) => <li key={run.id}><time>{timestamp(run.created_at)}</time><strong>{flowName(run.flow_id)}</strong><span>{run.trigger === 'cron' ? 'Agendada' : run.trigger === 'event' ? 'Atualização de dados' : 'Manual'}</span><span>{run.status === 'success' ? `${run.processed} novos resultados` : run.message || 'Falha na execução'}</span></li>)}</ul>
    </section>
  </div>;
}
