'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { parseFinancingNumber } from '../../lib/financing';
import { calculatePrequalification } from '../../lib/financing-prequalification';
import styles from './calculator.module.css';

const brl = (value:number) => value.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const percent = (value:number) => value.toLocaleString('pt-BR', { maximumFractionDigits:2 });
const states = ['Acre','Alagoas','Amapá','Amazonas','Bahia','Ceará','Distrito Federal','Espírito Santo','Goiás','Maranhão','Mato Grosso','Mato Grosso do Sul','Minas Gerais','Pará','Paraíba','Paraná','Pernambuco','Piauí','Rio de Janeiro','Rio Grande do Norte','Rio Grande do Sul','Rondônia','Roraima','Santa Catarina','São Paulo','Sergipe','Tocantins'];
type Estimate = ReturnType<typeof calculatePrequalification>;
type Company = { name:string; slug:string } | null;

function currencyMask(raw:string) {
  const digits = raw.replace(/\D/g, '').slice(0,11);
  return digits ? (Number(digits)/100).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '';
}
function phoneMask(raw:string) {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && (raw.trim().startsWith('+') || digits.length>11)) digits = digits.slice(2);
  digits = digits.slice(0,11);
  return '+55 ' + (digits ? '(' + digits.slice(0,2) : '') + (digits.length>=2 ? ') ' : '') + digits.slice(2,7) + (digits.length>7 ? '-' + digits.slice(7) : '');
}
function Metric({label,value,note,tone=''}:{label:string;value:string;note?:string;tone?:string}) {
  return <div className={styles.metric}><small>{label}</small><strong className={tone}>{value}</strong>{note && <span>{note}</span>}</div>;
}

