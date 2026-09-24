// Isolated storage/provider contracts and real local SQL, never real leads or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('sharp');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');
const env = { SUPABASE_URL: 'https://storage.example.test', SUPABASE_SECRET_KEY: 'fixture-storage' };
function load(file, mocks = {}, extras = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module: mod, exports: mod.exports, Buffer, Date, AbortSignal, Response, Request, FormData, Blob, Uint8Array,
    console, process: { env }, require: name => mocks[name] || require(name), ...extras });
  return mod.exports;
}
const imageUrl = `${env.SUPABASE_URL}/storage/v1/object/public/property-images/${id(1)}/${id(301)}.webp`;
const connection = { companyId: id(1), phoneNumberId: '12345', enabled: true, accessToken: 'fixture-meta', apiVersion: 'v26.0' };

async function storageTests() {
  const webp = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#ffffff' } }).webp().toBuffer();
  const signature = load('lib/whatsapp-media.ts', { './supabase': {} });
  let calls = [], own = true, available = true, mime = 'image/webp', length = webp.length;
  const api = load('lib/property-whatsapp-media.ts', { sharp, './whatsapp-media': signature, './supabase': {
    supabaseServiceRequest: async query => {
      assert.ok(query.includes(`company_id=eq.${id(1)}`) && query.includes(`id=eq.${id(301)}`));
      return own ? [{ images: [imageUrl], status: available ? 'Disponível' : 'Vendido' }] : [];
    },
  } }, { fetch: async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    if (url.startsWith(env.SUPABASE_URL)) {
      assert.equal(url, `${env.SUPABASE_URL}/storage/v1/object/authenticated/property-images/${id(1)}/${id(301)}.webp`);
      assert.equal(options.headers.Authorization, 'Bearer fixture-storage');
      return new Response(webp, { headers: { 'Content-Type': mime, 'Content-Length': String(length) } });
    }
    assert.equal(url, 'https://graph.facebook.com/v26.0/12345/media');
    assert.equal(options.headers.Authorization, 'Bearer fixture-meta');
    assert.equal(options.body.get('messaging_product'), 'whatsapp');
    const file = options.body.get('file'); assert.equal(file.type, 'image/jpeg');
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(signature.matchesImageSignature(bytes, 'image/jpeg'), true);
    const metadata = await sharp(bytes).metadata(); assert.equal(metadata.width, 12); assert.equal(metadata.exif, undefined);
    return Response.json({ id: '7890' });
  } });
  const attachment = api.propertyImageAttachment(imageUrl, id(1), id(301));
  assert.equal(await api.uploadPropertyWhatsAppImage(id(1), attachment, connection), '7890');
  assert.equal(calls.length, 2, 'WebP becomes a real uploaded JPEG');
  for (const bad of [imageUrl.replace(id(1), id(2)), imageUrl + '?token=bad', imageUrl.replace('https:', 'http:'),
    'https://127.0.0.1/image.jpg', 'https://evil.test/photo.jpg', imageUrl.replace('.webp', '/../../secret')]) {
    assert.throws(() => api.propertyImageAttachment(bad, id(1), id(301)));
  }
  calls = []; own = false;
  await assert.rejects(() => api.uploadPropertyWhatsAppImage(id(1), attachment, connection));
  assert.equal(calls.length, 0, 'tenant/property ownership checked before any storage access');
  own = true; available = false;
  await assert.rejects(() => api.uploadPropertyWhatsAppImage(id(1), attachment, connection));
  assert.equal(calls.length, 0);
  available = true; mime = 'image/jpeg';
  await assert.rejects(() => api.uploadPropertyWhatsAppImage(id(1), attachment, connection), /Conteúdo/);
  assert.equal(calls.length, 1, 'MIME spoof never uploaded');
  mime = 'image/webp'; length = 5 * 1024 * 1024 + 1; calls = [];
  await assert.rejects(() => api.uploadPropertyWhatsAppImage(id(1), attachment, connection));
  assert.equal(calls.length, 1, 'oversize never uploaded');
}

