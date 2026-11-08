'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';
import { SITE_LAYOUTS, validateSiteContent, type MarketingAccount, type PublicProperty, type SiteContent, type WebsiteSnapshot } from '@/lib/website/model';
import PublicSite from './public-site';
import WebsiteDomainSettings from './domain-settings';
import s from './site-editor.module.css';

export type WebsiteAction = 'save' | 'publish' | 'unpublish' | 'restore';
export type WebsiteMutation = { action: WebsiteAction; expectedVersion: number; content?: SiteContent };
export type WebsiteTransport = {
  load(): Promise<WebsiteSnapshot>;
  mutate(command: WebsiteMutation): Promise<WebsiteSnapshot>;
  upload(dataUrl: string): Promise<string>;
};
type Section = 'identity' | 'home' | 'promotion' | 'contact';
const sections: { id: Section; title: string; description: string }[] = [
  { id: 'identity', title: 'Identidade', description: 'A marca da sua imobiliária' },
  { id: 'home', title: 'Página inicial', description: 'A primeira impressão do visitante' },
  { id: 'promotion', title: 'Divulgação', description: 'Destaque, campanha e vídeo' },
  { id: 'contact', title: 'Contato', description: 'Como encontrar sua equipe' },
];

export class WebsiteRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store' });
  const data: unknown = await response.json().catch(() => ({}));
  const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Não foi possível concluir. Tente novamente.';
  if (!response.ok) throw new WebsiteRequestError(message, response.status);
  return data as T;
}
export function websiteTransport(marketing = false): WebsiteTransport {
  const query = marketing ? '?access=marketing' : '';
  return {
    load: () => request(`/api/website${query}`),
    mutate: command => request(`/api/website${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) }),
    upload: async dataUrl => (await request<{ url: string }>(`/api/website/media${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) })).url,
  };
}
export const liveWebsiteTransport = websiteTransport();
const marketingWebsiteTransport = websiteTransport(true);
const fingerprint = (content: SiteContent) => JSON.stringify(content);
const date = (value: string | null) => value ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

/** The demo permits only image data created locally; live requests always use the strict shared schema. */
export function validatedEditorContent(content: SiteContent, demo: boolean): SiteContent {
  if (!demo) return validateSiteContent(content);
  const localImage = (value: string) => /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 2_800_000;
  const cleaned = { ...content, logoUrl: localImage(content.logoUrl) ? '' : content.logoUrl, heroImageUrl: localImage(content.heroImageUrl) ? '' : content.heroImageUrl, promotion: { ...content.promotion, imageUrl: localImage(content.promotion.imageUrl) ? '' : content.promotion.imageUrl } };
  const valid = validateSiteContent(cleaned);
  return { ...valid, logoUrl: localImage(content.logoUrl) ? content.logoUrl : valid.logoUrl, heroImageUrl: localImage(content.heroImageUrl) ? content.heroImageUrl : valid.heroImageUrl, promotion: { ...valid.promotion, imageUrl: localImage(content.promotion.imageUrl) ? content.promotion.imageUrl : valid.promotion.imageUrl } };
}

