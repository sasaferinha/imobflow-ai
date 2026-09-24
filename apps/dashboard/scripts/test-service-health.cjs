const assert = require('node:assert/strict');
const { check } = require('./check-service-health.cjs');
const ok = () => ({ status: 200, json: async () => ({ configured: true, connected: true }) });
(async () => {
  assert.equal((await check(async () => ok())).healthy, true);
  for (const kind of ['http', 'timeout', 'invalid', 'disconnected']) {
    let calls = 0;
    const result = await check(async url => {
      if (!url.endsWith('/api/health/supabase')) return ok();
      calls++;
      if (kind === 'timeout') throw Error('timeout');
      if (kind === 'http') return { status: 503 };
      if (kind === 'invalid') return { status: 200, json: async () => { throw Error('invalid JSON'); } };
      return { status: 200, json: async () => ({ configured: true, connected: false }) };
    });
    assert.deepEqual(result.failures, ['/api/health/supabase']); assert.equal(calls, 2);
  }
  let calls = 0;
  assert.equal((await check(async () => ++calls === 1 ? { status: 503 } : ok())).healthy, true);
  console.log('PASS health detection: HTTP failure, timeout, invalid response, disconnected database, bounded confirmation and recovery');
})().catch(e => { console.error(e); process.exitCode = 1; });
