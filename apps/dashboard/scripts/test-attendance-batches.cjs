// Real attendance worker, fictional turns. No Meta, AI or database network calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const plain = value => JSON.parse(JSON.stringify(value));
function load(relative, overrides) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => name in overrides ? overrides[name] : name.startsWith('.')
      ? load(path.posix.join(path.posix.dirname(relative), name + '.ts'), overrides) : require(name),
    process: { env: {} }, Date, Intl, URL, URLSearchParams, console,
    fetch: async () => assert.fail('No network is allowed in attendance batch regressions'),
  });
  return module.exports;
}

function worker({ initialProfile = {}, batches, superseded = 0, conflict = false,
  enqueueFailure = false, overflow = false, model = false, modelData, ignored = false, lastReply } = {}) {
  let profile = plain(initialProfile), paused = false, consumed = ignored, active = null;
  const claims = [], attempts = [], replies = [], deliveries = [], released = [], reconciled = [], reads = [], ai = [], waits = [];
  const input = {
    companyId: 'company-a', leadId: 'lead-a', conversationId: 'conversation-a',
    incomingExternalMessageId: 'wamid.trigger', message: 'trigger (not the persisted turn)',
    hasImage: false, recipientPhone: '5535999999999', phoneNumberId: '123456789',
    accessToken: 'fictional-token', apiVersion: 'v26.0', occurredAt: new Date().toISOString(),
  };
  const assertScope = event => {
    assert.equal(event.companyId, input.companyId);
    assert.equal(event.conversationId, input.conversationId);
  };
  const api = load('lib/attendance.ts', {
    'node:timers/promises': { setTimeout: async ms => { waits.push(ms); } },
    './attendance-turns': {
      ATTENDANCE_DEBOUNCE_MS: 3000,
      async claimAttendanceTurn(event) {
        assertScope(event);
        if (consumed || paused) return { status: 'ignored' };
        assert.equal(active, null, 'the previous reservation is released before claiming again');
        const batch = batches[Math.min(claims.length, batches.length - 1)];
        const index = claims.length + 1;
        const messages = batch.map((message, offset) => ({
          externalMessageId: `wamid.batch.${index}.${offset}`,
          message, hasImage: false, hasAudio: false, occurredAt: input.occurredAt,
        }));
        active = { status: 'claimed', token: `token-${index}`, watermark: messages.length,
          key: `turn-${index}`, messages, latestOccurredAt: input.occurredAt, overflow,
          ...(lastReply !== undefined ? { lastReply } : {}) };
        claims.push(active);
        return active;
      },
      async enqueueAttendanceTurn(event, turn, content, options) {
        assertScope(event);
        assert.equal(turn, active);
        assert.equal(options.profileVersion, 'version-1', 'read version participates in atomic enqueue');
        assert.deepEqual(profile, initialProfile, 'no durable profile writes happen before atomic enqueue');
        attempts.push({ content, options: plain(options) });
        if (enqueueFailure) throw new Error('fictional database unavailable');
        if (conflict || attempts.length <= superseded) return { status: 'superseded' };
        profile = { ...profile, ...plain(options.profilePatch) };
        paused ||= options.handoff;
        consumed = true;
        replies.push(content);
        return { status: 'queued', messageId: `outbox-${replies.length}` };
      },
      async releaseAttendanceTurn(event, turn) {
        assertScope(event);
        assert.equal(turn, active, 'only the owning token releases the turn');
        released.push(turn.token);
        active = null;
      },
      async reconcileAttendanceHandoffs(event) {
        assertScope(event);
        assert.equal(attempts.at(-1).options.handoff, true, 'only a human handoff is reconciled');
        assert.equal(deliveries.length, 1, 'reconciliation follows the queued delivery attempt');
        reconciled.push(event.conversationId);
        return 1;
      },
    },
    './supabase': { supabaseServiceRequest: async query => {
      reads.push(query);
      if (query === 'leads?company_id=eq.company-a&id=eq.lead-a&select=interest_profile,goal,property_type,region,budget_max,updated_at&limit=1') {
        return [{ interest_profile: plain(profile), goal: '', property_type: '', region: '',
          budget_max: 0, updated_at: 'version-1' }];
      }
      if (query.startsWith('messages?company_id=eq.company-a&conversation_id=eq.conversation-a&')) return [];
      if (query === 'companies?id=eq.company-a&select=id,slug&limit=1') return [{ id: 'company-a', slug: 'imobiliaria-a' }];
      assert.fail('Unexpected database operation (legacy writes are forbidden): ' + query);
    } },
    './ai/openai-provider': { configuredAIProvider: () => model ? { extractLeadProfile: async request => {
      ai.push(plain(request));
      return { data: modelData || { confidence: 0, requestsHumanHandoff: false, extractedFields: {} } };
    } } : null },
    './conversation-settings': { readBusinessHours: async companyId => {
      assert.equal(companyId, input.companyId); return {};
    } },
    './business-hours': { businessTime: () => ({ afterHours: false }) },
    './message-outbox': { sendQueuedMessage: async (companyId, messageId, deadline) => {
      assert.equal(companyId, input.companyId);
      assert.equal(typeof deadline, 'number');
      assert.ok(deadline > Date.now(), 'sender gets the bounded worker deadline');
      deliveries.push(messageId);
    } },
  });
  return { claims, attempts, replies, deliveries, released, reconciled, reads, ai, waits,
    get profile() { return profile; }, get paused() { return paused; },
    run: () => api.respondToIncomingMessage(input) };
}

