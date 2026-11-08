// Real operations SQL against isolated PostgreSQL. pg_cron/pg_net are inert
// fixtures; no network, secrets from the environment or customer data are used.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../../..');
(async () => {
 const db = await PGlite.create();
 try {
  await db.exec(`
   CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA vault;
   CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
   CREATE FUNCTION cron.schedule(p_name text,p_schedule text,p_command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command) RETURNING jobid $$;
   CREATE FUNCTION cron.alter_job(job_id bigint,active boolean) RETURNS void LANGUAGE sql AS $$
    UPDATE cron.job SET active=alter_job.active WHERE jobid=job_id $$;
   CREATE TABLE net._http_response(id bigint PRIMARY KEY,status_code integer,created timestamptz DEFAULT now());
   CREATE TABLE net.synthetic_requests(id bigserial PRIMARY KEY,url text,authorized boolean,timeout_ms integer);
   CREATE TABLE vault.secrets(name text,secret text);
   CREATE VIEW vault.decrypted_secrets AS SELECT name,secret AS decrypted_secret FROM vault.secrets;
   CREATE TABLE public.synthetic_push_candidates(ready boolean);
   INSERT INTO public.synthetic_push_candidates VALUES(false);
   CREATE FUNCTION public.list_web_push_candidates(p_limit integer,p_offset integer) RETURNS jsonb LANGUAGE sql AS $$
    SELECT CASE WHEN ready THEN '[{"synthetic":true}]'::jsonb ELSE '[]'::jsonb END FROM public.synthetic_push_candidates $$;
   CREATE FUNCTION net.http_get(url text,params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 2000)
    RETURNS bigint LANGUAGE plpgsql AS $$
    DECLARE request_id bigint;
    BEGIN
     IF url<>'https://www.imobflow.net.br/api/notifications/push/dispatch' THEN RAISE EXCEPTION 'unexpected_url'; END IF;
     IF headers->>'Authorization' IS DISTINCT FROM 'Bearer '||repeat('N',48) THEN RAISE EXCEPTION 'unexpected_key'; END IF;
     INSERT INTO net.synthetic_requests(url,authorized,timeout_ms) VALUES(url,true,timeout_milliseconds) RETURNING id INTO request_id;
     RETURN request_id;
    END $$;
  `);
  const operation = fs.readFileSync(path.join(root, 'supabase/operations/web-push-cron.sql'), 'utf8');
  await db.exec(operation);
  const scalar = async (sql, values = []) => Object.values((await db.query(sql, values)).rows[0])[0];
  const job = (await db.query('SELECT jobname,schedule,command,active FROM cron.job')).rows[0];
  assert.deepEqual(job, { jobname: 'imobflow-web-push', schedule: '* * * * *', command: 'SELECT public.dispatch_web_push_scheduler()', active: false });
  assert.equal(await scalar('SELECT count(*)::int FROM net.synthetic_requests'), 0, 'installation is inactive and performs no HTTP');
  const tick = () => db.query('SELECT public.dispatch_web_push_scheduler()');
  await tick(); assert.equal(await scalar('SELECT count(*)::int FROM net.synthetic_requests'), 0, 'no eligible consent means no HTTP or secret needed');
  await db.exec('UPDATE public.synthetic_push_candidates SET ready=true');
  await assert.rejects(tick, /web_push_scheduler_secret_missing_or_ambiguous/);
  await db.query('INSERT INTO vault.secrets VALUES($1,$2),($3,$4)', ['imobflow_web_push_scheduler_secret', 'N'.repeat(48), 'existing_cron_secret', 'UNRELATED_SYNTHETIC_VALUE']);
  await tick(); assert.equal(await scalar('SELECT count(*)::int FROM net.synthetic_requests'), 1);
  assert.equal(await scalar('SELECT timeout_ms FROM net.synthetic_requests LIMIT 1'), 55000);
  await tick(); assert.equal(await scalar('SELECT count(*)::int FROM net.synthetic_requests'), 1, 'in-flight HTTP cannot stack on repeated ticks');
  await db.exec('INSERT INTO net._http_response(id,status_code) VALUES(1,503)');
  await tick(); assert.equal(await scalar('SELECT count(*)::int FROM net.synthetic_requests'), 2);
  assert.equal(await scalar('SELECT last_http_status FROM public.web_push_scheduler'), 503);
  await db.exec('INSERT INTO net._http_response(id,status_code) VALUES(2,200);UPDATE public.synthetic_push_candidates SET ready=false');
  await tick(); assert.equal(await scalar('SELECT count(*)::int FROM net.synthetic_requests'), 2);
  assert.equal(await scalar('SELECT last_http_success_at IS NOT NULL FROM public.web_push_scheduler'), true);
  assert.equal(await scalar('SELECT secret FROM vault.secrets WHERE name=$1', ['existing_cron_secret']), 'UNRELATED_SYNTHETIC_VALUE', 'existing unrelated credential remains untouched');
  for (const role of ['anon', 'authenticated', 'service_role']) {
   await db.exec('SET ROLE ' + role);
   await assert.rejects(tick, /permission denied/);
   if (role === 'service_role') assert.equal(await scalar('SELECT last_http_status FROM public.web_push_scheduler'), 200);
   else await assert.rejects(() => db.query('SELECT * FROM public.web_push_scheduler'), /permission denied/);
   await db.exec('RESET ROLE');
  }
  const verified = await db.exec(fs.readFileSync(path.join(root, 'supabase/operations/web-push-verify.sql'), 'utf8'));
  assert(!JSON.stringify(verified).includes('N'.repeat(48)) && !JSON.stringify(verified).includes('UNRELATED_SYNTHETIC_VALUE'), 'metadata verification exposes no credential values');
  await assert.rejects(() => db.exec(operation), /web_push_scheduler_already_installed_review_existing_job/);
  await db.exec('ROLLBACK');
  assert.equal(await scalar('SELECT count(*)::int FROM cron.job'), 1, 'repeat installation never duplicates or replaces a job');
  console.log('PASS push scheduler SQL: inactive one-minute job, dedicated Vault key, empty-queue gate, in-flight guard, HTTP status metadata, private grants, no legacy secret change, safe verification and no network.');
 } finally { await db.close(); }
})().catch(error => { console.error(error); process.exit(1); });
