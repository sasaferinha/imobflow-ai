#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { checkSync, isOfficialRemote, main } = require('./check-sync.cjs');

function fixture(overrides = {}) {
  const state = {
    remote: 'https://github.com/sasaferinha/imobflow-ai.git\n',
    branch: 'main\n', head: `${'a'.repeat(40)}\n`, upstream: 'origin/main\n',
    status: '', counts: '0\t0\n', ...overrides,
  };
  const calls = [], messages = [];
  const runGit = (args) => {
    calls.push(args);
    if (args.includes('fetch')) {
      if (state.fetchError) throw state.fetchError;
      if (state.noOpenSsl && args.includes('http.sslBackend=openssl')) throw { stderr: "fatal: Unsupported SSL backend 'openssl'. Supported SSL backends: secure-transport" };
      return '';
    }
    const command = args.join(' ');
    switch (command) {
      case 'rev-parse --show-toplevel': if (state.noRepo) throw Error(); return '/project';
      case 'remote get-url --all origin': return state.remote;
      case 'remote get-url --push --all origin': return state.pushRemote || state.remote;
      case 'branch --show-current': return state.branch;
      case 'rev-parse --verify HEAD': return state.head;
      case 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': if (state.noUpstream) throw Error(); return state.upstream;
      case 'status --porcelain=v1 --untracked-files=all -z': return state.status;
      case 'rev-list --left-right --count HEAD...refs/remotes/origin/main': if (state.noMain) throw Error(); return state.counts;
      default: throw Error(`Unexpected Git command: ${command}`);
    }
  };
  const options = { runGit, write: (message) => messages.push(message) };
  const run = (extra = {}) => checkSync({ ...options, ...extra });
  return { run, options, calls, messages };
}

for (const remote of ['https://github.com/sasaferinha/imobflow-ai', 'git@github.com:sasaferinha/imobflow-ai.git', 'ssh://git@github.com/sasaferinha/imobflow-ai.git']) assert.equal(isOfficialRemote(remote), true);
for (const remote of ['https://github.com/other/imobflow-ai.git', 'https://github.com/sasaferinha/imobflow-ai-extra', 'https://github.com.evil.test/sasaferinha/imobflow-ai.git', 'https://secret@github.com/sasaferinha/imobflow-ai.git', 'http://github.com/sasaferinha/imobflow-ai.git', 'file:///tmp/imobflow-ai']) assert.equal(isOfficialRemote(remote), false);

const clean = fixture();
assert.equal(clean.run(), 0);
assert.equal(clean.calls.filter((args) => args.includes('fetch')).length, 1);
assert.deepEqual(clean.calls.find((args) => args.includes('fetch')), ['-c', 'http.sslBackend=openssl', '-c', 'http.sslVerify=true', 'fetch', '--no-tags', '--recurse-submodules=no', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
assert.match(clean.messages.join('\n'), /ALINHADO/);

for (const [changes, expected] of [
  [{ status: ' M tracked-file\0' }, /alterações locais/],
  [{ status: '?? new-file\0' }, /não rastreados/],
  [{ status: 'A  new-staged-file\0' }, /alterações locais/],
  [{ status: 'R  renamed-file\0old-file\0' }, /alterações locais/],
  [{ counts: '0 3' }, /atrasado/],
  [{ counts: '2 0' }, /ainda não enviados/],
  [{ counts: '2 3' }, /divergiram/],
  [{ branch: 'codex/feature' }, /não está na branch main/],
  [{ branch: '' }, /HEAD separado/],
  [{ noUpstream: true }, /não acompanha origin\/main/],
  [{ upstream: 'other/main' }, /não acompanha origin\/main/],
  [{ noMain: true }, /Não foi possível comparar/],
  [{ counts: 'bad-data' }, /Não foi possível comparar/],
  [{ noRepo: true }, /Não foi possível identificar/],
]) {
  const test = fixture(changes);
  assert.equal(test.run(), 1, JSON.stringify(changes));
  assert.match(test.messages.join('\n'), expected);
  assert.equal(test.calls.some((args) => args.some((arg) => ['pull', 'push', 'reset', 'stash', 'commit', 'checkout', 'switch', 'merge'].includes(arg))), false);
}

for (const remote of ['https://github.com/other/repo.git', 'https://do-not-print-me@github.com/sasaferinha/imobflow-ai.git', 'https://github.com/sasaferinha/imobflow-ai.git\nhttps://github.com/other/repo.git']) {
  const invalid = fixture({ remote });
  assert.equal(invalid.run(), 1);
  assert.equal(invalid.calls.some((args) => args.includes('fetch')), false);
  assert.doesNotMatch(invalid.messages.join('\n'), /do-not-print-me/);
}

const offline = fixture();
assert.equal(offline.run({ offline: true }), 0);
assert.equal(offline.calls.some((args) => args.includes('fetch')), false);
assert.match(offline.messages.join('\n'), /referências locais podem estar desatualizadas/);
assert.match(offline.messages.join('\n'), /NÃO foi confirmada online/);

const foreignPush = fixture({ pushRemote: 'https://github.com/other/repo.git' });
assert.equal(foreignPush.run(), 1);
assert.equal(foreignPush.calls.some((args) => args.includes('fetch')), false);

const unsupported = fixture({ noOpenSsl: true });
assert.equal(unsupported.run(), 0);
assert.equal(unsupported.calls.filter((args) => args.includes('fetch')).length, 2);
assert.ok(unsupported.calls.filter((args) => args.includes('fetch')).every((args) => args.includes('http.sslVerify=true')));

for (const detail of ['certificate verify failed secret-do-not-print', 'Authentication failed secret-do-not-print', 'network timeout secret-do-not-print']) {
  const failure = fixture({ fetchError: { stderr: detail } });
  assert.equal(failure.run(), 1);
  assert.equal(failure.calls.filter((args) => args.includes('fetch')).length, 1);
  assert.doesNotMatch(failure.messages.join('\n'), /secret-do-not-print/);
}

const help = fixture();
assert.equal(main(['--help'], help.options), 0);
assert.equal(help.calls.length, 0);
assert.equal(main(['--force'], help.options), 2);
assert.equal(help.calls.length, 0);
const offlineCli = fixture();
assert.equal(main(['--offline'], offlineCli.options), 0);
assert.equal(offlineCli.calls.some((args) => args.includes('fetch')), false);

console.log('PASS sync guard: official origin, TLS, clean/dirty/untracked, ahead/behind/diverged, branch/upstream, offline and sanitized errors.');
console.log('Tests use isolated mocks: no network calls, repository changes, uploads or deployments.');
