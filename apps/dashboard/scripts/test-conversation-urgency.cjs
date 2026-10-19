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
const inboxHelpers = load('lib/conversation-inbox.ts');
const helper = load('lib/conversation-urgency.ts', { './conversation-inbox': inboxHelpers });
const intake = Date.parse('2026-10-19T12:00:00Z');
const iso = offset => new Date(intake + offset).toISOString();
const fixture = (elapsed = 120000, preferred = true) => ({
  actorId: 'broker-a', fetchedAt: intake + elapsed,
  leads: [{ id: 'lead-a', assignedTo: null, lifecycleStatus: 'Novo' }],
  attendance: [{ leadId: 'lead-a', assignedTo: null, assignedBrokerId: null, attendanceMode: 'paused' }],
  messages: [{ id: 'incoming-a', leadId: 'lead-a', side: 'incoming', createdAt: iso(0) }],
  inbox: [{ conversationId: 'conversation-a', leadId: 'lead-a', lastMessageId: 'incoming-a', lastMessageAt: iso(0), incomingCount: 1, unread: 0,
    dutyPriorityUntil: iso(300000), dutyPreferred: preferred }],
});
function pending(snapshot, overrides = {}) {
  return helper.urgentConversationCandidates({ snapshot, currentBrokerId: 'broker-a', visibleLeadIds: new Set(['lead-a']),
    ready: true, demonstration: false, now: snapshot.fetchedAt, ...overrides });
}
assert.equal(pending(fixture(119999)).length, 0, 'Duty: before 2 minutes no alarm');
assert.equal(pending(fixture(120000)).length, 1, 'Duty: exact 2-minute boundary');
assert.equal(pending(fixture(299999, false)).length, 0, 'Others: respect first five minutes');
assert.equal(pending(fixture(300000, false)).length, 1, 'Others: exact 5-minute boundary');
assert.equal(pending(fixture(300000, false))[0].leadId, 'lead-a', 'Read message without response remains pending');
for (const changes of [{ assignedTo: 'Other broker' }, { assignedBrokerId: 'broker-b' }, { assignedTo: 'Current broker', assignedBrokerId: 'broker-a' },
  { attendanceMode: 'closed' }, { attendanceMode: 'unknown' }, { assignedBrokerId: undefined }]) {
  const item = fixture(); Object.assign(item.attendance[0], changes);
  assert.equal(pending(item).length, 0, JSON.stringify(changes));
}
for (const changes of [{ assignedTo: 'Lead owner' }, { lifecycleStatus: 'Convertido' }, { lifecycleStatus: 'Perdido' }]) {
  const item = fixture(); Object.assign(item.leads[0], changes); assert.equal(pending(item).length, 0);
}
for (const overrides of [{ ready: false }, { demonstration: true }, { currentBrokerId: undefined }, { currentBrokerId: 'other-account' },
  { visibleLeadIds: new Set() }, { now: intake + 150001 }, { now: intake - 1 }]) assert.equal(pending(fixture(), overrides).length, 0);
for (const modify of [item => { item.attendance = []; }, item => { item.messages = []; }, item => { item.messages[0].side = 'outgoing'; },
  item => { item.messages[0].leadId = 'foreign'; }, item => { item.inbox[0].lastMessageId = 'not-hydrated'; },
  item => { item.inbox[0].dutyPriorityUntil = 'bad'; }, item => { item.inbox[0].lastMessageAt = 'bad'; },
  item => { item.inbox[0].incomingCount = 0; }, item => { item.inbox[0].lastMessageAt = iso(999999); }]) {
  const item = fixture(); modify(item); assert.equal(pending(item).length, 0);
}
const duplicateChannels = fixture(); duplicateChannels.attendance.push({ ...duplicateChannels.attendance[0], assignedBrokerId: 'other-broker' });
assert.equal(pending(duplicateChannels).length, 0, 'Conflicting channel ownership suppresses urgent claim prompt');
const automatic = fixture(); automatic.attendance[0].attendanceMode = 'automatic';
assert.equal(pending(automatic).length, 1, 'Automatic bot without a reply after the waiting window still needs human attention');
automatic.messages[0].side = 'outgoing'; assert.equal(pending(automatic).length, 0, 'Bot reply suppresses the warning');
const repeated = fixture(120000);
repeated.messages.push({ id: 'incoming-b', leadId: 'lead-a', side: 'incoming', createdAt: iso(110000) });
Object.assign(repeated.inbox[0], { lastMessageId: 'incoming-b', lastMessageAt: iso(110000), incomingCount: 2 });
assert.equal(pending(repeated).length, 1, 'Additional incoming does not reset server intake clock');
assert.equal(pending(repeated)[0].waitingSince, iso(0));
const noDuty = fixture(299999); delete noDuty.inbox[0].dutyPriorityUntil;
assert.equal(pending(noDuty).length, 0);
noDuty.fetchedAt = intake + 300000; assert.equal(pending(noDuty).length, 1, 'Missing roster: conservative five-minute fallback');
const reply = fixture(450000); delete reply.inbox[0].dutyPriorityUntil;
reply.messages = [reply.messages[0], { id: 'reply', leadId: 'lead-a', side: 'outgoing', createdAt: iso(200000) },
  { id: 'new-incoming', leadId: 'lead-a', side: 'incoming', createdAt: iso(400000) }];
