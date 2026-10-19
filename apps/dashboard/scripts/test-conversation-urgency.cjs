// Synthetic, read-only fixtures. No customer data, provider, database or real notification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, require: name => {
    if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`);
  }, Date, Set, Map, AbortController, console, ...globals });
  return mod.exports;
}
const helper = load('lib/conversation-urgency.ts');
const intake = Date.parse('2026-10-19T12:00:00Z');
const iso = offset => new Date(intake + offset).toISOString();
const duty = { dutyPriorityUntil: iso(300000), dutyPreferred: true };
const dutyAt = helper.urgentAlertEligibleAt(duty, iso(0));
assert.equal(dutyAt, intake + 120000);
assert.equal(dutyAt <= intake + 119999, false, 'Duty: before 2 minutes no alarm');
assert.equal(dutyAt <= intake + 120000, true, 'Duty: exact 2-minute boundary');
const generalAt = helper.urgentAlertEligibleAt({ ...duty, dutyPreferred: false }, iso(0));
assert.equal(generalAt <= intake + 299999, false, 'Others: before 5 minutes no alarm');
assert.equal(generalAt <= intake + 300000, true, 'Others: exact 5-minute boundary');
assert.equal(helper.urgentAlertEligibleAt({}, iso(0)), intake + 300000, 'No confirmed duty preference: five-minute fallback');
assert.equal(helper.urgentAlertEligibleAt(duty, 'bad'), null);
assert.equal(helper.urgentAlertEligibleAt({ dutyPriorityUntil: 'bad', dutyPreferred: true }, iso(0)), null);
// The full first-incoming timestamp comes from SQL. No UI message/read/bot state can replace it.
assert.equal(helper.urgentAlertEligibleAt(duty, iso(0)), dutyAt, 'First arrival remains stable through bot activity and repeated messages');
assert.equal(helper.urgentAlertEligibleAt({ dutyPriorityUntil: iso(300000), dutyPreferred: true }, iso(110000)), intake + 230000, 'A new waiting cycle gets its own minimum delay');
assert.equal(helper.urgentAlertEligibleAt({ dutyPriorityUntil: iso(300000), dutyPreferred: true }, iso(900000)), intake + 1200000, 'Expired roster cannot grant a later cycle early preference');
assert.equal(helper.urgentAlertEligibleAt({ dutyPriorityUntil: iso(900000), dutyPreferred: true }, iso(0)), intake + 120000, 'A duty reservation assigned late does not restart the first-arrival clock');
assert.equal(helper.urgentAlertEligibleAt({ dutyPriorityUntil: iso(900000), dutyPreferred: false }, iso(0)), intake + 300000, 'Others become eligible five minutes after arrival even if the reservation was recorded late');
assert.equal(helper.urgentConversationCandidates, undefined, 'No legacy paginated-message inference remains');
console.log('PASS urgency eligibility: first-arrival 2/5-minute boundaries, conservative roster guards and no message-sample inference.');

const queueInput = { snapshot: { actorId: 'broker-a', fetchedAt: intake + 120000, activeUntil: intake + 145500, data: [{ leadId: 'lead-a', waitingSince: iso(0) }] },
  visibleLeadIds: new Set(['lead-a']), currentBrokerId: 'broker-a', ready: true, demonstration: false, now: intake + 120000 };
assert.equal(helper.visibleUrgentQueue(queueInput).length, 1);
for (const changes of [{ ready: false }, { demonstration: true }, { currentBrokerId: 'broker-b' }, { visibleLeadIds: new Set() },
  { now: intake + 150001 }, { now: intake + 119999 }]) assert.equal(helper.visibleUrgentQueue({ ...queueInput, ...changes }).length, 0);
assert.equal(helper.visibleUrgentQueue({ ...queueInput, now: intake + 145499 }).length, 1, 'Still open just before server boundary');
assert.equal(helper.visibleUrgentQueue({ ...queueInput, now: intake + 145500 }).length, 0, 'Closes exactly at boundary, before 30-second snapshot expiry');
for (const activeUntil of [null, undefined, '2026-10-19T12:03:00Z', NaN, Infinity, intake + 120000]) {
  assert.equal(helper.visibleUrgentQueue({ ...queueInput, snapshot: { ...queueInput.snapshot, activeUntil } }).length, 0, 'Closed/missing/invalid business-hours metadata fails closed');
}
assert.equal(helper.visibleUrgentQueue({ ...queueInput, snapshot: { ...queueInput.snapshot,
  data: [...queueInput.snapshot.data, ...queueInput.snapshot.data, { leadId: 'foreign', waitingSince: iso(0) }, null,
    { leadId: 'lead-a', waitingSince: 'not-a-date' }] } }).length, 1, 'Server queue is narrowed to visible account scope and deduplicated');

const jsx = (type, props) => ({ type, props: props || {} });
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)] : [];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join(' ') : '';
function harness({ demo = false, ready = true } = {}) {
  let now = intake + 120000, index = 0, subscription, stopped = false;
  const slots = [], effects = [], requests = [], opened = [], timers = new Map();
  const win = new EventTarget(), doc = new EventTarget(), navigator = { onLine: true };
  Object.assign(doc, { visibilityState: 'visible' });
  Object.assign(win, { setInterval: (fn, ms) => { const id = Symbol(); timers.set(id, { fn, ms }); return id; }, clearInterval: id => timers.delete(id),
    setTimeout: (fn, ms) => { const id = Symbol(); timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) });
  const confirmed = { data: [{ leadId: 'lead-a', waitingSince: iso(0) }], activeUntil: intake + 500000 };
  const React = {
    useState(initial) { const n = index++; if (!(n in slots)) slots[n] = { value: initial }; return [slots[n].value, value => { slots[n].value = value; }]; },
    useEffect(fn, dependencies) { const n = index++, previous = slots[n]; if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) effects.push(() => {
      previous?.cleanup?.(); slots[n] = { dependencies, cleanup: fn() };
    }); },
  };
  class Clock extends Date { static now() { return now; } }
  const Component = load('app/conversation-urgent-alert.tsx', {
    react: React, 'react/jsx-runtime': { jsx, jsxs: jsx }, './conversation-urgent-alert.module.css': new Proxy({}, { get: (_, name) => String(name) }),
    '@/lib/conversation-urgency': helper,
    '@/lib/dashboard-transport': { isProductDemo: () => demo, dashboardFetch: async (url, options) => {
      requests.push({ url, options });
      assert.equal(url, '/api/conversations/urgent', 'One authoritative server queue, no paginated history inference');
      return { ok: true, json: async () => ({ data: confirmed.data, fetchedAt: now, activeUntil: confirmed.activeUntil }) };
    } },
    '@/lib/dashboard-sync': { subscribeDashboardSync: options => { subscription = options; return () => { stopped = true; }; } },
  }, { window: win, document: doc, navigator, Date: Clock }).default;
  const props = { currentBrokerId: 'broker-a', visibleLeadIds: ['lead-a'], ready, onOpen: id => opened.push(id) };
  const render = () => { index = 0; const tree = Component(props); while (effects.length) effects.shift()(); return tree; };
  render();
  return { render, requests, opened, confirmed, props, doc, win, navigator, timers,
    get subscription() { return subscription; }, get stopped() { return stopped; },
    tick(value) { now = value; for (const timer of timers.values()) if (timer.ms === 1000) timer.fn(); },
    fireTimeout(value, delay) { now = value; for (const [id, timer] of timers) if (timer.ms === delay) { timers.delete(id); timer.fn(); } },
    async refresh() { subscription.apply(await subscription.load(new AbortController().signal)); return render(); },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
  };
}
(async () => {
  const ui = harness();
  assert.equal(nodes(ui.render()).some(node => node.type === 'button'), false, 'No unverified initial alarm');
  let tree = await ui.refresh();
  assert.equal(ui.requests.length, 1);
  assert.ok(ui.requests.every(request => !request.options.method && request.options.cache === 'no-store'), 'Only GET reads, no sends/claim/read acknowledgement');
  const button = nodes(tree).find(node => node.type === 'button'); assert(button); button.props.onClick();
  assert.deepEqual(ui.opened, ['lead-a']); assert.equal(ui.requests.length, 1, 'Opening delegates selection only');
  assert.match(text(tree), /CLIENTE ESTÁ SOZINHO E PRECISA SER ATENDIDO/);
  assert.match(text(tree), /aguardando aceite humano, mesmo que a IA esteja atendendo/);
  assert.doesNotMatch(text(tree), /aguardando resposta/);
  const firstAnnouncement = text(nodes(tree).find(node => node.props.role === 'alert'));
  ui.tick(intake + 121000); tree = ui.render();
  assert.equal(text(nodes(tree).find(node => node.props.role === 'alert')), firstAnnouncement, 'Stable alert text on clock ticks');
  const change = new Event('imobflow_data_changed'); change.detail = { entity: 'conversations' }; ui.win.dispatchEvent(change);
  assert.equal(nodes(ui.render()).some(node => node.type === 'section'), false, 'Known local claim/message changes invalidate snapshot before fetch finishes');
  await ui.refresh();
  ui.tick(intake + 151001); assert.equal(nodes(ui.render()).some(node => node.type === 'section'), false, 'Stale snapshot expires without a new response');
  await ui.refresh(); ui.confirmed.data = []; tree = await ui.refresh();
  assert.equal(nodes(tree).some(node => node.type === 'section'), false, 'Claim by another broker removes alarm on refreshed source');
  ui.confirmed.data = [{ leadId: 'lead-a', waitingSince: iso(0) }]; await ui.refresh();
  ui.subscription.onError(new Error('503 schema unavailable'));
  assert.equal(nodes(ui.render()).some(node => node.type === 'section'), false, 'No stale fallback when urgent endpoint fails');
  await ui.refresh();
  ui.doc.visibilityState = 'hidden'; ui.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(nodes(ui.render()).some(node => node.type === 'section'), false);
  ui.doc.visibilityState = 'visible'; ui.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(nodes(ui.render()).some(node => node.type === 'section'), false, 'Returning to tab waits for fresh source');
  await ui.refresh(); ui.navigator.onLine = false; ui.win.dispatchEvent(new Event('offline'));
  assert.equal(nodes(ui.render()).some(node => node.type === 'section'), false, 'Offline does not assert abandonment from cache');
  await assert.rejects(() => ui.subscription.load(new AbortController().signal), /offline/);
  ui.unmount(); assert(ui.stopped); assert.equal(ui.timers.size, 0);
  const closing = harness(); closing.confirmed.activeUntil = intake + 120250;
  assert.ok(nodes(await closing.refresh()).some(node => node.type === 'section'));
  closing.fireTimeout(intake + 120250, 250);
  assert.equal(nodes(closing.render()).some(node => node.type === 'section'), false, 'Closing timeout removes banner without the one-second tick or a new request');
  assert.equal(closing.requests.length, 1);
  closing.confirmed.activeUntil = null;
  assert.equal(nodes(await closing.refresh()).some(node => node.type === 'section'), false, 'Closed server queue remains hidden even if it contains an old item');
  for (const invalid of [undefined, 'bad', Infinity]) {
    closing.confirmed.activeUntil = invalid;
    await assert.rejects(() => closing.subscription.load(new AbortController().signal), /urgent_snapshot_invalid/);
  }
  closing.unmount(); assert.equal(closing.timers.size, 0);
  for (const options of [{ demo: true }, { ready: false }]) {
    const blocked = harness(options); assert.equal(blocked.subscription, undefined); assert.equal(blocked.requests.length, 0); blocked.unmount();
  }
  const css = fs.readFileSync(path.join(root, 'app/conversation-urgent-alert.module.css'), 'utf8');
  assert.doesNotMatch(css, /animation\s*:|position:\s*fixed/, 'No flashing or obstructive overlay');
  assert.match(css, /min-height:\s*44px/);
  console.log('PASS urgent banner: bounded read-only snapshot, exact business-hours expiry, visibility/offline/stale/demo guards, stable announcement, selection-only CTA and cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
