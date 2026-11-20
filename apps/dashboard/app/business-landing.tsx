import Image from 'next/image';
import type { CSSProperties } from 'react';
import s from './business-landing.module.css';
import LandingJourney from './landing-journey';
import LandingAreas from './landing-areas';
import LandingMotion from './landing-motion';
import ProductPreview from './product-preview';

const CONTACT = 'https://wa.me/5535991652306';

function Brand() {
  return <span className={s.brand}><svg viewBox="0 0 32 44" width="27" height="37" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 41V24l8-4v21M11 20V7l12-5v39M23 16h6v25"/></svg><strong>ImobFlow<span>GESTÃO IMOBILIÁRIA</span></strong></span>;
}
function Icon({ type }: { type: 'chat' | 'spark' | 'team' | 'check' | 'home' }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type === 'chat' ? <path d="M20 11a8 8 0 0 1-8 8H4l1-4a8 8 0 1 1 15-4ZM8 10h8m-8 4h5"/> : type === 'spark' ? <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6Z"/></> : type === 'team' ? <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></> : type === 'home' ? <path d="m3 10 9-7 9 7v11H3ZM9 21v-8h6v8"/> : <path d="m5 12 4 4L19 6"/>}</svg>;
}
function FlowSculpture() {
  return <div className={s.heroArt} aria-label="Ilustração de um contato encontrando um imóvel compatível">
    <div className={s.sculpture} aria-hidden="true"><div className={s.ribbon}>{Array.from({length:24}, (_, index) => <i key={index} style={{'--layer':index} as CSSProperties}/>)}</div></div>
    <div className={s.messageCard}><div className={s.artLabel}><span className={s.person}>AM</span><div><strong>Ana Martins</strong><small>Novo contato · WhatsApp</small></div><Icon type="chat"/></div><p>Procuro um apartamento.<br/>Pode me ajudar a encontrar?</p><span className={s.contextPill}><Icon type="spark"/>O atendimento ganha contexto</span></div>
    <div className={s.matchCard}><div className={s.matchPhoto}><Image src="/demo-media/sala-clara.jpg" alt="Sala clara de apartamento, imagem ilustrativa" fill unoptimized priority sizes="250px"/><span><Icon type="spark"/>Match encontrado</span></div><div className={s.matchInfo}><strong>Um lugar que combina.</strong><span>Centro · 2 quartos · 1 vaga</span><div><b>R$ 450 mil</b><span>Perfil compatível</span></div></div></div>
    <span className={s.flowLabel}><Icon type="check"/>Conversa, perfil e imóvel conectados</span>
    <span className={s.artNote}>Cena ilustrativa · dados fictícios</span>
  </div>;
}
const questions = [
  ['Por onde minha imobiliária começa?', 'Converse com a nossa equipe sobre sua carteira, seus canais e a rotina dos corretores. A partir disso, alinhamos a configuração e os recursos que fazem sentido para a sua operação. Você também pode explorar a demonstração sem cadastrar clientes reais.'],
  ['É para o corretor ou para o administrador?', 'Para os dois. O corretor acompanha sua carteira, os atendimentos e os próximos passos. O administrador consulta os resultados, acompanha a equipe e configura as regras da imobiliária. Os acessos seguem o perfil de cada pessoa.'],
  ['WhatsApp, Instagram e Facebook ficam no mesmo lugar?', 'A área de Conversas reúne os canais conectados e autorizados. O atendimento mantém o canal de origem do lead. Cada conexão depende das permissões, do tipo de conta e das regras da Meta; nossa equipe orienta essa configuração.'],
  ['A inteligência artificial substitui o corretor?', 'A IA apoia a organização das preferências e do contexto do atendimento. O corretor pode assumir a conversa, revisar as oportunidades e conduzir a visita e a negociação. A relação com o cliente continua nas mãos da sua equipe.'],
  ['Preciso cadastrar os imóveis duas vezes para ter um site?', 'Não. Você administra os imóveis na ImobFlow, e o catálogo do site acompanha essa carteira. O editor cuida do visual: layouts, marca, textos, banners e vídeos. Um domínio próprio pode ser conectado com configuração assistida.'],
  ['Todos os recursos fazem parte do mesmo plano?', 'A composição é alinhada com a sua imobiliária. Conexões e recursos adicionais podem depender de habilitação específica. O estúdio de mídia tem uma demonstração; gerações por IA dependem de ativação, fornecedor e créditos. Converse com a equipe para definir o que será incluído.'],
];

