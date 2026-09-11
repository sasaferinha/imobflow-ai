'use client';

import PasswordInput from './password-input';
import { useState, type FormEvent } from 'react';

export default function PasswordModal({close}:{close:()=>void}) {
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const [done,setDone] = useState(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setError('');
    const response = await fetch('/api/account/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'change',currentPassword:form.get('currentPassword'),password:form.get('password'),confirmPassword:form.get('confirmPassword')})}).catch(()=>null);
    const data = await response?.json().catch(()=>({})) as { error?: string } | undefined;
    setSaving(false);
    if(!response?.ok) {setError(data?.error || 'Não foi possível trocar a senha.');return;}
    setDone(true);
  }
  return <div className="modal-backdrop" onMouseDown={()=>!saving&&!done&&close()}><form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={submit} onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><h2 id="password-title">Trocar minha senha</h2>{!done&&<button type="button" disabled={saving} aria-label="Fechar" onClick={close}>×</button>}</div>{done?<><p>Sua senha foi alterada e as sessões anteriores foram encerradas.</p><a className="primary-button" href="/painel">Entrar com a nova senha</a></>:<><label>Senha atual<PasswordInput name="currentPassword" autoComplete="current-password" required maxLength={128}/></label><label>Nova senha<PasswordInput name="password" autoComplete="new-password" required minLength={8} maxLength={128} placeholder="Mínimo de 8 caracteres"/></label><label>Confirme a nova senha<PasswordInput name="confirmPassword" autoComplete="new-password" required minLength={8} maxLength={128}/></label><p>Após salvar, entre novamente nos seus dispositivos.</p>{error&&<p className="access-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" onClick={close} disabled={saving}>Cancelar</button><button className="primary-button" disabled={saving}>{saving?'Salvando…':'Salvar nova senha'}</button></div></>}</form></div>;
}
