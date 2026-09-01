'use client';

import { useMemo, useState, type FormEvent } from 'react';

type View = 'overview' | 'conversations' | 'leads' | 'properties' | 'agenda' | 'automations';
type ChatMessage = { id: number; side: 'incoming' | 'outgoing'; text: string };
type Property = { id: number; title: string; district: string; price: string; meta: string; match: number; tone: string };

const navItems: Array<{ id: View; icon: string; label: string; badge?: string }> = [
  { id: 'overview', icon: '⌂', label: 'Visão geral' },
  { id: 'conversations', icon: '◌', label: 'Conversas', badge: '6' },
  { id: 'leads', icon: '◎', label: 'Leads' },
  { id: 'properties', icon: '◇', label: 'Imóveis' },
  { id: 'agenda', icon: '□', label: 'Agenda' },
  { id: 'automations', icon: '↗', label: 'Automações' },
];

const headers: Record<View, { eyebrow: string; title: string; copy: string }> = {
  overview: { eyebrow: 'Quinta-feira, 27 de agosto', title: 'Bom dia, Marina', copy: 'Seu atendimento está fluindo bem. Aqui está o resumo de hoje.' },
  conversations: { eyebrow: 'Central de atendimento', title: 'Conversas', copy: 'Acompanhe o que a IA está resolvendo e assuma quando quiser.' },
  leads: { eyebrow: 'Relacionamento comercial', title: 'Leads', copy: 'Priorize oportunidades por perfil, intenção e temperatura.' },
  properties: { eyebrow: 'Catálogo conectado', title: 'Imóveis', copy: 'Gerencie os imóveis reais que a IA pode recomendar.' },
  agenda: { eyebrow: 'Visitas e compromissos', title: 'Agenda', copy: 'Veja a programação dos corretores e confirmações pendentes.' },
  automations: { eyebrow: 'Operação inteligente', title: 'Automações', copy: 'Acompanhe os fluxos que trabalham pela imobiliária.' },
};

const leadRows = [
  { initials: 'LC', name: 'Lucas Carvalho', phone: '(11) 99992-4120', intent: 'Comprar apartamento', region: 'Centro', score: 86, status: 'Muito quente', tone: 0 },
  { initials: 'AM', name: 'Ana Martins', phone: '(11) 98814-2031', intent: 'Comprar apartamento', region: 'Pinheiros', score: 74, status: 'Quente', tone: 1 },
  { initials: 'RB', name: 'Rafael Borges', phone: '(11) 97751-0928', intent: 'Alugar casa', region: 'Moema', score: 61, status: 'Quente', tone: 2 },
  { initials: 'CS', name: 'Carla Souza', phone: '(11) 96632-7744', intent: 'Comprar terreno', region: 'Alphaville', score: 48, status: 'Morno', tone: 3 },
  { initials: 'VF', name: 'Victor Freitas', phone: '(11) 95521-0062', intent: 'Financiamento', region: 'Vila Mariana', score: 32, status: 'Morno', tone: 4 },
];

const initialProperties: Property[] = [
  { id: 1, title: 'Residencial Aurora', district: 'Centro', price: 'R$ 575.000', meta: '3 quartos • 2 vagas • 98 m²', match: 96, tone: 'orchid' },
  { id: 2, title: 'Edifício Horizonte', district: 'Jardim Floresta', price: 'R$ 590.000', meta: '3 quartos • 1 vaga • 91 m²', match: 92, tone: 'sky' },
  { id: 3, title: 'Casa Bosque Sereno', district: 'Alto da Serra', price: 'R$ 820.000', meta: '4 quartos • 3 vagas • 184 m²', match: 88, tone: 'sage' },
  { id: 4, title: 'Studio Vila Nova', district: 'Vila Nova', price: 'R$ 2.950/mês', meta: '1 quarto • mobiliado • 42 m²', match: 83, tone: 'sand' },
  { id: 5, title: 'Parque das Oliveiras', district: 'Pinheiros', price: 'R$ 745.000', meta: '2 quartos • varanda • 76 m²', match: 81, tone: 'rose' },
  { id: 6, title: 'Terreno Reserva Sul', district: 'Reserva Sul', price: 'R$ 310.000', meta: 'Plano • 360 m² • residencial', match: 77, tone: 'slate' },
];

