import { neon } from '@neondatabase/serverless';
import type { LeadInput, LeadProfile } from './leads';
import { explainProfile, scoreLead } from './leads';
import type { AppointmentInput, AppointmentRecord, PerformanceSettingsInput, PerformanceSnapshot, PropertyInput, PropertyRecord, SaleInput, SaleRecord } from './operations';

function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
  return neon(process.env.DATABASE_URL);
}

async function ensureLeadSchema() {
  const sql = database();
  await sql`CREATE TABLE IF NOT EXISTS site_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    goal TEXT NOT NULL,
    property_type TEXT NOT NULL,
    region TEXT NOT NULL,
    budget TEXT NOT NULL,
    details TEXT,
    summary TEXT NOT NULL,
    score INTEGER NOT NULL,
    temperature TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

export async function createLead(input: LeadInput): Promise<LeadProfile> {
  await ensureLeadSchema();
  const sql = database();
  const summary = explainProfile(input);
  const { score, temperature } = scoreLead(input);
  const rows = await sql`INSERT INTO site_leads
    (name, phone, email, goal, property_type, region, budget, details, summary, score, temperature)
    VALUES (${input.name}, ${input.phone}, ${input.email}, ${input.goal}, ${input.propertyType}, ${input.region}, ${input.budget}, ${input.details}, ${summary}, ${score}, ${temperature})
    RETURNING id, name, phone, email, goal, property_type, region, budget, details, summary, score, temperature, created_at`;
  return mapLead(rows[0]);
}

export async function listLeads(): Promise<LeadProfile[]> {
  await ensureLeadSchema();
  const sql = database();
  const rows = await sql`SELECT id, name, phone, email, goal, property_type, region, budget, details, summary, score, temperature, created_at FROM site_leads ORDER BY created_at DESC LIMIT 100`;
  return rows.map(mapLead);
}

async function ensurePropertySchema() {
  const sql = database();
  await sql`CREATE TABLE IF NOT EXISTS site_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_key TEXT UNIQUE,
    title TEXT NOT NULL,
    district TEXT NOT NULL,
    price TEXT NOT NULL,
    meta TEXT NOT NULL,
    match INTEGER NOT NULL DEFAULT 80,
    tone TEXT NOT NULL DEFAULT 'orchid',
    purpose TEXT NOT NULL,
    images JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE site_properties ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`INSERT INTO site_properties (reference_key, title, district, price, meta, match, tone, purpose) VALUES
    ('aurora', 'Residencial Aurora', 'Centro', 'R$ 575.000', '3 quartos • 2 vagas • 98 m²', 96, 'orchid', 'Venda'),
    ('horizonte', 'Edifício Horizonte', 'Jardim Floresta', 'R$ 590.000', '3 quartos • 1 vaga • 91 m²', 92, 'sky', 'Venda'),
    ('bosque-sereno', 'Casa Bosque Sereno', 'Alto da Serra', 'R$ 820.000', '4 quartos • 3 vagas • 184 m²', 88, 'sage', 'Venda'),
    ('studio-vila-nova', 'Studio Vila Nova', 'Vila Nova', 'R$ 2.950/mês', '1 quarto • mobiliado • 42 m²', 83, 'sand', 'Aluguel'),
    ('oliveiras', 'Parque das Oliveiras', 'Pinheiros', 'R$ 745.000', '2 quartos • varanda • 76 m²', 81, 'rose', 'Venda'),
    ('ipe-amarelo', 'Casa Ipê Amarelo', 'Jardim Campestre', 'R$ 2.400/mês', '2 quartos • quintal • 80 m²', 77, 'slate', 'Aluguel')
    ON CONFLICT (reference_key) DO NOTHING`;
}

export async function listProperties(): Promise<PropertyRecord[]> {
  await ensurePropertySchema();
  const rows = await database()`SELECT id, title, district, price, meta, match, tone, purpose, images, created_at FROM site_properties ORDER BY created_at DESC`;
  return rows.map(mapProperty);
}

export async function createProperty(input: PropertyInput): Promise<PropertyRecord> {
  await ensurePropertySchema();
  const rows = await database()`INSERT INTO site_properties (title, district, price, meta, match, tone, purpose, images)
    VALUES (${input.title}, ${input.district}, ${input.price}, ${input.meta}, ${input.match}, ${input.tone}, ${input.purpose}, ${JSON.stringify(input.images)}::jsonb)
    RETURNING id, title, district, price, meta, match, tone, purpose, images, created_at`;
  return mapProperty(rows[0]);
}

