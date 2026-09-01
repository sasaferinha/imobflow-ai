'use client';

import { useState, type FormEvent } from 'react';

export default function LoginClient() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError('');
    const password = String(new FormData(event.currentTarget).get('password') || '');
    const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (response.ok) window.location.reload(); else { setError('Senha incorreta.'); setLoading(false); }
  }
  return <main className="admin-login"><form onSubmit={login}><a className="landing-brand" href="/"><span>I</span><strong>ImobFlow</strong></a><p className="eyebrow">Área restrita</p><h1>Painel do corretor</h1><p>Entre para acessar os perfis e dados dos clientes.</p><label>Senha de acesso<input name="password" type="password" autoFocus required placeholder="Digite sua senha" /></label><button disabled={loading}>{loading ? 'Entrando…' : 'Entrar no painel'}</button>{error && <small role="alert">{error}</small>}</form></main>;
}
