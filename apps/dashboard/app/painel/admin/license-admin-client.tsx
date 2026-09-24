'use client';

import PasswordInput from '../../password-input';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import '../access.css';
import { plans } from '@/lib/plans';

export default function LicenseAdminClient() {
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage(''); setKey('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch('/api/licenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ managementPassword: form.get('managementPassword'), plan: form.get('plan') }) }).catch(() => null);
    const result = await response?.json().catch(() => ({})) as { error?: string; key?: string } | undefined;
    if (!response?.ok || !result?.key) { setMessage(result?.error || 'Não foi possível gerar a chave.'); setLoading(false); return; }
    setKey(result.key); setLoading(false); formElement.reset();
  }
  return <main className="access-page"><section className="access-card" aria-labelledby="license-title">
    <header className="access-header"><Link href="/" className="access-logo"><span aria-hidden="true">I</span>ImobFlow</Link><p>Administração de licenças</p></header>
    <div className="access-content"><div className="access-intro"><p className="access-eyebrow">ADMINISTRAÇÃO IMOBFLOW</p><h1 id="license-title">Ativar plano da imobiliária.</h1><p>Selecione o plano contratado e gere a chave. Cada plano inclui um administrador, além das vagas de corretores.</p></div>
      <form onSubmit={submit} className="access-form admin-license-form"><div className="access-fields"><label>Plano contratado<select name="plan" defaultValue="basic" disabled={loading}>{Object.entries(plans).map(([id, plan]) => <option key={id} value={id}>{plan.name} · 1 administrador + {plan.brokers} corretores</option>)}</select></label><label>Senha administrativa<PasswordInput name="managementPassword" required autoComplete="current-password" /></label></div>{message && <p className="access-error" role="alert">{message}</p>}<button className="access-submit" type="submit" disabled={loading}>{loading ? 'Gerando chave…' : 'Gerar chave do plano'}<span aria-hidden="true">→</span></button></form>
      {key && <section className="license-result" aria-live="polite"><strong>Chave criada — copie agora.</strong><code>{key}</code><button type="button" onClick={() => navigator.clipboard.writeText(key)}>Copiar chave</button><small>Ela não é armazenada em texto legível. Guarde-a e entregue-a apenas à empresa contratante.</small></section>}
    </div>
  </section></main>;
}
