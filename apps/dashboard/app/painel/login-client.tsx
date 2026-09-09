'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import './access.css';

export default function LoginClient({ legacy = false }: { legacy?: boolean }) {
  const [mode, setMode] = useState<'login' | 'provision'>(legacy ? 'provision' : 'login');
  const [existingCompany, setExistingCompany] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
    const response = await fetch(`/api/account/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: form.get('company'), name: form.get('name'), password: form.get('password'), managementPassword: form.get('managementPassword'), seatLimit: form.get('seatLimit'), existingCompany, claimLegacy: legacy }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok && mode === 'login') window.location.reload(); else if (response.ok) { setError('Cadastro concluído. Entregue os dados de acesso ao corretor.'); setLoading(false); event.currentTarget.reset(); } else { setError(result.error || 'Não foi possível continuar.'); setLoading(false); }
    } catch { setError('Não foi possível conectar. Verifique sua internet e tente novamente.'); setLoading(false); }
  }
  return <main className="access-page"><section className="access-card">
    <aside className="access-brand"><Link href="/" className="access-logo"><span>I</span>ImobFlow</Link><div><p>Seu próximo negócio começa aqui.</p><h1>Sua empresa.<br />Sua equipe.<br />Tudo conectado.</h1></div><small>Clientes, imóveis e conversas no mesmo lugar.</small></aside>
    <div className="access-form"><p className="access-eyebrow">PAINEL DA IMOBILIÁRIA</p><h2>{mode === 'login' ? 'Bem-vindo de volta' : 'Cadastrar empresa'}</h2><p>{mode === 'login' ? 'Entre com os dados da sua empresa e do seu corretor.' : 'Área administrativa: crie empresas e acessos individuais para a equipe.'}</p>
      <div className="access-tabs"><button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>Entrar</button><button type="button" aria-pressed={mode === 'provision'} onClick={() => { setMode('provision'); setError(''); }}>Cadastrar empresa</button></div>
      <form onSubmit={login}>
        <label>Nome da empresa<input name="company" autoComplete="organization" placeholder="Ex.: Imobiliária Central" required minLength={2} maxLength={120} /></label>
        <label>Nome do corretor<input name="name" autoComplete="username" placeholder="Seu nome completo" required minLength={2} maxLength={120} /></label>
        <label>Senha do corretor<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'provision' ? 'Pelo menos 12 caracteres' : 'Digite sua senha'} required minLength={mode === 'provision' ? 12 : 1} maxLength={128} /></label>
        {mode === 'provision' && <><label className="access-check"><input type="checkbox" checked={existingCompany} onChange={event => setExistingCompany(event.target.checked)} />Adicionar corretor a uma empresa já cadastrada</label><label>Limite de corretores do plano<input name="seatLimit" type="number" required min={1} max={500} defaultValue={1} /></label><label>Senha administrativa do ImobFlow<input name="managementPassword" type="password" autoComplete="current-password" required placeholder="Senha de administração" minLength={1} maxLength={128} /></label><small>Somente a administração do ImobFlow pode cadastrar empresas e corretores.</small></>}
        {error && <p className="access-error" role="alert">{error}</p>}
        <button className="access-submit" type="submit" disabled={loading}>{loading ? 'Aguarde…' : mode === 'login' ? 'Entrar no painel' : existingCompany ? 'Cadastrar corretor' : 'Cadastrar empresa'}<span aria-hidden="true">→</span></button>
      </form><p className="access-footnote">O acesso fica vinculado à sua empresa.</p>
    </div></section></main>;
}