const appointments = [
  { time: '09:00', name: 'Ana Martins', property: 'Edifício Horizonte', broker: 'Marina Oliveira', status: 'Confirmada', color: 'mint' },
  { time: '10:30', name: 'Lucas Carvalho', property: 'Residencial Aurora', broker: 'Paulo Mendes', status: 'Aguardando', color: 'amber' },
  { time: '14:00', name: 'Carla Souza', property: 'Terreno Reserva Sul', broker: 'Marina Oliveira', status: 'Confirmada', color: 'violet' },
  { time: '16:30', name: 'Rafael Borges', property: 'Casa Bosque Sereno', broker: 'Paulo Mendes', status: 'Confirmada', color: 'blue' },
];

const automations = [
  { icon: '◌', name: 'Qualificação automática', detail: 'Identifica intenção, perfil e orçamento do novo lead.', count: '37 conversas', state: 'Ativa' },
  { icon: '◇', name: 'Recomendação de imóveis', detail: 'Busca e ordena somente imóveis reais do catálogo.', count: '19 recomendações', state: 'Ativa' },
  { icon: '↗', name: 'Follow-up em 48 horas', detail: 'Retoma leads que receberam imóveis e não responderam.', count: '8 agendados', state: 'Ativa' },
  { icon: '◎', name: 'Aviso de lead quente', detail: 'Notifica o corretor quando o score passa de 80.', count: '4 alertas hoje', state: 'Ativa' },
];

const initialMessages: ChatMessage[] = [
  { id: 1, side: 'incoming', text: 'Oi! Estou procurando um apartamento de 3 quartos no Centro.' },
  { id: 2, side: 'outgoing', text: 'Olá, Lucas! Posso te ajudar 😊 Qual valor máximo você pretende investir?' },
  { id: 3, side: 'incoming', text: 'Até 600 mil. Pode ser financiamento.' },
  { id: 4, side: 'outgoing', text: 'Perfeito. Encontrei duas opções reais que combinam com o seu perfil. Quer começar pelo Residencial Aurora?' },
];