export default function SiteEditor({ initial, transport = liveWebsiteTransport, demo = false, onSnapshot, catalog }: { initial: WebsiteSnapshot; transport?: WebsiteTransport; demo?: boolean; onSnapshot?: (snapshot: WebsiteSnapshot) => void; catalog?: PublicProperty[] }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [draft, setDraft] = useState<SiteContent>(() => structuredClone(initial.site.draft));
  const [section, setSection] = useState<Section>('identity');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const saving = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  const dirty = fingerprint(draft) !== fingerprint(snapshot.site.draft);
  const awaitingPublication = fingerprint(draft) !== fingerprint(snapshot.site.published as SiteContent);
  const publicUrl = demo ? '/modelo-imobiliaria' : `/imobiliaria/${encodeURIComponent(snapshot.company.slug)}`;
  const properties = catalog || snapshot.properties;

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || saving.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);

  function guardLink(event: MouseEvent<HTMLAnchorElement>) {
    if (saving.current || dirty && !window.confirm('Sair sem salvar as alterações do site?')) event.preventDefault();
  }
  function update<K extends keyof SiteContent>(key: K, value: SiteContent[K]) {
    setDraft(current => ({ ...current, [key]: value })); setNotice(''); setError('');
  }
  function accept(next: WebsiteSnapshot, replaceDraft = true) {
    setSnapshot(next); if (replaceDraft) setDraft(structuredClone(next.site.draft));
    setConflict(false); onSnapshot?.(next);
  }
  function validate(): SiteContent | null {
    const invalid = form.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:invalid, textarea:invalid, select:invalid');
    if (invalid) {
      setPreview(false);
      setSection((invalid.closest('[data-section]')?.getAttribute('data-section') || 'identity') as Section);
      setError('Confira o campo indicado antes de continuar.');
      requestAnimationFrame(() => { invalid.focus(); invalid.reportValidity(); });
      return null;
    }
    try { return validatedEditorContent(draft, demo); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Confira os dados do site.'); return null; }
  }
  async function perform(action: WebsiteAction) {
    if (saving.current || conflict) return;
    let content: SiteContent | undefined;
    if (action === 'save' || action === 'publish') { const valid = validate(); if (!valid) return; content = valid; }
    if (action === 'unpublish' && !window.confirm('Retirar o site do ar? O cadastro dos imóveis será preservado.')) return;
    if (action === 'restore' && !window.confirm('Publicar novamente o conteúdo da versão anterior? O rascunho atual será substituído.')) return;
    if ((action === 'unpublish' || action === 'restore') && dirty && !window.confirm('Há alterações não salvas. Descartá-las para continuar?')) return;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      accept(await transport.mutate({ action, expectedVersion: snapshot.site.version, ...(content ? { content } : {}) }));
      setNotice(action === 'save' ? 'Rascunho salvo. O site publicado continua como estava.' : action === 'publish' ? demo ? 'Publicado na demonstração deste navegador.' : 'Site publicado. As alterações já estão disponíveis.' : action === 'restore' ? 'A versão anterior foi publicada novamente.' : 'Site retirado do ar. Seu conteúdo permanece salvo.');
    } catch (issue) {
      if (issue instanceof WebsiteRequestError && issue.status === 409) setConflict(true);
      setError(issue instanceof Error ? issue.message : 'Não foi possível confirmar o resultado. Recarregue antes de tentar novamente.');
    } finally { saving.current = false; setBusy(false); }
  }
  async function reload() {
    if (saving.current || dirty && !window.confirm('Carregar a versão salva e descartar suas alterações desta tela?')) return;
    saving.current = true; setBusy(true); setError('');
    try { accept(await transport.load()); setNotice('Versão salva carregada.'); }
    catch (issue) { setError(issue instanceof Error ? issue.message : 'Não foi possível carregar o site.'); }
    finally { saving.current = false; setBusy(false); }
  }
  // Preview follows the in-progress draft; validation belongs to save/publish only.
  function openPreview() { setPreview(current => !current); }
  const imageChange = (key: 'logoUrl' | 'heroImageUrl' | 'promotion', value: string) => key === 'promotion' ? update('promotion', { ...draft.promotion, imageUrl: value }) : update(key, value);
  async function upload(event: ChangeEvent<HTMLInputElement>, key: 'logoUrl' | 'heroImageUrl' | 'promotion') {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || saving.current) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2_000_000) { setError('Escolha uma imagem JPG, PNG ou WebP de até 2 MB.'); return; }
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
      imageChange(key, await transport.upload(dataUrl));
      setNotice('Imagem adicionada ao rascunho. Publique quando estiver pronto.');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Não foi possível enviar a imagem.'); }
    finally { saving.current = false; setBusy(false); }
  }
  function imageField(label: string, value: string, key: 'logoUrl' | 'heroImageUrl' | 'promotion') {
    return <div className={s.imageField}><label>{label}<input value={value.startsWith('data:') ? '' : value} placeholder={value.startsWith('data:') ? 'Imagem local selecionada' : 'https://… ou envie uma imagem'} maxLength={2048} onChange={event => imageChange(key, event.target.value)} /></label><label className={s.upload}>Enviar imagem<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void upload(event, key)} disabled={busy} /></label>{value && <button className={s.textButton} type="button" disabled={busy} onClick={() => imageChange(key, '')}>Remover imagem</button>}<small>JPG, PNG ou WebP, até 2 MB.</small></div>;
  }
  function textField(label: string, key: 'brandName' | 'tagline' | 'heroTitle' | 'heroText' | 'aboutTitle' | 'aboutText' | 'contactPhone' | 'contactEmail' | 'contactAddress' | 'instagramUrl', options: { max?: number; multiline?: boolean; required?: boolean; type?: string } = {}) {
    const shared = { value: draft[key], maxLength: options.max || 160, required: options.required, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, event.target.value) };
    return <label>{label}{options.multiline ? <textarea rows={key === 'aboutText' ? 5 : 3} {...shared} /> : <input type={options.type || 'text'} {...shared} />}</label>;
  }

  return <div className={s.editor}>
    <header className={s.header}>
      <div className={s.heading}><a href={demo ? '/modelo-imobiliaria' : snapshot.role === 'owner' ? '/painel#settings' : '/site/acesso'} onClick={guardLink}>← {demo ? 'Site de demonstração' : snapshot.role === 'owner' ? 'Voltar ao painel' : 'Acesso ao site'}</a><h1>Seu site</h1><p>{snapshot.company.name} <span className={`${s.badge} ${snapshot.site.published ? s.live : ''}`}>{snapshot.site.published ? 'Publicado' : 'Em preparação'}</span></p></div>
      <div className={s.actions}><button className={s.previewToggle} type="button" onClick={openPreview} aria-controls="website-live-preview" aria-expanded={preview} disabled={busy}>{preview ? 'Voltar à edição' : 'Ver prévia'}</button>{snapshot.site.published && <a className={s.button} href={publicUrl} target="_blank" rel="noopener noreferrer">Abrir site ↗</a>}<button type="button" disabled={busy || !dirty || conflict} onClick={() => void perform('save')}>Salvar rascunho</button><button className={s.primary} type="button" disabled={busy || conflict || !awaitingPublication} onClick={() => void perform('publish')}>{busy ? 'Aguarde…' : snapshot.site.published ? 'Publicar alterações' : 'Publicar site'}</button></div>
    </header>
    {demo && <div className={s.demoNotice}><strong>Imobiliária fictícia · ambiente de demonstração</strong><span>As alterações ficam apenas neste navegador. Nenhuma informação é enviada a clientes.</span></div>}
    <div className={s.saveStatus} role="status">{dirty ? 'Alterações ainda não salvas' : !snapshot.site.published && snapshot.site.version === 0 ? 'Personalize o site para sua primeira publicação' : awaitingPublication ? 'Rascunho salvo · ainda não publicado' : 'Seu site está atualizado'}{snapshot.site.publishedAt && <span>Última publicação: {date(snapshot.site.publishedAt)}</span>}</div>
    {error && <div className={s.error} role="alert" ref={errorBox} tabIndex={-1}>{error}{conflict && <><p>Seu rascunho foi preservado. Carregue a versão atual antes de salvar novamente.</p><button type="button" disabled={busy} onClick={() => void reload()}>Carregar versão atual</button></>}</div>}
    {notice && <p className={s.notice} role="status">{notice}</p>}
    <div className={s.studio} data-mobile-preview={preview}>
    <div className={s.editPane}>
    <div className={s.workspace}>
      <aside className={s.sidebar}><nav aria-label="Seções do editor">{sections.map(item => <button key={item.id} type="button" aria-current={section === item.id ? 'step' : undefined} onClick={() => setSection(item.id)}><strong>{item.title}</strong><small>{item.description}</small></button>)}</nav></aside>
      <form className={s.form} ref={form} noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); void perform('save'); }}>
        <fieldset disabled={busy} data-section="identity" hidden={section !== 'identity'}>
          <legend>Uma marca, o seu jeito.</legend><p className={s.intro}>Personalize a identidade que aparece para seus clientes.</p>
          <fieldset className={s.layoutPicker}>
            <legend>Modelo do site</legend><p>Escolha um modelo e personalize com sua marca.</p>
            <div className={s.layoutChoices}>{SITE_LAYOUTS.map(layout => <label key={layout.id} className={s.layoutChoice} data-selected={(draft.layout || 'classic') === layout.id}>
              <input type="radio" name="site-layout" value={layout.id} checked={(draft.layout || 'classic') === layout.id} aria-label={layout.name} aria-describedby={`site-layout-${layout.id}-description`} onChange={() => update('layout', layout.id)} />
              <span className={s.layoutThumbnail} data-layout={layout.id} aria-hidden="true"><span className={s.thumbnailHeader}><i /><i /></span><span className={s.thumbnailHero}><span className={s.thumbnailCopy}><i /><i /><b /></span><span className={s.thumbnailImage} /></span><span className={s.thumbnailSearch} /><span className={s.thumbnailCards}><i /><i /><i /></span></span>
              <strong className={s.layoutName}>{layout.name}</strong><small id={`site-layout-${layout.id}-description`}>{layout.description}</small>
            </label>)}</div>
            <small className={s.layoutHint}>Seus textos, fotos e imóveis continuam os mesmos. A prévia acompanha suas alterações.</small>
          </fieldset>
          {textField('Nome da imobiliária', 'brandName', { required: true, max: 120 })}{textField('Frase da marca', 'tagline')}{imageField('Logo da imobiliária', draft.logoUrl, 'logoUrl')}<label>Cor principal<div className={s.color}><input type="color" aria-label="Escolher cor principal" value={draft.primaryColor} onChange={event => update('primaryColor', event.target.value)} /><input aria-label="Código da cor principal" value={draft.primaryColor} maxLength={7} pattern="#[0-9a-fA-F]{6}" onChange={event => update('primaryColor', event.target.value)} /></div></label><label className={s.switch}><input type="checkbox" checked={draft.showPrices} onChange={event => update('showPrices', event.target.checked)} /><span>Mostrar os preços no catálogo</span></label>
        </fieldset>
        <fieldset disabled={busy} data-section="home" hidden={section !== 'home'}><legend>Receba bem quem chega.</legend><p className={s.intro}>Uma apresentação curta e uma boa imagem destacam sua imobiliária.</p>{textField('Título principal', 'heroTitle', { required: true })}{textField('Texto de apresentação', 'heroText', { multiline: true, max: 600 })}{imageField('Imagem de capa', draft.heroImageUrl, 'heroImageUrl')}<hr />{textField('Título sobre a imobiliária', 'aboutTitle')}{textField('Sobre a imobiliária', 'aboutText', { multiline: true, max: 3000 })}</fieldset>
        <fieldset disabled={busy} data-section="promotion" hidden={section !== 'promotion'}><legend>Seu próximo destaque.</legend><p className={s.intro}>Divulgue uma campanha, uma oportunidade ou um vídeo da equipe.</p><label className={s.switch}><input type="checkbox" checked={draft.promotion.enabled} onChange={event => update('promotion', { ...draft.promotion, enabled: event.target.checked })} /><span>Mostrar destaque no site</span></label>{draft.promotion.enabled && <div className={s.subsection}><label>Título do destaque<input required maxLength={120} value={draft.promotion.title} onChange={event => update('promotion', { ...draft.promotion, title: event.target.value })} /></label><label>Texto do destaque<textarea maxLength={1200} rows={3} value={draft.promotion.text} onChange={event => update('promotion', { ...draft.promotion, text: event.target.value })} /></label>{imageField('Imagem do destaque', draft.promotion.imageUrl, 'promotion')}<div className={s.twoColumns}><label>Texto do botão<input maxLength={60} value={draft.promotion.linkLabel} onChange={event => update('promotion', { ...draft.promotion, linkLabel: event.target.value })} /></label><label>Link do botão<input maxLength={2048} placeholder="https://…" value={draft.promotion.linkUrl} onChange={event => update('promotion', { ...draft.promotion, linkUrl: event.target.value })} /></label></div></div>}<hr /><label className={s.switch}><input type="checkbox" checked={draft.video.enabled} onChange={event => update('video', { ...draft.video, enabled: event.target.checked })} /><span>Mostrar vídeo no site</span></label>{draft.video.enabled && <div className={s.subsection}><label>Título do vídeo<input maxLength={160} value={draft.video.title} onChange={event => update('video', { ...draft.video, title: event.target.value })} /></label><label>Link do vídeo<input required maxLength={2048} placeholder="https://www.youtube.com/watch?v=…" value={draft.video.url} onChange={event => update('video', { ...draft.video, url: event.target.value })} /><small>YouTube, Vimeo ou arquivo MP4/WebM hospedado em HTTPS. O vídeo começa apenas quando o visitante quiser.</small></label></div>}</fieldset>
        <fieldset disabled={busy} data-section="contact" hidden={section !== 'contact'}><legend>Uma conversa começa aqui.</legend><p className={s.intro}>Informe os canais públicos da imobiliária.</p>{textField('Telefone / WhatsApp', 'contactPhone', { max: 30, type: 'tel' })}{textField('E-mail de contato', 'contactEmail', { max: 160, type: 'email' })}{textField('Endereço da imobiliária', 'contactAddress', { max: 300 })}{textField('Link do Instagram', 'instagramUrl', { max: 2048 })}<p className={s.helper}>Os contatos interessados em um imóvel entram na conta da sua imobiliária na ImobFlow.</p></fieldset>
      </form>
    </div>
    <div className={s.bottom}><div className={s.catalog}><strong>{properties.length} imóveis disponíveis</strong><p>{demo ? 'Catálogo ilustrativo, somente para consulta. Na sua imobiliária, os imóveis são gerenciados pelo CRM.' : 'O catálogo acompanha o cadastro: preço, fotos e disponibilidade são atualizados no site.'}</p>{!demo && snapshot.role === 'owner' && <a href="/painel#properties" onClick={guardLink}>Gerenciar imóveis →</a>}</div><details className={s.advanced}><summary>Publicação e histórico</summary><p>O catálogo usa sempre a disponibilidade atual dos imóveis. Restaurar o conteúdo não altera os imóveis do CRM.</p><div className={s.actions}><button type="button" onClick={() => void reload()} disabled={busy}>Recarregar dados</button><button type="button" disabled={busy || conflict || !snapshot.site.previous} onClick={() => void perform('restore')}>Restaurar publicação anterior</button><button type="button" disabled={busy || conflict || !snapshot.site.published} onClick={() => void perform('unpublish')}>Retirar site do ar</button></div></details>{snapshot.role === 'owner' && !demo && <MarketingAccess accounts={snapshot.marketingAccounts || []} locked={busy} onChange={accounts => setSnapshot(current => ({ ...current, marketingAccounts: accounts }))} />}{snapshot.role === 'marketing' && <button className={s.textButton} type="button" onClick={async () => { if (saving.current || dirty && !window.confirm('Sair sem salvar as alterações?')) return; try { await request('/api/website/session', { method: 'DELETE' }); window.location.assign('/site/acesso'); } catch { setError('Não foi possível encerrar o acesso. Tente novamente.'); } }}>Sair do editor</button>}</div>
    {snapshot.role === 'owner' && !demo && <WebsiteDomainSettings locked={busy} />}
    </div>
    <section className={s.preview} id="website-live-preview" aria-label="Prévia ao vivo do site"><div className={s.previewNotice}><strong>Prévia ao vivo</strong><span>As alterações só vão ao ar ao publicar.</span></div><div className={s.previewViewport} tabIndex={0} role="region" aria-label="Navegar pela prévia do site"><PublicSite content={draft} properties={properties} companySlug={snapshot.company.slug} preview demo={demo} /></div></section>
    </div>
  </div>;
}

