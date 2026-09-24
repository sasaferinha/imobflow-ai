const checks = [
  ['/', null], ['/painel', null],
  ['/api/health/supabase', b => b.configured === true && b.connected === true],
  ['/api/health/email', b => b.configured === true],
];
async function check(fetcher = fetch) {
  const failures = [];
  for (const [path, validate] of checks) {
    let healthy = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetcher('https://www.imobflow.net.br' + path, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
        healthy = response.status === 200 && (!validate || validate(await response.json()));
      } catch { healthy = false; }
      if (healthy) break;
    }
    if (!healthy) failures.push(path);
  }
  return { healthy: failures.length === 0, failures };
}
module.exports = { check };
if (require.main === module) check().then(result => {
  console.log(JSON.stringify(result)); process.exitCode = result.healthy ? 0 : 1;
}).catch(() => { console.error('health_check_failed'); process.exitCode = 1; });
