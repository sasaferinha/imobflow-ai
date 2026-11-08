'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { WebsiteDomain, WebsiteDomainStatus, WebsiteDomainsSnapshot } from '@/lib/website/domains-model';
import s from './domain-settings.module.css';

const labels: Record<WebsiteDomainStatus, string> = { pending: 'Aguardando comprovação', verified: 'Posse confirmada', provisioning: 'Configurando conexão', active: 'Conectado', error: 'Revisão necessária' };
async function domainRequest(body?: Record<string, unknown>): Promise<WebsiteDomainsSnapshot> {
  const response = await fetch('/api/website/domains', { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null) as WebsiteDomainsSnapshot & { error?: string } | null;
  if (!response.ok || !data || !Array.isArray(data.domains)) throw new Error(data?.error || 'Não foi possível confirmar a alteração. Atualize a lista antes de tentar novamente.');
  return data;
}

export default function WebsiteDomainSettings({ locked = false }: { locked?: boolean }) {
  const [snapshot, setSnapshot] = useState<WebsiteDomainsSnapshot | null>(null);
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const pending = useRef(false);
  async function load() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { setSnapshot(await domainRequest()); setNeedsReload(false); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Não foi possível carregar os domínios.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function change(action: 'create' | 'verify' | 'disable' | 'enable', domain?: WebsiteDomain) {
    if (pending.current || locked || needsReload) return;
    if (action === 'disable' && !window.confirm(`Desconectar ${domain?.hostname} do site? O conteúdo e os registros DNS serão preservados. Você poderá reconectar e verificar novamente depois.`)) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const next = await domainRequest(action === 'create' ? { action, hostname: hostname.trim() } : { action, id: domain?.id, expectedVersion: domain?.version });
      setSnapshot(next);
      if (action === 'create') { setHostname(''); setNotice('Domínio cadastrado. Adicione o TXT indicado e depois escolha “Verificar conexão”.'); }
      else if (action === 'disable') setNotice('Domínio desconectado. O site continua disponível pelo endereço da ImobFlow.');
      else if (action === 'enable') setNotice('Vínculo reaberto. Verifique a conexão para ativá-lo novamente.');
      else setNotice(next.domains.find(item => item.id === domain?.id)?.message || 'Verificação concluída. Confira o estado abaixo.');
    } catch (issue) { setNeedsReload(true); setError(issue instanceof Error ? issue.message : 'Não foi possível confirmar a operação. Atualize a lista.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <details className={s.panel} onToggle={event => { if (event.currentTarget.open && !snapshot && !pending.current) void load(); }}>
    <summary>Domínio próprio</summary>
    <p>Use o endereço da sua imobiliária. Cadastre exatamente o domínio desejado, como <strong>www.suaimobiliaria.com.br</strong>; a versão sem “www” é um vínculo separado.</p>
    <p>Seu conteúdo precisa estar publicado. Conectar um domínio não publica rascunhos nem altera e-mails ou outros serviços do domínio.</p>
    {error && <p className={s.error} role="alert">{error}</p>}
    {notice && <p className={s.notice} role="status">{notice}</p>}
    {busy && <p role="status">Conferindo configuração…</p>}
    {(needsReload || !snapshot && error) && <button type="button" onClick={() => void load()} disabled={busy}>Atualizar lista</button>}
    {snapshot && <>
      {!snapshot.providerConfigured && <p className={s.pending}>Você já pode comprovar a posse. A ativação aguarda a configuração da hospedagem pela equipe ImobFlow.</p>}
      <div className={s.domains}>{snapshot.domains.map(domain => <article className={s.domain} key={domain.id}>
        <div className={s.title}><strong>{domain.hostname}</strong><span data-active={!domain.disabled && domain.status === 'active'}>{domain.disabled ? 'Desconectado' : labels[domain.status]}</span></div>
        <p>{domain.message}</p>
        {!domain.disabled && <details className={s.instructions} open={domain.status !== 'active'}><summary>Registros DNS</summary><p>No provedor onde você administra o domínio, adicione os registros abaixo. Mantenha o TXT de comprovação; a propagação pode levar algum tempo.</p><div className={s.records}>{domain.records.map((record, index) => <div className={s.record} key={`${record.type}-${record.name}-${index}`}><strong>{record.type} · {record.purpose === 'ownership' ? 'Comprovação da ImobFlow' : record.purpose === 'provider' ? 'Comprovação da hospedagem' : 'Direcionamento do site'}</strong><label>Nome<input readOnly value={record.name} aria-label={`Nome do registro ${index + 1} de ${domain.hostname}`} onFocus={event => event.currentTarget.select()} /></label><label>Valor<input readOnly value={record.value} aria-label={`Valor do registro ${index + 1} de ${domain.hostname}`} onFocus={event => event.currentTarget.select()} /></label></div>)}</div>{domain.records.every(record => record.purpose === 'ownership') && <p>Depois da confirmação do TXT, os registros de direcionamento aparecerão aqui quando a hospedagem estiver configurada.</p>}</details>}
        {domain.checkedAt && <small>Última verificação: {new Date(domain.checkedAt).toLocaleString('pt-BR')}</small>}
        <div className={s.actions}>{domain.disabled ? <button type="button" disabled={busy || locked || needsReload} onClick={() => void change('enable', domain)}>Reconectar</button> : <><button type="button" disabled={busy || locked || needsReload} onClick={() => void change('verify', domain)}>Verificar conexão</button><button type="button" disabled={busy || locked || needsReload} onClick={() => void change('disable', domain)}>Desconectar</button>{domain.status === 'active' && <a href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer">Abrir domínio ↗</a>}</>}</div>
      </article>)}</div>
      {snapshot.domains.length < 3 && <form className={s.add} onSubmit={(event: FormEvent) => { event.preventDefault(); void change('create'); }}><label>Domínio da imobiliária<input required type="text" value={hostname} maxLength={253} placeholder="www.suaimobiliaria.com.br" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy || locked} onChange={event => setHostname(event.target.value)} /></label><button type="submit" disabled={busy || locked || needsReload}>Cadastrar domínio</button></form>}
    </>}
  </details>;
}