export default function DashboardClient() {
  const [view, setView] = useState<View>('overview');
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [properties, setProperties] = useState(initialProperties);
  const [propertySearch, setPropertySearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const visibleLeads = useMemo(() => leadRows.filter((lead) => `${lead.name} ${lead.intent} ${lead.region}`.toLowerCase().includes(leadSearch.toLowerCase())), [leadSearch]);
  const visibleProperties = useMemo(() => properties.filter((property) => `${property.title} ${property.district}`.toLowerCase().includes(propertySearch.toLowerCase())), [properties, propertySearch]);
  const header = headers[view];

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: Date.now(), side: 'incoming', text }]);
    setDraft('');
    window.setTimeout(() => {
      setMessages((current) => [...current, { id: Date.now() + 1, side: 'outgoing', text: 'Entendi. Vou considerar isso na busca e mostrar apenas imóveis cadastrados que realmente atendam ao seu perfil.' }]);
    }, 650);
  }

  function addProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') || 'Novo imóvel');
    const district = String(form.get('district') || 'Centro');
    const price = String(form.get('price') || 'R$ 0');
    setProperties((current) => [{ id: Date.now(), title, district, price, meta: '2 quartos • 1 vaga • 72 m²', match: 80, tone: 'orchid' }, ...current]);
    setModalOpen(false);
    notify('Imóvel adicionado ao catálogo da IA');
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="brand brand-button" onClick={() => setView('overview')}>
          <span className="brand-mark">I</span>
          <div><strong>ImobFlow</strong><span>AI Concierge</span></div>
        </button>
        <nav className="nav-list" aria-label="Navegação principal">
          {navItems.map((item) => (
            <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}>
              <span>{item.icon}</span>{item.label}{item.badge && <b>{item.badge}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-card"><span className="live-dot" /><div><strong>Atendimento ativo</strong><span>IA respondendo normalmente</span></div></div>
        <div className="profile-row"><span className="avatar">MO</span><div><strong>Marina Oliveira</strong><span>Imobiliária Horizonte</span></div><button aria-label="Abrir perfil">•••</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{header.eyebrow}</p><h1>{header.title} <span>✦</span></h1><p>{header.copy}</p></div>
          <div className="header-actions">
            <button className="icon-button" aria-label="Notificações" onClick={() => notify('Você não tem novas pendências críticas')}>♢<i /></button>
            <button className="primary-button" onClick={() => setModalOpen(true)}>＋ Novo imóvel</button>
          </div>
        </header>

        {view === 'overview' && <Overview onSimulate={() => setView('conversations')} />}
        {view === 'conversations' && <Conversations messages={messages} draft={draft} setDraft={setDraft} sendMessage={sendMessage} notify={notify} />}
        {view === 'leads' && <Leads leads={visibleLeads} search={leadSearch} setSearch={setLeadSearch} notify={notify} />}
        {view === 'properties' && <Properties properties={visibleProperties} search={propertySearch} setSearch={setPropertySearch} add={() => setModalOpen(true)} />}
        {view === 'agenda' && <Agenda notify={notify} />}
        {view === 'automations' && <Automations notify={notify} />}
      </section>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}>
          <form className="modal-card" onSubmit={addProperty} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><p className="eyebrow">Catálogo da imobiliária</p><h2>Novo imóvel</h2></div><button type="button" onClick={() => setModalOpen(false)}>×</button></div>
            <label>Título<input name="title" placeholder="Ex.: Residencial das Flores" required /></label>
            <div className="form-grid"><label>Bairro<input name="district" placeholder="Centro" required /></label><label>Preço<input name="price" placeholder="R$ 650.000" required /></label></div>
            <label>Descrição<textarea placeholder="Principais características do imóvel" rows={3} /></label>
            <div className="modal-actions"><button type="button" onClick={() => setModalOpen(false)}>Cancelar</button><button className="primary-button" type="submit">Salvar imóvel</button></div>
          </form>
        </div>
      )}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Overview({ onSimulate }: { onSimulate: () => void }) {
  const metrics = [
    { label: 'Leads hoje', value: '24', change: '+18%', tone: 'violet' },
    { label: 'Qualificados', value: '09', change: '37,5%', tone: 'mint' },
    { label: 'Visitas marcadas', value: '04', change: '+2 hoje', tone: 'amber' },
    { label: 'Conversas ativas', value: '37', change: '6 agora', tone: 'blue' },
  ];
  const activity = [
    { initials: 'LC', name: 'Lucas Carvalho', detail: 'Solicitou visita • Residencial Aurora', time: '2 min', tag: 'Muito quente' },
    { initials: 'AM', name: 'Ana Martins', detail: '3 imóveis recomendados em Pinheiros', time: '8 min', tag: 'Qualificado' },
    { initials: 'RB', name: 'Rafael Borges', detail: 'Pediu para falar com um corretor', time: '14 min', tag: 'Handoff' },
  ];
  return <>
    <div className="metric-grid">{metrics.map((metric) => <article className={`metric-card ${metric.tone}`} key={metric.label}><div className="metric-icon">{metric.label.charAt(0)}</div><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.change}</small></article>)}</div>
    <div className="main-grid"><div className="content-column">
      <article className="panel pipeline-panel"><div className="panel-heading"><div><p className="eyebrow">Jornada comercial</p><h2>Funil de leads</h2></div><button>Últimos 7 dias⌄</button></div><div className="pipeline"><div className="pipeline-step step-one"><strong>68</strong><span>Novos contatos</span></div><div className="pipeline-step step-two"><strong>41</strong><span>Em qualificação</span></div><div className="pipeline-step step-three"><strong>19</strong><span>Imóveis enviados</span></div><div className="pipeline-step step-four"><strong>08</strong><span>Visita solicitada</span></div></div></article>
      <article className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">Acontecendo agora</p><h2>Atividade recente</h2></div><button>Ver todos →</button></div><div className="activity-list">{activity.map((item,index)=><div className="activity-row" key={item.name}><span className={`lead-avatar avatar-${index}`}>{item.initials}</span><div className="activity-copy"><strong>{item.name}</strong><span>{item.detail}</span></div><span className={`status-tag status-${index}`}>{item.tag}</span><time>{item.time}</time></div>)}</div></article>
    </div><aside className="conversation-card"><div className="conversation-head"><span className="lead-avatar avatar-0">LC</span><div><strong>Lucas Carvalho</strong><span><i /> online agora</span></div><button>•••</button></div><div className="lead-signal"><div><span>Lead score</span><strong>86<small>/100</small></strong></div><span className="hot-pill">Muito quente</span></div><div className="chat-area"><span className="chat-date">Hoje, 10:42</span><div className="bubble incoming">Oi! Estou procurando um apartamento de 3 quartos no Centro.</div><div className="bubble outgoing">Olá, Lucas! Qual valor máximo você pretende investir?</div><div className="bubble incoming">Até 600 mil. Pode ser financiamento.</div><div className="typing"><i/><i/><i/></div></div><div className="chat-composer"><button>＋</button><span>Escreva uma mensagem...</span><button className="send-button">➜</button></div><button className="simulate-button" onClick={onSimulate}>▶ Abrir conversa completa</button></aside></div>
  </>;
}

