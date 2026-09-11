'use client';

import { useEffect, useState } from 'react';
import { automationFlows, type FlowId } from '@/lib/automation-rules';
import { NEW_PROPERTY_DAYS } from '@/lib/property-matching';

type Snapshot = {
  configured: boolean; schedulerConfigured: boolean;
  flows: { id: FlowId; active: boolean; total: number }[];
  results: { id: string; flow_id: string; summary: string; detail: { message?: string; note?: string; summary?: string; assignedTo?: string; reasons?: string[]; matches?: { id: string; title: string; price: string; district: string }[] }; status: string; created_at: string }[];
  runs: { id: string; flow_id: string; status: string; processed: number; message: string | null; trigger: string; created_at: string }[];
};
const timestamp = (value: string) => new Date(value).toLocaleString('pt-BR');
const flowName = (id: string) => automationFlows.find((flow) => flow.id === id)?.name || 'Todos os fluxos';
type ApiResponse = { data?: Snapshot; error?: string; execution?: { busy: boolean; processed: number; failed: number } };

export default function AutomationCenter({ notify }: { notify: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<FlowId>('followup');
  const [draft, setDraft] = useState<{ id: string; message: string; phone: string | null } | null>(null);
  const [draftError, setDraftError] = useState('');
  async function reviewMessage(id: string) {
    setPending(true); setDraft(null); setDraftError('');
    try {
      const response = await fetch('/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'prepare-message', id }) });
      const body = await response.json() as { message?: string; phone?: string | null; error?: string };
      if (!response.ok || !body.message) throw new Error(body.error || 'Não foi possível conferir este rascunho.');
      setDraft({ id, message: body.message, phone: body.phone || null });
    } catch (reason) { setDraftError(reason instanceof Error ? reason.message : 'Falha ao conferir o rascunho.'); }
    finally { setPending(false); }
  }
  async function copyMessage(message: string) {
    try { await navigator.clipboard.writeText(message); notify('Mensagem copiada. Nenhum envio realizado.'); }
    catch { notify('Não foi possível copiar. Selecione e copie o texto do rascunho.'); }
  }
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
    {snapshot?.configured && <p className="automation-notice">Execuções em cadastros e atualizações de leads e imóveis, além das importações de leads. {snapshot.schedulerConfigured ? 'Credencial do agendador configurada; habilite e confira a agenda na Vercel.' : 'Varredura diária pendente: configure CRON_SECRET e habilite a agenda na Vercel.'} O envio de mensagens exige sua confirmação no WhatsApp.</p>}
    <p>Os matches de imóveis estão na área Oportunidades, com revisão e envio manual pelo corretor.</p>
    <div className="automation-layout"><section className="automation-grid">{automationFlows.filter(flow => flow.id !== 'new-property').map((flow) => {
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
      {selected === 'new-property' && <div className="match-flow-guide">
        <h4>Como encontrar os matches</h4>
        <ol><li>No lead, informe objetivo, tipo, bairro, orçamento e quartos nas observações (ex.: “2 quartos”).</li><li>No imóvel, informe tipo, bairro, preço e quartos na descrição.</li><li>Busque os matches e revise a mensagem antes de continuar no WhatsApp.</li></ol>
        <p>Considera imóveis disponíveis, cadastrados nos últimos {NEW_PROPERTY_DAYS} dias e após o último contato do lead (ou seu cadastro, se não houver contato). Bairro, tipo, finalidade, quartos e teto de preço precisam ser compatíveis.</p>
        <p>Dados incompletos ou ambíguos ficam fora da seleção. Cada par de lead e imóvel gera apenas um rascunho.</p>
      </div>}
      <p>{state?.active ? 'Habilitada para processar novos dados.' : 'Fluxo desativado ou banco não conectado.'}</p>
      <button type="button" className="primary-button" disabled={disabled || !state?.active} onClick={() => { setDraft(null); void act({ action: 'run', flowId: selected }); }}>{pending ? 'Processando…' : selected === 'new-property' ? 'Buscar leads compatíveis' : 'Executar agora'}</button>
      <button type="button" className="profile-action" disabled={disabled} onClick={() => void act({ action: 'run' })}>Executar todos os ativos</button>
    </aside></div>
    <section className="panel automation-results"><h2>{selected === 'new-property' ? 'Oportunidades de contato' : 'Resultados e tarefas internas'}</h2><p>Últimos 100 resultados de {current.name.toLocaleLowerCase('pt-BR')}. Marcar como revisado não envia mensagens.</p>
      {draftError && <p className="automation-warning" role="alert">{draftError}</p>}
      {!snapshot?.results.some((result) => result.flow_id === selected) && <div className="match-empty"><h3>{selected === 'new-property' ? 'Nenhuma oportunidade registrada' : 'Nenhum resultado registrado'}</h3><p>{selected === 'new-property' ? 'Os matches aparecerão aqui após conectar o banco e processar cadastros com os critérios completos.' : 'Execute o fluxo para consultar os dados da base.'}</p></div>}
      {snapshot?.results.filter((result) => result.flow_id === selected).map((result) => <article key={result.id}>
        <div><small>{flowName(result.flow_id)} · {timestamp(result.created_at)}</small><h3>{result.summary}</h3>
          {result.detail.summary && <p>{result.detail.summary}</p>}
          {result.detail.assignedTo && <p>Responsável: {result.detail.assignedTo}</p>}
          {result.detail.note && <p>{result.detail.note}</p>}
          {result.detail.matches && <ul>{result.detail.matches.map((property) => <li key={property.id}>{property.title} · {property.district} · {property.price}</li>)}</ul>}
          {result.detail.reasons && <p>{result.detail.reasons.join(' • ')}</p>}
          {result.detail.message && <blockquote className="match-message">{result.detail.message}</blockquote>}
          {draft?.id === result.id && result.status === 'open' && <div className="match-review">
            <label>Mensagem conferida com os dados atuais<textarea readOnly rows={5} value={draft.message}/></label>
            <p>Revise o destinatário e o conteúdo no WhatsApp. Você confirma o envio por lá; o ImobFlow não envia automaticamente nem confirma a entrega.</p>
            <div><button type="button" onClick={() => void copyMessage(draft.message)}>Copiar mensagem</button>
              {draft.phone ? <a className="primary-button" href={`https://wa.me/${draft.phone}?text=${encodeURIComponent(draft.message)}`} target="_blank" rel="noopener noreferrer">Continuar no WhatsApp · +{draft.phone}</a> : <span>Cadastre um telefone válido no lead para abrir o WhatsApp.</span>}
            </div>
          </div>}
        </div><div><span>{result.status === 'done' ? 'Concluído' : result.status === 'cancelled' ? 'Cancelado por atualização do lead' : 'Pendente de revisão'}</span>
          {result.flow_id === 'new-property' && result.status === 'open' && <button type="button" className="primary-button" disabled={disabled} onClick={() => void reviewMessage(result.id)}>Revisar mensagem</button>}
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
