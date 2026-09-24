'use client';

import { useEffect, useRef } from 'react';
import s from './business-landing.module.css';
import ProductPreview from './product-preview';

function Brand({small=false}:{small?:boolean}) {
  return <span className={`${s.brand} ${small?s.smallBrand:''}`}><svg viewBox="0 0 32 44" width="30" height="41" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 41V24l8-4v21M11 20V7l12-5v39M23 16h6v25"/></svg><span><strong>ImobFlow</strong>{!small&&<span>GESTÃO IMOBILIÁRIA</span>}</span></span>;
}
function Arrow(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>;}
function Icon({type}:{type:'chat'|'team'|'chart'}){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type==='chat'?<path d="M20 11a8 8 0 0 1-8 8H4l1-4a8 8 0 1 1 15-4ZM8 10h8m-8 4h5"/>:type==='team'?<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>:<path d="M4 4v16h16M8 15v-3m5 3V7m5 8v-5"/>}</svg>;}
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
      <p className={s.eyebrow}>SOFTWARE PARA IMOBILIÁRIAS</p>
      <h1>Menos tarefas manuais.<br/><span>Mais tempo para vender.</span></h1>
      <p className={s.heroCopy}>Organize leads, automatize o atendimento pelo WhatsApp<br className={s.desktopBreak}/> e acompanhe sua equipe em um só lugar.</p>
      <div className={s.heroActions}><a className={s.primary} href="#produto">Conhecer a ImobFlow <Arrow/></a><a className={s.textLink} href="#como-funciona">Veja como funciona <span aria-hidden="true">↓</span></a></div>
      <div className={s.heroFoot}><span>Atendimento.</span><span>Organização.</span><span>Clareza para decidir.</span></div>
    </section>

    <section id="produto" className={s.product} aria-label="Demonstração do produto">
      <ProductPreview />
    </section>

    <section className={s.benefits} aria-labelledby="benefits-title" data-reveal>
      <div className={s.sectionIntro}><p className={s.eyebrow}>DO PRIMEIRO CONTATO À GESTÃO</p><h2 id="benefits-title">Sua operação conectada.<br/><span>Sem perder o fio da conversa.</span></h2></div>
      <div className={s.benefitGrid}>{[{icon:'chat' as const,title:'Atenda com contexto.',copy:'Automatize as primeiras perguntas pelo WhatsApp e entregue ao corretor um lead com preferências organizadas.'},{icon:'team' as const,title:'Cada lead no seu lugar.',copy:'Organize responsáveis, imóveis e oportunidades. A equipe sabe quem atender e o que o cliente procura.'},{icon:'chart' as const,title:'Enxergue o que acontece.',copy:'Acompanhe atendimentos, metas e resultados. Tome decisões com as informações da sua operação reunidas.'}].map(b=><article key={b.title}><Icon type={b.icon}/><h3>{b.title}</h3><p>{b.copy}</p></article>)}</div>
    </section>

    <section id="como-funciona" className={s.how} data-reveal><div><p className={s.eyebrow}>COMO FUNCIONA</p><h2>Uma rotina mais simples.<br/><span>Em três passos.</span></h2></div><ol>{[['Configure sua imobiliária','Cadastre a equipe, os imóveis e conecte o WhatsApp da empresa.'],['Organize o atendimento','Receba os leads, reúna as preferências e acompanhe os responsáveis.'],['Acompanhe e melhore','Veja oportunidades, metas e resultados para orientar os próximos passos.']].map(([title,copy],i)=><li key={title}><span>0{i+1}</span><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol></section>

    <section className={s.closing} data-reveal><p className={s.eyebrow}>MAIS FOCO NO QUE IMPORTA</p><h2>Sua equipe cuida das relações.<br/><span>A ImobFlow ajuda com a rotina.</span></h2><a className={s.primary} href="mailto:imobflow.ai@gmail.com?subject=Quero%20conhecer%20a%20ImobFlow">Conversar sobre minha imobiliária <Arrow/></a><p className={s.contactNote}>Fale com a equipe em <a href="mailto:imobflow.ai@gmail.com">imobflow.ai@gmail.com</a></p></section>
    <footer className={s.footer}><a href="#" aria-label="ImobFlow — início"><Brand small/></a><span>Organização e automação para imobiliárias.</span><div><a href="/privacidade">Privacidade</a><a href="/painel">Acessar painel <Arrow/></a></div></footer>
  </main>;
}
