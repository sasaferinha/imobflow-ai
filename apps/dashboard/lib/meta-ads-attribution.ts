import { supabaseServiceRequest as db } from './supabase';
import { AdsError, validateAdsDates } from './meta-ads';
export type AdAttribution = { source: string; medium: string; campaign: string; content: string; term: string; campaignId: string | null; adId: string | null };
const fields = { utm_source: 100, utm_medium: 100, utm_campaign: 150, utm_content: 150, utm_term: 150 } as const;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
/** The browser sends only these five UTM strings. Values are observations, not proof of a Meta conversion. */
export function parseAdAttribution(input: unknown): AdAttribution | null {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdsError('Origem do contato inválida.',400);
  const raw=input as Record<string,unknown>;if(Object.keys(raw).some(k=>!Object.hasOwn(fields,k)))throw new AdsError('Origem do contato inválida.',400);
  const clean:Record<string,string>={};for(const [key,limit] of Object.entries(fields)){const value=raw[key];if(value!==undefined&&(typeof value!=='string'||value.length>limit||/[\u0000-\u001f\u007f]/u.test(value)))throw new AdsError('Origem do contato inválida.',400);clean[key]=typeof value==='string'?value.trim():'';}
  if(!Object.values(clean).some(Boolean))return null;
  return {source:clean.utm_source,medium:clean.utm_medium,campaign:clean.utm_campaign,content:clean.utm_content,term:clean.utm_term,campaignId:/^\d{3,40}$/.test(clean.utm_campaign)?clean.utm_campaign:null,adId:/^\d{3,40}$/.test(clean.utm_content)?clean.utm_content:null};
}
export async function recordLeadAdAttribution(companyId:string,leadId:string,input:unknown){
 if(!uuid.test(companyId)||!uuid.test(leadId))throw new AdsError('Contato inválido.',400);
 const value=parseAdAttribution(input);if(!value)return;
 await db('lead_ad_attributions?on_conflict=company_id,lead_id',{method:'POST',prefer:'resolution=ignore-duplicates',body:{company_id:companyId,lead_id:leadId,source:value.source,medium:value.medium,campaign:value.campaign,content:value.content,term:value.term,campaign_id:value.campaignId,ad_id:value.adId}});
}
type Inputs={attributions:Array<AdAttribution&{leadId:string;capturedAt:string}>;sales:Array<{id:string;leadId:string;closedAt:string;amount:unknown}>;totalLeads:number};
export type AdAttributionReport={since:string;until:string;totalLeads:number;trackedLeads:number;untrackedLeads:number;unattributedSales:number;rows:Array<{source:string;medium:string;campaign:string;campaignId:string|null;leads:number;sales:number;salesAmount:number;missingSaleAmount:number}>};
export function buildAdAttributionReport(input:Inputs,since:string,until:string):AdAttributionReport{
 const start=Date.parse(`${since}T00:00:00-03:00`),end=Date.parse(`${until}T00:00:00-03:00`)+86400000;
 if(!Array.isArray(input.attributions)||!Array.isArray(input.sales)||input.attributions.length>10000||input.sales.length>10000)throw new AdsError('O relatório excedeu o limite de leitura. Peça ao suporte para ampliar a consulta.',503);
 const groups=new Map<string,AdAttributionReport['rows'][number]>(),byLead=new Map<string,Inputs['attributions'][number]>();let trackedLeads=0,unattributedSales=0;
 const group=(a:AdAttribution)=>{const key=JSON.stringify([a.source,a.medium,a.campaign]);let row=groups.get(key);if(!row){row={source:a.source,medium:a.medium,campaign:a.campaign,campaignId:a.campaignId,leads:0,sales:0,salesAmount:0,missingSaleAmount:0};groups.set(key,row);}return row;};
 for(const a of input.attributions){if(byLead.has(a.leadId))continue;byLead.set(a.leadId,a);const at=Date.parse(a.capturedAt);if(at>=start&&at<end){group(a).leads++;trackedLeads++;}}
 const seen=new Set<string>();for(const sale of input.sales){const at=Date.parse(sale.closedAt);if(seen.has(sale.id)||!Number.isFinite(at)||at<start||at>=end)continue;seen.add(sale.id);const leadId=sale.leadId?.replace(/^lead:/,''),a=byLead.get(leadId);if(!a){unattributedSales++;continue;}const row=group(a);row.sales++;if(typeof sale.amount==='number'&&Number.isFinite(sale.amount)&&sale.amount>0)row.salesAmount+=sale.amount;else row.missingSaleAmount++;}
 return {since,until,totalLeads:input.totalLeads,trackedLeads,untrackedLeads:Math.max(0,input.totalLeads-trackedLeads),unattributedSales,rows:[...groups.values()].sort((a,b)=>b.leads-a.leads||b.sales-a.sales)};
}
export async function adsAttributionReport(companyId:string,actorId:string,since:string,until:string){
 validateAdsDates(since,until);const input=await db<Inputs>('rpc/meta_ads_attribution_inputs',{method:'POST',body:{p_company_id:companyId,p_actor_id:actorId,p_since:new Date(`${since}T00:00:00-03:00`).toISOString(),p_until:new Date(Date.parse(`${until}T00:00:00-03:00`)+86400000).toISOString()}});return buildAdAttributionReport(input,since,until);
}
