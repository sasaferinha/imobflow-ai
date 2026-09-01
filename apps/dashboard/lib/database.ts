import { neon } from '@neondatabase/serverless';
import type { LeadInput, LeadProfile } from './leads';
import { explainProfile, scoreLead } from './leads';

function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
  return neon(process.env.DATABASE_URL);
}

async function ensureSchema() {
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
  await ensureSchema();
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
  await ensureSchema();
  const sql = database();
  const rows = await sql`SELECT id, name, phone, email, goal, property_type, region, budget, details, summary, score, temperature, created_at FROM site_leads ORDER BY created_at DESC LIMIT 100`;
  return rows.map(mapLead);
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