function Conversations({ messages, draft, setDraft, sendMessage, notify }: { messages: ChatMessage[]; draft: string; setDraft: (value: string) => void; sendMessage: (event: FormEvent) => void; notify: (message: string) => void }) {
  const contacts = [
    { initials:'LC',name:'Lucas Carvalho',preview:'Até 600 mil. Pode ser financiamento.',time:'10:45',unread:2,tone:0 },
    { initials:'AM',name:'Ana Martins',preview:'Gostei da segunda opção!',time:'10:31',unread:1,tone:1 },
    { initials:'RB',name:'Rafael Borges',preview:'Quero falar com um corretor.',time:'10:08',unread:0,tone:2 },
    { initials:'CS',name:'Carla Souza',preview:'Pode ser em Alphaville.',time:'09:42',unread:0,tone:3 },
  ];
  return <div className="inbox-layout">
    <aside className="inbox-list panel"><div className="inbox-search">⌕ <input aria-label="Buscar conversa" placeholder="Buscar conversa" /></div><div className="inbox-tabs"><button className="selected">Todas</button><button>Não lidas</button></div>{contacts.map((contact,index)=><button className={`contact-row ${index===0?'selected':''}`} key={contact.name}><span className={`lead-avatar avatar-${contact.tone}`}>{contact.initials}</span><span><strong>{contact.name}</strong><small>{contact.preview}</small></span><time>{contact.time}</time>{contact.unread>0&&<b>{contact.unread}</b>}</button>)}</aside>
    <section className="full-chat panel"><div className="full-chat-head"><span className="lead-avatar avatar-0">LC</span><div><strong>Lucas Carvalho</strong><span><i/> WhatsApp • IA atendendo</span></div><button onClick={()=>notify('Atendimento transferido para Marina')}>Assumir conversa</button></div><div className="full-chat-body"><span className="chat-date">Hoje</span>{messages.map(message=><div className={`bubble ${message.side}`} key={message.id}>{message.text}<small>{message.side==='incoming'?'10:44':'10:45'} ✓✓</small></div>)}</div><form className="full-composer" onSubmit={sendMessage}><button type="button">＋</button><input value={draft} onChange={(event)=>setDraft(event.target.value)} placeholder="Digite como se fosse o cliente..."/><button className="send-button" type="submit">➜</button></form></section>
    <aside className="lead-profile panel"><div className="profile-hero"><span className="lead-avatar avatar-0">LC</span><h3>Lucas Carvalho</h3><p>+55 11 99992-4120</p><span className="hot-pill">Muito quente</span></div><div className="score-ring"><strong>86</strong><span>Lead score</span></div><dl><div><dt>Intenção</dt><dd>Comprar</dd></div><div><dt>Tipo</dt><dd>Apartamento</dd></div><div><dt>Região</dt><dd>Centro</dd></div><div><dt>Orçamento</dt><dd>Até R$ 600 mil</dd></div><div><dt>Quartos</dt><dd>3+</dd></div><div><dt>Pagamento</dt><dd>Financiamento</dd></div></dl><button className="profile-action" onClick={()=>notify('Visita sugerida para sábado, 10h30')}>＋ Agendar visita</button></aside>
  </div>;
}