async function senderTests() {
  for (const mode of ['ok', 'prepare-failed', 'post-timeout', 'rate-limit']) {
    const events = [], receipts = [];
    const api = load('lib/message-outbox.ts', {
      './supabase': { supabaseServiceRequest: async (query, options) => {
        if (query === 'rpc/claim_outbox_message_v2') return true;
        if (query === 'rpc/mark_outbox_provider_attempt') { events.push('mark'); return true; }
        if (query === 'rpc/finish_outbox_attempt') { receipts.push(options.body); return true; }
        if (query.startsWith('message_outbox?')) return [{ conversation_id: id(501), attempts: 1, template_payload: null,
          property_image: { propertyId: id(301), url: imageUrl, path: `property-images/${id(1)}/${id(301)}.webp` } }];
        if (query.startsWith('messages?')) return [{ content: 'Imóvel — foto 1/1' }];
        if (query.startsWith('conversations?')) return [{ external_conversation_id: 'whatsapp:5535999990001', phone_number_id: '12345' }];
        throw Error(query);
      } }, './meta-whatsapp-connections': { loadMetaWhatsAppConnectionForCompany: async () => [connection] },
      './property-whatsapp-media': { uploadPropertyWhatsAppImage: async (company, image, config) => {
        assert.equal(company, id(1)); assert.equal(image.propertyId, id(301)); assert.equal(config.accessToken, 'fixture-meta');
        events.push('prepare'); if (mode === 'prepare-failed') throw Error('storage outage'); return '7890';
      } },
    }, { fetch: async (url, options) => {
      events.push('send'); assert.match(url, /\/messages$/);
      const payload = JSON.parse(options.body);
      assert.equal(payload.type, 'image'); assert.equal(payload.image.id, '7890'); assert.equal(payload.image.caption, 'Imóvel — foto 1/1');
      assert.equal(payload.image.link, undefined); assert.equal(payload.to, '5535999990001');
      if (mode === 'post-timeout') throw Error('timeout');
      return mode === 'rate-limit' ? Response.json({ error: { code: 130429 } }, { status: 429 }) : Response.json({ messages: [{ id: 'wamid.photo' }] });
    } });
    await api.sendQueuedMessage(id(1), id(701));
    assert.deepEqual(events, mode === 'prepare-failed' ? ['prepare'] : ['prepare', 'mark', 'send']);
    assert.equal(receipts[0].p_state, mode === 'ok' ? 'sent' : mode === 'post-timeout' ? 'uncertain' : 'pending');
    if (mode === 'ok') assert.equal(receipts[0].p_provider_id, 'wamid.photo');
  }
}

async function offerContractTests() {
  const writes = [], sends = [];
  const api = load('lib/conversations.ts', {
    './supabase': { supabaseCompanyId: () => id(1), supabaseRequest: async (query, options) => {
      if (query.startsWith('leads?')) return [{ id: id(101) }];
      if (query.startsWith('properties?')) return [{ id: id(301), status: 'Disponível', images: [imageUrl] }];
      if (query.startsWith('conversations?')) return [{ id: id(501), assigned_broker_id: id(11) }];
      if (query === 'rpc/enqueue_property_offer') { writes.push(options.body); return [id(801), id(802)]; }
      if (query.startsWith('messages?')) return [{ id: id(801), company_id: id(1), content: 'Oferta', direction: 'outgoing', delivery_status: 'sent', media_urls: [], created_at: new Date().toISOString() }];
      if (query.startsWith('message_outbox?')) return [{ state: 'pending' }];
      throw Error(query);
    } },
    './tenant-context': { currentAccount: () => ({ brokerId: id(11), role: 'owner', name: 'Fixture' }) },
    './whatsapp-media': { isWhatsAppAudioPath: () => false, isWhatsAppMediaPath: () => false }, './message-delivery': {},
    './message-visibility': { hideMessageContent: row => row },
    './message-outbox': { sendQueuedMessage: async (company, message) => { assert.equal(company, id(1)); sends.push(message); } },
    './property-whatsapp-media': { propertyImageAttachment: (url, company, property) => ({ url, propertyId: property, path: `property-images/${company}/${id(301)}.webp` }) },
  });
  const result = await api.createConversationMessage({ leadId: id(101), propertyId: id(301), content: 'Oferta', requestId: id(901), images: ['https://attacker.example/private'] });
  assert.equal(writes.length, 1); assert.equal(writes[0].p_images[0].url, imageUrl, 'client image list cannot replace property database images');
  assert.deepEqual(sends, [id(801), id(802)]);
  assert.equal(result.photoDelivery.total, 1); assert.equal(result.photoDelivery.pending, 1); assert.equal(result.photoDelivery.sent, 0, 'queued photo not represented as delivered');
  sends.length = 0;
  const queued = await api.createConversationMessage({ leadId: id(101), propertyId: id(301), content: 'Oferta', requestId: id(902) }, Date.now() + 30000);
  assert.equal(sends.length, 0, 'elapsed preflight budget never restarts after enqueue');
  assert.equal(queued.photoDelivery.pending, 1, 'queue survives a short HTTP budget');
}

