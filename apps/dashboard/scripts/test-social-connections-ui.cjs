const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === 'button' && (node.props['aria-label'] || text(node).trim().replace(/\s*↗$/, '')) === label);
const select = tree => find(find(tree, node => node.type === 'fieldset'), node => node.type === 'select');
const tick = () => new Promise(resolve => setImmediate(resolve));
const status = { available: true, webhookConfigured: true, authorized: true, accounts: [] };
const directStatus = { ...status, channels: { facebook: { available: true, webhookConfigured: true }, instagram: { available: true, webhookConfigured: true } } };
const page = { id: '123', name: 'Imobiliária de teste', instagramId: null, instagramName: null };
const fbAccount = { id: 'account-fb', channel: 'facebook', name: page.name, enabled: true, defaultMode: 'human' };
const igAccount = { id: 'account-ig', channel: 'instagram', name: 'teste', enabled: true, defaultMode: 'human' };
const response = (body, ok = true) => ({ ok, json: async () => body });

function harness(fetch, href = 'https://app.test/painel#settings') {
  const slots = [], redirects = [], effects = [];
  let cursor = 0, tree;
  const location = { href, assign: url => redirects.push(url) };
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] || (slots[i] = { current: initial }); },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = fn(); }); } },
  };
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'app/social-connections.tsx'), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, URL, fetch, window: { location, history: { state: {}, replaceState(_state, _title, next) { location.href = new URL(next, location.href).href; } } }, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw Error(`Unexpected dependency ${name}`);
  } });
  function render() { cursor = 0; tree = mod.exports.default(); effects.splice(0).forEach(effect => effect()); return tree; }
  render();
  return { render, redirects, location, get tree() { return tree; }, async settle() { await tick(); render(); await tick(); return render(); } };
}

