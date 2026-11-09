'use client';
import { useRef, useState } from 'react';
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
async function request(action?: Record<string,unknown> | 'pages', channel?: SocialChannel): Promise<Status | { url: string }> {
  const query = action === 'pages' ? `?action=pages&channel=${channel}` : '';
  const response = await fetch(`/api/integrations/meta/social/connections${query}`, { method: action && action !== 'pages' ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', ...(action && action !== 'pages' ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(action)} : {}) });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(record(body) && typeof body.error === 'string' ? body.error : 'Não foi possível consultar a conexão.');
  if (record(body) && typeof body.url === 'string' && typeof action === 'object' && action.action === 'connect') return { url: body.url };
  if (!record(body) || !validStatus(body)) throw new Error('A conexão retornou uma resposta inválida. Atualize e tente novamente.');
  return body;
}
/** Owner-only integration surface; it never receives access tokens or sends messages. */
export default function SocialConnections({ onChange }: { onChange?: () => void } = {}) {
  const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [pageId,setPageId]=useState(''),[selection,setSelection]=useState<{channel:SocialChannel;pages:Page[]}|null>(null);
  const inFlight=useRef(false);
  async function load(channel?:SocialChannel){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
    if(channel)setSelection(null);
    try{
      const next=await request(channel?'pages':undefined,channel);if('url' in next)throw new Error('Resposta de conexão inválida.');setStatus(next);
      if(channel){const pages=next.pages||[];setSelection({channel,pages});setPageId(previous=>selection?.channel===channel&&pages.some(page=>page.id===previous)?previous:'');}
    }catch(issue){setError(issue instanceof Error?issue.message:'Não foi possível consultar a conexão.');}finally{inFlight.current=false;setBusy(false);}
  }
  async function mutate(body:Record<string,unknown>){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{const next=await request(body);if('url' in next){const url=new URL(next.url);if(url.origin!=='https://www.facebook.com'||url.username||url.password)throw new Error('Endereço de autorização inválido.');window.location.assign(url.href);return;}setStatus(next);if(body.action==='select-page'){setSelection(null);setPageId('');}setNotice(body.action==='mode'?'Preferência salva para novos atendimentos.':body.action==='disconnect'?'Canal desconectado. O histórico foi preservado.':'Conexão salva. As mensagens dependem das permissões e liberações da Meta.');onChange?.();}
    catch(issue){setError(issue instanceof Error?issue.message:'Não foi possível confirmar a operação.');}finally{inFlight.current=false;setBusy(false);}
  }
  const selected=selection?.pages.find(p=>p.id===pageId);
  return <details className={s.root} onToggle={event=>{if(event.currentTarget.open&&!status&&!busy)void load();}}>
    <summary>Conectar Instagram e Facebook <span>Administrador</span></summary>
    <div className={s.body}>
      <p>Conecte cada canal separadamente. Para o Instagram, escolha uma conta profissional vinculada à Página da imobiliária.</p>
      {error&&<p className={s.error} role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {!status&&<button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Carregando…':'Consultar conexão'}</button>}
      {status&&<>
        {!status.available&&<p className={s.note}>A ImobFlow precisa concluir a configuração do aplicativo Meta para liberar a conexão.</p>}
        {!status.webhookConfigured&&<p className={s.note}>O recebimento de mensagens ainda depende da configuração dos eventos Meta pela ImobFlow.</p>}
        <div className={s.actions}>{(['facebook','instagram'] as const).map(channel=><button type="button" key={channel} disabled={busy||!status.available} onClick={()=>void mutate({action:'connect',channel})}>{status.accounts.some(account=>account.channel===channel&&account.enabled)?'Reconectar':'Conectar'} {channelName(channel)}</button>)}{status.authorized&&<><button type="button" disabled={busy} onClick={()=>void load('facebook')}>Escolher Página do Facebook</button><button type="button" disabled={busy} onClick={()=>void load('instagram')}>Escolher conta do Instagram</button></>}<button type="button" disabled={busy} onClick={()=>void load()}>Atualizar estado</button></div>
        {selection&&<fieldset disabled={busy} className={s.selection}><legend>{selection.channel==='facebook'?'Página do Facebook':'Conta do Instagram'}</legend>
          <label>Página<select value={pageId} onChange={e=>setPageId(e.target.value)}><option value="">Selecione uma Página</option>{selection.pages.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
          {!selection.pages.length&&<p>Nenhuma Página foi disponibilizada. Confira o acesso concedido na Meta e autorize {channelName(selection.channel)} novamente.</p>}
          {selection.channel==='instagram'&&selected&&<p>{selected.instagramId?`Instagram vinculado: ${selected.instagramName||'conta profissional'}.`:'Essa Página não retornou uma conta profissional do Instagram. Confira o vínculo e a autorização desse canal.'}</p>}
          <button type="button" disabled={!selected||(selection.channel==='instagram'&&!selected.instagramId)} onClick={()=>void mutate({action:'select-page',pageId,channels:[selection.channel]})}>Usar esta Página no {channelName(selection.channel)}</button>
        </fieldset>}
        {status.accounts.map(account=><div className={s.account} key={account.id}><div><strong>{channelName(account.channel)}</strong><span>{account.name} · {account.enabled?'Conectado':'Desconectado'}</span></div><label>Novos atendimentos<select disabled={busy||!account.enabled} value={account.defaultMode} onChange={e=>void mutate({action:'mode',channel:account.channel,mode:e.target.value})}><option value="human">Atendimento humano</option><option value="suggestions">Sugestões para o corretor</option><option value="automatic">Atendimento automático</option></select></label>{account.enabled&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm(`Desconectar ${channelName(account.channel)}? O histórico será mantido.`))void mutate({action:'disconnect',channel:account.channel});}}>Desconectar</button>}</div>)}
        <p className={s.helper}>A conexão inicia com atendimento humano. A Meta exige permissões aprovadas para atender contas externas e limita as respostas à janela de atendimento. Alterar a preferência acima vale para novos contatos.</p>
      </>}
    </div>
  </details>;
}