async function sqlTests() {
  const db = await createDatabase();
  try {
    await db.exec(migration('20260912221000_message_recovery.sql'));
    await db.exec(migration('20260924130000_property_image_outbox.sql'));
    await seedCompanies(db);
    await db.query('SELECT change_conversation_owner($1,$2,$3,false)', [id(1), id(101), id(11)]);
    const image = { propertyId: id(301), url: imageUrl, path: `property-images/${id(1)}/${id(301)}.webp` };
    await db.query('UPDATE properties SET images=$1::jsonb WHERE id=$2', [JSON.stringify([imageUrl]), id(301)]);
    const offer = async (key, images = [image], propertyId = id(301), broker = id(11)) => (await db.query(
      'SELECT enqueue_property_offer($1,$2,$3,$4,$5,$6,$7::jsonb) ids', [id(1), id(501), key, 'Oferta de teste', broker, propertyId, JSON.stringify(images)],
    )).rows[0].ids;
    const rowsBefore = (await db.query('SELECT count(*) count FROM messages')).rows[0].count;
    for (const args of [ ['foreign', [image], id(401)], ['foreign-image', [{...image, url: imageUrl.replace(id(1), id(2))}]],
      ['invalid-path', [{...image, path: `property-images/${id(2)}/${id(301)}.webp`}]], ['too-many', Array(6).fill(image)], ['wrong-broker', [image], id(301), id(21)] ]) {
      await assert.rejects(() => offer(...args));
    }
    assert.equal((await db.query('SELECT count(*) count FROM messages')).rows[0].count, rowsBefore, 'invalid offer rolls back entirely');
    const ids = await offer('offer-1'); assert.equal(ids.length, 2);
    assert.deepEqual(await offer('offer-1'), ids, 'same request never duplicates messages');
    const claim = async message => (await db.query('SELECT claim_outbox_message_v2($1,$2) ok', [id(1), message])).rows[0].ok;
    assert.equal(await claim(ids[1]), false, 'photo waits for text receipt');
    assert.equal(await claim(ids[0]), true);
    assert.equal(await claim(ids[0]), false, 'one sender lease');
    await db.query("SELECT finish_outbox_attempt($1,$2,1,'sent',NULL,'wamid.text',NULL)", [id(1), ids[0]]);
    await db.query("SELECT finish_outbox_attempt($1,$2,1,'sent',NULL,'wamid.text',NULL)", [id(1), ids[0]]);
    assert.equal((await db.query("SELECT count(*) n FROM lead_property_events WHERE company_id=$1 AND event_type='Enviado'", [id(1)])).rows[0].n, 1, 'offer event recorded once by durable receipt, including recovery');
    assert.equal(await claim(ids[1]), true);
    await db.query('SELECT mark_outbox_provider_attempt($1,$2,1)', [id(1), ids[1]]);
    await db.query("SELECT finish_outbox_attempt($1,$2,1,'uncertain',NULL,NULL,NULL)", [id(1), ids[1]]);
    assert.equal(await claim(ids[1]), false, 'ambiguous photo is never resent');
    const more = await offer('offer-2', [image, image]);
    await claim(more[0]);
    await db.query("SELECT finish_outbox_attempt($1,$2,1,'sent',NULL,'wamid.text2',NULL)", [id(1), more[0]]);
    await claim(more[1]);
    await db.query("SELECT finish_outbox_attempt($1,$2,1,'failed',131053,NULL,NULL)", [id(1), more[1]]);
    assert.equal(await claim(more[2]), false);
    assert.equal((await db.query('SELECT state FROM message_outbox WHERE id=$1',[more[2]])).rows[0].state, 'cancelled');
    const sold = await offer('sold-before-send');
    await db.query("UPDATE properties SET status='Vendido' WHERE id=$1", [id(301)]);
    assert.equal(await claim(sold[0]), false, 'do not offer a property sold while queued');
    await db.query("UPDATE properties SET status='Disponível' WHERE id=$1", [id(301)]);
    await db.query("UPDATE messages SET created_at=now()-interval '25 hours' WHERE direction='incoming'");
    await assert.rejects(() => offer('expired-window'), /template_required/);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(() => offer('unprivileged'), /permission denied/);
  } finally { await db.close(); }
}

(async () => { await storageTests(); await senderTests(); await offerContractTests(); await sqlTests(); console.log('PASS property photos: real WebP→JPEG, tenant/storage isolation, bounded media, upload/send receipts, atomic offers, 24h window, ordered queue and no duplicate retries'); })().catch(error => { console.error(error); process.exitCode = 1; });