(async () => {
  const requests = [];
  let pendingOAuth;
  const h = harness(async (url, options) => {
    const body = options.body && JSON.parse(options.body); requests.push({ url, body });
    if (body?.action === 'connect') return new Promise(resolve => { pendingOAuth = resolve; });
    return response(status);
  });
  h.tree.props.onToggle({ currentTarget: { open: true } }); await h.settle();
  assert.doesNotMatch(text(h.tree), /Atualizar estado|Escolher Página do Facebook|Escolher conta do Instagram|Reconectar/);
  assert.ok(button(h.tree, 'Conectar Facebook')); assert.ok(button(h.tree, 'Conectar Instagram'));
  button(h.tree, 'Conectar Facebook').props.onClick(); button(h.tree, 'Conectar Instagram').props.onClick(); h.render();
  assert.equal(requests.length, 2, 'one status read and one OAuth request; simultaneous clicks never replace the nonce');
  assert.deepEqual(requests[1].body, { action: 'connect', channel: 'facebook' });
  pendingOAuth(response({ url: 'https://www.facebook.com/v26.0/dialog/oauth?state=synthetic' })); await h.settle();
  assert.equal(h.redirects.length, 1);
  button(h.tree, 'Conectar Instagram').props.onClick();
  assert.deepEqual(requests.at(-1).body, { action: 'connect', channel: 'instagram' }, 'Facebook authorization does not skip Instagram consent');
  pendingOAuth(response({ url: 'https://attacker.invalid' })); await h.settle();
  assert.equal(h.redirects.length, 1); assert.match(text(h.tree), /Endereço de autorização inválido/);

  const selections = []; let current = { ...status, accounts: [fbAccount] };
  const chooser = harness(async (url, options) => {
    const body = options.body && JSON.parse(options.body); selections.push({ url, body });
    if (url.includes('action=pages')) return response({ ...current, pages: [{ ...page, instagramId: '456', instagramName: 'teste' }] });
    if (body?.action === 'select-page') current = { ...current, accounts: [fbAccount, igAccount] };
    if (body?.action === 'disconnect') current = { ...current, accounts: [fbAccount] };
    if (body?.action === 'connect') return response({ url: 'https://www.instagram.com/oauth/authorize?state=new' });
    return response(current);
  }, 'https://app.test/painel?area=settings&social=instagram#settings');
  await chooser.settle();
  assert.equal(chooser.tree.props.open, true, 'return opens the connection without another menu click');
  assert.ok(!chooser.location.href.includes('social='), 'resume hint is consumed without changing area/hash');
  assert.ok(chooser.location.href.endsWith('#settings'));
  assert.match(selections.at(-1).url, /action=pages&channel=instagram$/);
  assert.equal(selections.filter(r => r.body).length, 0, 'return never binds automatically');
  assert.equal(select(chooser.tree), undefined, 'one eligible account uses a short confirmation instead of an empty selector');
  assert.ok(button(chooser.tree, 'Concluir conexão do Instagram'));
  assert.equal(button(chooser.tree, 'Conectar Facebook'), undefined, 'connected card has no redundant connect action');
  assert.ok(button(chooser.tree, 'Desconectar Facebook'));
  button(chooser.tree, 'Concluir conexão do Instagram').props.onClick(); await chooser.settle();
  assert.deepEqual(selections.at(-1).body, { action: 'select-page', pageId: page.id, channels: ['instagram'] });
  assert.equal(find(chooser.tree, node => node.type === 'fieldset'), undefined);
  assert.ok(button(chooser.tree, 'Desconectar Instagram'));
  const mode = find(find(chooser.tree, node => node.type === 'label' && text(node).startsWith('Novos atendimentos')), node => node.type === 'select');
  mode.props.onChange({ target: { value: 'suggestions' } }); await chooser.settle();
  assert.deepEqual(selections.at(-1).body, { action: 'mode', channel: 'facebook', mode: 'suggestions' });
  button(chooser.tree, 'Desconectar Instagram').props.onClick(); chooser.render();
  assert.ok(find(chooser.tree, node => node.props?.role === 'group' && node.props['aria-label'] === 'Confirmar desconexão do Instagram'));
  button(chooser.tree, 'Confirmar desconexão').props.onClick(); await chooser.settle();
  assert.deepEqual(selections.at(-1).body, { action: 'disconnect', channel: 'instagram' });
  assert.ok(button(chooser.tree, 'Conectar Instagram'));
  assert.match(text(chooser.tree), /histórico anterior foi preservado/);
  button(chooser.tree, 'Conectar Instagram').props.onClick(); await chooser.settle();
  assert.equal(chooser.redirects.length, 1, 'disconnected channel can start a new account connection');

  const multiple = harness(async url => response({ ...status, ...(url.includes('action=pages') ? { pages: [page, { ...page, id: '456', name: 'Outra Página' }] } : {}) }), 'https://app.test/painel?social=facebook#settings');
  await multiple.settle();
  assert.equal(select(multiple.tree).props.value, '');
  assert.equal(button(multiple.tree, 'Concluir conexão do Facebook').props.disabled, true);
  select(multiple.tree).props.onChange({ target: { value: '456' } }); multiple.render();
  assert.equal(button(multiple.tree, 'Concluir conexão do Facebook').props.disabled, false);
  assert.equal(nodes(multiple.tree).filter(n => n.type === 'input' && n.props.type === 'checkbox').length, 0, 'cannot select multiple channels/accounts');

  const noInstagram = harness(async url => response({ ...status, ...(url.includes('action=pages') ? { pages: [page] } : {}) }), 'https://app.test/painel?social=instagram#settings');
  await noInstagram.settle();
  assert.match(text(noInstagram.tree), /Nenhuma conta profissional vinculada/);
  assert.equal(button(noInstagram.tree, 'Concluir conexão do Instagram'), undefined);
  assert.ok(button(noInstagram.tree, 'Autorizar Instagram novamente'));

  let failPages = true;
  const recovery = harness(async url => {
    if (url.includes('action=pages')) return failPages ? response({ error: 'Autorize o Instagram para escolher essa conta.' }, false) : response({ ...current, pages: [{ ...page, instagramId: '456', instagramName: 'teste' }] });
    return response(current);
  }, 'https://app.test/painel?social=instagram#settings');
  await recovery.settle();
  assert.match(text(recovery.tree), /Autorize o Instagram/);
  assert.ok(button(recovery.tree, 'Desconectar Facebook'), 'Instagram failure preserves Facebook card');
  assert.ok(button(recovery.tree, 'Conectar Instagram'), 'failed permission can restart consent');
  failPages = false; button(recovery.tree, 'Tentar novamente').props.onClick(); await recovery.settle();
  assert.ok(button(recovery.tree, 'Concluir conexão do Instagram'));

  const staleRequests = [];
  const stale = harness(async url => { staleRequests.push(url); return response({ ...status, accounts: [igAccount] }); }, 'https://app.test/painel?social=instagram#settings');
  await stale.settle();
  assert.equal(staleRequests.length, 1, 'a return completed in another tab only loads current status');
  assert.equal(button(stale.tree, 'Concluir conexão do Instagram'), undefined);
  assert.ok(button(stale.tree, 'Desconectar Instagram'));
  assert.match(text(stale.tree), /Instagram conectado/);

  const retryRequests = [];
  const retry = harness(async (url, options) => {
    const body = options.body && JSON.parse(options.body); retryRequests.push({ url, body });
    return body ? response({ error: 'Falha temporária na desconexão.' }, false) : response({ ...status, accounts: [igAccount] });
  }, 'https://app.test/painel?social=instagram#settings');
  await retry.settle();
  button(retry.tree, 'Desconectar Instagram').props.onClick(); retry.render();
  button(retry.tree, 'Confirmar desconexão').props.onClick(); await retry.settle();
  button(retry.tree, 'Tentar novamente').props.onClick(); await retry.settle();
  assert.equal(retryRequests.filter(r => r.url.includes('action=pages')).length, 0, 'a failed disconnect retries status instead of an old account picker');
  const nativeRequests = [];
  let nativeStatus = { ...directStatus, accounts: [fbAccount, igAccount] };
  const native = harness(async (url, options) => {
    const body = options.body && JSON.parse(options.body); nativeRequests.push({ url, body });
    assert(!url.includes('action=pages'), 'Direct Instagram authorization never lists Facebook Pages');
    if (body?.action === 'disconnect') nativeStatus = { ...nativeStatus, accounts: [fbAccount] };
    if (body?.action === 'connect') return response({ url: 'https://www.instagram.com/oauth/authorize?state=independent' });
    return response(nativeStatus);
  }, 'https://app.test/painel?social=instagram#settings');
  await native.settle();
  assert.equal(nativeRequests.length, 1, 'Native callback already binds the account: only read status');
  assert.equal(button(native.tree, 'Concluir conexão do Instagram'), undefined);
  assert.ok(button(native.tree, 'Desconectar Instagram')); assert.ok(button(native.tree, 'Desconectar Facebook'));
  assert.match(text(native.tree), /Conecte cada canal com a conta que preferir/);
  assert.match(text(native.tree), /Instagram conectado/);
  button(native.tree, 'Desconectar Instagram').props.onClick(); native.render();
  button(native.tree, 'Confirmar desconexão').props.onClick(); await native.settle();
  assert.deepEqual(nativeRequests.at(-1).body, { action: 'disconnect', channel: 'instagram' });
  assert.ok(button(native.tree, 'Desconectar Facebook'), 'Disconnecting Instagram preserves Facebook');
  button(native.tree, 'Conectar Instagram').props.onClick(); await native.settle();
  assert.deepEqual(nativeRequests.at(-1).body, { action: 'connect', channel: 'instagram' });
  assert.equal(native.redirects[0], 'https://www.instagram.com/oauth/authorize?state=independent');

  const unfinishedRequests = [];
  const unfinished = harness(async url => { unfinishedRequests.push(url); return response({ ...directStatus, accounts: [fbAccount] }); }, 'https://app.test/painel?social=instagram#settings');
  await unfinished.settle();
  assert.equal(unfinishedRequests.length, 1);
  assert.match(text(unfinished.tree), /Não foi possível concluir a conexão do Instagram/);
  assert.ok(button(unfinished.tree, 'Tentar conectar Instagram'));
  assert.ok(find(unfinished.tree, node => node.props?.role === 'alert'), 'unfinished connection is not styled as success');
  assert.equal(find(unfinished.tree, node => node.props?.role === 'status'), undefined);
  const instagramCard = find(unfinished.tree, node => node.props?.['aria-label'] === 'Conexão do Instagram');
  assert.doesNotMatch(text(instagramCard), /Vincule|Conta profissional vinculada|Concluir conexão/, 'Failed direct callback does not require a Facebook Page');
  const help = find(instagramCard, node => node.type === 'details' && node.props['aria-label'] === 'Como conectar o Instagram');
  assert.ok(help); assert.equal(help.props.open, undefined, 'connection help is optional and initially collapsed');
  assert.match(text(help), /profissional.*empresa ou criador/);
  assert.match(text(help), /Não precisa de uma Página do Facebook/);
  assert.match(text(help), /não informa senha ou código de acesso à ImobFlow/);
  assert.equal(nodes(instagramCard).filter(node => node.type === 'button').length, 1, 'one main action while disconnected');

  const unavailableRequests = [];
  const unavailable = harness(async (url, options) => {
    const body = options.body && JSON.parse(options.body); unavailableRequests.push({ url, body });
    return body ? response({ url: 'https://www.facebook.com/v26.0/dialog/oauth?state=still-works' }) : response({ ...directStatus, available: false, webhookConfigured: false, channels: { facebook: { available: true, webhookConfigured: true }, instagram: { available: false, webhookConfigured: false } } });
  });
  unavailable.tree.props.onToggle({ currentTarget: { open: true } }); await unavailable.settle();
  assert.equal(button(unavailable.tree, 'Conectar Instagram').props.disabled, true);
  assert.equal(button(unavailable.tree, 'Conectar Facebook').props.disabled, false, 'Missing Instagram credentials never disable Facebook');
  assert.match(text(unavailable.tree), /A ImobFlow precisa concluir a configuração do Instagram/);
  button(unavailable.tree, 'Conectar Instagram').props.onClick(); await unavailable.settle();
  assert.equal(unavailableRequests.length, 1, 'Unavailable channel cannot start authorization even through a stale click');
  button(unavailable.tree, 'Conectar Facebook').props.onClick(); await unavailable.settle(); assert.equal(unavailable.redirects.length, 1);

  const independent = harness(async (_url, options) => options.body ? response({ url: 'https://www.instagram.com/oauth/authorize?state=only-instagram' }) : response({ ...directStatus, available: false, channels: { facebook: { available: false, webhookConfigured: false }, instagram: { available: true, webhookConfigured: true } } }));
  independent.tree.props.onToggle({ currentTarget: { open: true } }); await independent.settle();
  assert.equal(button(independent.tree, 'Conectar Instagram').props.disabled, false); assert.equal(button(independent.tree, 'Conectar Facebook').props.disabled, true);
  assert.doesNotMatch(text(find(independent.tree, node => node.props?.['aria-label'] === 'Conexão do Instagram')), /precisa concluir|recebimento de mensagens/);
  assert.doesNotMatch(text(find(independent.tree, node => node.props?.['aria-label'] === 'Conexão do Facebook')), /recebimento de mensagens do Instagram/);
  button(independent.tree, 'Conectar Instagram').props.onClick(); await independent.settle(); assert.equal(independent.redirects.length, 1, 'Direct Instagram can connect without Facebook configuration');

  // Retrying a failed start must actually reopen the same provider's OAuth,
  // rather than reload status and strand the customer in an unrelated picker.
  for (const channel of ['instagram', 'facebook']) {
    const name = channel === 'instagram' ? 'Instagram' : 'Facebook';
    const other = channel === 'instagram' ? fbAccount : igAccount;
    const attempts = []; let completeRetry;
    const connectRetry = harness(async (_url, options) => {
      const body = options.body && JSON.parse(options.body); attempts.push(body || null);
      if (!body) return response({ ...directStatus, accounts: [other] });
      if (attempts.length === 2) return response({ error: 'Falha temporária ao abrir a autorização.' }, false);
      return new Promise(resolve => { completeRetry = resolve; });
    });
    connectRetry.tree.props.onToggle({ currentTarget: { open: true } }); await connectRetry.settle();
    button(connectRetry.tree, `Conectar ${name}`).props.onClick(); await connectRetry.settle();
    assert.ok(button(connectRetry.tree, `Tentar conectar ${name}`));
    assert.equal(button(connectRetry.tree, 'Tentar novamente'), undefined, 'the failed channel has one retry action');
    assert.ok(button(connectRetry.tree, `Desconectar ${channel === 'instagram' ? 'Facebook' : 'Instagram'}`), 'another channel remains connected');
    const retryButton = button(connectRetry.tree, `Tentar conectar ${name}`);
    retryButton.props.onClick(); retryButton.props.onClick(); connectRetry.render();
    assert.equal(attempts.length, 3, 'double retry never starts competing OAuth states');
    assert.deepEqual(attempts[2], { action: 'connect', channel }, 'retry repeats authorization instead of reading status or listing Pages');
    const oauthUrl = channel === 'instagram' ? 'https://www.instagram.com/oauth/authorize?state=retry' : 'https://www.facebook.com/v26.0/dialog/oauth?state=retry';
    completeRetry(response({ url: oauthUrl })); await connectRetry.settle();
    assert.deepEqual(connectRetry.redirects, [oauthUrl]);
  }

  for (const [channel, url] of [
    ['Instagram', 'https://www.facebook.com/v26.0/dialog/oauth?state=wrong-channel'],
    ['Facebook', 'https://www.instagram.com/oauth/authorize?state=wrong-channel'],
    ['Instagram', 'https://www.instagram.com/accounts/login'],
    ['Facebook', 'https://www.facebook.com/v25.0/dialog/oauth'],
    ['Instagram', 'https://www.instagram.com.attacker.test/oauth/authorize'],
    ['Instagram', 'http://www.instagram.com/oauth/authorize'],
    ['Facebook', 'https://name:pass@www.facebook.com/v26.0/dialog/oauth'],
    ['Instagram', 'https://www.instagram.com/oauth/authorize#untrusted'],
  ]) {
    const unsafe = harness(async (_url, options) => response(options.body ? { url } : directStatus));
    unsafe.tree.props.onToggle({ currentTarget: { open: true } }); await unsafe.settle();
    button(unsafe.tree, `Conectar ${channel}`).props.onClick(); await unsafe.settle();
    assert.equal(unsafe.redirects.length, 0, `${channel} rejects a wrong origin, channel or OAuth path`);
    assert.match(text(unsafe.tree), /Endereço de autorização inválido/);
  }
  const malformed = harness(async () => response({ ...directStatus, channels: { facebook: { available: true, webhookConfigured: true }, instagram: { available: 'true', webhookConfigured: true } } }));
  malformed.tree.props.onToggle({ currentTarget: { open: true } }); await malformed.settle();
  assert.match(text(malformed.tree), /Não foi possível conferir a conexão/); assert.equal(button(malformed.tree, 'Conectar Instagram'), undefined);
  const renewalRequests=[];
  const expired = harness(async (url, options) => {
    const body=options.body&&JSON.parse(options.body); renewalRequests.push({url,body});
    assert(!url.includes('action=pages'),'renewing native Instagram never opens a Facebook Page picker');
    return response(body ? {url:'https://www.instagram.com/oauth/authorize?state=renew'} : {...directStatus,accounts:[fbAccount,{...igAccount,reconnectRequired:true}]});
  },'https://app.test/painel?social=instagram#settings');
  await expired.settle();
  const expiredCard=find(expired.tree,node=>node.props?.['aria-label']==='Conexão do Instagram');
  assert.match(text(expiredCard),/Reconexão necessária/); assert.doesNotMatch(text(expiredCard),/Conectado/);
  assert.doesNotMatch(text(expired.tree),/Instagram conectado/,'callback hint cannot override expired server status');
  assert.ok(!nodes(expiredCard).some(node=>node.type==='span'&&String(node.props.className).split(' ').includes('connected')),'expired account has no green connected indicator');
  assert.ok(button(expired.tree,'Desconectar Instagram')); assert.ok(button(expired.tree,'Desconectar Facebook'));
  button(expired.tree,'Reconectar Instagram').props.onClick(); await expired.settle();
  assert.deepEqual(renewalRequests.at(-1).body,{action:'connect',channel:'instagram'});
  assert.equal(expired.redirects[0],'https://www.instagram.com/oauth/authorize?state=renew');
  assert(!renewalRequests.some(item=>item.body?.action==='disconnect'),'renewal preserves account identity and history');
  const disabledRenewal=harness(async()=>response({...directStatus,channels:{...directStatus.channels,instagram:{available:false,webhookConfigured:false}},accounts:[{...igAccount,reconnectRequired:true}]}));
  disabledRenewal.tree.props.onToggle({currentTarget:{open:true}}); await disabledRenewal.settle();
  assert.equal(button(disabledRenewal.tree,'Reconectar Instagram').props.disabled,true);
  assert.equal(button(disabledRenewal.tree,'Desconectar Instagram').props.disabled,false,'missing configuration never traps an expired connection');
  const renewed=harness(async()=>response({...directStatus,accounts:[{...igAccount,reconnectRequired:false}]}),'https://app.test/painel?social=instagram#settings');
  await renewed.settle(); assert.match(text(renewed.tree),/Instagram conectado/); assert.equal(button(renewed.tree,'Reconectar Instagram'),undefined);
  const malformedRenewal=harness(async()=>response({...directStatus,accounts:[{...igAccount,reconnectRequired:'false'}]}));
  malformedRenewal.tree.props.onToggle({currentTarget:{open:true}}); await malformedRenewal.settle();
  assert.match(text(malformedRenewal.tree),/Não foi possível conferir a conexão/);
  console.log('PASS social connection UI: independent per-channel capability/login/disconnect, direct Instagram callback without Facebook Page picker, strict channel-specific OAuth redirects, legacy callback recovery, one account per channel, preserved history/preferences and scoped retries. Mocked HTTP only.');
})().catch(error => { console.error(error); process.exit(1); });
