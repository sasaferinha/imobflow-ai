// Fictional local conversations only: no network, database or real messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const module = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => overrides[name] || (name.startsWith('.')
      ? load(path.posix.join(path.posix.dirname(relative), name + '.ts'), overrides)
      : require(name)),
    process: { env: {} },
    Date, Intl, URL, URLSearchParams, console,
    fetch: async () => { throw new Error('Unexpected network request'); },
  });
  return module.exports;
}

const basic = load('lib/ai/basic-qualification.ts');
const qualification = load('lib/ai/qualification.ts');
const natural = load('lib/ai/natural-qualification.ts');
const OPENING_QUESTION = 'Você procura algo para morar ou investir? Quer comprar ou alugar?';
const completeBuyer = {
  purpose: 'Venda', propertyType: 'Casa', city: 'Lavras', regions: ['Centro'],
  budgetMax: 500000, bedrooms: 3, parkingSpaces: 0,
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function conversation(initialProfile = {}, afterHours = false) {
  let profile = { ...initialProfile };
  let nextIncomingId = 0;
  const replies = [];
  const deliveries = [];
  const failures = [];
  const input = {
    companyId: 'company-a', leadId: 'lead-a', conversationId: 'conversation-a',
    hasImage: false, recipientPhone: '5535999999999', phoneNumberId: '123456789',
    accessToken: 'fictional-token', apiVersion: 'v26.0',
  };
  const api = load('lib/attendance.ts', {
    './supabase': {
      supabaseServiceRequest: async (query, options = {}) => {
        if (query === 'rpc/claim_attendance_reply') return true;
        if (query === 'conversations?company_id=eq.company-a&id=eq.conversation-a' && options.method === 'PATCH') {
          assert.equal(options.body.bot_paused, true);
          return null;
        }
        if (query === 'leads?company_id=eq.company-a&id=eq.lead-a&select=interest_profile,goal,property_type,region,budget_max,updated_at&limit=1') {
          return [{
            interest_profile: profile,
            goal: profile.purpose === 'Venda' ? 'Comprar' : profile.purpose === 'Aluguel' ? 'Alugar' : 'Não informado',
            property_type: profile.propertyType || 'Não informado',
            region: profile.regions?.join(', ') || 'Não informado',
            budget_max: profile.budgetMax || null,
            updated_at: '2026-09-12T12:00:00Z',
          }];
        }
        if (query === 'rpc/merge_attendance_profile') {
          assert.equal(options.body.p_company_id, input.companyId);
          assert.equal(options.body.p_lead_id, input.leadId);
          profile = { ...profile, ...plain(options.body.p_profile) };
          return true;
        }
        if (query === 'companies?id=eq.company-a&select=id,slug&limit=1') {
          return [{ id: 'company-a', slug: 'imobiliaria-a' }];
        }
        if (query === 'rpc/enqueue_conversation_message') {
          assert.equal(options.body.p_company_id, input.companyId);
          assert.equal(options.body.p_conversation_id, input.conversationId);
          replies.push(options.body.p_content);
          return `queued-${replies.length}`;
        }
        failures.push(query);
        throw new Error('Unexpected database operation: ' + query);
      },
    },
    './conversation-settings': { readBusinessHours: async () => ({}) },
    './business-hours': { businessTime: () => ({ afterHours }) },
    './message-outbox': {
      sendQueuedMessage: async (companyId, messageId) => deliveries.push({ companyId, messageId }),
    },
  });
  return {
    get profile() { return profile; },
    replies,
    async receive(message) {
      const before = replies.length;
      await api.respondToIncomingMessage({
        ...input, message, occurredAt: new Date().toISOString(),
        incomingExternalMessageId: `wamid.financing-opening.${++nextIncomingId}`,
      });
      assert.deepEqual(failures, [], 'the reply must use only the expected database operations');
      assert.equal(replies.length, before + 1, 'each incoming message queues one response');
      assert.deepEqual(deliveries.at(-1), {
        companyId: input.companyId, messageId: `queued-${replies.length}`,
      }, 'the queued response is handed to the sender');
      return replies.at(-1);
    },
  };
}

(async () => {
  assert.equal(qualification.qualificationQuestion({}), OPENING_QUESTION);
  for (const answer of ['talvez', 'ainda não sei', 'não decidi']) {
    const undecided = conversation(completeBuyer);
    assert.match(await undecided.receive(answer), /Está certo\?/);
    assert.equal(await undecided.receive('sim'), qualification.QUALIFICATION_COMPLETE_MESSAGE);
    assert.equal(undecided.profile.financingIntent, 'Indeciso');
    assert.equal(basic.basicPreferences(answer, {}).financingIntent, undefined);
  }
  assert.ok(natural.clarificationReply({}).startsWith(OPENING_QUESTION));
  const opening = conversation();
  assert.equal(await opening.receive('Oi'), `Olá! Sou o assistente da imobiliária. Vou te ajudar a encontrar um imóvel. ${OPENING_QUESTION}`);
  assert.ok((await opening.receive('não entendi')).includes(OPENING_QUESTION));
  assert.deepEqual(opening.profile, {});

  for (const message of ['financiar', 'financiamento', 'quero financiar']) {
    const patch = plain(basic.basicPreferences(message, {}));
    assert.deepEqual(patch, { purpose: 'Venda', financingIntent: 'Sim' }, message);
    for (const current of [{ purpose: 'Venda' }, { purpose: 'Venda', propertyType: 'Casa' }, completeBuyer]) {
      const buyerPatch = basic.basicPreferences(message, current);
      assert.equal(buyerPatch.financingIntent, 'Sim', message + ' should work during buyer qualification');
      assert.equal(buyerPatch.city, undefined, 'a financing choice is never a city');
      assert.equal(buyerPatch.regions, undefined, 'a financing choice is never a neighborhood');
    }
  }
  assert.equal(basic.basicPreferences('quero financiar', {
    ...completeBuyer, financingIntent: 'Não',
  }).financingIntent, 'Sim', 'an explicit later choice can update a previous decline');

  for (const message of [
    'não quero financiar', 'não preciso de financiamento', 'sem financiamento',
    'financiamento?', 'quero financiar?', 'posso financiar?', 'como funciona o financiamento?',
    'se eu quiser financiar', 'talvez eu queira financiar', 'suponha que eu queira financiar',
  ]) {
    for (const current of [{}, { purpose: 'Venda' }, completeBuyer]) {
      const patch = basic.basicPreferences(message, current);
      assert.notEqual(patch.financingIntent, 'Sim', message + ' must not opt in');
      if (!current.purpose) assert.equal(patch.purpose, undefined, message + ' must not infer a purchase');
    }
  }
  assert.equal(basic.basicPreferences('sim', {}).financingIntent, undefined,
    'a bare yes does not select financing at the three-way opening');
  for (const message of ['financiamento', 'financiar', 'quero financiar', 'posso financiar?']) {
    const rental = { ...completeBuyer, purpose: 'Aluguel' };
    const patch = basic.basicPreferences(message, rental);
    assert.equal({ ...rental, ...patch }.purpose, 'Aluguel', message + ' must preserve an existing rental search');
    assert.notEqual(patch.financingIntent, 'Sim', message + ' must not opt a renter into financing');
  }
  console.log('PASS opening choices, explicit finance parsing, negative/question/hypothetical exclusion and rental preservation');

  const simulator = 'https://www.imobflow.net.br/simulador-financiamento?empresa=imobiliaria-a';
  for (const message of ['financiar', 'financiamento', 'quero financiar']) {
    const chat = conversation();
    const reply = await chat.receive(message);
    assert.equal(chat.profile.purpose, 'Venda');
    assert.equal(chat.profile.financingIntent, 'Sim');
    assert.ok(reply.includes(simulator), message + ' must deliver the simulator in the immediate reply');
    const nextQuestion = qualification.qualificationQuestion(chat.profile);
    assert.match(nextQuestion, /tipo de imóvel/);
    assert.ok(reply.endsWith(nextQuestion), 'qualification continues in the same reply');
    assert.ok(reply.indexOf(simulator) < reply.indexOf(nextQuestion), 'simulator precedes the next question');
    assert.ok(!reply.includes(qualification.FINANCING_QUESTION), 'do not ask for financing again after an explicit choice');
  }

  const financed = conversation();
  await financed.receive('financiar');
  for (const message of ['Casa', 'Lavras', 'Centro', '500 mil', '3 quartos e sem garagem', 'sim']) {
    const reply = await financed.receive(message);
    assert.ok(!reply.includes(qualification.FINANCING_QUESTION), 'financed buyer skips the late opt-in question');
    assert.ok(!reply.includes(qualification.FINANCING_SIMULATOR_URL), 'ordinary qualification answers do not resend the simulator');
  }
  assert.equal(financed.replies.at(-1), qualification.QUALIFICATION_COMPLETE_MESSAGE);
  assert.deepEqual(financed.profile, { ...completeBuyer, financingIntent: 'Sim', preferencesRecorded: true, preferenceNotes: '3 quartos e sem garagem', summaryConfirmed: true, correctionRequested: false });
  assert.match(await financed.receive('Obrigado'), /cadastro já está registrado/);

  const buyer = conversation();
  for (const message of ['Comprar', 'Casa', 'Lavras', 'Centro', '500 mil', '3', '0']) {
    const reply = await buyer.receive(message);
    assert.ok(!reply.includes(qualification.FINANCING_SIMULATOR_URL), 'purchase alone must not send the simulator');
  }
  assert.equal(buyer.profile.financingIntent, undefined);
  assert.ok(buyer.replies.at(-1).endsWith(qualification.FINANCING_QUESTION));
  const optedInLater = await buyer.receive('sim');
  assert.ok(optedInLater.includes(simulator));
  assert.match(optedInLater, /Está certo\?$/);
  assert.equal(await buyer.receive('ok'), qualification.QUALIFICATION_COMPLETE_MESSAGE);

  for (const message of ['posso financiar?', 'talvez eu queira financiar', 'não quero financiar']) {
    const chat = conversation();
    const reply = await chat.receive(message);
    assert.ok(!reply.includes(qualification.FINANCING_SIMULATOR_URL), message + ' must not send a simulator link');
    assert.notEqual(chat.profile.financingIntent, 'Sim');
  }
  console.log('PASS immediate simulator delivery, continued qualification, no repeated opt-in and unchanged purchase opt-in flow');

  const rental = conversation({}, true);
  await rental.receive('Quero alugar apartamento em Lavras, no bairro Centro, até 2500');
  assert.ok(rental.replies.at(-1).endsWith(qualification.OPTIONAL_PREFERENCES_QUESTION));
  assert.ok(!rental.replies.at(-1).includes('não há corretores'), 'collect preferences even outside office hours');
  assert.match(await rental.receive('sem preferência'), /Está certo\?$/);
  assert.match(await rental.receive('não'), /deseja corrigir/);
  assert.equal(rental.profile.summaryConfirmed, undefined);
  assert.match(await rental.receive('bairro: São Pedro'), /São Pedro/);
  assert.deepEqual(rental.profile.regions, ['São Pedro']);
  assert.match(await rental.receive('meu orçamento é 3000'), /3.000/);
  assert.equal(rental.profile.budgetMax, 3000);
  const finished = await rental.receive('ok');
  assert.equal(finished, 'Muito obrigado pelas informações! Seu cadastro foi concluído. No momento não há corretores disponíveis. Nossa equipe dará continuidade ao seu atendimento no próximo horário comercial.');
  assert.match(finished, /não há corretores disponíveis/);
  assert.ok(rental.replies.every(reply => !reply.includes(qualification.FINANCING_SIMULATOR_URL)), 'rental never receives financing');
  const human = conversation({}, true);
  assert.match(await human.receive('Quero falar com um corretor'), /não há corretores disponíveis/);
  assert.deepEqual(human.profile, {}, 'human handoff does not require qualification');
  assert.equal(basic.basicPreferences('Quero investir', {}).intendedUse, 'Investir');
  assert.equal(basic.basicPreferences('Pretendo investir 500 mil', {}).intendedUse, undefined, 'budget does not imply an investment purpose');
  const changedFinance = basic.basicPreferences('Quero financiar', {...completeBuyer, financingIntent:'Não', summaryConfirmed:true});
  assert.equal(changedFinance.summaryConfirmed, false, 'changing a confirmed payment choice requires a fresh summary');
  console.log('PASS optional preferences, rental, summary corrections, ok confirmation, after-hours completion and immediate human handoff');

  for (const answer of ['sem financiamento', 'não vou financiar', 'pagamento à vista']) {
    const cashBuyer = conversation(completeBuyer);
    assert.match(await cashBuyer.receive(answer), /Está certo\?$/);
    assert.equal(cashBuyer.profile.financingIntent, 'Não', answer + ' must advance the payment step');
    assert.equal(await cashBuyer.receive('sim'), qualification.QUALIFICATION_COMPLETE_MESSAGE);
  }
  const corrected = conversation({ ...completeBuyer, financingIntent: 'Não' });
  assert.match(await corrected.receive('não está correto'), /deseja corrigir/);
  assert.match(await corrected.receive('bairros: Centro, Vila Rica e Jardim América'), /Centro, Vila Rica, Jardim América/);
  assert.deepEqual(corrected.profile.regions, ['Centro', 'Vila Rica', 'Jardim América']);
  assert.equal(corrected.profile.correctionRequested, false);
  const details = basic.basicPreferences('Quero comprar casa em Lavras, bairros: Centro, Vila Rica, até 600 mil, com três quartos', {});
  assert.deepEqual(plain(details.regions), ['Centro', 'Vila Rica']);
  assert.equal(details.budgetMax, 600000);
  assert.equal(details.bedrooms, 3);
  assert.deepEqual(plain(basic.basicPreferences('casa em Lavras, no bairro Centro, 3 quartos, até 600 mil', {}).regions), ['Centro']);
  assert.equal(basic.basicPreferences('sem financiamento?', completeBuyer).financingIntent, undefined);
  assert.equal(basic.basicPreferences('talvez sem financiamento', completeBuyer).financingIntent, undefined);
  const revisedPreferences = conversation({ ...completeBuyer, financingIntent: 'Não', preferencesRecorded: true, preferenceNotes: '3 quartos, quintal e acessibilidade; sem garagem' });
  const revisedSummary = await revisedPreferences.receive('Na verdade, quero 2 quartos e uma vaga');
  assert.match(revisedSummary, /2 quartos, quintal e acessibilidade; 1 vaga/);
  assert.doesNotMatch(revisedSummary, /3 quartos|sem garagem/);
  assert.equal(revisedPreferences.profile.bedrooms, 2);
  assert.equal(revisedPreferences.profile.parkingSpaces, 1);
  assert.equal(revisedPreferences.profile.preferenceNotes, '3 quartos, quintal e acessibilidade; sem garagem', 'original free-text information remains stored');
  console.log('PASS cash payment alternatives, summary rejection and multiple labeled neighborhoods');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
