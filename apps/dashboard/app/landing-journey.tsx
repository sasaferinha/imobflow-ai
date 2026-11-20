'use client';

import Image from 'next/image';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import s from './landing-journey.module.css';

const steps = ['Conversa', 'Lead organizado', 'Match encontrado'] as const;

function JourneyIcon({ type }: { type: 'chat' | 'profile' | 'match' | 'check' | 'home' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type === 'chat' ? <path d="M20 11a8 8 0 0 1-8 8H4l1-4a8 8 0 1 1 15-4ZM8 10h8m-8 4h5" />
      : type === 'profile' ? <><circle cx="12" cy="8" r="3" /><path d="M5 21v-2a7 7 0 0 1 14 0v2M3 3h3m12 0h3" /></>
      : type === 'match' ? <><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" /><path d="m19 3 .5 1.5L21 5l-1.5.5L19 7l-.5-1.5L17 5l1.5-.5Z" /></>
      : type === 'home' ? <><path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7" /></>
      : <path d="m5 12 4 4L19 6" />}
  </svg>;
}

export default function LandingJourney() {
  const [active, setActive] = useState(0);
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function advance(index: number) {
    setActive(index);
    tabs.current[index]?.focus({ preventScroll: true });
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % steps.length
      : event.key === 'ArrowLeft' ? (index + steps.length - 1) % steps.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  }

  return <div className={s.journey} aria-label="Experimente o caminho de um lead na ImobFlow">
    <div className={s.windowBar}>
      <span className={s.windowBrand}><span className={s.brandMark}><JourneyIcon type="home" /></span>ImobFlow<span className={s.workspaceName}>Seu atendimento conectado</span></span>
      <span className={s.demoNotice}>Demonstração · dados fictícios</span>
    </div>
    <div className={s.steps} role="tablist" aria-label="Explore as etapas do atendimento">
      {steps.map((label, index) => <button
        key={label}
        ref={element => { tabs.current[index] = element; }}
        type="button"
        role="tab"
        id={`${id}-tab-${index}`}
        aria-selected={active === index}
        aria-controls={`${id}-panel`}
        tabIndex={active === index ? 0 : -1}
        className={active === index ? s.activeStep : ''}
        onClick={() => setActive(index)}
        onKeyDown={event => navigate(event, index)}
      ><JourneyIcon type={index === 0 ? 'chat' : index === 1 ? 'profile' : 'match'} /><span>{label}</span></button>)}
    </div>

    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`} className={s.scene} data-step={active} tabIndex={0}>
      <section className={s.chat} aria-label="Conversa de exemplo com Ana Martins">
        <div className={s.chatHead}>
          <span className={s.avatar}>AM</span>
          <div><strong>Ana Martins</strong><span>Cliente · WhatsApp</span></div>
          <span className={s.whatsapp}><JourneyIcon type="chat" /></span>
        </div>
        <div className={s.messages}>
          <p className={s.incoming}>Quero comprar um apartamento no Centro de Lavras.</p>
          <p className={s.outgoing}>Claro, Ana! Quantos quartos e até qual valor?</p>
          <p className={`${s.incoming} ${active > 0 ? s.highlightMessage : ''}`}>Dois quartos, até <strong>R$ 500 mil</strong>. Quero financiar.</p>
          <p key={active} className={s.handoff}>{active === 2 ? <><span>Marina · corretora</span>Encontrei um apartamento que combina com você. Vamos conhecer?</> : <><span>ImobFlow · atendimento</span>Já tenho o seu perfil. A Marina continua o atendimento com você.</>}</p>
        </div>
      </section>

      <div className={s.result} aria-live="polite" aria-atomic="true">
        <div key={active} className={s.resultContent}>
          {active === 0 ? <>
            <div className={s.resultEyebrow}><JourneyIcon type="chat" /> DO OUTRO LADO DA CONVERSA</div>
            <h3>Um novo cliente.<br />Uma história para continuar.</h3>
            <p className={s.resultCopy}>A equipe recebe o que a Ana procura e continua o atendimento com contexto.</p>
            <div className={s.contextPreview}>
              <span className={s.contextAvatar}>AM</span>
              <div><strong>Ana Martins</strong><span>Compra · apartamento · Centro</span></div>
              <JourneyIcon type="check" />
            </div>
            <div className={s.bottomAction}><button type="button" onClick={() => advance(1)}>Ver lead organizado</button></div>
          </> : active === 1 ? <>
            <div className={s.resultEyebrow}><JourneyIcon type="profile" /> PERFIL DO CLIENTE</div>
            <div className={s.profileTitle}><h3>Ana Martins</h3><span>Compra</span></div>
            <dl className={s.profileFields}>
              <div><dt>Imóvel</dt><dd>Apartamento</dd></div>
              <div><dt>Região</dt><dd>Centro, Lavras</dd></div>
              <div><dt>Orçamento</dt><dd>Até R$ 500 mil</dd></div>
              <div><dt>Quartos</dt><dd>2 quartos</dd></div>
            </dl>
            <div className={s.owner}><span>MA</span><p><strong>Marina Alves</strong><span>Corretora responsável</span></p></div>
            <div className={s.bottomAction}><button type="button" onClick={() => advance(2)}>Ver imóvel compatível</button></div>
          </> : <>
            <div className={s.resultEyebrow}><JourneyIcon type="match" /> MATCH IMOBFLOW</div>
            <div className={s.propertyPhoto}><Image src="/demo-media/sala-clara.jpg" alt="Sala de estar ilustrativa do apartamento usado na demonstração" fill unoptimized sizes="(max-width: 720px) 90vw, (max-width: 1100px) 44vw, 480px" /><span>Combina com a Ana</span></div>
            <div className={s.propertyTitle}><div><h3>Apartamento no Centro</h3><p>Lavras · 2 quartos</p></div><strong>R$ 450 mil</strong></div>
            <ul className={s.matchReasons} aria-label="Por que este imóvel combina"><li><JourneyIcon type="check" />Região desejada</li><li><JourneyIcon type="check" />Dentro do orçamento</li></ul>
            <div className={s.matchOutcome}><JourneyIcon type="chat" /><p>O corretor recebe a oportunidade e decide o próximo contato.</p></div>
          </>}
        </div>
      </div>
    </div>
    <div className={s.sceneFooter}><span>Uma conversa. Todo o contexto.</span><span>Explore as três etapas acima</span></div>
  </div>;
}
