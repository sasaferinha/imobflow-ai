const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = new Map();
let uploads = [];
const env = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SECRET_KEY: 'synthetic-key-not-a-secret' };
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, Buffer, URL, Uint8Array, AbortSignal,
    process: { env }, fetch: async (url, options) => { uploads.push({ url, options }); return { ok: true }; },
    require(name) { if (name === 'node:crypto') return { randomUUID: () => '00000000-0000-4000-8000-000000000099' }; if (name === './model') return load('lib/website/model.ts'); throw new Error(name); },
  });
  modules.set(file, module.exports); return module.exports;
}
async function run() {
  const { decodeWebsiteImage, storeWebsiteImage, WEBSITE_IMAGE_LIMIT } = load('lib/website/media.ts');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=';
  assert.equal(decodeWebsiteImage(png).contentType, 'image/png');
  for (const bad of [null, '', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,' + Buffer.from('<html>x</html>').toString('base64'), png.replace('image/png','image/jpeg'), png + 'a', 'https://example.com/image.png', 'data:image/png;base64,' + Buffer.alloc(WEBSITE_IMAGE_LIMIT + 1).toString('base64')]) assert.throws(() => decodeWebsiteImage(bad));
  assert.equal(uploads.length, 0, 'Validation never performs a network request');
  await assert.rejects(storeWebsiteImage('../other-company', png));
  const company = '00000000-0000-4000-8000-000000000001';
  const result = await storeWebsiteImage(company, png);
  assert.equal(uploads.length, 1);
  assert(result.startsWith(`https://synthetic.supabase.co/storage/v1/object/public/website-media/${company}/`));
  assert.equal(uploads[0].options.headers['x-upsert'], 'false');
  assert.equal(uploads[0].options.headers['Content-Type'], 'image/png');
  assert.equal(uploads[0].options.cache, 'no-store');
  assert(!result.includes(env.SUPABASE_SECRET_KEY), 'Public URLs never contain storage credentials');
  const { PGlite } = require('@electric-sql/pglite');
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA storage; GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
      CREATE TABLE storage.objects(id text PRIMARY KEY,bucket_id text);
      GRANT ALL ON storage.objects TO anon,authenticated,service_role;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY preexisting_permissive ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
      INSERT INTO storage.objects VALUES('website-file','website-media'),('other-file','other-bucket');`);
    await db.exec(fs.readFileSync(path.resolve(root, '../../supabase/migrations/20261108001000_website_media.sql'), 'utf8'));
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query("INSERT INTO storage.objects VALUES('forbidden','website-media')"), /row-level security/);
      assert.equal((await db.query("UPDATE storage.objects SET id='changed' WHERE id='website-file' RETURNING id")).rows.length, 0);
      assert.equal((await db.query("DELETE FROM storage.objects WHERE id='website-file' RETURNING id")).rows.length, 0);
      assert.equal((await db.query("UPDATE storage.objects SET bucket_id='other-bucket' WHERE id='other-file' RETURNING id")).rows.length, 1, 'Other buckets retain their prior policies');
      await assert.rejects(db.query("UPDATE storage.objects SET bucket_id='website-media' WHERE id='other-file'"), /row-level security/);
      await db.exec('RESET ROLE');
    }
    await db.exec("SET ROLE service_role; INSERT INTO storage.objects VALUES('server-file','website-media'); RESET ROLE");
    assert.equal((await db.query("SELECT file_size_limit FROM storage.buckets WHERE id='website-media'")).rows[0].file_size_limit, WEBSITE_IMAGE_LIMIT);
  } finally { await db.close(); }
  console.log('PASS website media: strict raster formats, content signature, size limits, tenant path, immutable upload and no credential disclosure.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
