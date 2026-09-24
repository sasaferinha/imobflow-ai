// Isolated fixture for the legacy CRM schema that predates tracked migrations.
// All versioned Supabase migrations are executed verbatim; no live connection.
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../../../..');
const isolationMigration = '20260912190000_tenant_relationship_isolation.sql';
const migration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function createDatabase({ hardened = true, propertyAutoDeliveries = true } = {}) {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
    CREATE TABLE companies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,slug text NOT NULL UNIQUE);
    CREATE TABLE leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),
      name text NOT NULL,phone text NOT NULL,email text,goal text,property_type text,region text,budget_min numeric,budget_max numeric,
      bedrooms int,parking_spaces int,details text,summary text,score int,temperature text,lifecycle_status text DEFAULT 'Novo',
      assigned_to text,source text,last_contact_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE properties(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),
      code text,title text NOT NULL,description text,purpose text,price numeric,district text,city text,address text,
      property_type text,bedrooms int,parking_spaces int,area numeric,images jsonb DEFAULT '[]',public_url text,status text DEFAULT 'Disponível',
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),
      lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,channel text,external_conversation_id text,status text,
      assigned_to text,last_message_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),
      conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,direction text,sender_type text,content text,
      external_message_id text,media_urls jsonb DEFAULT '[]',created_at timestamptz DEFAULT now());
    CREATE TABLE appointments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),
      lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
      scheduled_at timestamptz,assigned_to text,status text,notes text,created_at timestamptz DEFAULT now());
    CREATE TABLE lead_property_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),
      lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      event_type text,created_at timestamptz DEFAULT now());
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    -- Deliberately hostile legacy grants/policies: migration must close them.
    GRANT ALL ON leads,properties,conversations,messages,appointments,lead_property_events TO anon,authenticated;
    ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
    CREATE POLICY stale_allow_all ON leads FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
  `);
  const files = fs.readdirSync(path.join(root, 'supabase/migrations'))
    .filter(name => /^202609(?:09|10|11).*\.sql$/.test(name)).sort();
  for (const name of files) {
    if (!propertyAutoDeliveries && name === '20260909110000_property_auto_deliveries.sql') continue;
    await db.exec(migration(name));
  }
  if (hardened) await db.exec(migration(isolationMigration));
  return db;
}

async function seedCompanies(db) {
  for (const company of [1, 2]) {
    const broker = company * 10 + 1, lead = company * 100 + 1, property = company * 100 + 201, conversation = company * 100 + 401;
    await db.query('INSERT INTO companies(id,name,slug) VALUES($1,$2,$3)', [id(company), `Empresa ${company}`, `empresa-${company}`]);
    await db.query('INSERT INTO account_companies(company_id,name,name_key) VALUES($1,$2,$3)', [id(company), `Empresa ${company}`, `empresa ${company}`]);
    await db.query(`INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key)
      VALUES($1,$2,$3,$4,$5,'owner',true,$6,$6)`, [id(broker), id(company), `Dono ${company}`, `dono ${company}`, 'scrypt-v1$fixture', `owner${company}@example.test`]);
    await db.query(`INSERT INTO leads(id,company_id,name,phone,goal,property_type,region,budget_max,bedrooms,parking_spaces,
      lifecycle_status,assigned_to,last_contact_at,interest_profile) VALUES($1,$2,$3,$4,'Comprar','Apartamento','Centro',600000,3,2,'Novo',$5,now()-interval '12 days','{"city":"Lavras","parkingSpaces":2}')`,
    [id(lead), id(company), `Lead ${company}`, `553599999000${company}`, `Dono ${company}`]);
    await db.query(`INSERT INTO properties(id,company_id,title,purpose,price,district,city,property_type,bedrooms,parking_spaces)
      VALUES($1,$2,$3,'Venda',570000,'Centro','Lavras','Apartamento',3,2)`, [id(property), id(company), `Imóvel ${company}`]);
    await db.query(`INSERT INTO conversations(id,company_id,lead_id,channel,status,last_message_at)
      VALUES($1,$2,$3,'WhatsApp','Aberta',now())`, [id(conversation), id(company), id(lead)]);
    await db.query(`INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content,external_message_id)
      VALUES($1,$2,$3,'incoming','client',$4,$5)`, [id(company * 100 + 601), id(company), id(conversation), `Mensagem ${company}`, `wamid.${company}`]);
    await db.query(`INSERT INTO appointments(id,company_id,lead_id,property_id,scheduled_at,status)
      VALUES($1,$2,$3,$4,now(),'Aguardando')`, [id(company * 100 + 801), id(company), id(lead), id(property)]);
  }
}

module.exports = { createDatabase, seedCompanies, id, migration, isolationMigration };
