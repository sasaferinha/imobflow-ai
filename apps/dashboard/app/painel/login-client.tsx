'use client';

import PasswordInput from '../password-input';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import './access.css';

type Mode = 'enroll' | 'login' | 'login-admin';

export default function LoginClient() {
  const [mode, setMode] = useState<Mode>('enroll');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setMessage(''); setIsError(false);
    const form = new FormData(event.currentTarget);
    const response = await fetch(recovering ? '/api/account/password' : `/api/account/${mode}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action:'request', role: mode === 'login' ? 'broker' : 'owner', company: form.get('company'), name: form.get('name'), email: form.get('email'), password: form.get('password'), accessKey: form.get('accessKey') }),
    }).catch(() => null);
    const result = await response?.json().catch(() => ({})) as { error?: string; message?: string } | undefined;
    if (!response?.ok) { setMessage(result?.error || 'Não foi possível conectar. Tente novamente.'); setIsError(true); setLoading(false); return; }
    if (recovering) { setLoading(false); setMessage(result?.message || 'Se houver uma conta ativa, você receberá um link por e-mail.'); return; }
    window.location.assign('/painel');
  }

  const registering = mode === 'enroll';
  const administrator = mode !== 'login';
  return <main className="access-page"><section className="access-card" aria-labelledby="access-title">
    <header className="access-header"><Link href="/" className="access-logo"><span aria-hidden="true">I</span>ImobFlow</Link><p>Gestão imobiliária, com privacidade.</p></header>
    <div className="access-content">
      <div className="access-intro"><p className="access-eyebrow">ACESSO DA IMOBILIÁRIA</p><h1 id="access-title">{recovering ? 'Recupere seu acesso.' : registering ? 'Cadastre sua imobiliária.' : administrator ? 'Acesso do administrador.' : 'Acesso do corretor.'}</h1><p>{recovering ? 'Informe seu e-mail para receber um link de redefinição de senha.' : registering ? 'Use a chave recebida após a contratação para criar o painel de administrador da sua empresa.' : 'Entre com seu e-mail e sua senha pessoal.'}</p></div>
      <div className="access-tabs access-tabs-three" aria-label="Tipo de acesso">{([['enroll','Cadastrar empresa'],['login','Login do corretor'],['login-admin','Login do Administrador']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={mode === value} disabled={loading} onClick={() => { setMode(value); setRecovering(false); setMessage(''); }}>{label}</button>)}</div>
      <form onSubmit={submit} className="access-form">
        {registering && <label className="access-key">Chave de ativação<input name="accessKey" autoComplete="off" spellCheck="false" placeholder="IMF-••••••••••••" required minLength={20} maxLength={160} /><small>Uma chave ativa uma única imobiliária no plano Basic.</small></label>}
        <div className="access-fields">{registering && <label>Nome da empresa<input name="company" autoComplete="organization" placeholder="Ex.: Imobiliária Central" required minLength={2} maxLength={120} /></label>}{registering && <label>Nome do administrador<input name="name" autoComplete="name" placeholder="Nome completo" required minLength={2} maxLength={120} /></label>}<label>{administrator ? 'E-mail do administrador' : 'E-mail do corretor'}<input name="email" type="email" autoComplete="username" placeholder="nome@imobiliaria.com.br" required maxLength={254} /></label>{!recovering && <label>{administrator ? 'Senha do administrador' : 'Senha do corretor'}<PasswordInput key={mode} name="password" autoComplete={registering ? 'new-password' : 'current-password'} placeholder="Mínimo de 8 caracteres" required minLength={8} maxLength={128} /></label>}</div>
        {message && <p className={isError ? 'access-error' : 'access-notice'} role={isError ? 'alert' : 'status'}>{message}</p>}
        <button className="access-submit" type="submit" disabled={loading}>{loading ? 'Aguarde…' : recovering ? 'Enviar link de recuperação' : registering ? 'Criar empresa e entrar' : 'Entrar no painel'}<span aria-hidden="true">→</span></button>
        {!registering && <button className="access-text-button" type="button" disabled={loading} onClick={() => { setRecovering(!recovering); setMessage(''); }}>{recovering ? 'Voltar ao login' : 'Esqueci minha senha'}</button>}
      </form>
      <p className="access-footnote">{registering ? 'Plano Basic: 1 administrador e até 3 corretores. A chave é enviada após o pagamento.' : 'Cada corretor possui seu próprio acesso e senha.'}</p>
    </div>
  </section></main>;
}