export async function updateProperty(id: string, input: PropertyInput): Promise<PropertyRecord | null> {
  await ensurePropertySchema();
  const rows = await database()`UPDATE site_properties SET title=${input.title}, district=${input.district}, price=${input.price}, meta=${input.meta}, match=${input.match}, tone=${input.tone}, purpose=${input.purpose}, images=${JSON.stringify(input.images)}::jsonb
    WHERE id=${id} RETURNING id, title, district, price, meta, match, tone, purpose, images, created_at`;
  return rows[0] ? mapProperty(rows[0]) : null;
}

export async function deleteProperty(id: string): Promise<boolean> {
  await ensurePropertySchema();
  const rows = await database()`DELETE FROM site_properties WHERE id=${id} RETURNING id`;
  return rows.length > 0;
}

function mapProperty(row: Record<string, unknown>): PropertyRecord {
  const images = Array.isArray(row.images) ? row.images.filter((image): image is string => typeof image === 'string') : [];
  return {
    id: String(row.id), title: String(row.title), district: String(row.district), price: String(row.price),
    meta: String(row.meta), match: Number(row.match), tone: String(row.tone),
    purpose: row.purpose === 'Aluguel' ? 'Aluguel' : 'Venda', images, createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

async function ensureAppointmentSchema() {
  const sql = database();
  await sql`CREATE TABLE IF NOT EXISTS site_appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_key TEXT UNIQUE,
    appointment_date DATE NOT NULL,
    appointment_time TEXT NOT NULL,
    name TEXT NOT NULL,
    property TEXT NOT NULL,
    broker TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Aguardando',
    color TEXT NOT NULL DEFAULT 'amber',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`INSERT INTO site_appointments (reference_key, appointment_date, appointment_time, name, property, broker, status, color) VALUES
    ('ana-horizonte', '2026-09-01', '09:00', 'Ana Martins', 'Edifício Horizonte', 'Marina Oliveira', 'Confirmada', 'mint'),
    ('lucas-aurora', '2026-09-01', '10:30', 'Lucas Carvalho', 'Residencial Aurora', 'Paulo Mendes', 'Aguardando', 'amber'),
    ('carla-reserva', '2026-09-01', '14:00', 'Carla Souza', 'Terreno Reserva Sul', 'Marina Oliveira', 'Confirmada', 'violet'),
    ('rafael-bosque', '2026-09-01', '16:30', 'Rafael Borges', 'Casa Bosque Sereno', 'Paulo Mendes', 'Confirmada', 'blue')
    ON CONFLICT (reference_key) DO NOTHING`;
}

export async function listAppointments(): Promise<AppointmentRecord[]> {
  await ensureAppointmentSchema();
  const rows = await database()`SELECT id, appointment_date, appointment_time, name, property, broker, status, color, created_at FROM site_appointments ORDER BY appointment_date, appointment_time`;
  return rows.map(mapAppointment);
}

export async function createAppointment(input: AppointmentInput): Promise<AppointmentRecord> {
  await ensureAppointmentSchema();
  const rows = await database()`INSERT INTO site_appointments (appointment_date, appointment_time, name, property, broker, status, color)
    VALUES (${input.date}, ${input.time}, ${input.name}, ${input.property}, ${input.broker}, ${input.status}, ${input.color})
    RETURNING id, appointment_date, appointment_time, name, property, broker, status, color, created_at`;
  return mapAppointment(rows[0]);
}

export async function updateAppointmentStatus(id: string, status: AppointmentRecord['status']): Promise<AppointmentRecord | null> {
  await ensureAppointmentSchema();
  const rows = await database()`UPDATE site_appointments SET status=${status} WHERE id=${id}
    RETURNING id, appointment_date, appointment_time, name, property, broker, status, color, created_at`;
  return rows[0] ? mapAppointment(rows[0]) : null;
}

export async function deleteAppointment(id: string): Promise<boolean> {
  await ensureAppointmentSchema();
  const rows = await database()`DELETE FROM site_appointments WHERE id=${id} RETURNING id`;
  return rows.length > 0;
}

function mapAppointment(row: Record<string, unknown>): AppointmentRecord {
  const date = row.appointment_date instanceof Date
    ? row.appointment_date.toISOString().slice(0, 10)
    : String(row.appointment_date).slice(0, 10);
  return {
    id: String(row.id), date, time: String(row.appointment_time), name: String(row.name), property: String(row.property),
    broker: String(row.broker), status: row.status === 'Confirmada' ? 'Confirmada' : 'Aguardando', color: String(row.color),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

async function ensurePerformanceSchema() {
  const sql = database();
  await sql`CREATE TABLE IF NOT EXISTS site_performance_months (
    month TEXT PRIMARY KEY,
    company_goal NUMERIC(14,2) NOT NULL DEFAULT 0,
    leads_received INTEGER NOT NULL DEFAULT 0,
    converted_leads INTEGER NOT NULL DEFAULT 0,
    recovered_leads INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS site_broker_goals (
    month TEXT NOT NULL,
    broker TEXT NOT NULL,
    goal NUMERIC(14,2) NOT NULL DEFAULT 0,
    leads_received INTEGER NOT NULL DEFAULT 0,
    converted_leads INTEGER NOT NULL DEFAULT 0,
    recovered_leads INTEGER NOT NULL DEFAULT 0,
    visits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (month, broker)
  )`;
  await sql`ALTER TABLE site_broker_goals ADD COLUMN IF NOT EXISTS leads_received INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE site_broker_goals ADD COLUMN IF NOT EXISTS converted_leads INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE site_broker_goals ADD COLUMN IF NOT EXISTS recovered_leads INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE site_broker_goals ADD COLUMN IF NOT EXISTS visits INTEGER NOT NULL DEFAULT 0`;
  await sql`CREATE TABLE IF NOT EXISTS site_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_key TEXT UNIQUE,
    sale_date DATE NOT NULL,
    broker TEXT NOT NULL,
    property TEXT NOT NULL,
    client TEXT NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`INSERT INTO site_performance_months (month, company_goal, leads_received, converted_leads, recovered_leads)
    VALUES ('2026-09', 3000000, 64, 18, 7) ON CONFLICT (month) DO NOTHING`;
  await sql`INSERT INTO site_broker_goals (month, broker, goal, leads_received, converted_leads, recovered_leads, visits) VALUES
    ('2026-09', 'Marina Oliveira', 1200000, 26, 9, 4, 7),
    ('2026-09', 'Paulo Mendes', 1000000, 22, 6, 2, 5),
    ('2026-09', 'Camila Rocha', 800000, 16, 3, 1, 4)
    ON CONFLICT (month, broker) DO NOTHING`;
  await sql`UPDATE site_broker_goals SET leads_received=26, converted_leads=9, recovered_leads=4, visits=7
    WHERE month='2026-09' AND broker='Marina Oliveira' AND leads_received=0 AND converted_leads=0 AND recovered_leads=0 AND visits=0`;
  await sql`UPDATE site_broker_goals SET leads_received=22, converted_leads=6, recovered_leads=2, visits=5
    WHERE month='2026-09' AND broker='Paulo Mendes' AND leads_received=0 AND converted_leads=0 AND recovered_leads=0 AND visits=0`;
  await sql`UPDATE site_broker_goals SET leads_received=16, converted_leads=3, recovered_leads=1, visits=4
    WHERE month='2026-09' AND broker='Camila Rocha' AND leads_received=0 AND converted_leads=0 AND recovered_leads=0 AND visits=0`;
  await sql`INSERT INTO site_sales (reference_key, sale_date, broker, property, client, amount) VALUES
    ('history-2026-04', '2026-04-18', 'Marina Oliveira', 'Residencial Alameda', 'Cliente abril', 1420000),
    ('history-2026-05', '2026-05-21', 'Paulo Mendes', 'Parque Imperial', 'Cliente maio', 1750000),
    ('history-2026-06', '2026-06-16', 'Camila Rocha', 'Vila do Lago', 'Cliente junho', 1980000),
    ('history-2026-07', '2026-07-24', 'Marina Oliveira', 'Reserva das Flores', 'Cliente julho', 2210000),
    ('history-2026-08', '2026-08-27', 'Paulo Mendes', 'Edifício Central', 'Cliente agosto', 2360000),
    ('sale-marina-aurora', '2026-09-01', 'Marina Oliveira', 'Residencial Aurora', 'Lucas Carvalho', 575000),
    ('sale-marina-horizonte', '2026-09-02', 'Marina Oliveira', 'Edifício Horizonte', 'Ana Martins', 590000),
    ('sale-paulo-bosque', '2026-09-03', 'Paulo Mendes', 'Casa Bosque Sereno', 'Rafael Borges', 820000),
    ('sale-paulo-vila', '2026-09-04', 'Paulo Mendes', 'Casa Vila Verde', 'Bruno Lima', 360000),
    ('sale-camila-studio', '2026-09-05', 'Camila Rocha', 'Studio Vila Nova', 'Juliana Reis', 295000)
    ON CONFLICT (reference_key) DO NOTHING`;
}

export async function getPerformance(month: string): Promise<PerformanceSnapshot> {
  await ensurePerformanceSchema();
  const sql = database();
  await sql`INSERT INTO site_performance_months (month, company_goal, leads_received, converted_leads, recovered_leads)
    VALUES (${month}, 3000000, 0, 0, 0) ON CONFLICT (month) DO NOTHING`;
  const defaultBrokers = ['Marina Oliveira', 'Paulo Mendes', 'Camila Rocha'];
  for (const broker of defaultBrokers) {
    await sql`INSERT INTO site_broker_goals (month, broker, goal) VALUES (${month}, ${broker}, 0) ON CONFLICT (month, broker) DO NOTHING`;
  }
  const settingsRows = await sql`SELECT company_goal, leads_received, converted_leads, recovered_leads FROM site_performance_months WHERE month=${month}`;
  const goalRows = await sql`SELECT broker, goal, leads_received, converted_leads, recovered_leads, visits FROM site_broker_goals WHERE month=${month} ORDER BY broker`;
  const saleRows = await sql`SELECT id, sale_date, broker, property, client, amount, created_at FROM site_sales
    WHERE TO_CHAR(sale_date, 'YYYY-MM')=${month} ORDER BY sale_date DESC, created_at DESC`;
  const historyRows = await sql`WITH recent_months AS (
      SELECT DISTINCT TO_CHAR(sale_date, 'YYYY-MM') AS month FROM site_sales
      WHERE sale_date < ((${month} || '-01')::date + INTERVAL '1 month') ORDER BY month DESC LIMIT 6
    )
    SELECT TO_CHAR(sale_date, 'YYYY-MM') AS month, broker, SUM(amount) AS sold FROM site_sales
    WHERE TO_CHAR(sale_date, 'YYYY-MM') IN (SELECT month FROM recent_months)
    GROUP BY TO_CHAR(sale_date, 'YYYY-MM'), broker ORDER BY month`;
  const sales = saleRows.map(mapSale);
  const totalSold = sales.reduce((total, sale) => total + sale.amount, 0);
  const settings = settingsRows[0];
  const leadsReceived = Number(settings.leads_received);
  const convertedLeads = Number(settings.converted_leads);
  return {
    month, companyGoal: Number(settings.company_goal), totalSold, salesCount: sales.length,
    averageTicket: sales.length ? totalSold / sales.length : 0, leadsReceived, convertedLeads,
    recoveredLeads: Number(settings.recovered_leads), conversionRate: leadsReceived ? (convertedLeads / leadsReceived) * 100 : 0,
    brokers: goalRows.map((goal) => {
      const brokerSales = sales.filter((sale) => sale.broker === String(goal.broker));
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
  await ensurePerformanceSchema();
  const rows = await database()`INSERT INTO site_sales (sale_date, broker, property, client, amount)
    VALUES (${input.date}, ${input.broker}, ${input.property}, ${input.client}, ${input.amount})
    RETURNING id, sale_date, broker, property, client, amount, created_at`;
  return mapSale(rows[0]);
}

export async function deleteSale(id: string): Promise<boolean> {
  await ensurePerformanceSchema();
  const rows = await database()`DELETE FROM site_sales WHERE id=${id} RETURNING id`;
  return rows.length > 0;
}

export async function updatePerformanceSettings(input: PerformanceSettingsInput) {
  await ensurePerformanceSchema();
  const sql = database();
  await sql`INSERT INTO site_performance_months (month, company_goal, leads_received, converted_leads, recovered_leads)
    VALUES (${input.month}, ${input.companyGoal}, ${input.leadsReceived}, ${input.convertedLeads}, ${input.recoveredLeads})
    ON CONFLICT (month) DO UPDATE SET company_goal=EXCLUDED.company_goal, leads_received=EXCLUDED.leads_received,
      converted_leads=EXCLUDED.converted_leads, recovered_leads=EXCLUDED.recovered_leads, updated_at=NOW()`;
  for (const item of input.brokerGoals) {
    await sql`INSERT INTO site_broker_goals (month, broker, goal) VALUES (${input.month}, ${item.broker}, ${item.goal})
      ON CONFLICT (month, broker) DO UPDATE SET goal=EXCLUDED.goal`;
  }
  return getPerformance(input.month);
}

function mapSale(row: Record<string, unknown>): SaleRecord {
  const date = row.sale_date instanceof Date ? row.sale_date.toISOString().slice(0, 10) : String(row.sale_date).slice(0, 10);
  return {
    id: String(row.id), date, broker: String(row.broker), property: String(row.property), client: String(row.client),
    amount: Number(row.amount), createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapLead(row: Record<string, unknown>): LeadProfile {
  return {
    id: String(row.id), name: String(row.name), phone: String(row.phone),
    email: row.email ? String(row.email) : null, goal: String(row.goal),
    propertyType: String(row.property_type), region: String(row.region), budget: String(row.budget),
    details: row.details ? String(row.details) : null, summary: String(row.summary),
    score: Number(row.score), temperature: String(row.temperature), createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
