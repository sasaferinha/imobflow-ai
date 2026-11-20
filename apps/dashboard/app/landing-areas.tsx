'use client';

import Image from 'next/image';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import styles from './landing-areas.module.css';

type AreaId = 'conversas' | 'leads' | 'imoveis' | 'visitas' | 'equipe' | 'resultados' | 'marketing' | 'site' | 'studio';
type IconName = AreaId | 'check' | 'spark' | 'clock';

const areas: {
  id: AreaId;
  label: string;
  title: string;
  description: string;
  capabilities: [string, string, string];
  note?: string;
  scene: string;
}[] = [
  {
    id: 'conversas', label: 'Conversas e IA', title: 'O atendimento começa com contexto.',
    description: 'Conversa, ficha do cliente e apoio da IA no mesmo lugar. Menos troca de tela, mais atenção a quem está do outro lado.',
    capabilities: ['WhatsApp, Instagram e Facebook', 'Áudios e resumos com apoio da IA', 'Continuidade entre bot e corretor'],
    note: 'Cada canal depende de conexão e das permissões da Meta.',
    scene: 'Conversa ilustrativa com Ana no WhatsApp, suas preferências organizadas e uma sugestão de resposta da IA.',
  },
  {
    id: 'leads', label: 'Leads, funil e Match', title: 'A próxima oportunidade fica à vista.',
    description: 'Acompanhe cada negociação e encontre imóveis que combinam com o que o cliente procura, sem perder o histórico do atendimento.',
    capabilities: ['Funil individual por corretor', 'Ficha e origem de cada lead', 'Match entre perfil e imóveis'],
    scene: 'Funil ilustrativo com leads em atendimento, visita e negociação. Um apartamento de 450 mil reais combina com o perfil de Ana.',
  },
  {
    id: 'imoveis', label: 'Imóveis e captação', title: 'Uma carteira bem cuidada vende melhor.',
    description: 'Reúna as informações do imóvel desde a captação e acompanhe o que falta para deixar cada oportunidade pronta para apresentar.',
    capabilities: ['Ficha, fotos, documentos e chaves', 'Metas de captação e avisos de tempo em carteira', 'Estimativa de valor por comparáveis'],
    note: 'A estimativa depende dos comparáveis informados; não substitui um laudo.',
    scene: 'Ficha ilustrativa de um apartamento com foto, preço, área, dois quartos e uma lista de informações de captação.',
  },
  {
    id: 'visitas', label: 'Visitas e propostas', title: 'Da visita ao próximo passo, sem perder o fio.',
    description: 'Registre a visita, acompanhe propostas e reúna a percepção do cliente sobre o imóvel no mesmo histórico.',
    capabilities: ['Início e encerramento da visita', 'Link de avaliação para o corretor enviar', 'Nota e observação ligadas ao imóvel'],
    scene: 'Visita ilustrativa encerrada, com horário de início e fim, seguida de uma avaliação de cinco estrelas e comentário do cliente.',
  },
  {
    id: 'equipe', label: 'Equipe e plantões', title: 'Cada corretor sabe onde agir.',
    description: 'Organize a distribuição de leads e dê ao administrador uma visão da operação, respeitando a responsabilidade de cada corretor.',
    capabilities: ['Prioridade para corretores ativos no plantão', 'Metas e prazos de retorno configuráveis', 'Avisos e regras de atendimento para a equipe'],
    scene: 'Plantão ilustrativo com três corretores, dois ativos, e uma indicação de prioridade para quem está disponível.',
  },
  {
    id: 'resultados', label: 'Comissões e relatórios', title: 'Entenda o que leva ao fechamento.',
    description: 'Conecte os resultados das vendas às comissões e ao perfil dos compradores para orientar as próximas decisões da imobiliária.',
    capabilities: ['Regras de comissão por corretor', 'Cálculo vinculado ao fechamento', 'Relatórios de vendas e compradores'],
    scene: 'Relatório ilustrativo de vendas por mês e um cálculo de comissão de 2% sobre uma venda de 450 mil reais, totalizando 9 mil reais.',
  },
  {
    id: 'marketing', label: 'Marketing e campanhas', title: 'O marketing mais perto das oportunidades.',
    description: 'Veja as métricas da conta de anúncios e a origem dos leads junto à operação comercial, com espaço próprio para acompanhar campanhas.',
    capabilities: ['Conta de anúncios conectada à empresa', 'Alcance, cliques e custo por clique', 'Preparação de rascunhos pausados'],
    note: 'Requer autorização da Meta; recursos avançados seguem no Gerenciador de Anúncios.',
    scene: 'Área ilustrativa de campanhas de tráfego com métricas de alcance, cliques e custo por clique, além de uma campanha em rascunho pausado.',
  },
  {
    id: 'site', label: 'Site da imobiliária', title: 'Sua marca, sua vitrine, a mesma carteira.',
    description: 'Personalize o site da imobiliária e mantenha o catálogo conectado aos imóveis do CRM. A apresentação muda; a gestão continua em um só lugar.',
    capabilities: ['Três layouts e edição com prévia', 'Banner, vídeo e catálogo conectado', 'Domínio próprio com configuração assistida'],
    scene: 'Prévia ilustrativa do site de uma imobiliária com banner de um apartamento, opções de layout e cores da marca.',
  },
  {
    id: 'studio', label: 'Estúdio de mídia', title: 'Mais possibilidades para apresentar seus imóveis.',
    description: 'Explore ferramentas opcionais para trabalhar as fotos do imóvel e compor vídeos para o site e as redes sociais.',
    capabilities: ['Aprimoramento de fotos', 'Apresentação em vídeo', 'Movimento de câmera com IA'],
    note: 'Conheça a demonstração. Gerações por IA dependem de ativação, fornecedor e créditos.',
    scene: 'Prévia estática de uma composição de vídeo, com três fotos selecionadas, miniaturas e indicação de formatos horizontal e vertical.',
  },
];