const completeProfile = {
  purpose: 'Venda', propertyType: 'Casa', city: 'Lavras', regions: ['Centro'],
  budgetMax: 500000, bedrooms: 3, parkingSpaces: 1, financingIntent: 'Não',
};

(async () => {
  const burst = worker({ batches: [['Comprar', 'Casa', 'Lavras']], model: true });
  await burst.run();
  assert.deepEqual(burst.profile, { purpose: 'Venda', propertyType: 'Casa', city: 'Lavras' });
  assert.equal(burst.replies.length, 1, 'three client messages result in one bot message');
  assert.deepEqual(burst.deliveries, ['outbox-1']);
  assert.deepEqual(burst.reconciled, [], 'ordinary automatic messages do not reconcile human handoff state');
  assert.match(burst.replies[0], /bairros ou regiões/);
  assert.match(burst.replies[0], /\n\n/, 'acknowledgement and next question are separate paragraphs');
  assert.equal(burst.ai.length, 1, 'a burst performs at most one optional model extraction');
  assert.equal(burst.ai[0].message, 'Lavras');
  assert.equal(burst.ai[0].currentProfile.transactionType, 'BUY');
  assert.equal(burst.ai[0].currentProfile.propertyType, 'HOUSE', 'later input sees earlier in-memory answers');
  assert.equal(burst.reads.filter(query => query.startsWith('leads?')).length, 1);
  assert.equal(burst.waits[0], 3000, 'the worker allows the persisted burst to settle');
  await burst.run();
  assert.equal(burst.replies.length, 1, 'a replay of an already-consumed turn sends nothing');
  const old = worker({ ignored: true, batches: [['Oi']] });
  await old.run();
  assert.deepEqual(old.reads, []);
  assert.deepEqual(old.deliveries, []);
  console.log('PASS persisted burst collects every answer, one model call, one organized response and no replay spam');

  const financed = worker({ batches: [['financiar', 'Casa', 'Lavras']] });
  await financed.run();
  assert.equal(financed.replies.length, 1);
  assert.equal(financed.profile.financingIntent, 'Sim');
  assert.match(financed.replies[0], /simulador-financiamento\?empresa=imobiliaria-a/);
  assert.match(financed.replies[0], /bairros ou regiões/);
  assert.doesNotMatch(financed.replies[0], /financiar ou comprar à vista/);
  const unseenSummary = worker({ initialProfile: completeProfile, batches: [['quero financiar', 'sim']] });
  await unseenSummary.run();
  assert.equal(unseenSummary.replies.length, 1);
  assert.equal(unseenSummary.profile.financingIntent, 'Sim');
  assert.notEqual(unseenSummary.profile.summaryConfirmed, true, 'a same-burst yes cannot confirm a summary the client has not received');
  assert.match(unseenSummary.replies[0], /• Pagamento: financiamento/);
  assert.match(unseenSummary.replies[0], /Está certo\?$/);
  assert.doesNotMatch(unseenSummary.replies[0], /Muito obrigado|encaminhando/);
  const cancelledSummary = worker({ initialProfile: completeProfile, batches: [['sim']], lastReply: null });
  await cancelledSummary.run();
  assert.notEqual(cancelledSummary.profile.summaryConfirmed, true, 'an unsent/cancelled previous summary cannot be approved');
  assert.match(cancelledSummary.replies[0], /Só para confirmar:/);
  assert.match(cancelledSummary.replies[0], /Está certo\?$/);
  const { qualificationSummary, QUALIFICATION_COMPLETE_MESSAGE } = load('lib/ai/qualification.ts', {});
  const deliveredSummary = worker({ initialProfile: completeProfile, batches: [['sim']],
    lastReply: qualificationSummary(completeProfile) });
  await deliveredSummary.run();
  assert.equal(deliveredSummary.profile.summaryConfirmed, true, 'an actual delivered summary can be approved');
  assert.equal(deliveredSummary.replies[0], QUALIFICATION_COMPLETE_MESSAGE);

  const correction = worker({ initialProfile: completeProfile,
    batches: [['não', 'quero mudar o bairro', 'São Pedro']] });
  await correction.run();
  assert.equal(correction.replies.length, 1, 'rejection and correction are consolidated, not three messages');
  assert.deepEqual(correction.profile.regions, ['São Pedro']);
  assert.equal(correction.profile.city, 'Lavras');
  assert.equal(correction.profile.correctionRequested, false);
  assert.notEqual(correction.profile.summaryConfirmed, true);
  assert.match(correction.replies[0], /• Bairros ou regiões: São Pedro/);
  assert.doesNotMatch(correction.replies[0], /Centro|Muito obrigado|deseja corrigir/);
  assert.match(correction.replies[0], /\n\nEstá certo\?$/);
  const staleModel = worker({ initialProfile: completeProfile, batches: [['bairro: São Pedro']], model: true,
    modelData: { confidence: 0.99, requestsHumanHandoff: false, extractedFields: { neighborhoods: ['Centro'] } } });
  await staleModel.run();
  assert.deepEqual(staleModel.profile.regions, ['São Pedro'], 'a model echo of old data cannot override an explicit local correction');
  assert.match(staleModel.replies[0], /• Bairros ou regiões: São Pedro/);
  assert.doesNotMatch(staleModel.replies[0], /Centro/);
  const greetings = worker({ initialProfile: completeProfile, batches: [['Oi', 'Oi', 'Oi']] });
  await greetings.run();
  assert.equal(greetings.replies.length, 1);
  assert.match(greetings.replies[0], /manter essa busca ou mudar/);
  assert.doesNotMatch(greetings.replies[0], /Só para confirmar/, 'greetings do not reprint an already-presented full summary');
  console.log('PASS financing survives a burst and rejection plus targeted bare-value correction produces one current summary');

  const superseded = worker({ superseded: 1, batches: [['Comprar', 'Casa'], ['Comprar', 'Casa', 'Lavras']] });
  await superseded.run();
  assert.equal(superseded.attempts.length, 2);
  assert.deepEqual(superseded.profile, { purpose: 'Venda', propertyType: 'Casa', city: 'Lavras' });
  assert.equal(superseded.deliveries.length, 1, 'an obsolete draft is never sent');
  assert.match(superseded.replies[0], /bairros ou regiões/);
  assert.doesNotMatch(superseded.replies[0], /qual cidade/);
  assert.deepEqual(superseded.released, ['token-1', 'token-2']);

  const conflict = worker({ initialProfile: completeProfile, conflict: true, batches: [['sim']] });
  await conflict.run();
  assert.equal(conflict.attempts.length, 3, 'continuous CAS conflicts retry at most three times');
  assert.deepEqual(conflict.profile, completeProfile);
  assert.deepEqual(conflict.replies, [], 'no success or generic fallback after a rejected save');
  assert.deepEqual(conflict.deliveries, []);
  assert.equal(conflict.released.length, 3);
  const unavailable = worker({ enqueueFailure: true, batches: [['Comprar']] });
  await unavailable.run();
  assert.equal(unavailable.attempts.length, 1);
  assert.deepEqual(unavailable.profile, {});
  assert.deepEqual(unavailable.deliveries, []);
  assert.deepEqual(unavailable.released, ['token-1']);
  console.log('PASS superseded draft recomposition, bounded CAS retries and silent recoverable infrastructure failure');

  const human = worker({ batches: [['Casa', 'Quero falar com um corretor', 'Lavras']] });
  await human.run();
  assert.equal(human.paused, true);
  assert.equal(human.replies.length, 1);
  assert.match(human.replies[0], /corretor/);
  assert.equal(human.profile.propertyType, 'Casa');
  assert.equal(human.profile.city, undefined, 'stop automatic qualification at the explicit handoff');
  await human.run();
  assert.equal(human.deliveries.length, 1);
  assert.deepEqual(human.reconciled, ['conversation-a']);
  const excessive = worker({ overflow: true, batches: [['Comprar', 'Casa', 'Lavras']] });
  await excessive.run();
  assert.equal(excessive.paused, true);
  assert.equal(excessive.replies.length, 1);
  assert.match(excessive.replies[0], /corretor/);
  assert.deepEqual(excessive.profile, {}, 'overflow cannot save a partial qualification');
  assert.equal(excessive.ai.length, 0);
  assert.equal(excessive.deliveries.length, 1);
  assert.deepEqual(excessive.reconciled, ['conversation-a']);
  console.log('PASS explicit human request and oversized burst each produce a single atomic handoff');
})().catch(error => { console.error(error); process.exitCode = 1; });
