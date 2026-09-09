'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import '../access.css';

export default function LicenseAdminClient() {
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage(''); setKey('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/licenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: form.get('company'), seatLimit: form.get('seatLimit'), managementPassword: form.get('managementPassword') }) }).catch(() => null);
    const result = await response?.json().catch(() => ({})) as { error?: string; key?: string } | undefined;
    if (!response?.ok || !result?.key) { setMessage(result?.error || 'Não foi possível gerar a chave.'); setLoading(false); return; }
    setKey(result.key); setLoading(false); event.currentTarget.reset();
  }
  return <main className="access-page"><section className="access-card" aria-labelledby="license-title">
    <header className="access-header"><Link href="/" className="access-logo"><span aria-hidden="true">I</span>ImobFlow</Link><p>Administração de licenças</p></header>
    <div className="access-content"><div className="access-intro"><p className="access-eyebrow">ADMINISTRAÇÃO</p><h1 id="license-title">Gerar chave de acesso.</h1><p>Crie uma chave após o pagamento. Ela libera somente o número de corretores contratado.</p></div>
      <form onSubmit={submit} className="access-form admin-license-form"><div className="access-fields"><label>Empresa existente <small>Opcional — use para ampliar o plano de uma empresa já cadastrada.</small><input name="company" placeholder="Ex.: Imobiliária Central" autoComplete="organization" minLength={2} maxLength={120} /></label><label>Quantidade de corretores do plano<input name="seatLimit" type="number" required min={1} max={500} defaultValue={1} /></label><label>Senha administrativa<input name="managementPassword" type="password" required autoComplete="current-password" /></label></div>{message && <p className="access-error" role="alert">{message}</p>}<button className="access-submit" type="submit" disabled={loading}>{loading ? 'Gerando chave…' : 'Gerar chave de acesso'}<span aria-hidden="true">→</span></button></form>
      {key && <section className="license-result" aria-live="polite"><strong>Chave criada — copie agora.</strong><code>{key}</code><button type="button" onClick={() => navigator.clipboard.writeText(key)}>Copiar chave</button><small>Ela não é armazenada em texto legível. Guarde-a e entregue-a apenas à empresa contratante.</small></section>}
    </div>
  </section></main>;
}