export function MarketingAccess({ accounts, locked, onChange }: { accounts: MarketingAccount[]; locked: boolean; onChange: (accounts: MarketingAccount[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetId, setResetId] = useState<string | null>(null);
  const submitting = useRef(false);
  async function send(body: Record<string, string>, form?: HTMLFormElement) {
    if (submitting.current || locked) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const data = await request<{ marketingAccounts: MarketingAccount[] }>('/api/website/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      onChange(data.marketingAccounts); form?.reset(); setResetId(null); setNotice(body.action === 'create' ? 'Acesso criado. Compartilhe o endereço de entrada e a senha diretamente com a pessoa.' : body.action === 'reset-password' ? 'Senha atualizada. As sessões anteriores dessa pessoa foram encerradas.' : 'Acesso desativado. As sessões dessa pessoa foram encerradas.');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Não foi possível alterar o acesso.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <details className={s.advanced}><summary>Acesso da equipe de marketing</summary><p>Esses usuários editam somente o site. Eles não recebem acesso a leads, conversas, comissões ou configurações do CRM.</p><a href="/site/acesso" target="_blank" rel="noopener noreferrer">Abrir página de acesso ↗</a>{error && <p role="alert" className={s.error}>{error}</p>}{notice && <p role="status" className={s.notice}>{notice}</p>}<ul className={s.accounts}>{accounts.map(account => <li key={account.id}><div className={s.accountRow}><div><strong>{account.name}</strong><span>{account.email} · {account.active ? 'Ativo' : 'Desativado'}</span></div>{account.active && <div className={s.actions}><button type="button" disabled={busy || locked} onClick={() => { setResetId(resetId === account.id ? null : account.id); setError(''); setNotice(''); }}>Nova senha</button><button type="button" disabled={busy || locked} onClick={() => { if (window.confirm(`Desativar o acesso ao site de ${account.name}?`)) void send({ action: 'deactivate', id: account.id }); }}>Desativar</button></div>}</div>{account.active && resetId === account.id && <form className={s.accessForm} aria-label={`Nova senha para ${account.name}`} onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void send({ action: 'reset-password', id: account.id, password: String(data.get('password')) }, form); }}><fieldset disabled={busy || locked}><label>Nova senha<input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" /><small>As sessões anteriores serão encerradas. Compartilhe a nova senha diretamente com a pessoa.</small></label><div className={s.actions}><button className={s.primary} type="submit">Atualizar senha</button><button type="button" onClick={() => setResetId(null)}>Cancelar</button></div></fieldset></form>}</li>)}</ul><form className={s.accessForm} onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void send({ action: 'create', name: String(data.get('name')), email: String(data.get('email')), password: String(data.get('password')) }, form); }}><fieldset disabled={busy || locked}><legend>Adicionar pessoa</legend><label>Nome<input name="name" required maxLength={120} autoComplete="off" /></label><label>E-mail<input name="email" type="email" required maxLength={160} autoComplete="off" /></label><label>Senha de acesso<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /><small>Use pelo menos 12 caracteres. A senha não será exibida novamente.</small></label><button className={s.primary} type="submit">{busy ? 'Salvando…' : 'Criar acesso ao site'}</button></fieldset></form></details>;
}

export function LiveWebsiteEditor({ marketing = false }: { marketing?: boolean }) {
  const [snapshot, setSnapshot] = useState<WebsiteSnapshot | null>(null);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [retry, setRetry] = useState(0);
  const selectedTransport = marketing ? marketingWebsiteTransport : liveWebsiteTransport;
  const load = useCallback(() => selectedTransport.load(), [selectedTransport]);
  useEffect(() => {
    let alive = true;
    load().then(data => { if (alive) { setSnapshot(data); setError(''); setUnauthorized(false); } }).catch(issue => { if (alive) { setError(issue instanceof Error ? issue.message : 'Não foi possível carregar o editor.'); setUnauthorized(issue instanceof WebsiteRequestError && (issue.status === 401 || issue.status === 403)); } });
    return () => { alive = false; };
  }, [load, retry]);
  if (snapshot) return <SiteEditor initial={snapshot} transport={selectedTransport} />;
  return <main className={s.entry}><a href="/painel">ImobFlow</a><h1>Seu site, no seu controle.</h1>{error ? <><p role="alert">{error}</p>{unauthorized ? <div className={s.actions}><a className={s.button} href="/painel">Entrar como administrador</a><a className={`${s.button} ${s.primary}`} href="/site/acesso">Entrar como marketing</a></div> : <button type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>}</> : <p role="status">Carregando seu site…</p>}<a href="/modelo-imobiliaria/editor">Experimentar com uma imobiliária fictícia →</a></main>;
}