const iconPaths: Record<IconName, string[]> = {
  conversas: ['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z', 'M8 10h8M8 14h5'],
  leads: ['M3 4h18l-7 8v7l-4 2v-9L3 4Z'],
  imoveis: ['m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z', 'M9 21V12h6v9'],
  visitas: ['M8 2v4M16 2v4M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'm9 15 2 2 4-4'],
  equipe: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  resultados: ['M4 3v18h17M8 16v-4M13 16V8M18 16V5'],
  marketing: ['m3 10 18-6v14L3 12v-2ZM7 14l2 7h3l-2-6M21 9h1M21 13h1'],
  site: ['M3 5h18v15H3V5ZM3 9h18M7 7h.01M10 7h.01M7 13h4v4H7v-4ZM14 13h3M14 17h3'],
  studio: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z'],
  check: ['m5 12 4 4L19 6'],
  spark: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2'],
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name].map((d, index) => <path d={d} key={index} />)}</svg>;
}

function Photo({ cozy = false, className }: { cozy?: boolean; className?: string }) {
  return <div className={`${styles.photo} ${className ?? ''}`}><Image src={cozy ? '/demo-media/sala-aconchegante.jpg' : '/demo-media/sala-clara.jpg'} alt="" fill sizes="(max-width: 700px) 90vw, 650px" unoptimized /></div>;
}

function SceneTop({ icon, title, aside }: { icon: IconName; title: string; aside?: string }) {
  return <div className={styles.sceneTop}><span><Icon name={icon} />{title}</span>{aside && <small>{aside}</small>}</div>;
}

