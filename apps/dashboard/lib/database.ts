import { neon } from '@neondatabase/serverless';
import type { LeadInput, LeadProfile } from './leads';
import { analyzeLead, explainProfile, hasCommercialQualification } from './leads';
import type { LeadLifecycleStatus } from './leads';
import type { AppointmentInput, AppointmentRecord, PerformanceSettingsInput, PerformanceSnapshot, PropertyInput, PropertyRecord, SaleInput, SaleRecord } from './operations';
import { supabaseCompanyId, supabaseRequest } from './supabase';
import { moneyValue } from './property-matching';

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
  const knownPhones = new Set(existing.map((row) => normalizePhone(String(row.phone || ''))).filter(Boolean));
  const knownEmails = new Set(existing.map((row) => String(row.email || '').toLowerCase()).filter(Boolean));
  const unique = inputs.filter((input, index, all) => {
    const phone = normalizePhone(input.phone);
    const email = input.email?.toLowerCase() || '';
    if ((phone && knownPhones.has(phone)) || (email && knownEmails.has(email))) return false;
    return all.findIndex((candidate) => (phone && normalizePhone(candidate.phone) === phone) || (email && candidate.email?.toLowerCase() === email)) === index;
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
  const lead = leads.find((item) => item.name.toLowerCase() === input.name.toLowerCase());
  const property = properties.find((item) => item.title.toLowerCase() === input.property.toLowerCase());
  if (!lead) throw new Error('Selecione um lead cadastrado para agendar a visita.');
  const rows = await supabaseRequest<Record<string, unknown>[]>('appointments', {
    method: 'POST', prefer: 'return=representation',
    body: { company_id: supabaseCompanyId(), lead_id: lead.id, property_id: property?.id || null,
      scheduled_at: `${input.date}T${input.time}:00-03:00`, assigned_to: input.broker, status: input.status, notes: `${input.name} · ${input.property}` },
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

function normalizePhone(value: string) { return value.replace(/\D/g, ''); }

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
  await sql`INSERT INTO site_performance_months (company_id, month, company_goal, leads_received, converted_leads, recovered_leads)
    VALUES (${companyId}, ${month}, 0, 0, 0, 0) ON CONFLICT (company_id, month) DO NOTHING`;
  const settingsRows = await sql`SELECT company_goal, leads_received, converted_leads, recovered_leads FROM site_performance_months WHERE company_id=${companyId} AND month=${month}`;
  const goalRows = await sql`SELECT broker, goal, leads_received, converted_leads, recovered_leads, visits FROM site_broker_goals WHERE company_id=${companyId} AND month=${month} ORDER BY broker`;
  const saleRows = await sql`SELECT id, sale_date, broker, property, client, amount, deal_type, created_at FROM site_sales
    WHERE company_id=${companyId} AND TO_CHAR(sale_date, 'YYYY-MM')=${month}
      AND NOT (COALESCE(reference_key, '') = ANY(${demoSaleKeys}::text[])) ORDER BY sale_date DESC, created_at DESC`;
  const historyRows = await sql`WITH recent_months AS (
      SELECT DISTINCT TO_CHAR(sale_date, 'YYYY-MM') AS month FROM site_sales
      WHERE company_id=${companyId} AND deal_type='Venda' AND NOT (COALESCE(reference_key, '') = ANY(${demoSaleKeys}::text[]))
        AND sale_date < ((${month} || '-01')::date + INTERVAL '1 month') ORDER BY month DESC LIMIT 6
    )
    SELECT TO_CHAR(sale_date, 'YYYY-MM') AS month, broker, SUM(amount) AS sold FROM site_sales
    WHERE company_id=${companyId} AND deal_type='Venda' AND NOT (COALESCE(reference_key, '') = ANY(${demoSaleKeys}::text[]))
      AND TO_CHAR(sale_date, 'YYYY-MM') IN (SELECT month FROM recent_months)
    GROUP BY TO_CHAR(sale_date, 'YYYY-MM'), broker ORDER BY month`;
  const sales = saleRows.map(mapSale);
  const completedSales = sales.filter((sale) => sale.dealType !== 'Aluguel');
  const totalSold = completedSales.reduce((total, sale) => total + sale.amount, 0);
  const settings = settingsRows[0];
  const leadsReceived = Number(settings.leads_received);
  const convertedLeads = Number(settings.converted_leads);
  return {
    dataMode: 'live', month, companyGoal: Number(settings.company_goal), totalSold, salesCount: completedSales.length,
    averageTicket: completedSales.length ? totalSold / completedSales.length : 0, leadsReceived, convertedLeads,
    recoveredLeads: Number(settings.recovered_leads), conversionRate: leadsReceived ? (convertedLeads / leadsReceived) * 100 : 0,
    brokers: goalRows.map((goal) => {
      const brokerSales = completedSales.filter((sale) => sale.broker === String(goal.broker));
      const sold = brokerSales.reduce((total, sale) => total + sale.amount, 0);
      const target = Number(goal.goal);
      const brokerLeads = Number(goal.leads_received);
      const brokerConverted = Number(goal.converted_leads);
      return {
        broker: String(goal.broker), goal: target, sold, salesCount: brokerSales.length, progress: target ? (sold / target) * 100 : 0,
        leadsReceived: brokerLeads, convertedLeads: brokerConverted, recoveredLeads: Number(goal.recovered_leads), visits: Number(goal.visits),
        conversionRate: brokerLeads ? (brokerConverted / brokerLeads) * 100 : 0,
        history: historyRows.filter((row) => String(row.broker) === String(goal.broker)).map((row) => ({ month: String(row.month), sold: Number(row.sold) })),
      };
    }).sort((a, b) => b.sold - a.sold),
    history: Array.from(new Set(historyRows.map((row) => String(row.month)))).map((historyMonth) => ({
      month: historyMonth,
      sold: historyRows.filter((row) => String(row.month) === historyMonth).reduce((total, row) => total + Number(row.sold), 0),
    })), sales,
  };
}

export async function createSale(input: SaleInput): Promise<SaleRecord> {
  const rows = await database()`INSERT INTO site_sales (company_id, sale_date, broker, property, client, amount, deal_type)
    VALUES (${supabaseCompanyId()}, ${input.date}, ${input.broker}, ${input.property}, ${input.client}, ${input.amount}, ${input.dealType || 'Venda'})
    RETURNING id, sale_date, broker, property, client, amount, deal_type, created_at`;
  return mapSale(rows[0]);
}

export async function deleteSale(id: string): Promise<boolean> {
  const rows = await database()`DELETE FROM site_sales WHERE id=${id} AND company_id=${supabaseCompanyId()} RETURNING id`;
  return rows.length > 0;
}

export async function updatePerformanceSettings(input: PerformanceSettingsInput) {
  const sql = database();
  const companyId = supabaseCompanyId();
  await sql`INSERT INTO site_performance_months (company_id, month, company_goal, leads_received, converted_leads, recovered_leads)
    VALUES (${companyId}, ${input.month}, ${input.companyGoal}, ${input.leadsReceived}, ${input.convertedLeads}, ${input.recoveredLeads})
    ON CONFLICT (company_id, month) DO UPDATE SET company_goal=EXCLUDED.company_goal, leads_received=EXCLUDED.leads_received,
      converted_leads=EXCLUDED.converted_leads, recovered_leads=EXCLUDED.recovered_leads, updated_at=NOW()`;
  for (const item of input.brokerGoals) {
    await sql`INSERT INTO site_broker_goals (company_id, month, broker, goal) VALUES (${companyId}, ${input.month}, ${item.broker}, ${item.goal})
      ON CONFLICT (company_id, month, broker) DO UPDATE SET goal=EXCLUDED.goal`;
  }
  return getPerformance(input.month);
}

function mapSale(row: Record<string, unknown>): SaleRecord {
  const date = row.sale_date instanceof Date ? row.sale_date.toISOString().slice(0, 10) : String(row.sale_date).slice(0, 10);
  return {
    dealType: row.deal_type === 'Aluguel' ? 'Aluguel' : 'Venda',
    id: String(row.id), date, broker: String(row.broker), property: String(row.property), client: String(row.client),
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
    goal: String(row.goal), propertyType: String(row.property_type), region: String(row.region),
    budget: formatBudget(row), details: row.details ? String(row.details) : null,
    lifecycleStatus, lastContactAt,
  };
  const analysis = analyzeLead(qualificationInput);
  const scoreDefined = !source.trim().toLowerCase().includes('whatsapp') || hasCommercialQualification(qualificationInput);
  return {
    id: String(row.id), name: String(row.name), phone: String(row.phone),
    email: row.email ? String(row.email) : null, goal: String(row.goal),
    propertyType: String(row.property_type), region: String(row.region), budget: formatBudget(row),
    details: row.details ? String(row.details) : null, summary: String(row.summary || ''),
    score: analysis.score, scoreDefined, temperature: scoreDefined ? analysis.temperature : 'Indefinido', source,
    assignedTo: row.assigned_to ? String(row.assigned_to) : null, lifecycleStatus, lastContactAt,
    inactivityDays: analysis.inactivityDays, recoveryPotential: analysis.recoveryPotential,
    scoreReasons: scoreDefined ? analysis.scoreReasons : ['Aguardando objetivo, tipo de imóvel, região e faixa de investimento'], recoverySelected: false,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