Object.assign(reply.inbox[0], { lastMessageId: 'new-incoming', lastMessageAt: iso(400000) });
assert.equal(pending(reply).length, 0, 'Already answered sequence does not age a newer pending request');
assert.equal(helper.urgentAlertEligibleAt({ dutyPriorityUntil: iso(300000), dutyPreferred: true }, iso(110000)), intake + 230000, 'A new waiting cycle gets its own minimum delay');
assert.equal(helper.urgentAlertEligibleAt({ dutyPriorityUntil: iso(300000), dutyPreferred: true }, iso(900000)), intake + 1200000, 'Expired roster cannot grant a later cycle early preference');
console.log('PASS urgency eligibility: 2/5-minute boundaries, ownership/tenant-visible scope, repeated messages, read-without-reply, closed/bot/unknown guards and snapshot expiry.');

const queueInput = { snapshot: { actorId: 'broker-a', fetchedAt: intake + 120000, data: [{ leadId: 'lead-a', waitingSince: iso(0) }] },
  visibleLeadIds: new Set(['lead-a']), currentBrokerId: 'broker-a', ready: true, demonstration: false, now: intake + 120000 };
assert.equal(helper.visibleUrgentQueue(queueInput).length, 1);
for (const changes of [{ ready: false }, { demonstration: true }, { currentBrokerId: 'broker-b' }, { visibleLeadIds: new Set() },
  { now: intake + 150001 }, { now: intake + 119999 }]) assert.equal(helper.visibleUrgentQueue({ ...queueInput, ...changes }).length, 0);
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
  const current = fixture();
  const confirmed = { data: [{ leadId: 'lead-a', waitingSince: iso(0) }] };
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
      return { ok: true, json: async () => ({ data: confirmed.data, fetchedAt: now }) };
    } },
    '@/lib/dashboard-sync': { subscribeDashboardSync: options => { subscription = options; return () => { stopped = true; }; } },
  }, { window: win, document: doc, navigator, Date: Clock }).default;
  const props = { currentBrokerId: 'broker-a', visibleLeadIds: ['lead-a'], ready, onOpen: id => opened.push(id) };
  const render = () => { index = 0; const tree = Component(props); while (effects.length) effects.shift()(); return tree; };
  render();
  return { render, requests, opened, current, confirmed, props, doc, win, navigator, timers,
    get subscription() { return subscription; }, get stopped() { return stopped; },
    tick(value) { now = value; for (const timer of timers.values()) if (timer.ms === 1000) timer.fn(); },
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
  for (const options of [{ demo: true }, { ready: false }]) {
    const blocked = harness(options); assert.equal(blocked.subscription, undefined); assert.equal(blocked.requests.length, 0); blocked.unmount();
  }
  const css = fs.readFileSync(path.join(root, 'app/conversation-urgent-alert.module.css'), 'utf8');
  assert.doesNotMatch(css, /animation\s*:|position:\s*fixed/, 'No flashing or obstructive overlay');
  assert.match(css, /min-height:\s*44px/);
  console.log('PASS urgent banner: bounded read-only snapshot, visibility/offline/stale/demo guards, accessible unchanged announcement, selection-only CTA and cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
