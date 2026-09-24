# Sincronizacao segura do ImobFlow

O GitHub e o ponto de troca entre computadores; a Vercel hospeda uma publicacao, mas nao substitui o backup das fontes no Git. Cada computador precisa ter acesso ao repositorio e enviar seu trabalho antes da troca. Um computador desligado nao pode ser sincronizado por este procedimento.

## Conferir antes de trabalhar

```powershell
node scripts/check-sync.cjs
```

O verificador consulta o GitHub e informa arquivos pendentes, branch, commits a enviar e commits a receber. Ele nao faz commit, merge, stash, push ou deploy. Qualquer divergencia exige revisao. O modo `--offline` usa somente referencias locais e nao confirma o estado atual do GitHub.

## Trocar de computador

1. No computador de origem, revisar o diff e arquivos novos; nao incluir segredos, caches ou dados reais de clientes.
2. Fazer commit das alteracoes revisadas e push na branch combinada. Nao usar force push. Se o push for rejeitado, comparar os historicos.
3. No computador de destino, executar o verificador e preservar qualquer trabalho local antes da atualizacao.
4. Com a arvore limpa, na branch correta e sem divergencia, `git pull --ff-only origin main` pode atualizar a copia de main. Nao executar esse comando em outra branch nem usar reset para contornar conflitos.
5. Instalar com `pnpm install --frozen-lockfile`; nao copiar dependencias de um PC para outro. Respeitar as politicas de seguranca do gerenciador.
6. Executar as validacoes pertinentes antes de publicar. A instalacao e os testes nao alteram o schema remoto; migrations sao uma etapa separada.

O arquivo AGENTS.md orienta o assistente que abrir esta pasta a seguir essas verificacoes. Ele e o verificador precisam ser commitados/enviados, e recebidos no outro computador, para estarem presentes la tambem. Nao sao um servico de sincronizacao continua e nao impedem uma publicacao feita manualmente fora desse fluxo.

## Validacao da versao GitHub auditada

```powershell
pnpm --dir apps/dashboard run build:production
pnpm --dir apps/dashboard lint
pnpm --dir apps/dashboard test:account-sql
pnpm --dir apps/api db:generate
pnpm --dir apps/api test
pnpm --dir apps/api typecheck
```

## Recuperacao da publicacao de 16/09/2026

O deployment `dpl_AKs2zSD18STetwuuoW7iTNabyq3J` possuia fontes diferentes do commit informado pela Vercel. Em 24/09/2026, 337 arquivos de origem foram recuperados pela API oficial, validados por SHA1 e comparados com `origin/main` numa worktree isolada. O checkout antigo deste PC foi preservado. Leia `docs/alinhamento-2026-09-24.md` para a revisao atual e `docs/operacao-whatsapp-2026-09-24.md` antes de configurar a Meta.

Mesmo depois de enviar essas fontes ao GitHub, um outro computador pode ter alteracoes locais nunca enviadas. Quando o acesso voltar, compare `git status`, branch, SHA e diff com `origin/main` antes de fazer pull ou publicar. Nao use a copia antiga nem o patch de exclusao de mensagens como substituto da fila de saida atual; a exclusao ainda requer desenho seguro. Nao presuma que o SHA exibido na Vercel inclui fontes nao commitadas.

## Copia de seguranca deste PC

`work/sync-backup-20260924/` guarda o historico em `repository.bundle`, o diff rastreado em `local-changes.patch` e os dois testes novos de exclusao/atendimento. O bundle foi verificado pelo Git. Os arquivos originais permanecem intactos. Arquivos de ambiente nao foram copiados. `tsconfig.tsbuildinfo` e um cache gerado, nao codigo-fonte.

Essa copia esta apenas neste computador, na pasta ignorada `work`; nao e backup externo nem garantia contra falha do disco. Nunca aplicar o patch antigo diretamente sobre a versao nova sem revisar conflitos e contratos de envio.
