'use client';

import PasswordInput from './password-input';

import { useEffect, useState, type FormEvent } from 'react';
import styles from './team-modal.module.css';

type Broker = {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'broker';
  active: boolean;
  created_at: string;
};

export default function TeamModal({ close, notify }: { close: () => void; notify: (message: string) => void }) {
  const [team, setTeam] = useState<Broker[]>([]);
  const [limit, setLimit] = useState(3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<Broker | null>(null);
  const [resetUrl, setResetUrl] = useState('');
  const [publicContactPath, setPublicContactPath] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/brokers', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as { data?: Broker[]; brokerLimit?: number; error?: string; publicContactPath?:string };
        if (!response.ok) throw new Error(result.error || 'Não foi possível carregar a equipe.');
        if (active) {
          setTeam(result.data || []);
          setLimit(result.brokerLimit || 3);
          setPublicContactPath(result.publicContactPath || '');
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a equipe.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch('/api/brokers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password') }),
    }).catch(() => null);
    const result = await response?.json().catch(() => ({})) as { data?: Broker; error?: string } | undefined;
    if (!response?.ok || !result?.data) {
      setError(result?.error || 'Não foi possível cadastrar o corretor.');
      setSaving(false);
      return;
    }
    setTeam((current) => [...current, result.data!]);
    setSaving(false);
    formElement.reset();
    notify('Corretor cadastrado. Envie a ele o nome da empresa, o e-mail e a senha.');
  }

  const brokers = team.filter((item) => item.role === 'broker' && item.active);
  const administrator = team.find((person) => person.role === 'owner');

  async function toggleAccess(person: Broker) {
    if (!window.confirm(person.active ? `Desativar ${person.name}? As sessões serão encerradas. Os atendimentos e imóveis serão preservados.` : `Reativar ${person.name}? Uma vaga do plano será utilizada.`)) return;
    setChanging(person.id); setError('');
    const response = await fetch(`/api/brokers/${person.id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!person.active})}).catch(()=>null);
    const result = await response?.json().catch(()=>({})) as { data?: Broker; error?: string } | undefined;
    setChanging(null);
    if (!response?.ok || !result?.data) { setError(result?.error || 'Não foi possível alterar o acesso.'); return; }
    setTeam(current=>current.map(item=>item.id===person.id?result.data!:item));
    setRecovery(null); setResetUrl('');
    notify(person.active ? 'Corretor desativado. Histórico preservado.' : 'Corretor reativado.');
  }

  async function generateRecovery(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recovery) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setChanging(recovery.id); setError(''); setResetUrl('');
    const response = await fetch(`/api/brokers/${recovery.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:form.get('currentPassword')})}).catch(()=>null);
    const result = await response?.json().catch(()=>({})) as { url?: string; error?: string } | undefined;
    formElement.reset(); setChanging(null);
    if (!response?.ok || !result?.url) {setError(result?.error || 'Não foi possível gerar o link.');return;}
    setResetUrl(result.url);
  }

  async function saveAdministratorEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/brokers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), currentPassword:form.get('currentPassword') }),
    }).catch(() => null);
    const result = await response?.json().catch(() => ({})) as { ok?: boolean; error?: string } | undefined;
    if (!response?.ok || !result?.ok) {
      setError(result?.error || 'Não foi possível salvar o e-mail.');
      return;
    }
    window.location.assign('/painel');
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <article className={`modal-card ${styles.card}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><p className="eyebrow">Painel do administrador</p><h2>Corretores</h2></div>
          <button type="button" aria-label="Fechar" onClick={close}>×</button>
        </div>

        <p className={styles.plan}><strong>Plano Basic</strong><span>{brokers.length} de {limit} corretores ativos</span></p>
        {publicContactPath && <p className={styles.empty}><a href={publicContactPath} target="_blank" rel="noopener noreferrer">Abrir formulário público da empresa ↗</a><br/>Compartilhe esse endereço para receber clientes somente nesta imobiliária.</p>}

        {administrator && !administrator.email && (
          <form className={styles.adminEmail} onSubmit={saveAdministratorEmail}>
            <strong>Defina seu e-mail de administrador</strong>
            <small>Ele será seu login nas próximas entradas no painel.</small>
            <label>E-mail de acesso<input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="seuemail@imobiliaria.com.br" /></label>
            <label>Senha atual<PasswordInput name="currentPassword" required maxLength={128} autoComplete="current-password"/></label>
            <button type="submit">Salvar e-mail</button>
          </form>
        )}

        {loading ? <p className={styles.empty}>Carregando equipe…</p> : (
          <ul className={styles.list}>
            {team.map((person) => (
              <li key={person.id}>
                <span>{person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                <div><strong>{person.name}</strong><small>{person.role === 'owner' ? 'Administrador' : 'Corretor'}{person.email ? ` · ${person.email}` : ''}</small>{person.role==='broker'&&<div className={styles.staffActions}><button type="button" disabled={!!changing||saving} onClick={()=>toggleAccess(person)}>{changing===person.id?'Aguarde…':person.active?'Desativar':'Reativar'}</button>{person.active&&<button type="button" disabled={!!changing||saving} onClick={()=>{setRecovery(person);setResetUrl('');setError('');}}>Recuperar senha</button>}</div>}</div>
                <em>{person.active ? 'Ativo' : 'Inativo'}</em>
              </li>
            ))}
          </ul>
        )}

        {recovery && <form className={styles.adminEmail} onSubmit={generateRecovery}><strong>Recuperar acesso de {recovery.name}</strong>{resetUrl?<><p>Envie este link somente para o corretor. Expira em 30 minutos e funciona uma única vez.</p><label>Link de recuperação<input readOnly value={resetUrl} onFocus={event=>event.currentTarget.select()}/></label><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(resetUrl);notify('Link copiado.');}catch{setError('Selecione o link e copie manualmente.');}}}>Copiar link</button></>:<><label>Sua senha de administrador<PasswordInput name="currentPassword" required maxLength={128} autoComplete="current-password"/></label><button disabled={!!changing} type="submit">{changing?'Gerando…':'Gerar link'}</button></>}<button type="button" disabled={!!changing} onClick={()=>{setRecovery(null);setResetUrl('');}}>Fechar recuperação</button></form>}
        {error && <p className="access-error" role="alert">{error}</p>}
        <form className={styles.form} onSubmit={create}>
          <h3>Novo corretor</h3>
          <label>Nome completo<input name="name" required minLength={2} maxLength={120} autoComplete="off" placeholder="Ex.: Ana Martins" /></label>
          <label>E-mail de acesso<input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="ana@imobiliaria.com.br" /></label>
          <label>Senha inicial<PasswordInput name="password" required minLength={8} maxLength={128} autoComplete="new-password" placeholder="Mínimo de 8 caracteres" /></label>
          <div className="modal-actions">
            <button type="button" onClick={close}>Fechar</button>
            <button className="primary-button" type="submit" disabled={saving || loading || !!changing || brokers.length >= limit}>{saving ? 'Cadastrando…' : brokers.length >= limit ? 'Limite do Basic atingido' : 'Cadastrar corretor'}</button>
          </div>
        </form>
      </article>
    </div>
  );
}
