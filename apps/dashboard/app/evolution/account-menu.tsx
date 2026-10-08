'use client';

import { useEffect, useId, useRef, useState } from 'react';
import s from './evolution.module.css';

type Props = { name: string; role: 'owner' | 'broker'; preview?: boolean; onOpen?: () => void };

export default function AccountMenu({ name, role, preview = false, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const logoutButton = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const panelId = useId();
  const roleLabel = role === 'owner' ? 'Administrador' : 'Corretor';
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  useEffect(() => {
    if (!open) return;
    logoutButton.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function logout() {
    if (busy.current) return;
    if (preview) {
      setMessage('Você está em uma demonstração. Nenhuma sessão real será encerrada.');
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/api/admin/logout', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
      });
      if (!response.ok) throw new Error('Logout failed');
      // A full navigation discards the authenticated panel and its client cache.
      window.location.replace(`/painel?acesso=${role === 'owner' ? 'administrador' : 'corretor'}`);
    } catch {
      setMessage('Não foi possível sair da conta. Tente novamente.');
    } finally {
      clearTimeout(timeout);
      busy.current = false;
      setPending(false);
    }
  }

  return <div className={s.accountMenu} ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className={s.headerUser}
      aria-label={`Abrir opções da conta de ${name}`} aria-expanded={open} aria-controls={panelId}
      title={`${name} · ${roleLabel}`} onClick={() => {
        if (!open) onOpen?.();
        setOpen(!open);
      }}>
      <span className={s.avatar} aria-hidden="true">{initials}</span>
      <span className={s.accountTriggerName}>{name}<small>{roleLabel}</small></span>
      <svg className={s.accountChevron} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div id={panelId} className={s.accountDropdown} role="region" aria-label="Opções da conta" aria-busy={pending}>
      <div className={s.accountIdentity}><strong>{name}</strong><span>{roleLabel}</span></div>
      <div className={s.accountMenuBody}>
        <button ref={logoutButton} className={s.accountLogout} type="button" disabled={pending} onClick={logout}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4M8 12h13" /></svg>
          {pending ? 'Saindo…' : 'Sair da conta'}
        </button>
        <p className={s.accountHint}>Voltar ao login e entrar com outra conta.</p>
        {message && <p className={preview ? s.accountNotice : s.accountError} role={preview ? 'status' : 'alert'}>{message}</p>}
      </div>
    </div>}
  </div>;
}
