'use client';

import { useState, type FormEvent } from 'react';

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, '') ?? '';

const benefits = [
  ['24/7', 'Atendimento contínuo'],
  ['2 min', 'Para qualificar um lead'],
  ['+38%', 'Mais visitas agendadas'],
];

const steps = [
  { number: '01', title: 'Conte o que procura', copy: 'Compra ou aluguel, região, tipo de imóvel e faixa de investimento.' },
  { number: '02', title: 'Receba uma curadoria', copy: 'A ImobFlow organiza seu perfil e encontra as opções mais compatíveis.' },
  { number: '03', title: 'Fale pelo WhatsApp', copy: 'Sua solicitação chega pronta para o atendimento continuar sem repetir informações.' },
];

export default function LandingClient() {
  const [submitted, setSubmitted] = useState(false);

  function openWhatsApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = [
      'Olá! Vim pelo site da ImobFlow e gostaria de encontrar um imóvel.',
      '',
      `Nome: ${String(form.get('name') || '')}`,
      `Objetivo: ${String(form.get('goal') || '')}`,
      `Tipo de imóvel: ${String(form.get('propertyType') || '')}`,
      `Cidade ou região: ${String(form.get('region') || '')}`,
      `Faixa de investimento: ${String(form.get('budget') || '')}`,
      `Detalhes: ${String(form.get('details') || 'Não informado')}`,
    ].join('\n');
    const endpoint = WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}` : 'https://wa.me/';
    setSubmitted(true);
    window.open(`${endpoint}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <main className="landing-shell">
      <header className="landing-nav">
        <a className="landing-brand" href="#inicio" aria-label="ImobFlow — início">
          <span>I</span><strong>ImobFlow</strong>
        </a>
        <nav aria-label="Navegação da landing page">
          <a href="#como-funciona">Como funciona</a>
          <a href="#vantagens">Vantagens</a>
          <a href="#encontrar-imovel">Encontrar imóvel</a>
        </nav>
        <a className="nav-cta" href="#encontrar-imovel">Começar agora <span>↗</span></a>
      </header>

      <section className="landing-hero" id="inicio">
        <div className="hero-copy">
          <p className="landing-kicker"><i /> Atendimento imobiliário inteligente</p>
          <h1>Seu próximo imóvel começa com uma <em>boa conversa.</em></h1>
          <p className="hero-lead">Conte o que você procura. A ImobFlow entende seu perfil, organiza suas preferências e conecta você às melhores oportunidades pelo WhatsApp.</p>
          <div className="hero-actions">
            <a className="landing-primary" href="#encontrar-imovel">Encontrar meu imóvel <span>→</span></a>
            <a className="landing-secondary" href="#como-funciona"><span>▶</span> Ver como funciona</a>
          </div>
          <div className="trust-row"><span className="trust-avatars"><i>MO</i><i>PA</i><i>LC</i></span><p><strong>Atendimento humano quando você quiser</strong><small>IA para agilizar. Pessoas para decidir junto.</small></p></div>
        </div>

        <div className="hero-visual" aria-label="Prévia de uma conversa inteligente">
          <div className="violet-orbit orbit-one" /><div className="violet-orbit orbit-two" />
          <article className="phone-card">
            <div className="phone-head"><span className="mini-brand">I</span><div><strong>ImobFlow</strong><small>online agora</small></div><b>•••</b></div>
            <div className="phone-body"><time>Hoje, 10:42</time><p className="phone-out">Olá! Que tipo de imóvel você procura?</p><p className="phone-in">Quero um apartamento com 3 quartos, perto do centro.</p><p className="phone-out">Perfeito. Qual faixa de investimento você tem em mente?</p><p className="phone-in">Até R$ 650 mil. Pode ser financiamento.</p><span className="typing-bubble"><i/><i/><i/></span></div>
            <div className="phone-input">Digite sua mensagem… <span>➜</span></div>
          </article>
          <aside className="match-card"><span>✦</span><div><small>Imóveis encontrados</small><strong>8 opções compatíveis</strong></div></aside>
          <aside className="visit-card"><span>✓</span><div><small>Próximo passo</small><strong>Visita agendada</strong></div></aside>
        </div>
      </section>

      <section className="benefit-strip" id="vantagens">
        {benefits.map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
        <p>Uma jornada mais simples, do primeiro “oi” até a visita.</p>
      </section>

      <section className="lead-section" id="encontrar-imovel">
        <div className="form-promise">
          <p className="landing-kicker light"><i /> Comece agora</p>
          <h2>O imóvel ideal pode estar a uma conversa de distância.</h2>
          <p>Responda algumas perguntas rápidas. Ao finalizar, sua mensagem será aberta no WhatsApp com tudo organizado para agilizar o atendimento.</p>
          <ul><li><span>✓</span> Leva menos de 2 minutos</li><li><span>✓</span> Sem compromisso</li><li><span>✓</span> Atendimento personalizado</li></ul>
          <div className="form-quote"><span>“</span><p>A melhor busca começa quando a gente entende o que realmente importa para você.</p></div>
        </div>

        <form className="lead-form" onSubmit={openWhatsApp}>
          <div className="form-title"><span>✦</span><div><strong>Vamos encontrar seu imóvel</strong><small>Uma busca personalizada começa aqui</small></div><b>2 min</b></div>
          <div className="form-progress" aria-label="Etapas do atendimento"><span className="active"><i>1</i>Seu perfil</span><span><i>2</i>Preferências</span><span><i>3</i>WhatsApp</span></div>
          <label>Como podemos chamar você?<input name="name" placeholder="Digite seu nome" required /></label>
          <div className="landing-form-grid">
            <label>O que você deseja?<select name="goal" defaultValue="" required><option value="" disabled>Selecione</option><option>Comprar</option><option>Alugar</option><option>Investir</option></select></label>
            <label>Tipo de imóvel<select name="propertyType" defaultValue="" required><option value="" disabled>Selecione</option><option>Apartamento</option><option>Casa</option><option>Terreno</option><option>Comercial</option></select></label>
          </div>
          <label>Cidade ou região<input name="region" placeholder="Ex.: Centro, São Paulo" required /></label>
          <label>Faixa de investimento<select name="budget" defaultValue="" required><option value="" disabled>Selecione uma faixa</option><option>Até R$ 300 mil</option><option>R$ 300 mil a R$ 600 mil</option><option>R$ 600 mil a R$ 1 milhão</option><option>Acima de R$ 1 milhão</option><option>Aluguel até R$ 3 mil/mês</option><option>Aluguel acima de R$ 3 mil/mês</option></select></label>
          <label>Algo mais que devemos saber?<textarea name="details" rows={3} placeholder="Quartos, vagas, condomínio, prazo…" /></label>
          <button type="submit"><i>◔</i> Continuar no WhatsApp <span>→</span></button>
          <small className="privacy-note">Ao continuar, você concorda em receber contato sobre sua busca. Seus dados serão usados apenas para este atendimento.</small>
          {submitted && <p className="form-success" role="status">✓ Sua mensagem foi preparada e o WhatsApp foi aberto.</p>}
        </form>
      </section>

      <section className="how-section" id="como-funciona">
        <div className="section-intro"><p className="landing-kicker">Simples do início ao fim</p><h2>Encontre o imóvel certo<br/>sem perder tempo.</h2></div>
        <div className="steps-grid">{steps.map((step) => <article key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.copy}</p></article>)}</div>
      </section>

      <footer className="landing-footer"><a className="landing-brand" href="#inicio"><span>I</span><strong>ImobFlow</strong></a><p>Atendimento imobiliário que entende, qualifica e aproxima.</p><a href="/painel">Acessar painel</a></footer>
    </main>
  );
}



