import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { supabaseServiceRequest as db } from './supabase';

const VERSION = 'v26.0';
export const ADS_COOKIE = 'imobflow_meta_ads_state';
export class AdsError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export type Connection = { company_id: string; token_ciphertext: string; account_id: string | null; account_name: string | null; currency: string | null; expires_at: string | null };
export type AdAccount = { id: string; name: string; currency: string; account_status: number };
export type Campaign = { id: string; name: string; status: string; objective: string; daily_budget?: string };
export type Insight = { campaign_id: string; campaign_name: string; spend: string; impressions: string; clicks: string; reach: string; ctr: string; cpc: string; actions?: Array<{ action_type: string; value: string }> };

function encryptionKey() {
  const explicit = process.env.META_ADS_TOKEN_ENCRYPTION_KEY?.trim();
  if (explicit && !/^[a-f0-9]{64}$/i.test(explicit)) throw new AdsError('A proteção da conexão Meta precisa ser configurada.', 503);
  if (explicit) return Buffer.from(explicit, 'hex');
  const secret = process.env.META_APP_SECRET?.trim();
  if (!secret) throw new AdsError('A conexão de anúncios ainda não foi habilitada pela ImobFlow.', 503);
  return createHash('sha256').update('imobflow/meta-ads/token/v1\0' + secret).digest();
}
export function encryptAdsToken(token: string, companyId: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(companyId));
  const content = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), content.toString('base64url')].join('.');
}
export function decryptAdsToken(value: string, companyId: string) {
  const [version, iv, tag, content, extra] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !content || extra) throw new AdsError('Reconecte sua conta de anúncios.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(companyId)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(content, 'base64url')), decipher.final()]).toString('utf8');
}
export function adsAvailable() {
  try { encryptionKey(); return /^\d+$/.test(process.env.META_APP_ID || '') && Boolean(process.env.META_APP_SECRET); } catch { return false; }
}
async function graph<T>(path: string, token: string, params: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${VERSION}/${path}`);
  const data = new URLSearchParams(params);
  if (token && process.env.META_APP_SECRET) data.set('appsecret_proof', createHmac('sha256', process.env.META_APP_SECRET).update(token).digest('hex'));
  if (method === 'GET') url.search = data.toString();
  let response: Response;
  try {
    response = await fetch(url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: method === 'POST' ? data.toString() : undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch { throw new AdsError('A Meta não respondeu. Tente novamente em alguns instantes.', 502); }
  const payload = await response.json().catch(() => null) as ({ error?: { code?: number } } & T) | null;
  if (!response.ok || !payload || payload.error) {
    if (payload?.error?.code === 190) throw new AdsError('A autorização expirou. Conecte novamente sua conta de anúncios.', 401);
    if (response.status === 429 || [4,17,32,613].includes(Number(payload?.error?.code))) throw new AdsError('A Meta limitou as solicitações. Aguarde antes de tentar novamente.',429);
    throw new AdsError('A Meta não autorizou esta operação. Confira as permissões e a situação da conta no Gerenciador de Anúncios.', 502);
  }
  return payload as T;
}
async function graphList<T>(path: string, token: string, params: Record<string, string>): Promise<T[]> {
  const rows: T[] = [], cursors = new Set<string>(); let after = '';
  for (let page = 0; page < 20; page++) {
    const result = await graph<{ data: T[]; paging?: { next?: string; cursors?: { after?: string } } }>(path, token, { ...params, limit: '100', ...(after ? { after } : {}) });
    if (!Array.isArray(result.data)) throw new AdsError('A Meta retornou dados incompletos.', 502);
    rows.push(...result.data);
    if (!result.paging?.next) return rows;
    const cursor = result.paging.cursors?.after;
    if (!cursor || cursor.length > 4096 || cursors.has(cursor)) break;
    cursors.add(cursor); after = cursor;
  }
  throw new AdsError('A consulta excedeu o limite. Reduza o período ou consulte a conta no Gerenciador de Anúncios.');
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function beginAdsOAuth(companyId: string, brokerId: string, redirectUri: string) {
  if (!adsAvailable()) throw new AdsError('A conexão de anúncios ainda não foi habilitada pela ImobFlow.', 503);
  const state = randomBytes(32).toString('hex');
  await db('meta_ads_oauth_requests', { method: 'POST', body: { state_hash: hash(state), company_id: companyId, broker_id: brokerId, redirect_uri: redirectUri, expires_at: new Date(Date.now() + 600000).toISOString() } });
  const url = new URL(`https://www.facebook.com/${VERSION}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: process.env.META_APP_ID!, redirect_uri: redirectUri, state, response_type: 'code', scope: 'ads_read,ads_management,pages_show_list,pages_read_engagement' }).toString();
  return { state, url: url.toString() };
}
export async function finishAdsOAuth(state: string, cookie: string | undefined, code: string) {
  if (!/^[a-f0-9]{64}$/.test(state) || state !== cookie || code.length < 10 || code.length > 4096) throw new AdsError('A conexão expirou. Inicie novamente pelo painel.');
  // DELETE RETURNING consumes the state once, before any exchange or persistence.
  const requests = await db<Array<{ company_id: string; broker_id: string; redirect_uri: string }>>(`meta_ads_oauth_requests?state_hash=eq.${hash(state)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE', prefer: 'return=representation' });
  const request = requests[0]; if (!request) throw new AdsError('A conexão expirou. Inicie novamente pelo painel.');
  const owners = await db<Array<{ id: string }>>(`broker_accounts?id=eq.${request.broker_id}&company_id=eq.${request.company_id}&role=eq.owner&active=eq.true&select=id`);
  if (!owners.length) throw new AdsError('O acesso de administrador não está mais ativo.', 403);
  const token = await graph<{ access_token: string; expires_in?: number }>('oauth/access_token', '', { client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, redirect_uri: request.redirect_uri, code }, 'POST');
  if (!token.access_token) throw new AdsError('A Meta não forneceu autorização. Conecte novamente.');
  const extended = await graph<{ access_token: string; expires_in?: number }>('oauth/access_token', '', { grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, fb_exchange_token: token.access_token }, 'POST');
  if (!extended.access_token) throw new AdsError('A Meta não forneceu autorização. Conecte novamente.');
  await db('meta_ads_connections?on_conflict=company_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { company_id: request.company_id, connected_by: request.broker_id, token_ciphertext: encryptAdsToken(extended.access_token, request.company_id), expires_at: extended.expires_in ? new Date(Date.now() + extended.expires_in * 1000).toISOString() : null, account_id: null, account_name: null, currency: null, updated_at: new Date().toISOString() } });
}
export async function loadAdsConnection(companyId: string) {
  const rows = await db<Connection[]>(`meta_ads_connections?company_id=eq.${companyId}&select=company_id,token_ciphertext,account_id,account_name,currency,expires_at&limit=1`);
  const row = rows[0];
  if (row && (row.company_id !== companyId || (row.account_id !== null && !/^act_\d{3,30}$/.test(row.account_id)))) throw new AdsError('A conexão salva precisa ser revisada. Conecte novamente.', 503);
  return row || null;
}
function tokenFor(connection: Connection) {
  if (connection.expires_at && Date.parse(connection.expires_at) <= Date.now()) throw new AdsError('A autorização expirou. Conecte novamente sua conta de anúncios.', 401);
  return decryptAdsToken(connection.token_ciphertext, connection.company_id);
}
export async function listAdAccounts(connection: Connection) { return graphList<AdAccount>('me/adaccounts', tokenFor(connection), { fields: 'id,name,currency,account_status' }); }
export async function selectAdAccount(companyId: string, accountId: string) {
  if (!/^act_\d{3,30}$/.test(accountId)) throw new AdsError('Escolha uma conta de anúncios válida.');
  const connection = await loadAdsConnection(companyId); if (!connection) throw new AdsError('Conecte primeiro sua conta Meta.');
  const account = (await listAdAccounts(connection)).find(row => row.id === accountId);
  if (!account) throw new AdsError('Esta conta não pertence à autorização conectada.', 403);
  await db(`meta_ads_connections?company_id=eq.${companyId}`, { method: 'PATCH', body: { account_id: account.id, account_name: account.name, currency: account.currency, updated_at: new Date().toISOString() } });
}
export function validateAdsDates(since: string, until: string) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(since) || !valid(until) || since > until || Date.parse(until) - Date.parse(since) > 366 * 86400000 || until > new Date().toISOString().slice(0, 10)) throw new AdsError('Escolha um período válido de até um ano, sem datas futuras.');
}
export async function adsDashboard(connection: Connection, since: string, until: string) {
  validateAdsDates(since, until);
  if (!connection.account_id) throw new AdsError('Escolha a conta de anúncios.');
  const token = tokenFor(connection);
  const [campaigns, insights] = await Promise.all([
    graphList<Campaign>(`${connection.account_id}/campaigns`, token, { fields: 'id,name,status,objective,daily_budget' }),
    graphList<Insight>(`${connection.account_id}/insights`, token, { fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,ctr,cpc,actions', level: 'campaign', time_range: JSON.stringify({ since, until }) }),
  ]);
  return { campaigns, insights, since, until, currency: connection.currency, accountName: connection.account_name };
}
export function campaignParameters(input: { name?: unknown; dailyBudget?: unknown; objective?: unknown }, currency: string | null) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const budget = input.dailyBudget;
  if (!name || name.length > 150 || typeof budget !== 'number' || !Number.isFinite(budget) || budget < 1 || budget > 100000 || !['OUTCOME_LEADS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT'].includes(String(input.objective))) throw new AdsError('Informe nome, objetivo e orçamento diário entre R$ 1 e R$ 100.000.');
  if (currency !== 'BRL') throw new AdsError('A criação pelo CRM está disponível para contas em reais (BRL).');
  return { name, objective: String(input.objective), daily_budget: String(Math.round(budget * 100)), status: 'PAUSED', special_ad_categories: JSON.stringify(['HOUSING']), special_ad_category_country: JSON.stringify(['BR']), bid_strategy: 'LOWEST_COST_WITHOUT_CAP' };
}
export async function createPausedCampaign(connection: Connection, input: { name?: unknown; dailyBudget?: unknown; objective?: unknown; requestId?: unknown }) {
  if (!connection.account_id) throw new AdsError('Escolha a conta de anúncios.');
  const params = campaignParameters(input, connection.currency);
  if (typeof input.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId)) throw new AdsError('Atualize a página antes de criar uma campanha.');
  const requestHash = hash(JSON.stringify({ accountId: connection.account_id, ...params }));
  const claim = await db<Array<{ request_id: string }>>('meta_ads_campaign_requests?on_conflict=company_id,request_id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: { company_id: connection.company_id, request_id: input.requestId, request_hash: requestHash } });
  if (!claim.length) {
    const rows = await db<Array<{ request_hash: string; campaign_id: string | null }>>(`meta_ads_campaign_requests?company_id=eq.${connection.company_id}&request_id=eq.${input.requestId}&select=request_hash,campaign_id&limit=1`);
    if (rows[0]?.request_hash === requestHash && rows[0]?.campaign_id) return { id: rows[0].campaign_id, name: params.name, status: 'PAUSED' };
    throw new AdsError('Esta solicitação já foi processada ou aguarda confirmação. Confira a campanha na Meta antes de iniciar outra.');
  }
  let result: { id: string };
  try { result = await graph<{ id: string }>(`${connection.account_id}/campaigns`, tokenFor(connection), params, 'POST'); }
  catch { throw new AdsError('Não foi possível confirmar a criação. Confira o Gerenciador de Anúncios antes de iniciar outra solicitação.', 502); }
  if (!/^\d+$/.test(result.id || '')) throw new AdsError('A Meta não confirmou a criação. Confira o Gerenciador antes de tentar novamente.', 502);
  await db(`meta_ads_campaign_requests?company_id=eq.${connection.company_id}&request_id=eq.${input.requestId}`, { method: 'PATCH', body: { campaign_id: result.id } });
  return { id: result.id, name: params.name, status: 'PAUSED' };
}
export async function disconnectAds(companyId: string) { await db(`meta_ads_connections?company_id=eq.${companyId}`, { method: 'DELETE' }); }

export async function updateAdCampaign(connection: Connection, input: { campaignId?: unknown; status?: unknown; dailyBudget?: unknown; confirmSpend?: unknown }) {
  if (!connection.account_id || typeof input.campaignId !== 'string' || !/^\d{3,30}$/.test(input.campaignId) || !['PAUSED', 'ACTIVE'].includes(String(input.status))) throw new AdsError('Escolha uma campanha e uma situação válidas.');
  const token = tokenFor(connection);
  const campaign = await graph<{ id: string; account_id: string; lifetime_budget?: string; daily_budget?: string }>(input.campaignId, token, { fields: 'id,account_id,lifetime_budget,daily_budget' });
  if (campaign.id !== input.campaignId || `act_${campaign.account_id}` !== connection.account_id) throw new AdsError('Esta campanha não pertence à conta selecionada.', 403);
  const params: Record<string, string> = { status: String(input.status) };
  if (input.status === 'ACTIVE') {
    if (input.confirmSpend !== true) throw new AdsError('Confirme o orçamento antes de ativar a campanha.');
    if (Number(campaign.lifetime_budget || 0) > 0) throw new AdsError('Campanhas com orçamento vitalício devem ser ajustadas no Gerenciador de Anúncios.');
    const validated = campaignParameters({ name: 'budget', objective: 'OUTCOME_LEADS', dailyBudget: input.dailyBudget }, connection.currency);
    params.daily_budget = validated.daily_budget;
  }
  const result = await graph<{ success: boolean }>(input.campaignId, token, params, 'POST');
  if (result.success !== true) throw new AdsError('A Meta não confirmou a alteração. Atualize os dados antes de tentar novamente.', 502);
  return { id: input.campaignId, status: params.status };
}

export type AdDraftInput = { requestId?: unknown; campaignId?: unknown; pageId?: unknown; name?: unknown; message?: unknown; title?: unknown; destinationUrl?: unknown; imageUrl?: unknown; dailyBudget?: unknown; confirmBudget?: unknown };
export type AdDraft = { requestId: string; campaignId: string; adsetId: string | null; creativeId: string | null; adId: string | null; name: string; state: 'creating' | 'complete' | 'uncertain'; step: string; error: string | null; status: 'PAUSED' };
function adPublicUrl(value: unknown): string {
  if(typeof value!=='string'||value.length>2048||/[\s\\\u0000-\u001f]/u.test(value))throw new AdsError('Use um endereço público HTTPS válido.');
  try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)||/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(u.hostname))throw new Error();return u.href;}catch{throw new AdsError('Use um endereço público HTTPS válido.');}
}
export function adDraftParameters(input: AdDraftInput, currency: string | null) {
  const text=(value:unknown,max:number)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))throw new AdsError('Confira o nome, o título e o texto do anúncio.');return value.trim();};
  if(typeof input.requestId!=='string'||!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(input.requestId)||typeof input.campaignId!=='string'||!/^\d{3,30}$/.test(input.campaignId)||typeof input.pageId!=='string'||!/^\d{3,30}$/.test(input.pageId))throw new AdsError('Escolha a campanha e a Página do anúncio.');
  if(input.confirmBudget!==true)throw new AdsError('Confirme o orçamento diário da campanha antes de criar o rascunho.');
  const budget=campaignParameters({name:'draft',dailyBudget:input.dailyBudget,objective:'OUTCOME_TRAFFIC'},currency).daily_budget;
  return {requestId:input.requestId,campaignId:input.campaignId,pageId:input.pageId,name:text(input.name,150),message:text(input.message,2000),title:text(input.title,100),destinationUrl:adPublicUrl(input.destinationUrl),imageUrl:adPublicUrl(input.imageUrl),budget};
}
export async function listAdsPages(connection: Connection) {
  const pages=await graphList<{id:string;name:string}>('me/accounts',tokenFor(connection),{fields:'id,name'});
  return pages.filter(page=>/^\d{3,30}$/.test(page.id)).map(page=>({id:page.id,name:page.name}));
}
type DraftRow = { request_id:string;request_hash:string;campaign_id:string;adset_id:string|null;creative_id:string|null;ad_id:string|null;name:string;state:AdDraft['state'];step:string;error_message:string|null };
const mapDraft=(row:DraftRow):AdDraft=>({requestId:row.request_id,campaignId:row.campaign_id,adsetId:row.adset_id,creativeId:row.creative_id,adId:row.ad_id,name:row.name,state:row.state,step:row.step,error:row.error_message,status:'PAUSED'});
export async function listAdDrafts(connection: Connection):Promise<AdDraft[]> {
 if(!connection.account_id)return[];
 const rows=await db<DraftRow[]>(`meta_ads_build_requests?company_id=eq.${connection.company_id}&account_id=eq.${connection.account_id}&select=request_id,campaign_id,adset_id,creative_id,ad_id,name,state,step,error_message&order=created_at.desc&limit=100`);return rows.map(mapDraft);
}
/** Creates only paused objects; activating an existing campaign never activates these ad sets or ads. */
export async function createPausedAdDraft(connection: Connection,actorId:string,input:AdDraftInput):Promise<AdDraft>{
 if(!connection.account_id)throw new AdsError('Escolha a conta de anúncios.');
 const p=adDraftParameters(input,connection.currency),token=tokenFor(connection);
 const campaign=await graph<{id:string;account_id:string;status:string;objective:string;daily_budget?:string;lifetime_budget?:string;special_ad_categories?:string[]}>(p.campaignId,token,{fields:'id,account_id,status,objective,daily_budget,lifetime_budget,special_ad_categories'});
 if(campaign.id!==p.campaignId||`act_${campaign.account_id}`!==connection.account_id)throw new AdsError('A campanha não pertence à conta selecionada.',403);
 if(campaign.status!=='PAUSED'||campaign.objective!=='OUTCOME_TRAFFIC'||!campaign.special_ad_categories?.includes('HOUSING'))throw new AdsError('Escolha uma campanha pausada de Tráfego na categoria Moradia. Outros objetivos continuam disponíveis no Gerenciador da Meta.');
 if(Number(campaign.lifetime_budget||0)>0||String(campaign.daily_budget)!==p.budget)throw new AdsError('O orçamento diário mudou ou não está definido na campanha. Atualize os dados e confirme o valor atual.');
 if(!(await listAdsPages(connection)).some(page=>page.id===p.pageId))throw new AdsError('A Página não pertence à autorização conectada.',403);
 const requestHash=hash(JSON.stringify({account:connection.account_id,...p}));
 const claimed=await db<boolean>('rpc/claim_meta_ads_build',{method:'POST',body:{p_company_id:connection.company_id,p_actor_id:actorId,p_request_id:p.requestId,p_account_id:connection.account_id,p_hash:requestHash,p_campaign_id:p.campaignId,p_name:p.name}});
 const path=`meta_ads_build_requests?company_id=eq.${connection.company_id}&request_id=eq.${p.requestId}`;
 if(!claimed){const [existing]=await db<DraftRow[]>(`${path}&select=*&limit=1`);if(existing?.request_hash!==requestHash)throw new AdsError('Esta solicitação já foi usada para outro anúncio. Atualize e confira os rascunhos.',409);if(existing.state==='complete')return mapDraft(existing);throw new AdsError('A criação anterior ainda não foi confirmada. Confira os IDs do rascunho e o Gerenciador da Meta antes de criar outro.',409);}
 const record:DraftRow={request_id:p.requestId,request_hash:requestHash,campaign_id:p.campaignId,adset_id:null,creative_id:null,ad_id:null,name:p.name,state:'creating',step:'adset',error_message:null};
 const checkpoint=async()=>db(path,{method:'PATCH',body:{adset_id:record.adset_id,creative_id:record.creative_id,ad_id:record.ad_id,state:record.state,step:record.step,error_message:record.error_message,updated_at:new Date().toISOString()}});
 const confirmed=(value:unknown)=>{if(typeof value!=='string'||!/^\d{3,30}$/.test(value))throw new AdsError('A Meta não confirmou o identificador criado.',502);return value;};
 try{
  const adset=await graph<{id:string}>(`${connection.account_id}/adsets`,token,{name:`${p.name} · conjunto`,campaign_id:p.campaignId,status:'PAUSED',optimization_goal:'LINK_CLICKS',billing_event:'IMPRESSIONS',destination_type:'WEBSITE',targeting:JSON.stringify({geo_locations:{countries:['BR']},age_min:18,age_max:65,publisher_platforms:['facebook'],facebook_positions:['feed'],device_platforms:['mobile','desktop']})},'POST');
  record.adset_id=confirmed(adset.id);record.step='creative';await checkpoint();
  const creative=await graph<{id:string}>(`${connection.account_id}/adcreatives`,token,{name:`${p.name} · criativo`,object_story_spec:JSON.stringify({page_id:p.pageId,link_data:{message:p.message,name:p.title,picture:p.imageUrl,link:p.destinationUrl,call_to_action:{type:'LEARN_MORE',value:{link:p.destinationUrl}}}}),url_tags:'utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}'},'POST');
  record.creative_id=confirmed(creative.id);record.step='ad';await checkpoint();
  const ad=await graph<{id:string}>(`${connection.account_id}/ads`,token,{name:p.name,adset_id:record.adset_id,creative:JSON.stringify({creative_id:record.creative_id}),status:'PAUSED'},'POST');
  record.ad_id=confirmed(ad.id);record.state='complete';record.step='complete';await checkpoint();return mapDraft(record);
 }catch{record.state='uncertain';record.error_message='Não foi possível confirmar toda a criação. Os objetos confirmados permanecem pausados. Confira os IDs e a Meta antes de iniciar outro rascunho.';try{await checkpoint();}catch{/* Preserve the initial claim even if checkpoint storage is unavailable. */}throw new AdsError(record.error_message,502);}
}
