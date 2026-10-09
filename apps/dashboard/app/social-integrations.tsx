'use client';
import { useEffect, useState } from 'react';
import { dashboardFetch } from '@/lib/dashboard-transport';
import styles from './social-integrations.module.css';

type Intake = {id:string;name:string;source:string;createdAt:string;details:string|null;messages:Array<{id:string;text:string;at:string}>};
type Status = {facebook:boolean;instagram:boolean;webhookConfigured:boolean;inbox:Intake[]};
export default function SocialIntegrations(){
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[selected,setSelected]=useState('');
  useEffect(()=>{
    const abort=new AbortController();
    void dashboardFetch('/api/integrations/meta/social',{signal:abort.signal,cache:'no-store'}).then(async response=>{
      const data=await response.json() as {data?:Status;error?:string};if(!response.ok||!data.data)throw Error(data.error||'Consulta indisponível.');if(!abort.signal.aborted)setStatus(data.data);
    }).catch(reason=>{if(!abort.signal.aborted)setError(reason instanceof Error?reason.message:'Consulta indisponível.');});
    return()=>abort.abort();
  },[attempt]);
  const record=status?.inbox.find(r=>r.id===selected);
  return <section className={styles.root} aria-label="Instagram e formulários do Facebook">
    <header><div><span className={styles.eyebrow}>CANAIS DE ENTRADA</span><h2>Instagram e Facebook</h2><p>Novos contatos chegam ao catálogo de leads. Sem disparos automáticos.</p></div><button type="button" onClick={()=>{setError('');setAttempt(a=>a+1);}}>Atualizar canais</button></header>
    {error&&<p role="alert">{error}</p>}
    <div className={styles.cards}>{(['facebook','instagram'] as const).map(channel=><article key={channel}>
      <span className={styles.icon} aria-hidden="true">{channel==='facebook'?'f':'◎'}</span><h3>{channel==='facebook'?'Formulários do Facebook':'Instagram Direct'}</h3>
      <span className={styles.status}>{!status?'Consultando…':status[channel]&&status.webhookConfigured?'Configuração salva · teste pendente':'Autorização / configuração pendente'}</span>
      <p>{channel==='facebook'?'Recebe formulários, preserva as respostas e organiza os campos reconhecidos. Informações ausentes ficam pendentes para revisão.':'Recebe mensagens de texto e cria o contato sem inventar telefone ou preferências. Consulte as últimas 40 mensagens por contato abaixo.'}</p>
    </article>)}</div>
    <details className={styles.setup}><summary>O que falta para ativar os canais?</summary><ol>
      <li>Autorizar o aplicativo Meta na Página do Facebook e na conta profissional do Instagram.</li>
      <li>Conceder acesso aos leads dos formulários e às mensagens da conta profissional. A Meta pode exigir análise do aplicativo.</li>
      <li>Vincular cada Página/conta à imobiliária no servidor e cadastrar o webhook de entrada. Credenciais nunca devem ser enviadas por conversa ou colocadas em campos de cadastro.</li>
      <li>Enviar um formulário e uma mensagem de teste autorizados. A configuração salva não confirma o recebimento real.</li>
    </ol><p>Webhook: <code>/api/integrations/meta/social</code>. O WhatsApp continua com sua conexão própria acima. O Instagram aqui é somente leitura: responda pelo aplicativo da Meta. Mídias, respostas pelo painel e sincronização retroativa não estão habilitadas.</p></details>
    <div className={styles.inbox}><h3>Entradas recentes <small>Até 30 contatos</small></h3>
      {!status?<p>Carregando entradas…</p>:!status.inbox.length?<p>Nenhuma entrada social recebida. Novos contatos aparecerão após a configuração e o primeiro recebimento.</p>:<div className={styles.columns}><div className={styles.list}>{status.inbox.map(item=><button type="button" key={item.id} aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}><strong>{item.name}</strong><span>{item.source} · {new Date(item.createdAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}</span></button>)}</div><div className={styles.detail}>{record?<><h4>{record.name}</h4><p>Contato disponível também no catálogo de leads, para revisão e atribuição.</p>{record.messages.length?record.messages.map(m=><blockquote key={m.id}><time>{new Date(m.at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</time><p>{m.text}</p></blockquote>):<p className={styles.answers}>{record.details||'Sem respostas adicionais.'}</p>}</>:<p>Selecione uma entrada para consultar.</p>}</div></div>}
    </div>
  </section>;
}
