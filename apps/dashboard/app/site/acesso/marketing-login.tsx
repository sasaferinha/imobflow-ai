'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import s from '../../website/site-editor.module.css';

export default function MarketingLogin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting.current) return;
    const data = new FormData(event.currentTarget);
    submitting.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/website/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) });
      const result: unknown = await response.json().catch(() => ({}));
      const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'Não foi possível entrar. Tente novamente.';
      if (!response.ok) throw new Error(message);
      window.location.assign('/site/editar');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Não foi possível entrar.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <main className={s.login}><section className={s.loginCard}><Link className={s.brand} href="/">ImobFlow</Link><p className={s.eyebrow}>PAINEL DO SITE</p><h1>Sua marca sempre atualizada.</h1><p>Entre com o acesso de marketing criado pelo administrador da sua imobiliária.</p><form onSubmit={event => void submit(event)}><fieldset disabled={busy}><label>E-mail<input type="email" name="email" autoComplete="username" required maxLength={160} /></label><label>Senha<input type="password" name="password" autoComplete="current-password" required maxLength={128} /></label>{error && <p className={s.error} role="alert">{error}</p>}<button type="submit" className={s.primary}>{busy ? 'Entrando…' : 'Entrar no editor'}</button></fieldset></form><p className={s.helper}>Precisa de acesso ou de uma nova senha? Fale com o administrador da imobiliária.</p><a href="/painel">Sou administrador da imobiliária →</a></section></main>;
}