export default function BusinessLanding() {
  return <LandingMotion><main className={s.page}>
    <a className={s.skip} href="#conteudo">Pular para o conteúdo</a>
    <header className={s.header}><div className={s.nav}>
      <a href="#conteudo" className={s.logoLink} aria-label="ImobFlow — início"><Brand/></a>
      <nav aria-label="Navegação principal"><a href="#plataforma">A plataforma</a><a href="#como-funciona">Como funciona</a><a href="#site-conectado">Seu site</a></nav>
      <div className={s.navActions}><a className={s.login} href="/painel">Entrar</a><a className={s.navCta} href={CONTACT} target="_blank" rel="noopener noreferrer">Vamos conversar</a></div>
    </div></header>

    <section id="conteudo" className={s.hero} aria-labelledby="landing-title">
      <div className={s.heroGrid}>
        <div className={s.heroCopy} data-reveal><p className={s.eyebrow}>CRM + INTELIGÊNCIA PARA IMOBILIÁRIAS</p><h1 id="landing-title">Mais espaço<br/>para <span>vender.</span></h1><p className={s.heroDescription}>Menos informação espalhada. Mais oportunidades conectadas. Conversas, imóveis e equipe no mesmo fluxo, do primeiro oi ao próximo negócio.</p><div className={s.heroActions}><a className={s.primary} href="#produto">Experimentar a ImobFlow</a><a className={s.textLink} href="#plataforma">Conhecer a plataforma</a></div><p className={s.heroFootnote}>Explore o painel de demonstração, sem cadastro.</p></div>
        <FlowSculpture/>
      </div>
      <div className={s.heroBottom}><p>FEITA PARA A ROTINA<br/>DE QUEM VENDE IMÓVEIS.</p><div><span>Atender com contexto</span><span>Encontrar o Match</span><span>Acompanhar cada etapa</span></div><a href="#como-funciona" aria-label="Conhecer o fluxo de atendimento"><span className={s.scrollCue} aria-hidden="true"/>Conheça o fluxo</a></div>
    </section>

    <section id="como-funciona" className={s.journeySection} aria-labelledby="journey-title">
      <div className={s.sectionIntro} data-reveal><p className={s.eyebrow}>CADA CONVERSA PODE ABRIR UMA PORTA.</p><div><h2 id="journey-title">Um novo contato.<br/><span>Um caminho mais claro.</span></h2><p>O cliente conta o que procura. A ImobFlow organiza o contexto. Seu corretor encontra o imóvel e conduz o próximo passo.<br/><strong>Experimente essa jornada abaixo.</strong></p></div></div>
      <div className={s.journeyFrame} data-reveal><LandingJourney/></div>
      <div className={s.channelLine}><span>Uma rotina de atendimento para</span><strong>WhatsApp</strong><strong>Instagram</strong><strong>Facebook</strong><small>Mediante conexão e autorização dos canais.</small></div>
    </section>

    <LandingAreas/>

    <section id="sua-equipe" className={s.teamSection} aria-labelledby="team-title">
      <div className={s.teamIntro} data-reveal><p className={s.eyebrow}>CADA PESSOA NO SEU MELHOR PAPEL.</p><h2 id="team-title">Liberdade para atender.<br/><span>Clareza para gerir.</span></h2></div>
      <div className={s.teamGrid}>
        <article className={s.brokerCard} data-reveal><div className={s.roleHeading}><Icon type="chat"/><span>PARA O CORRETOR</span></div><h3>Abra a conversa.<br/>Encontre o próximo passo.</h3><p>Cliente, preferências, imóveis compatíveis e visitas acessíveis durante o atendimento. Menos idas e vindas entre ferramentas.</p><div className={s.brokerScene}><div className={s.customerLine}><span className={s.person}>AM</span><div><strong>Ana Martins</strong><small>Conversa com Marina · exemplo</small></div><span className={s.stageBadge}>Em atendimento</span></div><div className={s.customerSummary}><span><Icon type="home"/>Apartamento · Centro</span><span>2 quartos · até R$ 500 mil</span></div><div className={s.nextVisit}><span className={s.visitDay}>18<small>NOV</small></span><div><strong>Visita agendada</strong><span>Apartamento no Centro · 14h</span></div><Icon type="check"/></div></div></article>
        <article className={s.managerCard} data-reveal><div className={s.roleHeading}><Icon type="team"/><span>PARA A GESTÃO</span></div><h3>O time em movimento.<br/>Você com a visão do todo.</h3><p>Acompanhe funis, responsáveis, metas e retornos. Entenda o que avança e onde sua equipe precisa de apoio.</p><div className={s.managerScene}><div><strong>Visão da equipe</strong><span>Exemplo de operação</span></div>{[['Marina','Visitas em andamento',84],['Rafael','Negociações em andamento',61],['Luiza','Novos atendimentos',43]].map(([name,label,value]) => <div className={s.teamRow} key={name}><span>{name}</span><div><small>{label}</small><span className={s.teamBar}><i style={{width:`${value}%`}}/></span></div></div>)}</div></article>
      </div>
    </section>

    <section id="site-conectado" className={s.websiteSection} aria-labelledby="website-title">
      <div className={s.websiteCopy} data-reveal><p className={s.eyebrow}>SUA PRESENÇA TAMBÉM FAZ PARTE DO FLUXO.</p><h2 id="website-title">Sua marca na frente.<br/><span>Sua carteira por trás.</span></h2><p>Um site com a cara da sua imobiliária e um catálogo conectado ao CRM. Mudou o imóvel na ImobFlow? O site acompanha.</p><ul><li><Icon type="check"/>Escolha entre os modelos Clássico, Moderno e Vitrine.</li><li><Icon type="check"/>Edite sua marca, banners, textos e vídeos com prévia.</li><li><Icon type="check"/>Conecte seu domínio com configuração assistida.</li></ul><a className={s.secondary} href="/modelo-imobiliaria" target="_blank" rel="noopener noreferrer">Explorar um site de exemplo</a></div>
      <div className={s.websitePreview} data-reveal><div className={s.browserBar}><span className={s.browserDots} aria-hidden="true"><i/><i/><i/></span><span>O site da sua imobiliária</span><Icon type="home"/></div><div className={s.exampleNav}><div><strong>Sua imobiliária</strong><small>Encontre seu próximo lugar.</small></div><span>Comprar · Alugar</span></div><div className={s.propertyImage}><Image src="/demo-media/sala-aconchegante.jpg" alt="Sala mobiliada ilustrando um site de imobiliária" fill unoptimized sizes="(max-width: 800px) 90vw, 600px"/><p>Um novo lugar.<br/>Uma nova história.</p></div><div className={s.exampleProperty}><div><p>DESTAQUE DA CARTEIRA</p><h3>Apartamento no Centro</h3><small>Lavras · 2 quartos · 1 vaga</small></div><strong>R$ 450 mil</strong></div><div className={s.catalogNotice}><Icon type="check"/><span>Seu catálogo conectado à ImobFlow</span></div><p className={s.exampleNote}>Site de exemplo · imóvel e dados fictícios · foto ilustrativa</p></div>
    </section>

    <section id="produto" className={s.product} aria-label="Explore o painel real da ImobFlow"><div className={s.productPrelude} data-reveal><span>AGORA É COM VOCÊ.</span><p>Veja o sistema.<br/><strong>Sinta como o trabalho flui.</strong></p></div><ProductPreview/></section>

    <section className={s.faq} aria-labelledby="faq-title"><div data-reveal><p className={s.eyebrow}>ANTES DO PRÓXIMO PASSO.</p><h2 id="faq-title">Boas perguntas.<br/><span>Respostas claras.</span></h2><p>Uma plataforma conectada à sua operação começa com uma boa conversa.</p><a className={s.textLink} href={CONTACT} target="_blank" rel="noopener noreferrer">Tirar uma dúvida com a equipe</a></div><div className={s.faqItems}>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

    <section className={s.closing} aria-labelledby="closing-title"><div className={s.closingLines} aria-hidden="true">{Array.from({length:10},(_,i)=><i key={i} style={{'--layer':i} as CSSProperties}/>)}</div><div data-reveal><p className={s.eyebrow}>SEU PRÓXIMO CAPÍTULO COMEÇA AQUI.</p><h2 id="closing-title">Dê mais espaço<br/>ao que faz sua<br/><span>imobiliária crescer.</span></h2><p>Vamos conhecer sua equipe, sua carteira e o jeito como vocês trabalham.</p><div className={s.closingActions}><a className={s.primary} href={CONTACT} target="_blank" rel="noopener noreferrer">Conversar com a ImobFlow</a><a href="/demonstracao" target="_blank" rel="noopener noreferrer">Explorar a demonstração</a></div></div></section>
    <footer className={s.footer}><div><a href="#conteudo" aria-label="ImobFlow — início"><Brand/></a><p>Mais contexto para atender.<br/>Mais clareza para crescer.</p><nav aria-label="Links do rodapé"><a href="#plataforma">A plataforma</a><a href="/privacidade">Privacidade</a><a href="/painel">Acessar painel</a></nav></div><span className={s.footerWord} aria-hidden="true">imobflow.</span></footer>
  </main></LandingMotion>;
}
