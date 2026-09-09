'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import './access.css';

export default function LoginClient({ legacy = false }: { legacy?: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup'>(legacy ? 'signup' : 'login');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
    const response = await fetch(`/api/account/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: form.get('company'), name: form.get('name'), password: form.get('password'), invitation: joining ? form.get('invitation') : undefined, claimLegacy: legacy }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) window.location.reload(); else { setError(result.error || 'Não foi possível entrar.'); setLoading(false); }
    } catch { setError('Não foi possível conectar. Verifique sua internet e tente novamente.'); setLoading(false); }
  }
  return <main className="access-page"><section className="access-card">
    <aside className="access-brand"><Link href="/" className="access-logo"><span>I</span>ImobFlow</Link><div><p>Seu próximo negócio começa aqui.</p><h1>Sua empresa.<br />Sua equipe.<br />Tudo conectado.</h1></div><small>Clientes, imóveis e conversas no mesmo lugar.</small></aside>
    <div className="access-form"><p className="access-eyebrow">PAINEL DA IMOBILIÁRIA</p><h2>{mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}</h2><p>{legacy ? 'Cadastre seu acesso individual para administrar a empresa atual.' : mode === 'login' ? 'Entre com os dados da sua empresa e do seu corretor.' : 'Cada corretor tem sua própria senha de acesso.'}</p>
      {!legacy && <div className="access-tabs"><button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>Entrar</button><button type="button" aria-pressed={mode === 'signup'} onClick={() => { setMode('signup'); setError(''); }}>Criar conta</button></div>}
      <form onSubmit={login}>
        <label>Nome da empresa<input name="company" autoComplete="organization" placeholder="Ex.: Imobiliária Central" required minLength={2} maxLength={120} /></label>
        <label>Nome do corretor<input name="name" autoComplete="username" placeholder="Seu nome completo" required minLength={2} maxLength={120} /></label>
        <label>Senha do corretor<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'signup' ? 'Pelo menos 12 caracteres' : 'Digite sua senha'} required minLength={mode === 'signup' ? 12 : 1} maxLength={128} /></label>
        {mode === 'signup' && !legacy && <><label className="access-check"><input type="checkbox" checked={joining} onChange={event => setJoining(event.target.checked)} />Minha empresa já tem uma conta</label>{joining ? <label>Código de convite<input name="invitation" required autoComplete="off" placeholder="Código enviado pelo administrador" maxLength={128} /></label> : <small>Você será o administrador da nova empresa e poderá convidar outros corretores.</small>}</>}
        {error && <p className="access-error" role="alert">{error}</p>}
        <button className="access-submit" type="submit" disabled={loading}>{loading ? 'Aguarde…' : mode === 'login' ? 'Entrar no painel' : legacy ? 'Cadastrar meu acesso' : joining ? 'Entrar para a equipe' : 'Criar empresa e conta'}<span aria-hidden="true">→</span></button>
      </form><p className="access-footnote">O acesso fica vinculado à sua empresa.</p>
    </div></section></main>;
}
