# ImobFlow — alinhamento e caminho para o piloto (24/09/2026)

## O que foi conferido

| Origem | Estado observado |
| --- | --- |
| GitHub `main` | `a5002c1` antes da recuperacao; nao continha varias fontes da publicacao |
| Vercel | `www.imobflow.net.br` servia `dpl_AKs2zSD18STetwuuoW7iTNabyq3J`; projeto `imobflow` conectado ao GitHub, branch de producao `main` |
| Este PC | checkout antigo em `d6e650d`, com trabalho local anterior nao integrado; foi mantido intacto |
| Outro PC | indisponivel; qualquer alteracao que nunca chegou ao GitHub/Vercel continua desconhecida |

A recuperacao revisada foi enviada a `codex/recover-deployment-20260924` e esta na [PR #1](https://github.com/sasaferinha/imobflow-ai/pull/1). O patch antigo deste PC foi salvo separadamente em `codex/backup-local-20260924` **apenas como backup**, sem integracao ao produto. `main` e a producao permanecem na versao anterior ate a verificacao operacional e o merge da PR. O preview da PR passou no build da Vercel e respondeu 200 em `/painel` e no health do banco; endpoints de dados sem sessao responderam 401. Isso nao substitui testes autenticados com clientes reais.

A API oficial da Vercel permitiu recuperar **337 arquivos de origem** (4.733.237 bytes). Cada arquivo foi conferido pelo SHA1 informado no deployment e salvo em `work/sync-backup-20260924/deployment-source/`, pasta local ignorada pelo Git. O codigo foi integrado em uma worktree isolada, sem copiar `.env`, credenciais, caches ou dependencias. A comparacao de bytes encontrou 104 arquivos novos, 143 diferentes e 90 identicos frente ao checkout de `main`; parte das diferencas era apenas final de linha. As migrations recuperadas foram preservadas e testadas localmente, nao aplicadas ao banco remoto nesta etapa.

## Validacao tecnica da fonte recuperada

- Instalacao congelada pelo lockfile, build de producao e TypeScript do painel passaram.
- API: 53 testes passaram; TypeScript passou apos gerar o Prisma Client.
- Testes locais de isolamento entre imobiliarias, importacao CSV, SQL de contas, fila de mensagens, recuperacao de inbound, limites dos planos, desconexao WhatsApp e agenda passaram. Sao testes isolados: nao comprovam operacao real no banco remoto nem entrega no celular.
- O lint da fonte publicada encontrou seis erros. Eles foram corrigidos no checkout isolado, com dois avisos restantes sem erro; o perfil foi tornado acessivel na navegacao mobile.
- Foram adicionados limites de tentativa de login e verificacoes de papel para operacoes administrativas. O segredo de administracao de producao nao foi lido nem trocado.
- No dominio oficial, `/painel` respondeu 200 e `/api/health/supabase` informou conexao e empresa presentes. Esse health check nao comprova todas as migrations, job de recuperacao, webhook Meta nem backup restauravel.

## Condicoes antes de colocar clientes reais

1. **Banco e recuperacao:** conferir no Supabase as migrations recentes, job `imobflow-message-recovery`, estados da outbox/inbound e logs; testar restauracao de backup e politica de retencao, inclusive imagens armazenadas separadamente. Veja `docs/operacao-whatsapp-2026-09-24.md`.
2. **Meta/WhatsApp:** concluir ou confirmar a ativacao/coexistencia do numero da imobiliaria, permissao do aplicativo, webhook e assinatura. O documento de 15/09 registra o numero final **3868** pausado; nao ha prova atual de reconexao. Testar com outro telefone, com consentimento, o recebimento, resposta automatica, atendimento humano e entrega. Nao reativar conexao legada as cegas.
3. **Acesso:** se `ADMIN_PANEL_SECRET` ainda for uma senha curta como `123`, trocar por valor forte e exclusivo por canal seguro; testar a emissao de licencas depois. O limite de tentativas nao torna uma senha fraca aceitavel.
4. **Dados piloto:** cadastrar uma imobiliaria e corretores de teste, importar pequena base autorizada, revisar duplicatas/consentimento, cadastrar imoveis com fotos e validar isolamento entre duas empresas e dois papeis.
5. **Release:** revisar a branch recuperada, conferir o estado remoto da producao, aplicar migrations de forma controlada quando necessarias, so entao integrar em `main`. `main` e a branch de producao Vercel: um push/merge pode disparar deploy. Confirmar o novo `/api/version`, testar login, leads, imoveis, agenda, corretor, WhatsApp e rollback. Nao confundir build verde com entrega real.

## Melhorias prioritarias depois do piloto

- Derivar os indicadores de leads, conversoes, recuperacoes e visitas dos eventos reais do CRM; hoje parte do dashboard usa contadores editaveis separados. A tela tambem deveria mostrar diagnostico agregado da base e potencial de recuperacao que ja sao calculados em dados individuais.
- Persistir edicao de perfil e vincular desempenho pelo ID do corretor, nao pelo nome. Corrigir exclusao de negocio para manter o status do imovel coerente.
- Implementar exclusao **visual e segura** de mensagens sem remover o registro da outbox/deduplicacao; isso nao apaga a conversa do WhatsApp do cliente. Fotos de imoveis sao persistidas, mas oferta ao lead ainda sai por texto/link, nao anexo.
- Paginar leads, ajustar filtro "frio" para nao misturar "morno", calcular o verdadeiro lider mensal e monitorar fila, webhook e indicadores de saude com dados recentes.
- Definir papeis, revisao de seguranca e MFA; medir desempenho com base real e obter feedback de corretores antes de automatizar reativacao em escala.

O script `node scripts/check-sync.cjs` impede trabalhar silenciosamente em um checkout atrasado ou alterado. Ele nao sincroniza PCs sozinho; quando o outro computador estiver disponivel, compare o trabalho que ficou somente la antes de atualizar ou publicar.
