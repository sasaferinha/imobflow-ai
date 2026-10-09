import { createHash } from 'node:crypto';
import { supabaseServiceRequest as db } from './supabase';
import { analyzeLead, explainProfile, type LeadInput } from './leads';
import { importPhone } from './lead-import';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const clean = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const id = (value: unknown) => /^\d{1,40}$/.test(clean(value)) ? clean(value) : '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type SocialConnection = { companyId: string; pageId?: string; instagramId?: string; accessToken?: string; enabled: boolean; apiVersion: string };
export type SocialEvent = { kind: 'facebook' | 'instagram'; connection: SocialConnection; externalId: string; senderId?: string; text?: string; occurredAt?: string };

/** Bindings are server-managed. A webhook can never select an arbitrary tenant. */
export function socialConnections(raw = process.env.META_SOCIAL_CONNECTIONS): SocialConnection[] {
  if (!raw) return [];
  const input: unknown = JSON.parse(raw);
  if (!Array.isArray(input) || input.length > 1000) throw new Error('social_configuration_invalid');
  const bound = new Set<string>();
  return input.map(value => {
    const row = object(value), companyId = clean(row.companyId), pageId = id(row.pageId), instagramId = id(row.instagramId);
    if (!uuid.test(companyId) || (!pageId && !instagramId) || (row.enabled !== undefined && typeof row.enabled !== 'boolean')) throw new Error('social_configuration_invalid');
    for (const key of [pageId && `page:${pageId}`, instagramId && `instagram:${instagramId}`].filter(Boolean)) {
      if (bound.has(key)) throw new Error('social_account_ambiguous');
      bound.add(key);
    }
    return { companyId, pageId: pageId || undefined, instagramId: instagramId || undefined, accessToken: clean(row.accessToken, 4000) || undefined, enabled: row.enabled === true, apiVersion: /^v\d+\.\d+$/.test(clean(row.apiVersion)) ? clean(row.apiVersion) : 'v26.0' };
  });
}

export function parseSocialEvents(payload: unknown, connections: SocialConnection[]): SocialEvent[] {
  const root = object(payload), result: SocialEvent[] = [];
  for (const rawEntry of list(root.entry)) {
    const entry = object(rawEntry), entryId = id(entry.id);
    if (!entryId) continue;
    if (root.object === 'page') {
      const connection = connections.find(c => c.enabled && c.pageId === entryId);
      if (!connection) continue;
      for (const rawChange of list(entry.changes)) {
        const change = object(rawChange), value = object(change.value), externalId = id(value.leadgen_id);
        if (change.field === 'leadgen' && externalId && (!value.page_id || id(value.page_id) === entryId)) result.push({ kind: 'facebook', connection, externalId });
      }
    }
    if (root.object === 'instagram') {
      const connection = connections.find(c => c.enabled && c.instagramId === entryId);
      if (!connection) continue;
      for (const rawMessage of list(entry.messaging)) {
        const event = object(rawMessage), message = object(event.message), senderId = id(object(event.sender).id), recipient = id(object(event.recipient).id);
        const externalId = clean(message.mid, 255), text = clean(message.text, 2000);
        const occurred = typeof event.timestamp === 'number' && event.timestamp > 0 && event.timestamp <= Date.now() + 300000 ? new Date(event.timestamp).toISOString() : undefined;
        // Text intake only: no echoes, read receipts, media downloads or automatic replies.
        if (recipient === entryId && senderId && senderId !== entryId && externalId && text && message.is_echo !== true) result.push({ kind: 'instagram', connection, externalId, senderId, text, occurredAt: occurred });
      }
    }
  }
  // The route bounds the raw body and processing deadline. Do not reject a
  // whole valid batch based on event count: retries advance past committed
  // forms and retained/stale Instagram messages without dropping later items.
  return result;
}

export function socialLeadId(event: SocialEvent) {
  const hash = createHash('sha256').update([event.connection.companyId, event.kind, event.kind === 'instagram' ? event.connection.instagramId : event.connection.pageId, event.kind === 'instagram' ? event.senderId : event.externalId].join(':')).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

/** Explicit field mapping only. Unknown answers remain pending, never guessed by AI. */
export function mapFacebookLead(payload: unknown): LeadInput {
  const fields: Record<string,string> = {};
  for (const raw of list(object(payload).field_data)) {
    const field = object(raw), name = clean(field.name, 100).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\W+/g,'_');
    if (!name || Object.hasOwn(fields,name)) continue;
    fields[name] = list(field.values).map(v => clean(v, 300)).filter(Boolean).join(', ').slice(0,500);
  }
  const read = (...names: string[]) => names.map(n=>fields[n]).find(Boolean) || '';
  const purpose = read('objetivo','interesse','finalidade').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const goal = /^(comprar|compra|venda)$/.test(purpose) ? 'Comprar' : /^(alugar|aluguel|locacao)$/.test(purpose) ? 'Alugar' : 'Não informado';
  const phone = importPhone(read('phone_number','telefone','whatsapp')), email = read('email').toLowerCase();
  const type = read('tipo_de_imovel','tipo_imovel');
  const propertyType = ['Casa','Apartamento','Terreno','Comercial','Galpão','Outro'].find(t=>t.toLocaleLowerCase('pt-BR')===type.toLocaleLowerCase('pt-BR')) || 'Não informado';
  return { name: read('full_name','nome') || [read('first_name'),read('last_name')].filter(Boolean).join(' ') || 'Contato do formulário Facebook', phone: /^\d{10,15}$/.test(phone) ? phone : '', email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null, goal, propertyType, region: read('bairro','regiao','cidade') || 'Não informado', budget: 'Não informado', details: Object.entries(fields).map(([key,value])=>`${key}: ${value}`).join('\n').slice(0,1000), source:'Facebook Lead Ads', lifecycleStatus:'Novo' };
}

