import { neon } from '@neondatabase/serverless';
import type { LeadInput, LeadProfile } from './leads';
import { analyzeLead, explainProfile, hasCommercialQualification } from './leads';
import type { LeadLifecycleStatus } from './leads';
import type { AppointmentInput, AppointmentRecord, PerformanceSettingsInput, PerformanceSnapshot, PropertyInput, PropertyRecord, SaleInput, SaleRecord } from './operations';
import { supabaseCompanyId, supabaseRequest } from './supabase';
import { moneyValue } from './property-matching';
import { importPhone } from './lead-import';
import { currentAccount } from './tenant-context';
import { buildPerformance, performanceMonths, type BrokerAlias, type MetricRow, type PerformanceBroker } from './performance-metrics';

// Exact identifiers written by the retired demo bootstrap. Preserve the records
// for review, but never count them as real sales.
const demoSaleKeys = ['history-2026-04', 'history-2026-05', 'history-2026-06', 'history-2026-07', 'history-2026-08', 'sale-marina-aurora', 'sale-marina-horizonte', 'sale-paulo-bosque', 'sale-paulo-vila', 'sale-camila-studio'];

function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
  return neon(process.env.DATABASE_URL);
}

export async function createLead(input: LeadInput): Promise<LeadProfile> {
  const lifecycleStatus = input.lifecycleStatus || 'Novo';
  const analysis = analyzeLead({ ...input, lifecycleStatus });
  const [budgetMin, budgetMax] = parseBudget(input.budget);
  const rows = await supabaseRequest<Record<string, unknown>[]>('leads', {
    method: 'POST', prefer: 'return=representation',
    body: {
      company_id: supabaseCompanyId(), name: input.name, phone: input.phone, email: input.email,
      goal: input.goal, property_type: input.propertyType, region: input.region,
      budget_min: budgetMin, budget_max: budgetMax, details: input.details, summary: explainProfile(input),
      score: analysis.score, temperature: analysis.temperature, lifecycle_status: lifecycleStatus,
      source: input.source || 'Formulário do site', assigned_to: input.assignedTo || null,
      last_contact_at: input.lastContactAt || null,
    },
  });
  return mapLead(rows[0]);
}

export async function listLeads(limit = 10000): Promise<LeadProfile[]> {
  const rows = await supabaseRequest<Record<string, unknown>[]>(`leads?company_id=eq.${supabaseCompanyId()}&select=*&order=created_at.desc&limit=${Math.max(1, Math.min(limit, 10001))}`, { allRows: true });
  return rows.map(mapLead);
}

export async function importLeads(inputs: LeadInput[]) {
  if (inputs.length === 0) return { imported: 0, skipped: 0, leads: [] as LeadProfile[] };
  const existing = await supabaseRequest<Record<string, unknown>[]>(`leads?company_id=eq.${supabaseCompanyId()}&select=phone,email`, { allRows: true });
  const knownPhones = new Set(existing.map((row) => importPhone(String(row.phone || ''))).filter(Boolean));
  const knownEmails = new Set(existing.map((row) => String(row.email || '').toLowerCase()).filter(Boolean));
  const unique = inputs.filter((input) => {
    const phone = importPhone(input.phone);
    const email = input.email?.toLowerCase() || '';
    if ((phone && knownPhones.has(phone)) || (email && knownEmails.has(email))) return false;
    if (phone) knownPhones.add(phone);
    if (email) knownEmails.add(email);
    return true;
  });
  const records = unique.map((input) => {
    const lifecycleStatus = input.lifecycleStatus || 'Novo';
    const analysis = analyzeLead({ ...input, lifecycleStatus });
    const [budgetMin, budgetMax] = parseBudget(input.budget);
    return {
      company_id: supabaseCompanyId(), name: input.name, phone: input.phone, email: input.email, goal: input.goal,
      property_type: input.propertyType, region: input.region, budget_min: budgetMin, budget_max: budgetMax,
      details: input.details, summary: explainProfile(input), score: analysis.score,
      temperature: analysis.temperature, source: input.source || 'Importação CSV',
      assigned_to: input.assignedTo || null, lifecycle_status: lifecycleStatus,
      last_contact_at: input.lastContactAt || null,
    };
  });
  if (records.length === 0) return { imported: 0, skipped: inputs.length, leads: [] as LeadProfile[] };
  const rows = await supabaseRequest<Record<string, unknown>[]>('leads', { method: 'POST', prefer: 'return=representation', body: records });
  const leads = rows.map(mapLead);
  return { imported: leads.length, skipped: inputs.length - leads.length, leads };
}