export default function FinancingCalculator({ company }: { company:Company }) {
  const [values,setValues] = useState({ monthlyIncome:'', downPayment:'', propertyValue:'' });
  const [region,setRegion] = useState('Minas Gerais');
  const [timing,setTiming] = useState('');
  const [conditions,setConditions] = useState({ annualRate:'10,99', months:'420', system:'PRICE' as 'PRICE'|'SAC' });
  const [pending,setPending] = useState<Estimate|null>(null);
  const [result,setResult] = useState<Estimate|null>(null);
  const [contact,setContact] = useState({ name:'', phone:'+55 ' });
  const [resultName,setResultName] = useState('');
  const [error,setError] = useState('');
  const [contactError,setContactError] = useState('');
  const [saving,setSaving] = useState(false);
  const [sent,setSent] = useState(false);
  const [adjusting,setAdjusting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const requestInFlight = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (pending && dialog && !dialog.open) dialog.showModal();
    if (!pending && dialog?.open) dialog.close();
  }, [pending]);
  useEffect(() => {
    if (!result) return;
    resultRef.current?.focus({ preventScroll:true });
    resultRef.current?.scrollIntoView({ behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start' });
  }, [result]);
  useEffect(() => {
    if (!adjusting) return;
    const input = document.getElementById('annual-rate');
    input?.focus({ preventScroll:true });
    input?.scrollIntoView({ behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'center' });
  }, [adjusting]);

  const income = parseFinancingNumber(values.monthlyIncome);
  const entry = parseFinancingNumber(values.downPayment);
  const property = parseFinancingNumber(values.propertyValue);
  let preview:Estimate|null = null;
  try { preview = calculatePrequalification({ monthlyIncome:income, downPayment:entry, propertyValue:property, annualRate:parseFinancingNumber(conditions.annualRate), months:Number(conditions.months), system:conditions.system }); } catch { /* Incomplete form: no premature result. */ }

  function update(key:keyof typeof values,value:string) {
    setValues(previous=>({ ...previous, [key]:currencyMask(value) })); setResult(null); setError(''); setSent(false);
  }
  function calculate(event:FormEvent) {
    event.preventDefault(); setError(''); setContactError('');
    try {
      if (!timing) throw new Error('Selecione sua intenção de compra.');
      const estimate = calculatePrequalification({ monthlyIncome:income, downPayment:entry, propertyValue:property, annualRate:parseFinancingNumber(conditions.annualRate), months:Number(conditions.months), system:conditions.system });
      setPending(estimate);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Confira os valores para continuar.'); }
  }
  function closeContact() {
    if (requestInFlight.current) return;
    setPending(null); setContactError(''); submitRef.current?.focus();
  }
  function reveal(estimate:Estimate,name:string,wasSent:boolean) {
    setResultName(name.trim().split(/\s+/)[0] || ''); setSent(wasSent); setPending(null); setResult(estimate); setAdjusting(false);
  }
  async function showResult(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || requestInFlight.current) return;
    const phone = contact.phone.replace(/\D/g,'');
    if (!contact.name.trim() || !/^55[1-9]\d9\d{8}$/.test(phone)) {
      setContactError('Informe seu nome e um WhatsApp com DDD, como +55 (35) 99999-9999.'); return;
    }
    if (!company) { reveal(pending,contact.name,false); return; }
    requestInFlight.current = true; setSaving(true); setContactError('');
    try {
      const response = await fetch('/api/leads', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        companySlug:company.slug, name:contact.name.trim(), phone:'+'+phone, goal:'Comprar', propertyType:'Não informado',
        region, budget:brl(pending.propertyValue),
        details:'Simulação de financiamento. Renda familiar: '+brl(pending.monthlyIncome)+'. Entrada (incluindo FGTS informado): '+brl(pending.downPayment)+'. Valor a financiar: '+brl(pending.financing.principal)+'. Parcela estimada: '+brl(pending.estimatedPayment)+'. Taxa efetiva de exemplo: '+pending.annualRate+'% a.a.; '+pending.months+' meses; '+pending.system+'. Intenção de compra: '+timing+'. Sem subsídio presumido.',
      }) });
      const payload = await response.json() as { ok?:boolean; error?:string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Não foi possível enviar os dados para a imobiliária.');
      reveal(pending,contact.name,true);
    } catch (problem) { setContactError(problem instanceof Error ? problem.message : 'Falha na conexão. Você pode consultar o resultado sem enviar seus dados.'); }
    finally { requestInFlight.current = false; setSaving(false); }
  }

  return <main className={styles.page}>
    <nav className={styles.nav} aria-label="Simulador"><Link className={styles.brand} href="/" aria-label="ImobFlow — início"><span aria-hidden="true">I</span><strong>ImobFlow</strong></Link><span className={styles.navCaption}>{company?.name || 'Simulador de financiamento'}</span></nav>
    <section className={styles.surface} id="calc" aria-labelledby="calculator-heading">
      <header className={styles.header}>
        <p className={styles.eyebrow}><i aria-hidden="true"/> Planeje seu próximo imóvel</p>
        <h1 id="calculator-heading">Simule seu financiamento imobiliário <span>Minha Casa Minha Vida</span></h1>
        <p>Descubra uma estimativa de parcelas e entrada para planejar a compra do seu imóvel.</p>
      </header>

      <div className={styles.formCard}>
        <form onSubmit={calculate}>
          <div className={styles.field}>
            <label htmlFor="income">1. Renda familiar mensal</label>
            <div className={styles.currencyInput}><span aria-hidden="true">R$</span><input id="income" name="income" inputMode="decimal" autoComplete="off" placeholder="5.000,00" value={values.monthlyIncome} onChange={e=>update('monthlyIncome',e.target.value)} aria-describedby="income-hint" required/></div>
            <small id="income-hint" className={styles.hint}>{Number.isFinite(income) && income>0 ? 'Referência de parcela: até '+brl(income*.3)+' por mês (30% da renda).' : ''}</small>
          </div>
          <div className={styles.field}>
            <label htmlFor="entry">2. Valor para entrada, incluindo FGTS se houver</label>
            <div className={styles.currencyInput}><span aria-hidden="true">R$</span><input id="entry" name="entry" inputMode="decimal" autoComplete="off" placeholder="25.000,00" value={values.downPayment} onChange={e=>update('downPayment',e.target.value)} aria-describedby="entry-hint" required/></div>
            <small id="entry-hint" className={styles.hint}>{Number.isFinite(entry) && property>0 ? 'Sua entrada representa '+percent(entry/property*100)+'% do valor do imóvel.' : ''}</small>
          </div>
          <div className={styles.field}>
            <label htmlFor="property">3. Valor do imóvel desejado</label>
            <div className={styles.currencyInput}><span aria-hidden="true">R$</span><input id="property" name="property" inputMode="decimal" autoComplete="off" placeholder="250.000,00" value={values.propertyValue} onChange={e=>update('propertyValue',e.target.value)} required/></div>
            <small className={styles.hint+' '+(preview && !preview.withinIncomeReference ? styles.amber : '')}>{preview ? preview.withinIncomeReference ? 'Parcela dentro da referência de renda, na taxa e no prazo desta estimativa.' : 'A parcela supera 30% da renda neste cenário. Veja os ajustes na simulação.' : ''}</small>
          </div>
          <div className={styles.twoColumns}>
            <div className={styles.field}><label htmlFor="region">4. Região de interesse</label><select id="region" value={region} onChange={e=>{setRegion(e.target.value);setResult(null);}}>{states.map(state=><option key={state}>{state}</option>)}</select></div>
            <div className={styles.field}><label htmlFor="timing">5. Intenção de compra</label><select id="timing" value={timing} onChange={e=>{setTiming(e.target.value);setResult(null);}} required><option value="">Selecione o prazo</option>{['Imediata','Até 3 meses','Até 6 meses','Até 1 ano'].map(time=><option key={time}>{time}</option>)}</select></div>
          </div>
          {adjusting && <fieldset className={styles.conditions}><legend>Condições da estimativa</legend><div className={styles.twoColumns}><label>Taxa anual efetiva (%)<input id="annual-rate" inputMode="decimal" value={conditions.annualRate} onChange={e=>{setConditions(c=>({...c,annualRate:e.target.value}));setResult(null);}} required/></label><label>Prazo do financiamento (meses)<input type="number" min="1" max="420" value={conditions.months} onChange={e=>{setConditions(c=>({...c,months:e.target.value}));setResult(null);}} required/></label></div><label>Sistema<select value={conditions.system} onChange={e=>{setConditions(c=>({...c,system:e.target.value as 'SAC'|'PRICE'}));setResult(null);}}><option value="PRICE">Price — parcelas constantes</option><option value="SAC">SAC — parcelas decrescentes</option></select></label></fieldset>}
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <button ref={submitRef} className={styles.submit} type="submit">Simular agora <span aria-hidden="true">→</span></button>
        </form>
        <p className={styles.freeNote}>Simulação gratuita e sem compromisso</p>
      </div>

      {result && <section ref={resultRef} className={styles.results} tabIndex={-1} aria-labelledby="result-heading">
        <header className={styles.resultIntro}><h2 id="result-heading">Resultado da sua simulação</h2><p>{resultName ? resultName+', veja' : 'Veja'} como a entrada e o financiamento se combinam no seu planejamento.</p>{sent && <p className={styles.success} role="status">Sua simulação foi enviada para {company?.name}.</p>}</header>
        <article className={styles.resultCard}><h3>Entenda sua compra</h3><p className={styles.explanation}>Para um imóvel de <strong>{brl(result.propertyValue)}</strong> e entrada de <strong>{brl(result.downPayment)}</strong>, o valor a financiar seria <strong>{brl(result.financing.principal)}</strong>.</p><div className={styles.math}><h4>Conta simplificada</h4><dl><div><dt>Valor do imóvel</dt><dd>{brl(result.propertyValue)}</dd></div><div><dt>Menos sua entrada</dt><dd>− {brl(result.downPayment)}</dd></div><div><dt>Subsídio</dt><dd>Não incluído na estimativa</dd></div><div><dt>Valor a financiar</dt><dd>{brl(result.financing.principal)}</dd></div></dl></div><div className={styles.resultGrid}><Metric label={result.system==='SAC' ? 'Primeira parcela estimada' : 'Parcela mensal estimada'} value={brl(result.estimatedPayment)} note="Amortização + juros, sem encargos"/><Metric label="Renda comprometida" value={percent(result.paymentIncomePercent)+'%'} note="Referência de até 30% da renda" tone={result.withinIncomeReference?styles.green:styles.amber}/></div></article>
        <article className={styles.resultCard}><h3>O que sua renda suporta</h3><p className={styles.explanation}>Com {percent(result.annualRate)}% de juros efetivos ao ano, {result.months} meses e sistema {result.system==='PRICE'?'Price':'SAC'}, a estimativa abaixo considera uma parcela de até 30% da renda informada.</p><div className={styles.resultGrid}><Metric label="Parcela de referência pela renda" value={brl(result.incomeReferencePayment)} note={'30% de '+brl(result.monthlyIncome)} tone={styles.green}/><Metric label="Valor financiável pela renda" value={brl(result.financingCapacity)} note="Estimativa matemática; não é limite aprovado"/></div></article>
        {!result.withinIncomeReference && <article className={styles.alert}><h3>Ajuste a entrada para este cenário</h3><p>Para que a parcela fique na referência de 30% da renda, mantendo a taxa e o prazo simulados:</p><dl><div><dt>Entrada informada</dt><dd>{brl(result.downPayment)}</dd></div><div><dt>Entrada estimada para essa parcela</dt><dd>{brl(result.requiredDownPayment)}</dd></div><div><dt>Valor adicional de entrada</dt><dd>{brl(result.extraDownPayment)}</dd></div></dl><p className={styles.tip}>Uma alternativa é simular um imóvel de menor valor.</p></article>}
        <article className={styles.resultCard}><h3>Minha Casa Minha Vida <span className={styles.badge}>{result.incomeBand?.label || 'Consultar condições'}</span></h3><p className={styles.explanation}>{result.incomeBand ? 'A renda informada está no intervalo de referência indicado. O enquadramento depende também do imóvel, da composição familiar e da análise da instituição financeira.' : 'A renda informada está acima dos intervalos de referência do programa. Outras modalidades podem ser consultadas com a instituição financeira.'}</p><div className={styles.resultGrid}><Metric label="Renda familiar" value={brl(result.monthlyIncome)} note={region}/><Metric label="Possível subsídio / uso de FGTS" value="Sujeito à análise" note="Nenhum subsídio foi descontado automaticamente." tone={styles.textMetric}/></div><p className={styles.source}>Faixas de renda: <a href="https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/sobre-o-minha-casa-minha-vida-1" target="_blank" rel="noreferrer">Ministério das Cidades</a>. A taxa de exemplo não representa uma oferta do programa.</p></article>
        <article className={styles.resultCard}><h3>Resumo final</h3><div className={styles.resultGrid}><Metric label="Valor do imóvel" value={brl(result.propertyValue)}/><Metric label="Entrada informada" value={brl(result.downPayment)}/><Metric label="Última parcela estimada" value={brl(result.lastPayment)}/><Metric label="Entrada + soma das parcelas" value={brl(result.financing.totalWithDownPayment)}/></div><button className={styles.adjustButton} type="button" onClick={()=>setAdjusting(true)}>Ajustar taxa e prazo da simulação</button></article>
        <details className={styles.schedule}><summary>Ver evolução das {result.months} parcelas</summary><div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Evolução do financiamento"><table><caption>Estimativa sem seguros, tarifas ou correção monetária</caption><thead><tr><th>Mês</th><th>Parcela</th><th>Juros</th><th>Amortização</th><th>Saldo</th></tr></thead><tbody>{result.financing.schedule.map(row=><tr key={row.month}><th scope="row">{row.month}</th><td>{brl(row.payment)}</td><td>{brl(row.interest)}</td><td>{brl(row.amortization)}</td><td>{brl(row.balance)}</td></tr>)}</tbody></table></div></details>
        <p className={styles.notice}>Estimativa sem seguros, tarifas, impostos ou atualização por índices. O banco define a entrada mínima, prazo, taxa e aprovação após analisar seu perfil e o imóvel.</p>
      </section>}
    </section>
    <footer className={styles.footer}><span>ImobFlow · Simulador de financiamento</span><a href="/privacidade">Privacidade</a></footer>
    <dialog ref={dialogRef} className={styles.modal} aria-labelledby="contact-title" aria-describedby="contact-description" onCancel={event=>{event.preventDefault();closeContact();}} onClick={event=>{if(event.target===dialogRef.current){const rect=dialogRef.current.getBoundingClientRect();if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)closeContact();}}}>
      <button type="button" className={styles.close} aria-label="Fechar" disabled={saving} onClick={closeContact}>×</button><h2 id="contact-title">Seu resultado está pronto</h2><p id="contact-description">Informe seu nome e WhatsApp para ver sua simulação completa.</p>
      <form onSubmit={showResult}><label className={styles.srOnly} htmlFor="contact-name">Seu nome</label><input id="contact-name" placeholder="Seu nome" autoComplete="name" maxLength={120} value={contact.name} onChange={e=>setContact(c=>({...c,name:e.target.value}))} disabled={saving} required/><label className={styles.srOnly} htmlFor="contact-phone">Seu WhatsApp</label><input id="contact-phone" type="tel" placeholder="+55 (35) 99999-9999" autoComplete="tel" value={contact.phone} onChange={e=>setContact(c=>({...c,phone:phoneMask(e.target.value)}))} disabled={saving} required/>{contactError && <p role="alert" className={styles.error}>{contactError}</p>}<p className={styles.contactNote}>{company ? 'Ao continuar, você envia seus dados e esta simulação para '+company.name+' dar continuidade ao atendimento.' : 'Neste link, seus dados ficam apenas nesta página e não são enviados a uma imobiliária.'} <a href="/privacidade" target="_blank" rel="noreferrer">Privacidade</a></p><button className={styles.submit} disabled={saving} type="submit">{saving?'Enviando...':'Ver minha simulação'}</button><button className={styles.skip} disabled={saving} type="button" onClick={()=>{if(pending)reveal(pending,'',false);}}>Ver sem enviar meus dados</button></form>
    </dialog>
  </main>;
}