function Scene({ area }: { area: AreaId }) {
  switch (area) {
    case 'conversas': return <div className={styles.conversationScene}>
      <div className={styles.chatColumn}>
        <div className={styles.contactHeader}><span className={styles.avatar}>A</span><div><strong>Ana Martins</strong><small>WhatsApp · em atendimento</small></div><span className={styles.channelMark}>W</span></div>
        <div className={styles.chatMessages}><p className={styles.incoming}>Procuro um apartamento no Centro de Lavras. Até R$ 500 mil, com 2 quartos.</p><p className={styles.outgoing}>Boa, Ana! Vou separar opções que combinam com você.</p></div>
        <div className={styles.aiSuggestion}><Icon name="spark" /><div><strong>Sugestão da IA</strong><span>Pergunte se uma vaga de garagem é importante para ela.</span></div></div>
        <div className={styles.compose}>Escreva sua mensagem<span>↵</span></div>
      </div>
      <aside className={styles.profileColumn}><span className={styles.miniEyebrow}>FICHA DO CLIENTE</span><strong>Ana Martins</strong><span className={styles.softPill}>Buscando apartamento</span><dl><div><dt>Região</dt><dd>Centro · Lavras</dd></div><div><dt>Orçamento</dt><dd>Até R$ 500 mil</dd></div><div><dt>Quartos</dt><dd>2 quartos</dd></div></dl><div className={styles.contextNote}><Icon name="check" />Contexto no atendimento</div></aside>
    </div>;
    case 'leads': return <div className={styles.funnelScene}>
      <SceneTop icon="leads" title="Meu funil" aside="Corretora · Marina" />
      <div className={styles.kanban}><div><span className={styles.columnLabel}>Em atendimento <b>2</b></span><div className={styles.leadCard}><span className={styles.tinyAvatar}>A</span><strong>Ana Martins</strong><small>Apartamento · Centro</small><span className={styles.matchPill}><Icon name="spark" /> Match encontrado</span></div><div className={styles.slimLead}>Pedro Santos<small>Casa · 3 quartos</small></div></div><div><span className={styles.columnLabel}>Visita <b>1</b></span><div className={styles.slimLead}>Carla Oliveira<small>Hoje, às 15h</small><span className={styles.miniTag}>Visita agendada</span></div></div><div><span className={styles.columnLabel}>Negociação <b>1</b></span><div className={styles.slimLead}>Lucas Ribeiro<small>Proposta recebida</small><span className={styles.miniTag}>Em análise</span></div></div></div>
      <div className={styles.matchResult}><Photo /><div><span className={styles.miniEyebrow}>COMBINA COM ANA</span><strong>Apartamento no Centro</strong><small>2 quartos · 78 m² · Lavras</small></div><b>R$ 450 mil</b></div>
    </div>;
    case 'imoveis': return <div className={styles.propertyScene}>
      <SceneTop icon="imoveis" title="Ficha do imóvel" aside="IMB-024" />
      <div className={styles.propertyBody}><div className={styles.propertyMain}><Photo /><span className={styles.available}>Disponível</span><h4>Apartamento no Centro</h4><span>Lavras, MG · 2 quartos · 78 m²</span><strong>R$ 450.000</strong></div><div className={styles.captureList}><span className={styles.miniEyebrow}>CAPTAÇÃO ORGANIZADA</span>{['Dados do proprietário', 'Características do imóvel', 'Fotos e documentação', 'Informações das chaves'].map(label => <div key={label}><Icon name="check" /><span>{label}</span></div>)}<div className={styles.captureNote}><Icon name="imoveis" /><span>Informações reunidas para o próximo atendimento.</span></div></div></div>
    </div>;
    case 'visitas': return <div className={styles.visitScene}>
      <SceneTop icon="visitas" title="Visita ao imóvel" aside="Ana · Centro" />
      <div className={styles.visitBody}><div className={styles.timeline}><span className={styles.miniEyebrow}>HISTÓRICO DA VISITA</span><div><i /><strong>Visita iniciada</strong><small>Hoje, 14h00 · Marina</small></div><div><i /><strong>Visita encerrada</strong><small>Hoje, 14h35</small></div><div><i /><strong>Avaliação recebida</strong><small>Hoje, 15h12 · Ana</small></div></div><div className={styles.reviewCard}><span className={styles.miniEyebrow}>AVALIAÇÃO DO IMÓVEL</span><Photo cozy /><strong>O que você achou?</strong><span className={styles.stars}>★★★★★</span><p>“Gostei da luz da sala e da localização. Quero conversar sobre a proposta.”</p><span className={styles.reviewReceived}><Icon name="check" />Resposta no histórico</span></div></div>
    </div>;
    case 'equipe': return <div className={styles.teamScene}>
      <SceneTop icon="equipe" title="Plantão da equipe" aside="Hoje · 08h às 18h" />
      <div className={styles.teamIntro}><div><span className={styles.miniEyebrow}>PRONTOS PARA ATENDER</span><strong>Disponibilidade que orienta a distribuição.</strong></div><span className={styles.teamCount}>2 ativos</span></div>
      <div className={styles.brokerRows}>{[{name:'Marina Costa',initials:'MC',status:'Ativa no plantão',active:true},{name:'Rafael Lima',initials:'RL',status:'Ativo no plantão',active:true},{name:'Bruna Santos',initials:'BS',status:'Fora do plantão',active:false}].map(broker => <div key={broker.name}><span className={`${styles.brokerAvatar} ${!broker.active ? styles.mutedAvatar : ''}`}>{broker.initials}</span><strong>{broker.name}</strong><span className={broker.active ? styles.onlineStatus : styles.offlineStatus}><i />{broker.status}</span></div>)}</div>
      <div className={styles.teamRule}><Icon name="equipe" /><div><strong>Priorizar corretores ativos</strong><span>Regra definida pelo administrador</span></div><span className={styles.enabledState}>Ativada</span></div>
    </div>;
    case 'resultados': return <div className={styles.resultsScene}>
      <SceneTop icon="resultados" title="Resultados da imobiliária" aside="Visão do administrador" />
      <div className={styles.resultsBody}><div className={styles.chartCard}><span className={styles.miniEyebrow}>VENDAS POR MÊS</span><div className={styles.chart}>{[{month:'Jan',height:34},{month:'Fev',height:57},{month:'Mar',height:43},{month:'Abr',height:78}].map(bar => <div key={bar.month}><span style={{height:`${bar.height}%`}} /><small>{bar.month}</small></div>)}</div><span className={styles.chartCaption}>Acompanhe a evolução da operação</span></div><div className={styles.commissionCard}><span className={styles.miniEyebrow}>VENDA CONCLUÍDA</span><span className={styles.commissionIcon}><Icon name="check" /></span><strong>Apartamento · Centro</strong><dl><div><dt>Valor de venda</dt><dd>R$ 450.000</dd></div><div><dt>Regra de exemplo</dt><dd>2% sobre a venda</dd></div></dl><div className={styles.commissionTotal}><span>Comissão calculada</span><strong>R$ 9.000</strong></div></div></div>
    </div>;
    case 'marketing': return <div className={styles.marketingScene}>
      <SceneTop icon="marketing" title="Campanhas da Meta" aside="Conta da imobiliária" />
      <div className={styles.metricsRow}><div><span>Alcance</span><strong>12.480</strong></div><div><span>Cliques</span><strong>34</strong></div><div><span>Custo por clique</span><strong>R$ 1,84</strong></div></div>
      <div className={styles.campaignTable}><div className={styles.tableLabels}><span>Campanha</span><span>Situação</span><span>Objetivo</span></div><div><span><b>Apartamentos no Centro</b><small>Acompanhamento da conta conectada</small></span><span className={styles.activeCampaign}>Ativa</span><span>Tráfego</span></div><div><span><b>Novos imóveis da semana</b><small>Rascunho preparado no CRM</small></span><span className={styles.pausedCampaign}>Pausada</span><span>Tráfego</span></div></div>
      <div className={styles.sourceTrace}><span>Anúncio</span><i /><span>Lead identificado</span><i /><span>Atendimento</span></div>
    </div>;
    case 'site': return <div className={styles.siteScene}>
      <div className={styles.editorTools}><span className={styles.miniEyebrow}>SEU SITE</span><strong>A sua marca<br />na primeira impressão.</strong><span className={styles.editorLabel}>Layout</span><div className={styles.layoutOptions}><span>Clássico</span><b>Moderno</b><span>Vitrine</span></div><span className={styles.editorLabel}>Cor da marca</span><div className={styles.swatches}><i /><i /><i /></div><span className={styles.previewTag}><Icon name="site" />Prévia do site</span></div>
      <div className={styles.websiteMock}><div className={styles.browserBar}><i /><i /><i /><span>suaimobiliaria.com.br</span></div><div className={styles.websiteNav}><strong>CASA<span>&</span>CO.</strong><span>Imóveis · Sobre · Contato</span></div><div className={styles.websiteHero}><Photo cozy /><div><span>SEU PRÓXIMO CAPÍTULO</span><strong>Um lugar para<br />chamar de seu.</strong></div></div><div className={styles.websiteCards}><div><Photo /><span>Apartamento · Centro</span><b>R$ 450.000</b></div><div><Photo cozy /><span>Casa · Jardim América</span><b>R$ 620.000</b></div></div></div>
    </div>;
    case 'studio': return <div className={styles.studioScene}>
      <SceneTop icon="spark" title="Estúdio de mídia" aside="Composição de exemplo" />
      <div className={styles.studioWorkspace}><div className={styles.studioComposition}><span className={styles.miniEyebrow}>PRÉVIA DE COMPOSIÇÃO</span><div className={styles.studioFrame}><Photo /><div className={styles.studioFrameCaption}><span>CASA&CO.</span><strong>Seu próximo<br />endereço.</strong></div></div><div className={styles.studioTrack}><span /><span /><span /></div><p>Formato vertical ou horizontal</p></div><div className={styles.studioSources}><span className={styles.miniEyebrow}>FOTOS SELECIONADAS</span><div className={styles.studioThumbnails}>{[false, true, false].map((cozy, index) => <div key={index}><Photo cozy={cozy} /><span>Foto 0{index + 1}</span></div>)}</div><span className={styles.studioCompositionNote}>Fotos, texto e marca na mesma composição.</span></div></div>
    </div>;
  }
}