export async function updateLeadIntelligence(id: string, input: Partial<{ lifecycleStatus: LeadLifecycleStatus; lastContactAt: string | null; recoverySelected: boolean; assignedTo: string | null }>) {
  const rows = await supabaseRequest<Record<string, unknown>[]>(`leads?id=eq.${encodeURIComponent(id)}&company_id=eq.${supabaseCompanyId()}`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { ...(input.lifecycleStatus === undefined ? {} : { lifecycle_status: input.lifecycleStatus }),
      ...(input.lastContactAt === undefined ? {} : { last_contact_at: input.lastContactAt }),
      ...(input.assignedTo === undefined ? {} : { assigned_to: input.assignedTo }) },
  });
  return rows[0] ? mapLead(rows[0]) : null;
}

export async function listProperties(forAutomation = false): Promise<PropertyRecord[]> {
  void forAutomation;
  const rows = await supabaseRequest<Record<string, unknown>[]>(`properties?company_id=eq.${supabaseCompanyId()}&select=*&order=created_at.desc`, { allRows: true });
  return rows.map(mapProperty);
}

export async function createProperty(input: PropertyInput): Promise<PropertyRecord> {
  const rows = await supabaseRequest<Record<string, unknown>[]>('properties', { method: 'POST', prefer: 'return=representation', body: propertyPayload(input) });
  return mapProperty(rows[0]);
}

export async function updateProperty(id: string, input: PropertyInput): Promise<PropertyRecord | null> {
  const rows = await supabaseRequest<Record<string, unknown>[]>(`properties?id=eq.${encodeURIComponent(id)}&company_id=eq.${supabaseCompanyId()}`, { method: 'PATCH', prefer: 'return=representation', body: propertyPayload(input) });
  return rows[0] ? mapProperty(rows[0]) : null;
}

export async function deleteProperty(id: string): Promise<boolean> {
  const rows = await supabaseRequest<Array<{ id: string }>>(`properties?id=eq.${encodeURIComponent(id)}&company_id=eq.${supabaseCompanyId()}&select=id`, { method: 'DELETE', prefer: 'return=representation' });
  return rows.length > 0;
}

