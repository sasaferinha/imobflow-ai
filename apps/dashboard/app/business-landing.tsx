import Image from 'next/image';
import s from './business-landing.module.css';
import LandingJourney from './landing-journey';
import ProductPreview from './product-preview';

const WHATSAPP_CONTACT_URL = 'https://wa.me/5535991652306';

function Brand() {
  return <span className={s.brand}><svg viewBox="0 0 32 44" width="27" height="37" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 41V24l8-4v21M11 20V7l12-5v39M23 16h6v25"/></svg><strong>ImobFlow<span>GESTÃO IMOBILIÁRIA</span></strong></span>;
}
function Icon({ type }: { type: 'chat' | 'match' | 'team' | 'check' | 'home' }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type === 'chat' ? <path d="M20 11a8 8 0 0 1-8 8H4l1-4a8 8 0 1 1 15-4ZM8 10h8m-8 4h5"/> : type === 'match' ? <><path d="m4 8 4-4 4 4M8 4v11a5 5 0 0 0 5 5h7M16 4h4v4M20 4l-6 6"/><path d="m17 17 3 3-3 3"/></> : type === 'team' ? <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></> : type === 'home' ? <path d="m3 10 9-7 9 7v11H3ZM9 21v-8h6v8"/> : <path d="m5 12 4 4L19 6"/>}</svg>;
}
const questions = [
  ['A ImobFlow é para o corretor ou para o administrador?', 'Para os dois. O corretor organiza sua carteira, atende e acompanha oportunidades. O administrador acompanha a equipe, configura regras e consulta os resultados da imobiliária.'],
  ['A IA substitui o atendimento do corretor?', 'A IA ajuda a reunir o que o cliente procura e a dar contexto ao atendimento. O corretor pode assumir a conversa e decidir os próximos passos, como apresentar um imóvel ou agendar uma visita.'],
  ['Como funciona o Match de imóveis?', 'A ImobFlow compara o perfil do lead com a carteira de imóveis: finalidade, tipo, região, orçamento e outras preferências. As opções compatíveis aparecem como oportunidades para a equipe revisar.'],
  ['O site da imobiliária fica conectado ao CRM?', 'Sim. Os imóveis são administrados na ImobFlow e alimentam o catálogo público da empresa. O visual, os textos, os banners e os vídeos do site podem ser personalizados na área do site.'],
];

