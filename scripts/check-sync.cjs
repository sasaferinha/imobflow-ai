#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const OFFICIAL_REPOSITORY = 'sasaferinha/imobflow-ai';
const DEFAULT_ROOT = path.resolve(__dirname, '..');

function isOfficialRemote(value) {
  const remote = value.trim();
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)sasaferinha\/imobflow-ai(?:\.git)?\/?$/i.test(remote);
}

function defaultGit(root) {
  return (args) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
  });
}

function unsupportedOpenSsl(error) {
  // Some macOS Git builds only include Secure Transport. Do not retry any
  // authentication, TLS verification, network, or repository error.
  const stderr = String(error?.stderr || '');
  return /unsupported SSL backend[^\r\n]*openssl/i.test(stderr);
}

function checkSync({ root = DEFAULT_ROOT, runGit = defaultGit(root), offline = false, write = console.log } = {}) {
  const say = (message) => write(message);
  const fail = (message) => {
    say(`BLOQUEADO: ${message}`);
    say('Nenhum arquivo foi sobrescrito; nenhum commit, push ou deploy foi realizado.');
    return 1;
  };

  let remotes, pushRemotes;
  try {
    runGit(['rev-parse', '--show-toplevel']);
    remotes = runGit(['remote', 'get-url', '--all', 'origin']).trim().split(/\r?\n/);
    pushRemotes = runGit(['remote', 'get-url', '--push', '--all', 'origin']).trim().split(/\r?\n/);
  } catch {
    return fail('Não foi possível identificar o repositório Git e seu origin.');
  }
  if (remotes.length !== 1 || !isOfficialRemote(remotes[0]) || pushRemotes.length !== 1 || !isOfficialRemote(pushRemotes[0])) {
    return fail(`O origin não corresponde ao repositório oficial ${OFFICIAL_REPOSITORY}. Confira a configuração antes de continuar.`);
  }

  if (offline) {
    say('AVISO: modo offline. As referências locais podem estar desatualizadas; o GitHub não será consultado.');
  } else {
    say(`Consultando main no GitHub (${OFFICIAL_REPOSITORY})…`);
    const fetchArgs = ['fetch', '--no-tags', '--recurse-submodules=no', 'origin', 'refs/heads/main:refs/remotes/origin/main'];
    try {
      runGit(['-c', 'http.sslBackend=openssl', '-c', 'http.sslVerify=true', ...fetchArgs]);
    } catch (error) {
      if (!unsupportedOpenSsl(error)) {
        return fail('Não foi possível consultar o GitHub. Verifique rede e autenticação; não foi possível confirmar a sincronização.');
      }
      say('Este Git não oferece OpenSSL. Consultando com o backend TLS padrão, mantendo a validação de certificados.');
      try {
        runGit(['-c', 'http.sslVerify=true', ...fetchArgs]);
      } catch {
        return fail('Não foi possível consultar o GitHub com o TLS padrão. A sincronização não foi confirmada.');
      }
    }
  }

  let branch, head, upstream, status, ahead, behind;
  try {
    branch = runGit(['branch', '--show-current']).trim();
    head = runGit(['rev-parse', '--verify', 'HEAD']).trim();
    if (!/^[a-f0-9]{40,64}$/i.test(head)) throw new Error('invalid_head');
    try {
      upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).trim();
    } catch {
      upstream = '';
    }
    status = runGit(['status', '--porcelain=v1', '--untracked-files=all', '-z']);
    const counts = runGit(['rev-list', '--left-right', '--count', 'HEAD...refs/remotes/origin/main']).trim();
    if (!/^\d+\s+\d+$/.test(counts)) throw new Error('invalid_counts');
    [ahead, behind] = counts.split(/\s+/).map(Number);
  } catch {
    return fail('Não foi possível comparar HEAD com origin/main. Verifique se main existe e execute novamente com acesso ao GitHub.');
  }

  const dirty = status.length > 0;
  say(`HEAD: ${head.slice(0, 12)} | branch: ${branch === 'main' ? 'main' : branch ? 'outra branch' : 'HEAD separado'} | upstream: ${upstream === 'origin/main' ? 'origin/main' : upstream ? 'outro upstream' : 'não configurado'}`);
  say(`Commits locais não enviados: ${ahead}. Commits do GitHub ausentes neste PC: ${behind}.`);
  say(`Arquivos locais: ${dirty ? 'há alterações ou arquivos não rastreados' : 'sem alterações'}.`);

  const reasons = [];
  if (branch !== 'main') reasons.push('A cópia não está na branch main.');
  if (upstream !== 'origin/main') reasons.push('A branch não acompanha origin/main.');
  if (ahead && behind) reasons.push('Os históricos divergiram; revise os dois lados antes de integrar.');
  else if (behind) reasons.push('Este PC está atrasado em relação ao GitHub; atualize com segurança antes de trabalhar.');
  else if (ahead) reasons.push('Há commits locais ainda não enviados ao GitHub; os outros PCs não os receberão.');
  if (dirty) reasons.push('Existem alterações locais não publicadas, inclusive possíveis arquivos novos. Preserve e revise esse trabalho antes de sincronizar.');
  if (reasons.length) return fail(reasons.join(' '));

  say(offline ? 'Checagem local aprovada, mas a sincronização com o GitHub NÃO foi confirmada online.' : 'ALINHADO: esta cópia está limpa e corresponde ao main consultado no GitHub.');
  say('Esta checagem não enxerga alterações de outro PC que ainda não foram enviadas ao GitHub e não confirma o conteúdo publicado na Vercel.');
  return 0;
}

function main(argv = process.argv.slice(2), options = {}) {
  const write = options.write || console.log;
  if (argv.some((arg) => !['--offline', '--help', '-h'].includes(arg))) {
    write('Uso: node scripts/check-sync.cjs [--offline]');
    return 2;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    write('Uso: node scripts/check-sync.cjs [--offline]');
    write('Verifica o repositório oficial, consulta main e bloqueia cópias alteradas, atrasadas, divergentes ou fora de main.');
    write('Não faz pull, reset, stash, commit, push ou deploy. --offline usa referências locais possivelmente antigas.');
    return 0;
  }
  return checkSync({ ...options, offline: argv.includes('--offline') });
}

module.exports = { checkSync, isOfficialRemote, main };
if (require.main === module) process.exitCode = main();
