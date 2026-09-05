import { neon } from '@neondatabase/serverless';
import type { LeadInput, LeadProfile } from './leads';
import { explainProfile, scoreLead } from './leads';
import type { AppointmentInput, AppointmentRecord, PropertyInput, PropertyRecord } from './operations';

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

function mapLead(row: Record<string, unknown>): LeadProfile {
  return {
    id: String(row.id), name: String(row.name), phone: String(row.phone),
    email: row.email ? String(row.email) : null, goal: String(row.goal),
    propertyType: String(row.property_type), region: String(row.region), budget: String(row.budget),
    details: row.details ? String(row.details) : null, summary: String(row.summary),
    score: Number(row.score), temperature: String(row.temperature), createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
