'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import './access.css';

type Mode = 'enroll' | 'login';

export default function LoginClient() {
  const [mode, setMode] = useState<Mode>('enroll');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setMessage(''); setIsError(false);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/account/${mode}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: form.get('company'), name: form.get('name'), password: form.get('password'), accessKey: form.get('accessKey') }),
    }).catch(() => null);
    const result = await response?.json().catch(() => ({})) as { error?: string } | undefined;
    if (!response?.ok) { setMessage(result?.error || 'Não foi possível conectar. Tente novamente.'); setIsError(true); setLoading(false); return; }
    window.location.assign('/painel');
  }

  const registering = mode === 'enroll';
  return <main className="access-page"><section className="access-card" aria-labelledby="access-title">
    <header className="access-header"><Link href="/" className="access-logo"><span aria-hidden="true">I</span>ImobFlow</Link><p>Gestão imobiliária, com privacidade.</p></header>
    <div className="access-content">
      <div className="access-intro"><p className="access-eyebrow">ACESSO DA IMOBILIÁRIA</p><h1 id="access-title">{registering ? 'Cadastre sua imobiliária.' : 'Acesse sua equipe.'}</h1><p>{registering ? 'Use a chave recebida após a contratação para criar o painel de administrador da sua empresa.' : 'Entre com o nome e a senha que o administrador da imobiliária entregou a você.'}</p></div>
      <div className="access-tabs" role="tablist" aria-label="Tipo de acesso"><button type="button" role="tab" aria-selected={registering} onClick={() => { setMode('enroll'); setMessage(''); }}>Cadastrar empresa</button><button type="button" role="tab" aria-selected={!registering} onClick={() => { setMode('login'); setMessage(''); }}>Login do corretor</button></div>
      <form onSubmit={submit} className="access-form">
        {registering && <label className="access-key">Chave de ativação<input name="accessKey" autoComplete="off" spellCheck="false" placeholder="IMF-••••••••••••" required minLength={20} maxLength={160} /><small>Uma chave ativa uma única imobiliária no plano Basic.</small></label>}
        <div className="access-fields"><label>Nome da empresa<input name="company" autoComplete="organization" placeholder="Ex.: Imobiliária Central" required minLength={2} maxLength={120} /></label><label>{registering ? 'Nome do administrador' : 'Nome do corretor'}<input name="name" autoComplete="username" placeholder="Nome completo" required minLength={2} maxLength={120} /></label><label>{registering ? 'Senha do administrador' : 'Senha do corretor'}<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} placeholder={registering ? 'Mínimo de 12 caracteres' : 'Digite sua senha'} required minLength={registering ? 12 : 1} maxLength={128} /></label></div>
        {message && <p className={isError ? 'access-error' : 'access-notice'} role={isError ? 'alert' : 'status'}>{message}</p>}
        <button className="access-submit" type="submit" disabled={loading}>{loading ? 'Validando chave…' : registering ? 'Criar empresa e entrar' : 'Entrar no painel'}<span aria-hidden="true">→</span></button>
      </form>
      <p className="access-footnote">{registering ? 'Plano Basic: 1 administrador e até 5 corretores. A chave é enviada após o pagamento.' : 'Cada corretor possui seu próprio acesso e senha.'}</p>
    </div>
  </section></main>;
}
