'use client';

import PasswordInput from '../../password-input';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import '../access.css';

export default function PasswordResetClient() {
  const [token,setToken] = useState('');
  const [message,setMessage] = useState('');
  const [loading,setLoading] = useState(false);
  const [done,setDone] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    const timer = window.setTimeout(() => {
      if (/^[a-f0-9]{64}$/.test(value)) setToken(value);
      else setMessage('Link inválido. Solicite um novo link de recuperação.');
    },0);
    window.history.replaceState(null,'',window.location.pathname);
    return () => window.clearTimeout(timer);
  },[]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true); setMessage('');
    const response = await fetch('/api/account/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset',token,password:form.get('password'),confirmPassword:form.get('confirmation')})}).catch(() => null);
    const result = await response?.json().catch(() => ({})) as { error?: string } | undefined;
    setLoading(false);
    if (!response?.ok) { setMessage(result?.error || 'Não foi possível redefinir a senha. Tente novamente.'); return; }
    setToken(''); setDone(true); setMessage('Senha alterada. Entre novamente usando sua nova senha.');
  }
  return <main className="access-page"><section className="access-card"><header className="access-header"><Link href="/painel" className="access-logo"><span>I</span>ImobFlow</Link></header><div className="access-content"><div className="access-intro"><h1>Nova senha.</h1><p>O link é válido por 30 minutos e pode ser usado apenas uma vez.</p></div><form className="access-form reset-form" onSubmit={submit}>{!done && <><label>Nova senha<PasswordInput name="password" required minLength={8} maxLength={128} autoComplete="new-password" placeholder="Mínimo de 8 caracteres" /></label><label>Confirme a nova senha<PasswordInput name="confirmation" required minLength={8} maxLength={128} autoComplete="new-password" /></label></>}{message && <p role={done?'status':'alert'} className={done?'access-notice':'access-error'}>{message}</p>}{!done && <button className="access-submit" disabled={loading || !token}>{loading?'Salvando…':'Salvar nova senha'}</button>}<Link className="access-text-button" href="/painel">Ir para o login</Link></form></div></section></main>;
}
