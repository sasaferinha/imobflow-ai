'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dashboardFetch } from '@/lib/dashboard-transport';
import { DEFAULT_TENANT_AI_SETTINGS, getTenantAISettings, validateTenantAISettings, type TenantAISettings } from '@/lib/ai/tenant-settings';
import type { CrmCommand, CrmState } from '@/lib/evolution/model';
import s from './ai-settings.module.css';

type Props = { state: CrmState; isAdmin: boolean; busy: boolean; preview: boolean; execute: (command: CrmCommand) => Promise<boolean>; onDirtyChange: (dirty: boolean) => void };
type ProviderStatus = { providerConfigured: boolean; providerTested: false };
const stringify = (settings: TenantAISettings) => JSON.stringify(settings);

export default function AISettings(props: Props) {
  if (!props.isAdmin) return <section className={s.restricted} role="alert"><h2>Acesso exclusivo do administrador</h2><p>Somente o administrador pode consultar e configurar a IA da imobiliária.</p></section>;
  let initial: TenantAISettings;
  try { initial = getTenantAISettings(props.state.settings.ai); }
  catch { return <section className={s.restricted} role="alert"><h2>Não foi possível validar a configuração</h2><p>Atualize a página ou procure o suporte. Nenhum padrão foi aplicado por cima dos dados existentes.</p></section>; }
  return <AISettingsForm {...props} initial={initial} />;
}

function Section({ id, number, title, description, children }: { id: string; number: string; title: string; description: string; children: ReactNode }) {
  return <section id={`ai-${id}`} className={s.section} aria-labelledby={`ai-title-${id}`}><header><span>{number}</span><div><h2 id={`ai-title-${id}`}>{title}</h2><p>{description}</p></div></header><div className={s.sectionBody}>{children}</div></section>;
}

