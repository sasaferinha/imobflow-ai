// Synthetic bytes and mocked HTTP only; never contacts customers or providers.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function load(file, deps, globals) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => name in deps ? deps[name] : require(name), Buffer, ArrayBuffer, Uint8Array, FormData, Blob, URL, Response, AbortSignal, Date, console, ...globals });
  return module.exports;
}
(async () => {
  const env = { OPENAI_API_KEY: 'synthetic-key' }, calls = [], reads = [], writes = [], mediaReads = [];
  const bytes = Uint8Array.from(Buffer.from('OggS synthetic audio')).buffer;
  let provider = () => Response.json({ text: 'Procuro uma casa no Centro até 400 mil.' });
  let row = { id: id(3), company_id: id(1), conversation_id: id(2), direction: 'incoming', content: 'Áudio recebido', media_urls: [`whatsapp-media/${id(1)}/${id(4)}.ogg`] }, save = true;
  const audio = load('lib/ai/audio-transcription.ts', {
    '../supabase': { supabaseServiceRequest: async (url, options = {}) => { assert.ok(url.includes(`company_id=eq.${id(1)}`)); assert.ok(url.includes(`conversation_id=eq.${id(2)}`)); if (options.method === 'PATCH') { writes.push({ url, options }); return save ? [{ id: id(3) }] : []; } reads.push(url); return [row]; } },
    '../whatsapp-media': { isWhatsAppAudioPath: (value, company) => value.startsWith(`whatsapp-media/${company}/`) && value.endsWith('.ogg'), matchesAudioSignature: (value, type) => type === 'audio/ogg' && Buffer.from(value).toString().startsWith('OggS'), readStoredWhatsAppImage: async value => { mediaReads.push(value); return { bytes, contentType: 'audio/ogg' }; } },
  }, { process: { env }, fetch: async (url, options) => { calls.push({ url, options }); return provider(); } });
  const input = { companyId: id(1), conversationId: id(2), messageId: id(3) };
  assert.equal(await audio.transcribeConversationAudio(input), 'Procuro uma casa no Centro até 400 mil.');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[0].options.body.get('model'), 'gpt-transcribe');
  assert.equal(calls[0].options.body.get('file').name, 'audio.ogg');
  assert.match(writes[0].url, /content=eq\./); assert.match(writes[0].options.body.content, /^Transcrição automática/);
  assert.equal(writes[0].options.body.media_urls, undefined, 'Audio remains attached');
  row = { ...row, content: writes[0].options.body.content };
  assert.equal(await audio.transcribeConversationAudio(input), 'Procuro uma casa no Centro até 400 mil.'); assert.equal(calls.length, 1, 'Cached transcript avoids provider cost');
  row = { ...row, content: 'Áudio recebido', company_id: id(9) }; assert.equal(await audio.transcribeConversationAudio(input), null); assert.equal(calls.length, 1);
  row = { ...row, company_id: id(1), media_urls: [`whatsapp-media/${id(9)}/${id(4)}.ogg`] }; assert.equal(await audio.transcribeConversationAudio(input), null); assert.equal(mediaReads.length, 1);
  row = { ...row, media_urls: [`whatsapp-media/${id(1)}/${id(4)}.ogg`], direction: 'outgoing' }; assert.equal(await audio.transcribeConversationAudio(input), null);
  row = { ...row, direction: 'incoming' }; save = false; assert.equal(await audio.transcribeConversationAudio(input), null, 'Concurrent correction wins');
  const count = calls.length; assert.equal(await audio.transcribeConversationAudio({ ...input, deadline: Date.now() }), null); assert.equal(calls.length, count);
  provider = () => Response.json({ error: 'private provider diagnostic' }, { status: 429 }); assert.equal(await audio.transcribeAudio(bytes, 'audio/ogg'), null);
  provider = () => Response.json({ text: 'x'.repeat(6001) }); assert.equal(await audio.transcribeAudio(bytes, 'audio/ogg'), null, 'No partial transcripts');
  assert.equal(await audio.transcribeAudio(bytes, 'audio/amr'), null); assert.equal(await audio.transcribeAudio(new ArrayBuffer(0), 'audio/ogg'), null);
  delete env.OPENAI_API_KEY; assert.equal(await audio.transcribeConversationAudio(input), null);
  console.log('PASS audio: private scoped media, bounded provider, supported signature, cache reuse, CAS correction protection, quota/unsupported/deadline fallbacks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
