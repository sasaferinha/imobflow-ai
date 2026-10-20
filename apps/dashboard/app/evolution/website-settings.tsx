'use client';

import { useEffect, useRef, useState } from 'react';
import type { CrmCommand, CrmState } from '@/lib/evolution/model';
import { getWebsiteSettings, validateWebsiteSettings, type WebsiteSettings as WebsiteConfig } from '@/lib/evolution/website-settings';
import s from './website-settings.module.css';

type Props = { state: CrmState; isAdmin: boolean; busy: boolean; execute: (command: CrmCommand) => Promise<boolean>; onDirtyChange: (dirty: boolean) => void };
const fingerprint = (value: WebsiteConfig) => JSON.stringify(value);

export default function WebsiteSettings(props: Props) {
  if (!props.isAdmin) return <section role="alert"><h2>Acesso exclusivo do administrador</h2><p>Somente o administrador pode preparar a conexão do site.</p></section>;
  let initial: WebsiteConfig;
  try { initial = getWebsiteSettings(props.state.settings.website); }
  catch { return <section role="alert"><h2>Não foi possível validar os dados do site</h2><p>Atualize a página ou procure o suporte. Os dados salvos não foram substituídos.</p></section>; }
  return <WebsiteSettingsForm {...props} initial={initial} />;
}

function WebsiteSettingsForm({ initial, busy, execute, onDirtyChange }: Props & { initial: WebsiteConfig }) {
  const [draft, setDraft] = useState<WebsiteConfig>(() => ({ ...initial }));
  const [baseline, setBaseline] = useState(() => fingerprint(initial));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copyState, setCopyState] = useState('');
  const saving = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const dirty = fingerprint(draft) !== baseline;
  const conflict = fingerprint(initial) !== baseline;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { if (error) { errorRef.current?.focus({ preventScroll: true }); errorRef.current?.scrollIntoView({ block:'center', behavior:'smooth' }); } }, [error]);

  function update(key: 'url' | 'provider', value: string) { setDraft(current => ({ ...current, [key]: value })); setError(''); setNotice(''); setCopyState(''); }
  function discard() {
    if (busy || saving.current || dirty && !window.confirm('Descartar os dados do site que ainda não foram salvos?')) return;
    setDraft({ ...initial }); setBaseline(fingerprint(initial)); setError(''); setNotice(''); setCopyState('');
  }
  async function save() {
    if (busy || saving.current || conflict) return;
    let valid: WebsiteConfig;
    try { valid = validateWebsiteSettings(draft); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Revise os dados do site.'); return; }
    saving.current = true; setError(''); setNotice('');
    try {
      if (await execute({ type:'settings', settings:{ website:valid } })) {
        setDraft(valid); setBaseline(fingerprint(valid)); onDirtyChange(false);
        setNotice(valid.url ? 'Dados do site salvos. A integração continua pendente; nenhum imóvel foi enviado.' : 'Dados de preparação removidos. Nenhum anúncio externo foi alterado.');
      }
    } finally { saving.current = false; }
  }
  let shareableUrl = '';
  try { shareableUrl = validateWebsiteSettings({ ...draft, provider: '' }).url; } catch { /* Never copy an unvalidated access URL into a supplier message. */ }
  const supplierMessage = `Olá! Usamos a ImobFlow para cadastrar os imóveis da imobiliária${shareableUrl ? ` e queremos integrar o site ${shareableUrl}` : ''}. Precisamos publicar imóveis novos, atualizar preços, fotos e informações, e retirar anúncios vendidos, alugados, desativados ou excluídos. Vocês oferecem uma API, importação por XML/JSON ou um plugin para isso? Podem enviar a documentação, os requisitos, a frequência de atualização e informar se há custo adicional? Não enviem senhas ou tokens nesta conversa.`;
  async function copyMessage() {
    try { await navigator.clipboard.writeText(supplierMessage); setCopyState('Mensagem copiada. Nenhuma mensagem foi enviada.'); }
    catch { setCopyState('Não foi possível copiar automaticamente. Selecione e copie o texto abaixo.'); }
  }
  return <div className={s.root}>
    <header className={s.intro}><h2>Leve seus imóveis ao site da imobiliária</h2><p>Não precisa saber a parte técnica. Comece com o endereço do site; a compatibilidade será conferida antes de ativar a integração.</p></header>
    <div className={s.pending}><strong>{initial.url ? 'Aguardando integração' : 'Integração ainda não ativa'}</strong><p>Salvar estes dados prepara o cadastro. Ainda não publica, atualiza ou retira anúncios no seu site.</p></div>
    <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      {error && <div className={s.error} role="alert" ref={errorRef} tabIndex={-1}>{error}</div>}
      {notice && <div className={s.success} role="status">{notice}</div>}
      {conflict && <div className={s.pending} role="alert"><strong>Os dados salvos mudaram em outra sessão.</strong><p>Seu rascunho foi preservado. Carregue a versão atual ou revise antes de substituir.</p><div className={s.actions}><button type="button" disabled={busy} onClick={discard}>Carregar dados salvos</button><button type="button" disabled={busy} onClick={() => setBaseline(fingerprint(initial))}>Revisei; manter meus dados</button></div></div>}
      <fieldset className={s.panel} disabled={busy}><legend>1. Identifique o site</legend>
        <label>Endereço do site<input type="url" inputMode="url" autoComplete="url" placeholder="https://www.suaimobiliaria.com.br" value={draft.url} maxLength={1024} onChange={event => update('url', event.target.value)} /><small>Use o endereço público com https://. Não coloque senhas, chaves ou links de acesso administrativo.</small></label>
        <label>Quem fez ou cuida do site? <span>(opcional)</span><input type="text" value={draft.provider} maxLength={100} placeholder="Nome da empresa ou do profissional, se souber" onChange={event => update('provider', event.target.value)} /><small>Se não souber, pode deixar em branco.</small></label>
        <div className={s.scope}><strong>O que queremos sincronizar</strong><ul><li>Publicar os imóveis cadastrados.</li><li>Atualizar preço, fotos e informações.</li><li>Retirar anúncios vendidos, alugados, desativados ou excluídos.</li></ul><small>Escopo solicitado. A automação só poderá ser ativada após implementar e testar a conexão com o fornecedor.</small></div>
      </fieldset>
      <footer className={s.footer}><small>Somente os dados de preparação são salvos na sua imobiliária.</small><div className={s.actions}><button type="button" disabled={busy || !dirty && !conflict} onClick={discard}>Descartar ajustes</button><button className={s.primary} disabled={busy || !dirty || conflict}>{busy ? 'Salvando…' : 'Salvar dados do site'}</button></div></footer>
    </form>
    <section className={s.next}><h3>2. Confirme com quem cuida do site</h3><p>Encaminhe esta mensagem ao fornecedor. Com a resposta, poderemos escolher a forma de integração e validar o envio antes de ativar.</p><details><summary>Ver mensagem pronta para o fornecedor</summary><label className={s.message}>Mensagem para copiar<textarea readOnly rows={7} value={supplierMessage} /></label><button type="button" onClick={() => void copyMessage()}>Copiar mensagem</button>{copyState && <p role="status">{copyState}</p>}</details><small>Você escolhe para quem enviar. A ImobFlow não entra em contato com o fornecedor por esta tela.</small></section>
  </div>;
}
