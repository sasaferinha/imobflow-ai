'use client';

import { useState, type FormEvent } from 'react';

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

export default function LandingClient({ companySlug, companyName, demo = false }: { companySlug?:string; companyName?:string; demo?:boolean }) {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const editorial = !demo && !companySlug;

  async function openWhatsApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) { setSubmitted(true); setFormError(''); return; }
    const form = new FormData(event.currentTarget);
    const payload = {
      companySlug,
      name: String(form.get('name') || ''), phone: String(form.get('phone') || ''), email: String(form.get('email') || ''),
      goal: String(form.get('goal') || ''), propertyType: String(form.get('propertyType') || ''),
      region: String(form.get('region') || ''), budget: String(form.get('budget') || ''), details: String(form.get('details') || ''),
    };
    setSubmitting(true); setFormError('');
    try {
      const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error('save_failed');
      setSubmitted(true);
    } catch {
      setFormError('Não conseguimos salvar seus dados agora. Tente novamente em instantes.');
    } finally { setSubmitting(false); }
  }

  return (
    <main className={`landing-shell${editorial ? ' landing-editorial' : ''}`}>
      <header className="landing-nav">
        <a className="landing-brand" href="#inicio" aria-label="ImobFlow — início">
          {editorial ? <svg className="editorial-logo" viewBox="0 0 32 44" width="32" height="44" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 41V24l8-4v21M11 20V7l12-5v39M23 16h6v25" /></svg> : <span>I</span>}<strong>{demo ? 'Horizonte Imobiliária' : 'ImobFlow'}</strong>
        </a>
        <nav aria-label="Navegação da landing page">
          <a href="#como-funciona">Como funciona</a>
          <a href="#vantagens">Vantagens</a>
          <a href="#encontrar-imovel">Encontrar imóvel</a>
          {demo && <a href="/simulador-financiamento">Simular financiamento</a>}
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
          {!editorial && <div className="trust-row"><span className="trust-avatars"><i>MO</i><i>PA</i><i>LC</i></span><p><strong>Atendimento humano quando você quiser</strong><small>IA para agilizar. Pessoas para decidir junto.</small></p></div>}
        </div>

        {editorial ? <div className="editorial-journey" aria-label="Etapas da busca por um imóvel">
          <article><span className="editorial-step">01 / SUA BUSCA</span><h2>Um lugar para chamar de seu.</h2><p>Casa ou apartamento. Compra ou aluguel. Tudo começa com o que faz sentido para você.</p><div className="editorial-tags"><a href="#encontrar-imovel">Comprar</a><a href="#encontrar-imovel">Alugar</a></div></article>
          <article><span className="editorial-step">02 / SUAS PREFERÊNCIAS</span><h2>Os detalhes fazem a diferença.</h2><p>Compartilhe a região, o tipo de imóvel e quanto pretende investir.</p><div className="editorial-tags"><span>Região</span><span>Tipo de imóvel</span><span>Orçamento</span></div></article>
          <article><span className="editorial-step">03 / A PRÓXIMA CONVERSA</span><h2>Tecnologia aproxima. Pessoas ajudam.</h2><p>Continue o atendimento com a equipe da sua imobiliária pelo WhatsApp.</p><a className="editorial-link" href="/simulador-financiamento">Simular financiamento ↗</a></article>
        </div> : <div className="hero-visual" aria-label="Prévia de uma conversa inteligente">
          <div className="violet-orbit orbit-one" /><div className="violet-orbit orbit-two" />
          <article className="phone-card">
            <div className="phone-head"><span className="mini-brand">I</span><div><strong>ImobFlow</strong><small>online agora</small></div><b>•••</b></div>
            <div className="phone-body"><time>Hoje, 10:42</time><p className="phone-out">Olá! Que tipo de imóvel você procura?</p><p className="phone-in">Quero um apartamento com 3 quartos, perto do centro.</p><p className="phone-out">Perfeito. Qual faixa de investimento você tem em mente?</p><p className="phone-in">Até R$ 650 mil. Pode ser financiamento.</p><span className="typing-bubble"><i/><i/><i/></span></div>
            <div className="phone-input">Digite sua mensagem… <span>➜</span></div>
          </article>
          <aside className="match-card"><span>✦</span><div><small>Imóveis encontrados</small><strong>8 opções compatíveis</strong></div></aside>
          <aside className="visit-card"><span>✓</span><div><small>Próximo passo</small><strong>Visita agendada</strong></div></aside>
        </div>}
      </section>

      <section className="benefit-strip" id="vantagens">
        {(editorial ? [['Seu perfil', 'Preferências organizadas'], ['Sua região', 'Uma busca com foco'], ['Sua conversa', 'Atendimento pelo WhatsApp']] : benefits).map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
        <p>Uma jornada mais simples, do primeiro “oi” até a visita.</p>
      </section>

      <section className="lead-section" id="encontrar-imovel">
        <div className="form-promise">
          <p className="landing-kicker light"><i /> Comece agora</p>
          <h2>O imóvel ideal pode estar a uma conversa de distância.</h2>
          <p>{companyName ? `Sua solicitação será salva para a equipe de ${companyName} continuar o atendimento.` : 'Peça à sua imobiliária o link de atendimento para enviar seus dados à equipe correta.'}</p>
          <ul><li><span>✓</span> Leva menos de 2 minutos</li><li><span>✓</span> Sem compromisso</li><li><span>✓</span> Atendimento personalizado</li></ul>
        </div>

        {!companySlug && !demo ? <aside className="agency-access" aria-labelledby="agency-access-title">
          <span className="agency-access-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h3a1 1 0 0 1 1 1v11M2 21h20M8 7h4M8 11h4M8 15h4M9 21v-3h2v3"/></svg></span>
          <p className="agency-access-eyebrow">Um espaço para cada jornada</p>
          <h3 id="agency-access-title">Sua próxima conversa<br/>começa aqui.</h3>
          <p className="agency-access-description">Procurando um imóvel? Peça à sua imobiliária o link de atendimento. Assim, suas preferências chegam à equipe certa.</p>
          <div className="agency-access-team">
            <div><strong>Faz parte da imobiliária?</strong><p>Seu atendimento, organizado em um só lugar.</p></div>
            <a href="/painel">Acessar meu painel <span aria-hidden="true">↗</span></a>
          </div>
        </aside> : <form className="lead-form" onSubmit={openWhatsApp}>
          <div className="form-title"><span>✦</span><div><strong>{companyName}</strong><small>Vamos encontrar seu imóvel</small></div><b>2 min</b></div>
          <label>Como podemos chamar você?<input name="name" placeholder="Digite seu nome" required /></label>
          <div className="landing-form-grid">
            <label>Seu WhatsApp<input name="phone" type="tel" placeholder="(11) 99999-9999" required /></label>
            <label>Seu e-mail <small>opcional</small><input name="email" type="email" placeholder="voce@email.com" /></label>
          </div>
          <div className="landing-form-grid">
            <label>O que você deseja?<select name="goal" defaultValue="" required><option value="" disabled>Selecione</option><option>Comprar</option><option>Alugar</option><option>Investir</option></select></label>
            <label>Tipo de imóvel<select name="propertyType" defaultValue="" required><option value="" disabled>Selecione</option><option>Apartamento</option><option>Casa</option><option>Terreno</option><option>Comercial</option></select></label>
          </div>
          <label>Cidade ou região<input name="region" placeholder="Ex.: Centro, São Paulo" required /></label>
          <label>Faixa de investimento<select name="budget" defaultValue="" required><option value="" disabled>Selecione uma faixa</option><option>Até R$ 300 mil</option><option>R$ 300 mil a R$ 600 mil</option><option>R$ 600 mil a R$ 1 milhão</option><option>Acima de R$ 1 milhão</option><option>Aluguel até R$ 3 mil/mês</option><option>Aluguel acima de R$ 3 mil/mês</option></select></label>
          <label>Algo mais que devemos saber?<textarea name="details" rows={3} placeholder="Quartos, vagas, condomínio, prazo…" /></label>
          {demo && <a href="/simulador-financiamento">Quer financiar? Simule seu financiamento →</a>}
          <button type="submit" disabled={submitting || submitted}><i>◔</i> {demo ? (submitted ? 'Demonstração concluída' : 'Simular atendimento pelo WhatsApp') : submitting ? 'Salvando seu perfil…' : submitted ? 'Solicitação recebida' : 'Enviar para a imobiliária'} <span>→</span></button>
          {demo && <p className="privacy-note">Imobiliária fictícia. Nenhum dado será salvo ou enviado. Na versão de cada empresa, este atendimento usará o WhatsApp dela.</p>}
          <small className="privacy-note">Ao continuar, você concorda em receber contato sobre sua busca. Seus dados serão usados apenas para este atendimento.</small>
          {submitted && <p className="form-success" role="status">{demo ? 'Demonstração concluída. O envio será habilitado após configurar o WhatsApp real da imobiliária.' : `✓ Solicitação salva para ${companyName}. A equipe poderá entrar em contato com você.`}</p>}
          {formError && <p className="form-error" role="alert">{formError}</p>}
        </form>}
      </section>

      <section className="how-section" id="como-funciona">
        <div className="section-intro"><p className="landing-kicker">Como funciona</p><h2>Do primeiro oi<br/>ao próximo endereço.</h2><p className="how-description">Uma busca mais simples, com suas preferências no centro da conversa.</p></div>
        <div className="steps-grid">{steps.map((step) => <article key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.copy}</p></article>)}</div>
      </section>

      <footer className="landing-footer"><a className="landing-brand" href="#inicio"><span>I</span><strong>{demo ? 'Horizonte Imobiliária · demonstração' : 'ImobFlow'}</strong></a><p>Atendimento imobiliário que entende, qualifica e aproxima.</p><a href="/privacidade">Privacidade</a>{demo ? <a href="/simulador-financiamento">Simular financiamento</a> : <a href="/painel">Acessar painel</a>}</footer>
    </main>
  );
}