function AISettingsForm({ initial, state, busy, preview, execute, onDirtyChange }: Props & { initial: TenantAISettings }) {
  const [draft, setDraft] = useState<TenantAISettings>(() => structuredClone(initial));
  const [baseline, setBaseline] = useState(() => stringify(initial));
  const [localError, setLocalError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const [scenario, setScenario] = useState<'hello' | 'sale' | 'rent'>('hello');
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [providerError, setProviderError] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const saving = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const dirty = stringify(draft) !== baseline;
  const changedElsewhere = stringify(initial) !== baseline;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!localError) return;
    errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    errorRef.current?.focus({ preventScroll: true });
  }, [localError]);
  useEffect(() => {
    if (preview) return;
    let active = true;
    const controller = new AbortController();
    void dashboardFetch('/api/ai/settings', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('status');
      const result = await response.json() as ProviderStatus;
      if (typeof result.providerConfigured !== 'boolean') throw new Error('status');
      if (active) setProvider(result);
    }).catch(() => { if (active) setProviderError(true); });
    return () => { active = false; controller.abort(); };
  }, [preview, state.companyId]);

  function update<K extends keyof TenantAISettings>(key: K, value: TenantAISettings[K]) {
    setDraft(current => ({ ...current, [key]: value })); setLocalError(''); setSavedNotice('');
  }
  function discard() {
    if (busy || saving.current || dirty && !window.confirm('Descartar os ajustes e voltar à configuração salva?')) return;
    setDraft(structuredClone(initial)); setBaseline(stringify(initial)); setLocalError(''); setSavedNotice('');
  }
  async function save() {
    if (busy || saving.current || changedElsewhere) return;
    let valid: TenantAISettings;
    if (!draft.services.length) { setLocalError('Selecione venda, locação ou as duas opções.'); return; }
    try {
      if (!draft.assistantName.trim()) throw new Error('Preencha o nome do assistente em Personalizar mensagens e orientações.');
      if (draft.faq.some(item => !item.question.trim() || !item.answer.trim())) throw new Error('Preencha a pergunta e a resposta de cada item ou remova o item vazio.');
      valid = validateTenantAISettings(draft);
    } catch (error) {
      setAdvancedOpen(true);
      setLocalError(error instanceof Error ? error.message : 'Revise os campos antes de salvar.'); return;
    }
    saving.current = true; setLocalError(''); setSavedNotice('');
    try {
      if (await execute({ type: 'settings', settings: { ai: valid } })) {
        setDraft(valid); setBaseline(stringify(valid)); onDirtyChange(false);
        setSavedNotice('Configuração salva para esta imobiliária. Será usada nas próximas análises e respostas automáticas elegíveis.');
      }
    } finally { saving.current = false; }
  }

  const offered = draft.services.map(service => service === 'Venda' ? 'venda' : 'locação').join(' e ');
  const samplePurpose = scenario === 'rent' ? 'Aluguel' : 'Venda';
  const outside = scenario !== 'hello' && !draft.services.includes(samplePurpose);
  const handoff = draft.handoffMessage.trim() || 'Recebemos sua mensagem. Um corretor dará continuidade ao seu atendimento.';
  const sample = draft.automaticMode === 'human' ? handoff : outside
    ? draft.unsupportedService === 'handoff' ? handoff
      : `Nossa imobiliária trabalha com ${offered || 'os serviços cadastrados'}. ${draft.unsupportedService === 'explain_close' ? 'Não oferecemos essa modalidade. Agradecemos seu contato.' : `Não oferecemos essa modalidade. ${handoff}`}`
    : scenario === 'hello' ? draft.greeting.trim() || `Olá! Sou ${draft.assistantName || 'o assistente da imobiliária'}. Como posso ajudar na sua busca?`
      : `Vamos entender sua busca para ${scenario === 'rent' ? 'alugar' : 'comprar'}. Qual tipo de imóvel e região você procura?`;
  const textField = (key: 'businessSummary' | 'serviceRegions' | 'greeting' | 'handoffMessage' | 'saleGuidance' | 'rentalGuidance', label: string, placeholder: string, maxLength: number, rows = 3) => <label className={s.field}>{label}<textarea value={draft[key]} onChange={event => update(key, event.target.value)} maxLength={maxLength} rows={rows} placeholder={placeholder} /><small>{draft[key].length}/{maxLength}</small></label>;

  return <div className={s.root}>
    <div className={s.intro}><p>Defina o essencial para a IA da sua imobiliária.</p><span className={s.adminBadge}>Somente administrador</span></div>
    <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      {localError && <div className={s.error} role="alert" tabIndex={-1} ref={errorRef}>{localError}</div>}
      {savedNotice && <div className={s.success} role="status">{savedNotice}</div>}
      {changedElsewhere && <div className={s.warning} role="alert"><strong>A configuração salva mudou.</strong><p>Seus ajustes continuam aqui. Carregue a versão salva ou revise e confirme que deseja substituí-la pelos seus ajustes.</p><button type="button" disabled={busy} onClick={discard}>Carregar configuração salva</button><button type="button" disabled={busy} onClick={() => { setBaseline(stringify(initial)); setSavedNotice('Versão atual reconhecida. Revise seus ajustes antes de salvar.'); }}>Revisei; manter meus ajustes</button></div>}
      <fieldset className={s.editor} disabled={busy}><legend className={s.srOnly}>Configuração da IA da imobiliária</legend>
        <section className={s.essential} aria-labelledby="ai-essential-title"><h2 id="ai-essential-title">O essencial</h2>
          <fieldset className={s.choiceGroup}><legend>Com o que a empresa trabalha? *</legend><div className={s.serviceChoices}>{([['Venda', 'Venda de imóveis', 'Clientes que querem comprar'], ['Aluguel', 'Locação de imóveis', 'Clientes que querem alugar']] as const).map(([value, title, subtitle]) => <label key={value} className={`${s.choiceCard} ${draft.services.includes(value) ? s.chosen : ''}`}><input type="checkbox" checked={draft.services.includes(value)} onChange={event => update('services', event.target.checked ? [...draft.services, value] : draft.services.filter(item => item !== value))} /><span><strong>{title}</strong><small>{subtitle}</small></span></label>)}</div><p className={s.hint}>Selecione uma ou as duas opções. Isso orienta a IA; não altera a carteira nem a especialidade dos corretores.</p></fieldset>
          <label className={s.field}>Atendimento automático no WhatsApp<select value={draft.automaticMode} onChange={event => update('automaticMode', event.target.value as TenantAISettings['automaticMode'])}><option value="qualify">Coletar preferências e encaminhar à equipe</option><option value="human">Encaminhar diretamente à equipe</option></select><small>Não conecta canais nem reativa conversas pausadas.</small></label>
          <label className={s.toggle}><input type="checkbox" checked={draft.brokerAssistantEnabled} onChange={event => update('brokerAssistantEnabled', event.target.checked)} /><span><strong>Permitir sugestões ao corretor</strong><small>O corretor revisa e decide o que enviar. Controle independente do atendimento automático.</small></span></label>
          <p className={s.policy}>Pedidos fora dos serviços: {draft.unsupportedService === 'explain_handoff' ? 'explicar a limitação e encaminhar à equipe.' : draft.unsupportedService === 'handoff' ? 'encaminhar à equipe sem explicar a limitação.' : 'explicar a limitação e encerrar apenas a triagem automática.'}</p>
        </section>
        <details className={s.optional} open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary>Personalizar mensagens e orientações<span>Opcional</span></summary><div className={s.optionalBody}>
        <Section id="messages" number="01" title="Mensagens" description="Pode deixar os textos vazios para usar o padrão.">
          <label className={s.field}>Nome do assistente<input required maxLength={60} value={draft.assistantName} onChange={event => update('assistantName', event.target.value)} placeholder="Ex.: Assistente da Imobiliária Horizonte" /></label>
          {textField('greeting', 'Mensagem de boas-vindas', 'Deixe vazio para usar a apresentação padrão do assistente.', 400)}
          {textField('handoffMessage', 'Mensagem ao encaminhar para a equipe', 'Deixe vazio para usar a mensagem padrão. Não prometa prazo de resposta.', 400)}
          <label className={s.field}>Se o cliente pedir um serviço não oferecido<select value={draft.unsupportedService} onChange={event => update('unsupportedService', event.target.value as TenantAISettings['unsupportedService'])}><option value="explain_handoff">Explicar a limitação e encaminhar à equipe</option><option value="handoff">Encaminhar à equipe sem explicar a limitação</option><option value="explain_close">Explicar e encerrar a triagem automática</option></select><small>O interesse real do cliente é preservado. Encerrar a triagem não exclui o lead nem registra uma venda ou perda.</small></label>
          <p className={s.hint}>Use textos literais, sem comandos ou variáveis. Horário da equipe: Conversas → Horário de atendimento.</p>
        </Section>
        <Section id="style" number="02" title="Sugestões ao corretor" description="Estas preferências não mudam as perguntas estruturadas do bot.">
          <div className={s.twoColumns}><label className={s.field}>Tom das sugestões<select value={draft.tone} onChange={event => update('tone', event.target.value as TenantAISettings['tone'])}><option value="acolhedor">Acolhedor e profissional</option><option value="objetivo">Direto e objetivo</option><option value="formal">Mais formal</option></select></label><label className={s.field}>Tamanho das sugestões<select value={draft.replyLength} onChange={event => update('replyLength', event.target.value as TenantAISettings['replyLength'])}><option value="curta">Curtas</option><option value="equilibrada">Equilibradas</option></select></label></div>
          <label className={s.toggle}><input type="checkbox" checked={draft.emojis} onChange={event => update('emojis', event.target.checked)} /><span><strong>Permitir emojis discretos nas sugestões</strong><small>Tom, tamanho e emojis orientam o Assistente do corretor. As perguntas de cadastro do bot seguem o fluxo estruturado.</small></span></label>
        </Section>
        <Section id="knowledge" number="03" title="Orientações e respostas frequentes" description="Referências para o Assistente do corretor, não respostas automáticas do bot.">
          {textField('serviceRegions', 'Cidades e regiões atendidas', 'Ex.: Lavras e bairros da região central.', 300, 2)}
          {textField('businessSummary', 'O que o assistente deve saber sobre a empresa?', 'Ex.: Atendimento residencial, endereço comercial e diferenciais confirmados.', 600)}
          <p className={s.hint}>Essas informações orientam sugestões. Não substituem o catálogo nem bloqueiam clientes por localização.</p>
          <div className={s.twoColumns}>{textField('saleGuidance', 'Orientações para compra e venda', 'Ex.: Entender região e orçamento. Financiamento sempre sujeito à análise do banco.', 1000, 4)}{textField('rentalGuidance', 'Orientações para locação', 'Ex.: Perguntar orçamento mensal e previsão de mudança. Confirmar garantias com a equipe.', 1000, 4)}</div>
          <div className={s.faqHeading}><div><h3>Perguntas frequentes</h3><p>Até seis respostas confirmadas pela imobiliária. Não são disparadas automaticamente pelo bot.</p></div><button type="button" disabled={draft.faq.length >= 6} onClick={() => update('faq', [...draft.faq, { question: '', answer: '' }])}>+ Adicionar pergunta</button></div>
          {draft.faq.length === 0 && <div className={s.empty}>Ainda não há perguntas cadastradas. Adicione informações que sua equipe costuma repetir.</div>}
          {draft.faq.map((faq, index) => <div className={s.faq} key={index}><div className={s.faqTop}><strong>Pergunta {index + 1}</strong><button type="button" aria-label={`Remover pergunta ${index + 1}`} onClick={() => update('faq', draft.faq.filter((_, position) => position !== index))}>Remover</button></div><label className={s.field}>Pergunta<input required maxLength={160} value={faq.question} onChange={event => update('faq', draft.faq.map((item, position) => position === index ? { ...item, question: event.target.value } : item))} placeholder="Ex.: Onde fica o escritório?" /></label><label className={s.field}>Resposta aprovada<textarea required maxLength={600} rows={3} value={faq.answer} onChange={event => update('faq', draft.faq.map((item, position) => position === index ? { ...item, answer: event.target.value } : item))} placeholder="Informe apenas fatos confirmados, sem dados pessoais de clientes." /></label></div>)}
          <div className={s.safety}><strong>Proteções que continuam valendo</strong><p>A IA não pode inventar imóveis, preços ou disponibilidade, aprovar financiamento, confirmar visitas ou alterar etapas por conta própria. Informações desconhecidas devem ser confirmadas com a equipe. Não cadastre senhas ou dados de clientes aqui.</p></div>
        </Section>
        <div className={s.reset}><button type="button" disabled={busy} onClick={() => { if (window.confirm('Carregar as opções padrão no formulário? Elas só serão aplicadas ao salvar.')) { setDraft(structuredClone(DEFAULT_TENANT_AI_SETTINGS)); setSavedNotice('Padrão carregado no formulário. Revise e salve para aplicar.'); } }}>Carregar opções padrão</button><span>Não altera nada até você salvar.</span></div>
        <section className={s.provider}><h3>Conexão com a IA</h3><strong>{preview ? 'Prévia · sem consultar serviços' : providerError ? 'Status indisponível' : !provider ? 'Consultando configuração…' : provider.providerConfigured ? 'Provedor configurado · não testado' : 'Provedor ainda não configurado'}</strong><p>Esta tela personaliza o comportamento. Não corrige credenciais, conecta redes sociais nem comprova que o provedor está respondendo. As chaves ficam somente no servidor.</p></section>
        </div></details>
        <details className={s.optional}><summary>Ver exemplo de atendimento<span>Sem envio</span></summary><section className={s.simulator}><h3>Prévia do comportamento</h3><p>Exemplo ilustrativo por regras, sem consultar a IA ou consumir créditos.</p><label className={s.field}>Situação de exemplo<select value={scenario} onChange={event => setScenario(event.target.value as typeof scenario)}><option value="hello">Cliente diz “Olá”</option><option value="sale">Cliente quer comprar</option><option value="rent">Cliente quer alugar</option></select></label><div className={s.customer}>{scenario === 'hello' ? 'Olá! Gostaria de informações.' : scenario === 'rent' ? 'Estou procurando um imóvel para alugar.' : 'Quero comprar um imóvel.'}</div><div className={s.bubble}>{sample}</div><small>Não é uma resposta gerada pelo modelo. O contexto real e a etapa da conversa também influenciam o atendimento.</small></section></details>
      </fieldset>
      <footer className={s.saveBar}><div><strong>{dirty ? 'Você tem ajustes não salvos' : 'Nenhum ajuste pendente'}</strong><small>Salvar aplica as escolhas somente à sua imobiliária.</small></div><div><button type="button" disabled={busy || !dirty && !changedElsewhere} onClick={discard}>Descartar ajustes</button><button className={s.primary} type="submit" disabled={busy || !dirty || changedElsewhere}>{busy ? 'Salvando…' : 'Salvar configuração'}</button></div></footer>
    </form>
  </div>;
}
