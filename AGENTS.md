# ImobFlow: trabalho entre computadores

## Antes de alterar codigo ou publicar

- Use `https://github.com/sasaferinha/imobflow-ai.git` como repositorio compartilhado. Nao considere uma copia local, memoria de conversa ou o SHA informado pela Vercel prova suficiente de que as fontes estao iguais.
- Execute `node scripts/check-sync.cjs` e leia `docs/sincronizacao.md`. O comando verifica o GitHub; nao envia arquivos e nao modifica o codigo de trabalho.
- Se houver arquivos alterados, commits locais, atraso ou divergencia, preserve o trabalho e compare as versoes antes de continuar. Nunca execute reset --hard, clean, force push ou sobrescreva arquivos para forcar alinhamento.
- Uma publicacao manual pode conter mudancas que nao foram commitadas. Compare o codigo publicado com o GitHub quando houver sinais dessa diferenca. Nao publique uma copia antiga sobre a versao mais recente.
- Nao copie node_modules, .next, .git, tokens ou arquivos .env entre computadores. Instale as dependencias pelo lockfile; configure credenciais separadamente sem coloca-las no Git.

## Antes de trocar de computador

- Revise a lista e o diff dos arquivos. Salve apenas as mudancas relacionadas ao trabalho, sem `git add .` indiscriminado.
- Quando autorizado a sincronizar, registre e envie as mudancas para o repositorio, sem force push; confira o SHA remoto depois. Fazer commit sem push nao sincroniza o outro PC.
- No outro computador, primeiro verifique mudancas locais. Use atualizacao fast-forward apenas com arvore limpa e historico compativel. Conflitos exigem reconciliacao, nao descarte.
- Registre pendencias e comandos de validacao em documentacao versionada, sem credenciais nem dados de clientes.

## Publicacao

- Publicacao requer autorizacao do usuario. Uma solicitacao apenas de revisao nao autoriza deploy.
- Publique somente uma revisao revisada, testada e enviada ao GitHub; nao publique de uma arvore com alteracoes nao registradas.
- Verifique migrations antes do deploy e confirme o dominio e a versao depois. Testes simulados nao comprovam entrega real no WhatsApp, configuracao Meta, backup restauravel ou schema remoto.
- Nao prometa sincronizacao automatica de um computador offline ou sem acesso. Informe explicitamente o que esta local, no GitHub e em producao.

## Estado recuperado em 24/09/2026

O deployment `dpl_AKs2zSD18STetwuuoW7iTNabyq3J` continha fontes diferentes de `main@a5002c1`, embora a Vercel informasse esse commit como origem. Foram recuperados 337 arquivos com verificacao de hash em `work/sync-backup-20260924/deployment-source/` e integrados em checkout isolado. A copia antiga deste PC permanece em `d6e650d`, com alteracoes anteriores de conversas preservadas. Leia `docs/alinhamento-2026-09-24.md` antes de integrar ou publicar. Revalide GitHub e Vercel a cada nova sessao; esta anotacao nao representa sincronizacao continua.