function Leads({ leads, search, setSearch, notify }: { leads: typeof leadRows; search:string; setSearch:(value:string)=>void; notify:(message:string)=>void }) {
  return <section className="table-panel panel"><div className="toolbar"><div className="search-field">⌕<input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar por nome, região ou intenção"/></div><button>Temperatura⌄</button><button>Intenção⌄</button></div><div className="lead-table"><div className="table-row table-head"><span>Lead</span><span>Intenção</span><span>Região</span><span>Score</span><span>Temperatura</span><span/></div>{leads.map((lead)=><button className="table-row" key={lead.name} onClick={()=>notify(`Perfil de ${lead.name} selecionado`)}><span className="lead-cell"><i className={`lead-avatar avatar-${lead.tone}`}>{lead.initials}</i><b>{lead.name}<small>{lead.phone}</small></b></span><span>{lead.intent}</span><span>{lead.region}</span><span className="score-cell"><i style={{width:`${lead.score}%`}}/><b>{lead.score}</b></span><span><em className={`temperature temp-${lead.tone}`}>{lead.status}</em></span><span>›</span></button>)}</div></section>;
}

function Properties({ properties, search, setSearch, add }: { properties:Property[]; search:string; setSearch:(value:string)=>void; add:()=>void }) {
  return <><div className="catalog-toolbar"><div className="search-field">⌕<input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar imóvel ou bairro"/></div><div><button>Venda e aluguel⌄</button><button>Mais filtros</button><button className="primary-button" onClick={add}>＋ Adicionar</button></div></div><div className="property-grid">{properties.map((property)=><article className="property-card" key={property.id}><div className={`property-visual ${property.tone}`}><span>◇</span><em>{property.match}% compatível</em></div><div className="property-copy"><small>{property.district}</small><h3>{property.title}</h3><p>{property.meta}</p><div><strong>{property.price}</strong><button aria-label="Abrir imóvel">›</button></div></div></article>)}</div></>;
}

function Agenda({ notify }: { notify:(message:string)=>void }) {
  return <div className="agenda-layout"><section className="panel calendar-panel"><div className="calendar-head"><button>‹</button><div><p className="eyebrow">Agosto de 2026</p><h2>Semana 24—30</h2></div><button>›</button></div><div className="week-strip">{['Seg 24','Ter 25','Qua 26','Qui 27','Sex 28','Sáb 29','Dom 30'].map((day,index)=><button className={index===3?'today':''} key={day}><span>{day.split(' ')[0]}</span><strong>{day.split(' ')[1]}</strong>{index===3&&<i/>}</button>)}</div><div className="timeline">{appointments.map((appointment)=><button className="appointment-row" onClick={()=>notify(`Visita de ${appointment.name} selecionada`)} key={appointment.time}><time>{appointment.time}</time><i className={appointment.color}/><span><strong>{appointment.name}</strong><small>{appointment.property} • {appointment.broker}</small></span><em>{appointment.status}</em><b>›</b></button>)}</div></section><aside className="panel day-summary"><p className="eyebrow">Resumo do dia</p><h2>Quinta, 27</h2><div className="summary-number"><strong>4</strong><span>visitas<br/>agendadas</span></div><ul><li><i className="mint"/>3 confirmadas</li><li><i className="amber"/>1 aguardando</li><li><i className="violet"/>2 corretores</li></ul><button className="primary-button" onClick={()=>notify('Novo horário preparado')}>＋ Novo horário</button></aside></div>;
}

function Automations({ notify }: { notify:(message:string)=>void }) {
  return <div className="automation-layout"><section className="automation-grid">{automations.map((automation)=><article className="automation-card panel" key={automation.name}><div className="automation-icon">{automation.icon}</div><span className="automation-state"><i/>{automation.state}</span><h3>{automation.name}</h3><p>{automation.detail}</p><footer><strong>{automation.count}</strong><button onClick={()=>notify(`${automation.name}: fluxo saudável`)}>Ver fluxo →</button></footer></article>)}</section><aside className="panel health-panel"><div className="health-orbit"><span>99,8<small>%</small></span></div><h3>Operação saudável</h3><p>Todos os fluxos executaram normalmente nas últimas 24 horas.</p><dl><div><dt>Execuções</dt><dd>142</dd></div><div><dt>Falhas</dt><dd>0</dd></div><div><dt>Tempo médio</dt><dd>1,8s</dd></div></dl></aside></div>;
}
