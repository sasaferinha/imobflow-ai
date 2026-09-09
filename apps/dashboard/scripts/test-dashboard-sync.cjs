const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const windowEvents = new EventTarget();
const documentEvents = new EventTarget();
const timers = new Map();
let timerId = 0;
const channels = [];
class BroadcastChannel {
  constructor() { channels.push(this); }
  postMessage(data) { for (const channel of channels) if (channel !== this && !channel.closed) channel.onmessage?.({data}); }
  close() { this.closed = true; }
}
const browser = Object.assign(windowEvents, { BroadcastChannel, setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id) });
const doc = Object.assign(documentEvents, { visibilityState:'visible' });
const moduleExports = { exports:{} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/dashboard-sync.ts'),'utf8'), {
  compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 }
}).outputText, { exports:moduleExports.exports,module:moduleExports,window:browser,document:doc,BroadcastChannel,CustomEvent,AbortController });
const { subscribeDashboardSync, announceDashboardChange } = moduleExports.exports;
const flush = () => new Promise(resolve => setImmediate(resolve));
const tick = () => { for(const fn of timers.values()) fn(); };
(async () => {
  const loads = [], applied = [];
  const stop = subscribeDashboardSync({ entities:['conversations'], load: signal => new Promise((resolve,reject) => loads.push({resolve,reject,signal})), apply:value => applied.push(value) });
  assert.equal(loads.length,1);
  tick(); tick();
  assert.equal(loads.length,1,'slow reads must not overlap or restart forever');
  loads[0].resolve('first'); await flush();
  assert.deepEqual(applied,['first']);
  tick();
  announceDashboardChange('conversations');
  loads[1].resolve('stale-before-write'); await flush();
  assert.deepEqual(applied,['first'],'discard read started before write notification');
  assert.equal(loads.length,3,'refresh queued while prior read runs');
  loads[2].resolve('broker assigned'); await flush();
  assert.deepEqual(applied,['first','broker assigned']);
  doc.visibilityState='hidden'; tick(); assert.equal(loads.length,3);
  doc.visibilityState='visible'; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(loads.length,4,'switching to other tab refreshes');
  stop(); assert.ok(loads[3].signal.aborted);
  loads[3].resolve('unmounted'); await flush();
  assert.equal(applied.length,2);
  tick(); assert.equal(loads.length,4);
  console.log('PASS serialized polling, stale read rejection, focus refresh, cancellation and cleanup');

  let reads=0; const values=[];
  const unsub=subscribeDashboardSync({entities:['demo-conversations'], load:async()=>++reads,apply:value=>values.push(value)});
  await flush();
  const otherTab = new BroadcastChannel(); otherTab.postMessage({entity:'demo-conversations'});
  await flush(); assert.equal(values.length,2,'another account tab invalidates and refetches server state');
  unsub(); otherTab.close();
  console.log('PASS cross-tab notifications reload server data without broadcasting customer data');
})().catch(error => { console.error(error); process.exitCode=1; });