export async function saveSocialEvent(event: SocialEvent) {
  const companyId = event.connection.companyId, leadId = socialLeadId(event);
  let input: LeadInput;
  if (event.kind === 'facebook') {
    // A partial webhook retry must advance past already committed forms instead
    // of spending its entire deadline fetching the same first events again.
    const existing = await db<Array<{id:string}>>(`leads?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${leadId}&select=id&limit=1`);
    if (existing.length) return {created:false};
    if (!event.connection.accessToken) throw new Error('social_access_missing');
    const url = new URL(`https://graph.facebook.com/${event.connection.apiVersion}/${event.externalId}`);
    url.searchParams.set('fields','id,field_data');
    const response = await fetch(url, { headers:{ Authorization:`Bearer ${event.connection.accessToken}` }, cache:'no-store', signal:AbortSignal.timeout(10000), redirect:'error' });
    if (!response.ok) throw new Error('social_retrieval_failed');
    const payload: unknown = await response.json();
    if (id(object(payload).id) !== event.externalId) throw new Error('social_lead_mismatch');
    input = mapFacebookLead(payload);
  } else {
    input = { name:'Contato do Instagram', phone:'', email:null, goal:'Não informado', propertyType:'Não informado', region:'Não informado', budget:'Não informado', details:event.text || null, source:'Instagram Direct', lifecycleStatus:'Novo' };
  }
  const analysis = analyzeLead(input);
  // Retry-safe insert. Existing contacts are never overwritten or silently merged.
  const inserted = await db<Array<{id:string}>>('leads?on_conflict=id&select=id', { method:'POST', prefer:'resolution=ignore-duplicates,return=representation', body:{
    id:leadId, company_id:companyId, name:input.name, phone:input.phone, email:input.email, goal:input.goal, property_type:input.propertyType, region:input.region,
    budget_min:null, budget_max:null, details:input.details, summary:explainProfile(input), score:analysis.score, temperature:analysis.temperature,
    source:input.source, assigned_to:null, lifecycle_status:'Novo', interest_profile:{},
  } });
  if (event.kind === 'instagram') {
    // Bounded read-only social transcript, kept separate from the WhatsApp send path.
    // CAS preserves simultaneous catalog edits and detects retry races.
    const path = `leads?company_id=eq.${encodeURIComponent(companyId)}&id=eq.${leadId}`;
    for (let attempt=0;attempt<2;attempt++) {
      const rows = await db<Array<{interest_profile:unknown}>>(`${path}&select=interest_profile&limit=1`);
      if (!rows[0]) throw new Error('social_lead_unavailable');
      const profile = object(rows[0].interest_profile), history = list(profile.socialMessages).map(object).filter(m=>typeof m.id==='string' && typeof m.text==='string' && typeof m.at==='string' && Number.isFinite(Date.parse(m.at)));
      if (history.some(m=>m.id===event.externalId)) return { created:inserted.length>0 };
      const ordered = history.sort((a,b)=>Date.parse(String(a.at))-Date.parse(String(b.at)));
      const at = event.occurredAt || new Date().toISOString();
      // The UI promises the latest 40 messages, not the latest 40 deliveries.
      // Late retries must not evict newer retained messages from this bounded view.
      if (ordered.length>=40 && Date.parse(at)<Date.parse(String(ordered[ordered.length-40].at))) return {created:inserted.length>0};
      const condition = rows[0].interest_profile === null ? 'is.null' : `eq.${encodeURIComponent(JSON.stringify(rows[0].interest_profile ?? {}))}`;
      const updated = await db<Array<{id:string}>>(`${path}&interest_profile=${condition}&select=id`, { method:'PATCH', prefer:'return=representation', body:{interest_profile:{...profile, socialChannel:'instagram', socialSenderId:event.senderId, socialMessages:[...ordered,{id:event.externalId,text:event.text,at}].sort((a,b)=>Date.parse(String(a.at))-Date.parse(String(b.at))).slice(-40)}} });
      if (updated.length) return {created:inserted.length>0};
    }
    throw new Error('social_update_conflict');
  }
  return {created:inserted.length>0};
}