function mapProperty(row: Record<string, unknown>): PropertyRecord {
  const images = Array.isArray(row.images) ? row.images.filter((image): image is string => typeof image === 'string') : [];
  return {
    id: String(row.id), code: row.code ? String(row.code) : undefined, title: String(row.title),
    description: row.description ? String(row.description) : undefined, district: String(row.district),
    city: row.city ? String(row.city) : undefined, address: row.address ? String(row.address) : undefined, price: formatMoney(Number(row.price), row.purpose === 'Aluguel'),
    propertyType: row.property_type ? String(row.property_type) : undefined,
    bedrooms: row.bedrooms == null ? undefined : Number(row.bedrooms), parkingSpaces: row.parking_spaces == null ? undefined : Number(row.parking_spaces),
    area: row.area == null ? undefined : Number(row.area), publicUrl: row.public_url ? String(row.public_url) : undefined,
    keyInOffice: row.key_in_office === true, occupied: row.occupied === true,
    catalogedOnInstagram: row.cataloged_on_instagram === true, catalogedOnSite: row.cataloged_on_site === true,
    meta: propertyMeta(row), tone: 'orchid',
    status: row.status === 'Reservado' ? 'Reservado' : row.status === 'Vendido' ? 'Vendido' : row.status === 'Alugado' ? 'Alugado' : 'Disponível',
    purpose: row.purpose === 'Aluguel' ? 'Aluguel' : 'Venda', images, createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export async function listAppointments(): Promise<AppointmentRecord[]> {
  const rows = await supabaseRequest<Record<string, unknown>[]>(`appointments?company_id=eq.${supabaseCompanyId()}&select=*&order=scheduled_at.asc`, { allRows: true });
  const leads = await listLeads();
  const properties = await listProperties();
  const leadNames = new Map(leads.map((lead) => [lead.id, lead.name]));
  const propertyNames = new Map(properties.map((property) => [property.id, property.title]));
  return rows.map((row) => mapAppointment(row, leadNames, propertyNames));
}

export async function createAppointment(input: AppointmentInput): Promise<AppointmentRecord> {
  const [leads, properties] = await Promise.all([listLeads(), listProperties()]);
  const lead = leads.find((item) => input.leadId ? item.id === input.leadId : item.name.toLowerCase() === input.name.toLowerCase());
  const property = properties.find((item) => input.propertyId ? item.id === input.propertyId : item.title.toLowerCase() === input.property.toLowerCase());
  if (!lead) throw new Error('Selecione um lead cadastrado para agendar a visita.');
  if (input.propertyId && (!property || property.status === 'Vendido' || property.status === 'Alugado')) throw new Error('Selecione um imóvel disponível para agendar a visita.');
  const rows = await supabaseRequest<Record<string, unknown>[]>('appointments', {
    method: 'POST', prefer: 'return=representation',
    body: { company_id: supabaseCompanyId(), lead_id: lead.id, property_id: property?.id || null,
      scheduled_at: `${input.date}T${input.time}:00-03:00`, assigned_to: input.broker, status: input.status, notes: `${lead.name} · ${property?.title || input.property}` },
  });
  return mapAppointment(rows[0], new Map([[lead.id, lead.name]]), new Map(property ? [[property.id, property.title]] : []));
}

export async function updateAppointmentStatus(id: string, status: AppointmentRecord['status']): Promise<AppointmentRecord | null> {
  const rows = await supabaseRequest<Record<string, unknown>[]>(`appointments?id=eq.${encodeURIComponent(id)}&company_id=eq.${supabaseCompanyId()}`, { method: 'PATCH', prefer: 'return=representation', body: { status } });
  return rows[0] ? mapAppointment(rows[0]) : null;
}

export async function deleteAppointment(id: string): Promise<boolean> {
  const rows = await supabaseRequest<Array<{ id: string }>>(`appointments?id=eq.${encodeURIComponent(id)}&company_id=eq.${supabaseCompanyId()}&select=id`, { method: 'DELETE', prefer: 'return=representation' });
  return rows.length > 0;
}

function mapAppointment(row: Record<string, unknown>, leadNames = new Map<string, string>(), propertyNames = new Map<string, string>()): AppointmentRecord {
  const scheduledAt = new Date(String(row.scheduled_at));
  const notes = String(row.notes || '');
  const [fallbackName, fallbackProperty] = notes.split(' · ');
  return {
    id: String(row.id), date: scheduledAt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), time: scheduledAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
    name: leadNames.get(String(row.lead_id)) || fallbackName || 'Cliente', property: propertyNames.get(String(row.property_id)) || fallbackProperty || 'Imóvel',
    broker: String(row.assigned_to || 'Marina Oliveira'), status: row.status === 'Confirmada' ? 'Confirmada' : 'Aguardando', color: row.status === 'Confirmada' ? 'mint' : 'amber',
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function parseBudget(value: string): [number | null, number | null] {
  const normalized = value.toLowerCase().replace(/r\$/g, '').replace(/\./g, '').replace(',', '.');
  const values = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(milh(?:ão|oes|ões)?|mi|mil|k)?/g)].map((match) => {
    const number = Number(match[1]);
    const unit = match[2] || '';
    return number * (unit.startsWith('milh') || unit === 'mi' ? 1_000_000 : unit === 'mil' || unit === 'k' ? 1_000 : 1);
  }).filter((number) => Number.isFinite(number) && number > 0);
  if (!values.length) return [null, null];
  if (/a partir|mínim|minim/.test(normalized)) return [values[0], values[1] || null];
  if (/até|ate|máxim|maxim/.test(normalized)) return [null, values.at(-1) || null];
  return values.length > 1 ? [Math.min(...values), Math.max(...values)] : [null, values[0]];
}

function formatMoney(value: number, monthly = false) {
  if (!Number.isFinite(value)) return 'Preço sob consulta';
  const formatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return monthly ? `${formatted}/mês` : formatted;
}

function formatBudget(row: Record<string, unknown>) {
  const minimum = row.budget_min == null ? null : Number(row.budget_min);
  const maximum = row.budget_max == null ? null : Number(row.budget_max);
  if (minimum && maximum) return `${formatMoney(minimum)} a ${formatMoney(maximum)}`;
  if (maximum) return `Até ${formatMoney(maximum)}`;
  if (minimum) return `A partir de ${formatMoney(minimum)}`;
  return 'Não informado';
}

function leadField(row: Record<string, unknown>, field: string) {
  const value = row[field];
  if (value == null) return 'Não informado';
  const text = String(value).trim();
  return text && !['null', 'undefined'].includes(text.toLowerCase()) ? text : 'Não informado';
}

function propertyPayload(input: PropertyInput) {
  return {
    company_id: supabaseCompanyId(), code: input.code || null, title: input.title, description: input.description || null,
    purpose: input.purpose, price: parseMoney(input.price), district: input.district, city: input.city || null,
    address: input.address || null, property_type: input.propertyType || null, bedrooms: input.bedrooms ?? null,
    parking_spaces: input.parkingSpaces ?? null, area: input.area ?? null, images: input.images,
    status: input.status || 'Disponível', public_url: input.publicUrl || null,
    key_in_office: Boolean(input.keyInOffice), occupied: Boolean(input.occupied),
    cataloged_on_instagram: Boolean(input.catalogedOnInstagram), cataloged_on_site: Boolean(input.catalogedOnSite),
  };
}

function parseMoney(value: string) {
  const amount = moneyValue(value);
  if (amount === null) throw new Error('Informe um preço válido, por exemplo R$ 500.000,00.');
  return amount;
}

function propertyMeta(row: Record<string, unknown>) {
  const items: string[] = [];
  if (row.bedrooms != null) items.push(`${row.bedrooms} ${Number(row.bedrooms) === 1 ? 'quarto' : 'quartos'}`);
  if (row.parking_spaces != null) items.push(`${row.parking_spaces} ${Number(row.parking_spaces) === 1 ? 'vaga' : 'vagas'}`);
  if (row.area != null) items.push(`${Number(row.area)} m²`);
  return items.join(' • ') || String(row.property_type || 'Imóvel');
}


export async function getPerformance(month: string): Promise<PerformanceSnapshot> {
  const sql = database();
  const companyId = supabaseCompanyId();
  const actorId = currentAccount()?.brokerId;
  if (!actorId) throw new Error('Contexto da conta ausente.');
  const months = performanceMonths(month);
  const start = `${months[0]}-01`;
  const end = new Date(`${month}-01T12:00:00Z`); end.setUTCMonth(end.getUTCMonth()+1);
  const until = end.toISOString().slice(0,10);
  const filter = `company_id=eq.${encodeURIComponent(companyId)}`;
  const [settings, goals, brokers, aliases, legacySales, crmSales, cancelled, crm] = await Promise.all([
    sql`SELECT company_goal FROM site_performance_months WHERE company_id=${companyId} AND month=${month}`,
    sql`SELECT broker, goal FROM site_broker_goals WHERE company_id=${companyId} AND month=${month}`,
    supabaseRequest<PerformanceBroker[]>(`broker_accounts?${filter}&select=id,name,active&order=created_at.asc`, { allRows:true }),
    supabaseRequest<BrokerAlias[]>(`broker_name_history?${filter}&select=id,broker_id,name`, { allRows:true }),
    sql`SELECT id,sale_date,broker,property,client,amount,deal_type,created_at FROM site_sales WHERE company_id=${companyId} AND sale_date>=${start}::date AND sale_date<${until}::date AND NOT (COALESCE(reference_key,'') = ANY(${demoSaleKeys}::text[]))`,
    supabaseRequest<Record<string,unknown>[]>(`property_deals?${filter}&cancelled_at=is.null&sale_date=gte.${start}&sale_date=lt.${until}&select=*&order=sale_date.asc`, { allRows:true }),
    supabaseRequest<Array<{ legacy_sale_id:string }>>(`cancelled_legacy_sales?${filter}&select=id,legacy_sale_id`, { allRows:true }),
    supabaseRequest<{ metrics:MetricRow[]; trackingStartedAt:string }>('rpc/performance_crm_month', { method:'POST', body:{ p_company_id:companyId,p_actor_id:actorId,p_month:month } }),
  ]);
  const cancelledIds = new Set(cancelled.map(s => s.legacy_sale_id));
  return buildPerformance({ month, companyGoal:Number(settings[0]?.company_goal || 0), brokers, aliases,
    goals:goals.map(row => ({ broker:String(row.broker),goal:Number(row.goal) })),
    sales:[...legacySales.filter(row => !cancelledIds.has(String(row.id))).map(row => ({ ...mapSale(row),id:`legacy:${row.id}`,source:'legacy' as const })),...crmSales.map(row => ({ ...mapSale(row),source:'crm' as const }))],
    metrics:crm.metrics,trackingStartedAt:crm.trackingStartedAt });
}

export async function createSale(input: SaleInput): Promise<SaleRecord> {
  const row = await supabaseRequest<Record<string,unknown>>('rpc/record_property_deal', { method:'POST', body:{
    p_company_id:supabaseCompanyId(), p_actor_id:currentAccount()?.brokerId, p_property_id:input.propertyId,
    p_broker_id:input.brokerId, p_lead_id:input.leadId || null, p_date:input.date, p_amount:input.amount,
    p_deal_type:input.dealType || 'Venda', p_client:input.client,
  } });
  return { ...mapSale(row),source:'crm' };
}

export async function deleteSale(id: string): Promise<{ ok:boolean; propertyRestored:boolean; warning?:string } | null> {
  const companyId = supabaseCompanyId();
  const actor = currentAccount();
  if (!actor || actor.role !== 'owner') throw new Error('deal_forbidden');
  if (!id.startsWith('legacy:')) {
    return supabaseRequest('rpc/cancel_property_deal', { method:'POST', body:{ p_company_id:companyId,p_actor_id:actor.brokerId,p_deal_id:id } });
  }
  const legacyId = id.slice(7);
  const [row] = await database()`SELECT id,sale_date,broker,property,client,amount,deal_type,created_at FROM site_sales WHERE id=${legacyId} AND company_id=${companyId}`;
  if (!row) return null;
  // Legacy rows have no property identity: keep the source and never guess
  // which same-named property should be reopened.
  await supabaseRequest('cancelled_legacy_sales?on_conflict=company_id,legacy_sale_id', { method:'POST',prefer:'resolution=ignore-duplicates',body:{
    company_id:companyId,legacy_sale_id:legacyId,sale_snapshot:row,cancelled_by:actor.brokerId,
  } });
  return { ok:true,propertyRestored:false,warning:'Registro antigo cancelado e preservado no histórico. Como não possui vínculo seguro com o imóvel, revise a situação no catálogo.' };
}

export async function updatePerformanceSettings(input: PerformanceSettingsInput) {
  const sql = database();
  const companyId = supabaseCompanyId();
  const brokers = await supabaseRequest<PerformanceBroker[]>(`broker_accounts?company_id=eq.${encodeURIComponent(companyId)}&select=id,name,active`);
  if (input.brokerGoals.some(item => !brokers.some(b => b.id === item.brokerId))) throw new Error('Corretor não encontrado nesta empresa.');
  const queries = [
    sql`INSERT INTO site_performance_months (company_id,month,company_goal) VALUES (${companyId},${input.month},${input.companyGoal})
      ON CONFLICT(company_id,month) DO UPDATE SET company_goal=EXCLUDED.company_goal,updated_at=NOW()`,
    ...input.brokerGoals.map(item => sql`INSERT INTO site_broker_goals(company_id,month,broker,goal) VALUES(${companyId},${input.month},${`id:${item.brokerId}`},${item.goal})
      ON CONFLICT(company_id,month,broker) DO UPDATE SET goal=EXCLUDED.goal`),
  ];
  await sql.transaction(queries);
  return getPerformance(input.month);
}

function mapSale(row: Record<string, unknown>): SaleRecord {
  const date = row.sale_date instanceof Date ? row.sale_date.toISOString().slice(0, 10) : String(row.sale_date).slice(0, 10);
  return {
    dealType: row.deal_type === 'Aluguel' ? 'Aluguel' : 'Venda',
    id: String(row.id), date, broker: String(row.broker), property: String(row.property), client: String(row.client),
    brokerId:row.broker_id ? String(row.broker_id) : undefined,propertyId:row.property_id ? String(row.property_id) : undefined,leadId:row.lead_id ? String(row.lead_id) : undefined,
    amount: Number(row.amount), createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapLead(row: Record<string, unknown>): LeadProfile {
  const lifecycleStatus = ['Novo', 'Em atendimento', 'Visita', 'Proposta', 'Convertido', 'Perdido'].includes(String(row.lifecycle_status))
    ? String(row.lifecycle_status) as LeadLifecycleStatus
    : 'Novo';
  const lastContactAt = row.last_contact_at ? new Date(String(row.last_contact_at)).toISOString() : null;
  const source = String(row.source || 'Formulário do site');
  const qualificationInput = {
    name: String(row.name), phone: String(row.phone), email: row.email ? String(row.email) : null,
    goal: leadField(row, 'goal'), propertyType: leadField(row, 'property_type'), region: leadField(row, 'region'),
    budget: formatBudget(row), details: row.details ? String(row.details) : null,
    lifecycleStatus, lastContactAt,
  };
  const analysis = analyzeLead(qualificationInput);
  const scoreDefined = !source.trim().toLowerCase().includes('whatsapp') || hasCommercialQualification(qualificationInput);
  return {
    id: String(row.id), name: String(row.name), phone: String(row.phone),
    email: row.email ? String(row.email) : null, goal: qualificationInput.goal,
    propertyType: qualificationInput.propertyType, region: qualificationInput.region, budget: formatBudget(row),
    details: row.details ? String(row.details) : null, summary: String(row.summary || ''),
    score: analysis.score, scoreDefined, temperature: scoreDefined ? analysis.temperature : 'Indefinido', source,
    assignedTo: row.assigned_to ? String(row.assigned_to) : null, lifecycleStatus, lastContactAt,
    inactivityDays: analysis.inactivityDays, recoveryPotential: analysis.recoveryPotential,
    scoreReasons: scoreDefined ? analysis.scoreReasons : ['Aguardando objetivo, tipo de imóvel, região e faixa de investimento'], recoverySelected: false,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
