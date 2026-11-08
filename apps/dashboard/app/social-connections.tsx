'use client';
import { useState } from 'react';
import type { SocialChannel, SocialMode } from '@/lib/social-model';
import s from './social-connections.module.css';

type Account = { id: string; channel: SocialChannel; name: string; enabled: boolean; defaultMode: SocialMode };
type Page = { id: string; name: string; instagramId: string | null; instagramName: string | null };
type Status = { available: boolean; webhookConfigured: boolean; authorized: boolean; accounts: Account[]; pages?: Page[] };
const channelName = (channel: SocialChannel) => channel === 'instagram' ? 'Instagram' : 'Facebook';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function validStatus(value: Record<string, unknown>): value is Record<string, unknown> & Status {
  return typeof value.available === 'boolean' && typeof value.webhookConfigured === 'boolean' && typeof value.authorized === 'boolean'
    && Array.isArray(value.accounts) && value.accounts.every(account => record(account) && typeof account.id === 'string' && typeof account.name === 'string' && ['instagram', 'facebook'].includes(String(account.channel)) && typeof account.enabled === 'boolean' && ['human', 'suggestions', 'automatic'].includes(String(account.defaultMode)))
    && (value.pages === undefined || Array.isArray(value.pages) && value.pages.every(page => record(page) && typeof page.id === 'string' && typeof page.name === 'string' && (page.instagramId === null || typeof page.instagramId === 'string') && (page.instagramName === null || typeof page.instagramName === 'string')));
}
async function request(action?: Record<string,unknown> | 'pages'): Promise<Status | { url: string }> {
  const response = await fetch(`/api/integrations/meta/social/connections${action === 'pages' ? '?action=pages' : ''}`, { method: action && action !== 'pages' ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', ...(action && action !== 'pages' ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(action)} : {}) });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(record(body) && typeof body.error === 'string' ? body.error : 'Não foi possível consultar a conexão.');
  if (record(body) && typeof body.url === 'string' && typeof action === 'object' && action.action === 'connect') return { url: body.url };
  if (!record(body) || !validStatus(body)) throw new Error('A conexão retornou uma resposta inválida. Atualize e tente novamente.');
  return body;
}
/** Owner-only integration surface; it never receives access tokens or sends messages. */
export default function SocialConnections({ onChange }: { onChange?: () => void } = {}) {
  const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [pageId,setPageId]=useState(''),[facebook,setFacebook]=useState(true),[instagram,setInstagram]=useState(true);
  async function load(includePages=false){setBusy(true);setError('');try{const next=await request(includePages?'pages':undefined);if('url' in next)throw new Error('Resposta de conexão inválida.');setStatus(next);}catch(issue){setError(issue instanceof Error?issue.message:'Não foi possível consultar a conexão.');}finally{setBusy(false);}}
  async function mutate(body:Record<string,unknown>){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{const next=await request(body);if('url' in next){const url=new URL(next.url);if(url.origin!=='https://www.facebook.com'||url.username||url.password)throw new Error('Endereço de autorização inválido.');window.location.assign(url.href);return;}setStatus(next);setNotice(body.action==='mode'?'Preferência salva para novos atendimentos.':body.action==='disconnect'?'Canal desconectado. O histórico foi preservado.':'Conexão salva. As mensagens dependem das permissões e liberações da Meta.');onChange?.();}
    catch(issue){setError(issue instanceof Error?issue.message:'Não foi possível confirmar a operação.');}finally{setBusy(false);}
  }
  const selected=status?.pages?.find(p=>p.id===pageId);
  return <details className={s.root} onToggle={event=>{if(event.currentTarget.open&&!status&&!busy)void load();}}>
    <summary>Conectar Instagram e Facebook <span>Administrador</span></summary>
    <div className={s.body}>
      <p>Escolha a Página da imobiliária e a conta profissional do Instagram vinculada a ela.</p>
      {error&&<p className={s.error} role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {!status&&<button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Carregando…':'Consultar conexão'}</button>}
      {status&&<>
        {!status.available&&<p className={s.note}>A ImobFlow precisa concluir a configuração do aplicativo Meta para liberar a conexão.</p>}
        {!status.webhookConfigured&&<p className={s.note}>O recebimento de mensagens ainda depende da configuração dos eventos Meta pela ImobFlow.</p>}
        <div className={s.actions}><button type="button" disabled={busy||!status.available} onClick={()=>void mutate({action:'connect'})}>{status.authorized?'Autorizar novamente na Meta':'Conectar com a Meta'}</button>{status.authorized&&<button type="button" disabled={busy} onClick={()=>void load(true)}>Escolher Página</button>}<button type="button" disabled={busy} onClick={()=>void load()}>Atualizar estado</button></div>
        {status.pages&&<fieldset disabled={busy} className={s.selection}><legend>Página e canais</legend>
          <label>Página<select value={pageId} onChange={e=>setPageId(e.target.value)}><option value="">Selecione uma Página</option>{status.pages.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
          {!status.pages.length&&<p>Nenhuma Página foi disponibilizada. Confira o acesso concedido na Meta e autorize novamente.</p>}
          <div className={s.channels}><label><input type="checkbox" checked={facebook} onChange={e=>setFacebook(e.target.checked)}/> Facebook</label><label><input type="checkbox" checked={instagram&&Boolean(selected?.instagramId)} disabled={!selected?.instagramId} onChange={e=>setInstagram(e.target.checked)}/> Instagram{selected?.instagramName?` · ${selected.instagramName}`:''}</label></div>
          {selected&&!selected.instagramId&&<p>Essa Página não retornou uma conta profissional do Instagram vinculada.</p>}
          <button type="button" disabled={!selected||(!facebook&&!(instagram&&selected.instagramId))} onClick={()=>void mutate({action:'select-page',pageId,channels:[...(facebook?['facebook']:[]),...(instagram&&selected?.instagramId?['instagram']:[])]})}>Conectar canais selecionados</button>
        </fieldset>}
        {status.accounts.map(account=><div className={s.account} key={account.id}><div><strong>{channelName(account.channel)}</strong><span>{account.name} · {account.enabled?'Conectado':'Desconectado'}</span></div><label>Novos atendimentos<select disabled={busy||!account.enabled} value={account.defaultMode} onChange={e=>void mutate({action:'mode',channel:account.channel,mode:e.target.value})}><option value="human">Atendimento humano</option><option value="suggestions">Sugestões para o corretor</option><option value="automatic">Atendimento automático</option></select></label>{account.enabled&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm(`Desconectar ${channelName(account.channel)}? O histórico será mantido.`))void mutate({action:'disconnect',channel:account.channel});}}>Desconectar</button>}</div>)}
        <p className={s.helper}>A conexão inicia com atendimento humano. A Meta exige permissões aprovadas para atender contas externas e limita as respostas à janela de atendimento. Alterar a preferência acima vale para novos contatos.</p>
      </>}
    </div>
  </details>;
}
