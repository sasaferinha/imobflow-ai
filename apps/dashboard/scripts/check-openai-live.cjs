// Explicit smoke test using fictional input; never prints credentials or sends WhatsApp messages.
if (process.argv.includes('--if-requested') && process.env.IMOBFLOW_VERIFY_OPENAI !== '1') process.exit(0);
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mod = { exports: {} };
const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/ai/openai-provider.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(output, { exports: mod.exports, module: mod, process, fetch, AbortSignal, console });
(async () => {
  const provider = mod.exports.configuredAIProvider();
  if (!provider) { console.log('OPENAI_KEY_NOT_AVAILABLE'); process.exitCode = 1; return; }
  try {
    const result = await provider.extractLeadProfile({ message: 'Quero comprar uma casa em Lavras, no Centro, até 400 mil reais.', currentProfile: {} });
    const fields = result.data.extractedFields;
    if (fields.transactionType !== 'BUY' || fields.propertyType !== 'HOUSE' || fields.maxPrice !== 400000) throw new Error('unexpected_extraction');
    const mixed = await provider.extractLeadProfile({
      message: 'Está certo, agora preciso que você me diga onde é a Apólo Imóveis.',
      currentProfile: { transactionType: 'BUY', propertyType: 'HOUSE', city: 'Lavras', neighborhoods: ['Centro'], maxPrice: 400000 },
      recentMessages: [{ role: 'assistant', content: 'Você procura casa para comprar em Lavras, Centro, até R$ 400.000. Está certo?' }],
    });
    if (mixed.data.summaryDecision !== 'confirmed' || !mixed.data.requestsHumanHandoff || mixed.data.confidence < .85) throw new Error('unexpected_mixed_intent');
    console.log('PASS live OpenAI: mixed confirmation and unknown company address correctly routed to a broker.');
    console.log('PASS live OpenAI: authenticated, funded request and real profile extraction. No WhatsApp sent.');
  } catch (error) {
    const code = typeof error?.message === 'string' ? error.message : '';
    console.log(/^openai_\d+$/.test(code) ? code : 'OPENAI_TEST_FAILED');
    process.exitCode = 1;
  }
})();