function subscribeToCompactLayout(callback: () => void) {
  const query = window.matchMedia('(max-width: 840px)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

export default function LandingAreas() {
  const [activeIndex, setActiveIndex] = useState(0);
  const componentId = useId();
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const navRef = useRef<HTMLDivElement>(null);
  const compact = useSyncExternalStore(subscribeToCompactLayout, () => window.matchMedia('(max-width: 840px)').matches, () => false);
  const active = areas[activeIndex];

  useEffect(() => {
    const nav = navRef.current;
    const tab = tabsRef.current[activeIndex];
    if (!nav || !tab || nav.scrollWidth <= nav.clientWidth) return;
    const navRect = nav.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    if (tabRect.left < navRect.left) nav.scrollLeft -= navRect.left - tabRect.left + 8;
    else if (tabRect.right > navRect.right) nav.scrollLeft += tabRect.right - navRect.right + 8;
  }, [activeIndex, compact]);

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % areas.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index - 1 + areas.length) % areas.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? areas.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next);
    tabsRef.current[next]?.focus({ preventScroll: true });
  }

  return <section className={styles.section} id="plataforma" aria-labelledby={`${componentId}-title`}>
    <div className={styles.heading}><span className={styles.eyebrow}>EXPLORE A IMOBFLOW</span><h2 id={`${componentId}-title`}>Toda a imobiliária.<br /><span>No mesmo fluxo.</span></h2><p>Do primeiro contato à próxima venda, conheça as áreas que conectam o trabalho da sua equipe.</p></div>
    <div className={styles.explorer}>
      <div className={styles.navigation} ref={navRef} role="tablist" aria-label="Áreas da ImobFlow" aria-orientation={compact ? 'horizontal' : 'vertical'}>{areas.map((area, index) => <button key={area.id} id={`${componentId}-tab-${area.id}`} type="button" role="tab" aria-selected={index === activeIndex} aria-controls={`${componentId}-panel-${area.id}`} tabIndex={index === activeIndex ? 0 : -1} ref={element => { tabsRef.current[index] = element; }} onClick={() => setActiveIndex(index)} onKeyDown={event => handleTabKey(event, index)} className={styles.tab}><Icon name={area.id} /><span>{area.label}</span></button>)}</div>
      {areas.map((area, index) => <div key={area.id} id={`${componentId}-panel-${area.id}`} role="tabpanel" aria-labelledby={`${componentId}-tab-${area.id}`} tabIndex={0} hidden={index !== activeIndex} className={styles.panel}>{index === activeIndex && <div className={styles.panelContent} key={active.id}>
        <div className={styles.sceneStage}><div className={styles.scene} role="img" aria-label={area.scene}><Scene area={area.id} /></div><span className={styles.illustrationLabel}>Visão ilustrativa · dados fictícios</span></div>
        <div className={styles.details}><div><h3>{area.title}</h3><p>{area.description}</p></div><ul>{area.capabilities.map(capability => <li key={capability}><Icon name="check" /><span>{capability}</span></li>)}</ul>{area.note && <p className={styles.note}>{area.note}</p>}{area.id === 'studio' && <a className={styles.studioLink} href="/modelo-imobiliaria/midias" target="_blank" rel="noopener noreferrer" aria-label="Explorar estúdio de demonstração (abre em nova aba)">Explorar estúdio de demonstração</a>}</div>
      </div>}</div>)}
    </div>
    <div className={styles.sectionFooter}><p>Explore o painel no seu ritmo, com dados de demonstração.</p><a href="/demonstracao" target="_blank" rel="noopener noreferrer" aria-label="Conhecer a demonstração (abre em nova aba)">Conhecer a demonstração</a></div>
  </section>;
}