export default function BusinessLanding() {
  return <main className={s.page}>
    <a className={s.skip} href="#conteudo">Pular para o conteúdo</a>
    <header className={s.header}><div className={s.nav}>
      <a href="#" className={s.logoLink} aria-label="ImobFlow — início"><Brand/></a>
      <nav aria-label="Navegação principal"><a href="#como-funciona">Como funciona</a><a href="#sua-equipe">Sua equipe</a><a href="#site-conectado">Seu site</a></nav>
      <div className={s.navActions}><a className={s.login} href="/painel">Entrar</a><a className={s.navCta} href="#produto">Ver demonstração</a></div>
    </div></header>

    <section id="conteudo" className={s.hero} aria-labelledby="landing-title">
      <div className={s.heroIntro}>
        <div><p className={s.eyebrow}>INTELIGÊNCIA PARA O MERCADO IMOBILIÁRIO</p><h1 id="landing-title">Boas conversas.<br/><span>Novos negócios.</span></h1></div>
        <div className={s.heroAside}><p>Conecte atendimento, clientes e imóveis em um só lugar. Sua equipe com contexto para vender. Você com clareza para acompanhar.</p><div className={s.heroActions}><a className={s.primary} href="#como-funciona">Experimente o fluxo</a><a className={s.secondary} href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">Falar com a equipe</a></div></div>
      </div>
      <div id="como-funciona" className={s.journey}><LandingJourney/></div>
      <div className={s.promiseRow}><span><Icon type="chat"/>Atendimento com contexto</span><span><Icon type="match"/>Imóveis que combinam</span><span><Icon type="team"/>Equipe na mesma página</span></div>
    </section>

    <section id="sua-equipe" className={s.teamSection} aria-labelledby="team-title">
      <div className={s.teamIntro}><p className={s.eyebrow}>UMA OPERAÇÃO. TODO MUNDO CONECTADO.</p><h2 id="team-title">O corretor avança.<br/><span>A gestão acompanha.</span></h2><p>As informações seguem com o atendimento. Cada pessoa encontra o que precisa para fazer a sua parte.</p></div>
      <div className={s.roleGrid}>
        <article className={s.roleCard}><div className={s.roleHeading}><span className={s.roleIcon}><Icon type="chat"/></span><p>PARA QUEM VENDE</p></div><h3>Seu próximo passo,<br/>mais claro.</h3><ul><li><Icon type="check"/>Carteira de clientes com histórico e preferências.</li><li><Icon type="check"/>Imóveis compatíveis para continuar a conversa.</li><li><Icon type="check"/>Visitas e negociações no mesmo fluxo.</li></ul></article>
        <article className={s.roleCard}><div className={s.roleHeading}><span className={s.roleIcon}><Icon type="team"/></span><p>PARA QUEM GERENCIA</p></div><h3>Sua equipe,<br/>mais perto.</h3><ul><li><Icon type="check"/>Funil e responsáveis pelo atendimento.</li><li><Icon type="check"/>Metas de captação e pendências da equipe.</li><li><Icon type="check"/>Relatórios para acompanhar a operação.</li></ul></article>
      </div>
    </section>

    <section id="produto" className={s.product} aria-label="Explore o painel real da ImobFlow"><ProductPreview/></section>

    <section id="site-conectado" className={s.websiteSection} aria-labelledby="website-title">
      <div className={s.websiteCopy}><p className={s.eyebrow}>DO CRM PARA A SUA VITRINE</p><h2 id="website-title">Sua marca.<br/>Seus imóveis.<br/><span>Seu site conectado.</span></h2><p>Cadastre o imóvel uma vez na ImobFlow e mantenha o catálogo do site conectado à sua carteira.</p><p>Escolha o layout, personalize a apresentação e dê aos seus imóveis um endereço com a cara da sua imobiliária.</p><a className={s.secondary} href="/modelo-imobiliaria" target="_blank" rel="noopener noreferrer" aria-label="Conhecer um site de exemplo (abre em nova aba)">Conhecer um site de exemplo</a></div>
      <div className={s.websitePreview}>
        <div className={s.browserBar}><span className={s.browserDots} aria-hidden="true"><i/><i/><i/></span><span>O site da sua imobiliária</span><Icon type="home"/></div>
        <div className={s.exampleNav}><div><strong>Sua imobiliária</strong><small>Um novo lugar para sua história.</small></div><span>Comprar · Alugar</span></div>
        <div className={s.propertyImage}><Image src="/demo-media/sala-aconchegante.jpg" alt="Sala mobiliada usada como imagem ilustrativa do site de uma imobiliária" fill unoptimized sizes="(max-width: 800px) 90vw, 550px"/><p>Encontre um lugar<br/>para chamar de seu.</p></div>
        <div className={s.exampleProperty}><div><p>DESTAQUE DA CARTEIRA</p><h3>Apartamento no Centro</h3><small>Lavras · 2 quartos · 1 vaga</small></div><strong>R$ 450 mil</strong></div>
        <div className={s.catalogNotice}><Icon type="check"/><span>Catálogo conectado à ImobFlow</span></div>
        <p className={s.exampleNote}>Site de exemplo · imóvel e dados fictícios · foto ilustrativa</p>
      </div>
    </section>

    <section className={s.faq} aria-labelledby="faq-title"><div><p className={s.eyebrow}>ANTES DE COMEÇAR</p><h2 id="faq-title">Vamos deixar<br/><span>tudo claro.</span></h2><p>Conheça a ideia. Experimente o painel. Converse com a nossa equipe.</p></div><div className={s.faqItems}>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

    <section className={s.closing} aria-labelledby="closing-title"><p className={s.eyebrow}>O PRÓXIMO PASSO É UMA CONVERSA.</p><h2 id="closing-title">Vamos conhecer<br/>a sua imobiliária?</h2><p>Conte como sua equipe trabalha e descubra onde a ImobFlow pode ajudar.</p><div className={s.closingActions}><a className={s.primary} href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer" aria-label="Conversar com a equipe da ImobFlow pelo WhatsApp (abre em nova aba)">Conversar com a ImobFlow</a><a className={s.closingDemo} href="/demonstracao" target="_blank" rel="noopener noreferrer">Explorar a demonstração</a></div></section>
    <footer className={s.footer}><a href="#" aria-label="ImobFlow — início"><Brand/></a><p>Mais contexto para atender.<br/>Mais clareza para crescer.</p><nav aria-label="Links do rodapé"><a href="/privacidade">Privacidade</a><a href="/painel">Acessar painel</a></nav></footer>
  </main>;
}
