'use client';

import { useEffect, useRef } from 'react';
import s from './business-landing.module.css';
import ProductPreview from './product-preview';

const WHATSAPP_CONTACT_URL = 'https://wa.me/5535991652306';

function Brand({small=false}:{small?:boolean}) {
  return <span className={`${s.brand} ${small?s.smallBrand:''}`}><svg viewBox="0 0 32 44" width="30" height="41" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 41V24l8-4v21M11 20V7l12-5v39M23 16h6v25"/></svg><span><strong>ImobFlow</strong>{!small&&<span>GESTÃO IMOBILIÁRIA</span>}</span></span>;
}
function Arrow(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>;}
function Icon({type}:{type:'chat'|'team'|'chart'}){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type==='chat'?<path d="M20 11a8 8 0 0 1-8 8H4l1-4a8 8 0 1 1 15-4ZM8 10h8m-8 4h5"/>:type==='team'?<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>:<path d="M4 4v16h16M8 15v-3m5 3V7m5 8v-5"/>}</svg>;}
function Check(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>;}
export default function BusinessLanding(){
  const root=useRef<HTMLElement>(null);
  useEffect(()=>{const el=root.current;if(!el||!('IntersectionObserver' in window)||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;const observer=new IntersectionObserver(items=>items.forEach(item=>{if(item.isIntersecting){item.target.classList.add(s.revealed);observer.unobserve(item.target);}}),{threshold:.1});el.querySelectorAll('[data-reveal]').forEach(node=>{node.classList.add(s.revealReady);observer.observe(node);});return()=>observer.disconnect();},[]);
  return <main ref={root} className={s.page}>
    <a className={s.skip} href="#conteudo">Pular para o conteúdo</a>
    <header className={s.header}><div className={s.nav}>
      <a href="#" className={s.logoLink} aria-label="ImobFlow — início"><Brand/></a>
      <nav aria-label="Navegação principal"><a href="#produto">Produto</a><a href="#como-funciona">Como funciona</a></nav>
      <div className={s.navActions}><a className={s.login} href="/painel">Entrar</a><a className={s.navCta} href="#produto">Conhecer a ImobFlow <Arrow/></a></div>
    </div></header>

    <section id="conteudo" className={s.hero}>
      <div className={s.heroAtmosphere} aria-hidden="true"><i className={s.orbOne}/><i className={s.orbTwo}/><i className={s.orbThree}/><svg className={s.flowLine} viewBox="0 0 1200 500" preserveAspectRatio="none"><path d="M-60 330 C180 100 320 440 550 230 S920 30 1260 280"/><path d="M-20 390 C220 190 390 500 670 270 S1010 130 1240 340"/></svg></div>
      <div className={s.heroContent}>
        <p className={s.eyebrow}>MUITO MAIS QUE UM CRM IMOBILIÁRIO</p>
        <h1>Menos tarefas manuais.<br/><span>Mais tempo para vender.</span></h1>
        <p className={s.heroCopy}>Organize leads, automatize o atendimento pelo WhatsApp<br className={s.desktopBreak}/> e acompanhe sua equipe em um só lugar.</p>
        <div className={s.heroActions}><a className={s.primary} href="#produto">Conhecer a ImobFlow <Arrow/></a><a className={s.textLink} href="#como-funciona">Veja como funciona <span aria-hidden="true">↓</span></a></div>
        <div className={s.heroFoot}><span>Atendimento.</span><span>Organização.</span><span>Clareza para decidir.</span></div>
      </div>
      <div className={s.signalCloud} aria-hidden="true">
        <article className={s.leadSignal}><span className={s.signalIcon}>01</span><div><small>LEAD CATALOGADO</small><strong>Compra · Centro</strong><p>2 quartos · até R$ 450 mil</p></div></article>
        <article className={s.routeSignal}><span className={s.liveDot}/><div><small>ROTEAMENTO CERTO</small><strong>Venda → corretor de vendas</strong></div></article>
        <article className={s.matchSignal}><span className={s.matchIcon}><Check/></span><div><small>MATCH IMOBFLOW</small><strong>Imóvel compatível</strong><p>Oportunidade pronta</p></div></article>
      </div>
    </section>

    <div className={s.motionRail} aria-label="Recursos: leads catalogados, atendimento inteligente, match de imóveis, compra e aluguel, equipe organizada">
      <div className={s.motionTrack} aria-hidden="true">{Array.from({length:2}).map((_,group)=><div key={group}><span>LEADS CATALOGADOS</span><i/><span>ATENDIMENTO INTELIGENTE</span><i/><span>MATCH DE IMÓVEIS</span><i/><span>COMPRA E ALUGUEL</span><i/><span>EQUIPE ORGANIZADA</span><i/></div>)}</div>
    </div>

    <section id="produto" className={s.product} aria-label="Demonstração do produto" data-reveal>
      <ProductPreview />
    </section>

    <section className={s.matchSection} aria-labelledby="match-title" data-reveal>
      <div className={s.matchCopy}><p className={s.eyebrow}>MATCH IMOBFLOW</p><h2 id="match-title">O perfil certo encontra<br/><span>o imóvel certo.</span></h2><p>A ImobFlow cruza o que cada lead procura com os imóveis disponíveis. Quando uma nova oportunidade entra, os perfis já catalogados continuam trabalhando a favor da sua equipe.</p><a className={s.textLink} href="#como-funciona">Entenda o fluxo <span aria-hidden="true">↓</span></a></div>
      <div className={s.matchStage} aria-label="Demonstração visual do match entre perfil e imóvel">
        <article className={s.profileCard}><small>PERFIL DO LEAD</small><strong>Apartamento</strong><p>Centro · 2 quartos</p><span>COMPRA</span></article>
        <div className={s.matchPulse} aria-hidden="true"><i/><i/><span><Check/></span><b>MATCH</b></div>
        <article className={s.propertyCard}><small>IMÓVEL</small><svg viewBox="0 0 90 68" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M7 62V31l30-19 29 19v31M37 12v50M66 31l17-10v41"/></svg><strong>COMPATÍVEL</strong><p>oportunidade pronta</p></article>
      </div>
    </section>

    <section className={s.benefits} aria-labelledby="benefits-title" data-reveal>
      <div className={s.sectionIntro}><p className={s.eyebrow}>DO PRIMEIRO CONTATO À GESTÃO</p><h2 id="benefits-title">Sua operação conectada.<br/><span>Sem perder o fio da conversa.</span></h2></div>
      <div className={s.benefitGrid}>{[{icon:'chat' as const,title:'Atenda com contexto.',copy:'Automatize as primeiras perguntas pelo WhatsApp e entregue ao corretor um lead com preferências organizadas.'},{icon:'team' as const,title:'Cada lead no seu lugar.',copy:'Organize responsáveis, imóveis e oportunidades. A equipe sabe quem atender e o que o cliente procura.'},{icon:'chart' as const,title:'Enxergue o que acontece.',copy:'Acompanhe atendimentos, metas e resultados. Tome decisões com as informações da sua operação reunidas.'}].map(b=><article key={b.title}><Icon type={b.icon}/><h3>{b.title}</h3><p>{b.copy}</p></article>)}</div>
    </section>

    <section id="como-funciona" className={s.how} data-reveal><div><p className={s.eyebrow}>COMO FUNCIONA</p><h2>Uma rotina mais simples.<br/><span>Em três passos.</span></h2></div><ol>{[['Configure sua imobiliária','Cadastre a equipe, os imóveis e conecte o WhatsApp da empresa.'],['Organize o atendimento','Receba os leads, reúna as preferências e acompanhe os responsáveis.'],['Acompanhe e melhore','Veja oportunidades, metas e resultados para orientar os próximos passos.']].map(([title,copy],i)=><li key={title}><span>0{i+1}</span><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol></section>

    <section className={s.closing} data-reveal><div className={s.closingGlow} aria-hidden="true"/><p className={s.eyebrow}>MAIS FOCO NO QUE IMPORTA</p><h2>Sua equipe cuida das relações.<br/><span>A ImobFlow ajuda com a rotina.</span></h2><a className={s.primary} href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer" aria-label="Conversar sobre minha imobiliária pelo WhatsApp (abre em nova aba)">Conversar sobre minha imobiliária <Arrow/></a><p className={s.contactNote}>Fale com a equipe pelo WhatsApp: <a href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">(35) 99165-2306</a></p></section>
    <footer className={s.footer}><a href="#" aria-label="ImobFlow — início"><Brand small/></a><span>Organização e automação para imobiliárias.</span><div><a href="/privacidade">Privacidade</a><a href="/painel">Acessar painel <Arrow/></a></div></footer>
  </main>;
}
