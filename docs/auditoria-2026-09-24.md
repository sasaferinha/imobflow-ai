# ImobFlow — verificacao de 24/09/2026

> Registro da primeira etapa da auditoria. As fontes publicadas foram recuperadas mais tarde no mesmo dia, sem acesso ao outro computador. Para o estado apos a recuperacao, leia `docs/alinhamento-2026-09-24.md`; os bloqueios de recuperacao abaixo sao historicos.

## Conclusao

O site esta acessivel, mas existem tres estados diferentes: copia deste PC, GitHub e fontes da publicacao. Nao e seguro publicar esta copia sobre o site atual antes de recuperar o trabalho do outro computador. Esta auditoria nao certifica todos os fluxos autenticados de producao.

## Versoes verificadas

| Origem | Evidencia |
| --- | --- |
| Este PC | main em d6e650d737804cbe1358cb1841761439ac496368; nove arquivos rastreados modificados e dois testes novos de conversas/atendimento |
| GitHub | main e codex/pilot-conversations em a5002c1fc67e5a798a284fe68ec1a3180311a887; main esta 11 commits a frente deste PC |
| Vercel | deployment dpl_AKs2zSD18STetwuuoW7iTNabyq3J, Ready, produzido em 16/09; metadados informam a5002c1, mas as fontes divergem do commit |
| Dominios | https://www.imobflow.net.br e https://imobflow-ai-rosy.vercel.app respondem com o mesmo deployment em /api/version; imobflow.net.br redireciona para www |

Exemplos observados na aba Source da Vercel, ausentes de main: `lib/plans.ts`, `lib/inbound-recovery.ts`, `lib/meta-whatsapp-onboarding.ts`, `lib/whatsapp-business-echo.ts`, `app/whatsapp-integration.tsx` e novas telas de simulacao. A tela publicada mostra Basic 5, Plus 8 e Pro 12; o GitHub ainda mostra Basic 3.

Fonte de producao inspecionada: https://vercel.com/samuelvilas290-5501s-projects/imobflow/AKs2zSD18STetwuuoW7iTNabyq3J/source

## Validacoes executadas

As validacoes abaixo foram feitas em copia temporaria isolada de **origin/main a5002c1**, sem credenciais de producao e sem sobrescrever o trabalho deste PC:

- Instalacao congelada pelo lockfile aprovada pelas politicas do pnpm.
- Suite do dashboard, testes de conversas piloto e sincronizacao: passaram.
- Build de producao Next.js e verificacao TypeScript do painel: passaram.
- ESLint do dashboard: passou.
- Testes SQL de contas, recuperacao e baseline Neon em PGlite: passaram. Isso nao confirma migrations aplicadas no banco remoto.
- Backend apps/api: 53 testes em oito arquivos passaram. Typecheck passou apos gerar o Prisma Client, etapa necessaria numa instalacao nova.
- Em producao, GET /painel retornou 200; /api/leads, /api/properties e /api/conversations retornaram 401 sem sessao; verificacao do webhook sem token retornou 403.

Build aprovado do GitHub nao significa build reproduzido da publicacao divergente.

Separadamente, os dez grupos de testes simulados dos diagnosticos n8n antigos locais passaram. O teste local de exclusao tem uma falha de isolamento do objeto Error no harness VM (500 em vez de 409); precisa ser ajustado ao portar o patch, sem confundir esse resultado com uma falha comprovada da rota publicada.

## Achados e limitacoes

### Prioridade alta: recuperar as fontes antes de sincronizar/publicar

O deployment inclui trabalho que nao consta nas branches remotas verificadas. Uma publicacao a partir delas pode remover recursos atuais. Preservar o trabalho do outro computador e envia-lo ao GitHub e a primeira acao. Ha tambem alteracoes antigas locais que precisam ser conciliadas, nao sobrescritas.

### Indicadores comerciais ainda dependem de dados separados do CRM

Na fonte publicada, `lib/database.ts:257-277` le contadores de leads recebidos, convertidos, recuperados e visitas das tabelas de indicadores; `:303-306` permite atualizar os totais manualmente. Eles nao sao calculados diretamente sobre os leads/visitas nessa consulta. Nao tratar esses numeros como metricas automaticamente derivadas de todos os eventos do CRM sem validar tambem os produtores e o banco remoto. Vendas sao somadas dos negocios registrados.

A publicacao ja corrige a lista de corretores de meses novos: `database.ts:239,263-268` inclui a equipe ativa. Esse problema ainda presente no GitHub nao deve ser reportado como confirmado no site.

### Conversas: diferencas importantes entre Git e publicacao

- GitHub ja possui envio manual real, caixa de saida, status de entrega, horarios e pausa para atendimento humano. n8n deixou de ser dependencia do fluxo principal; mantem-se opcional.
- A publicacao vai alem: `lib/conversations.ts:37-88` ja tem paginacao de mensagens e busca restrita dos eventos de entrega. O problema de carregar todo o historico existente no GitHub foi corrigido nesse trecho publicado.
- `lib/conversations.ts:155-156` da publicacao ainda envia imoveis como texto/link, nao como anexos de fotos. Upload no catalogo e entrega de anexo no WhatsApp sao capacidades diferentes.
- O patch de exclusao de mensagens deste PC foi preservado. Ele foi feito sobre o fluxo antigo e nao deve ser transplantado sem considerar a nova outbox, IDs externos e deduplicacao. A disponibilidade da exclusao na interface atual nao foi confirmada com login.

### Problemas comprovados no GitHub, nao necessariamente no site atual

Revisao de a5002c1 encontrou login ambiguo quando o mesmo email/papel pertence a duas empresas (`lib/accounts.ts:26-32`), transferencia de conversas presas a corretores desativados (migration piloto `:111-116`), perfil editavel somente em memoria (`app/dashboard-client.tsx:610`), contador de nao lidas que nao aumenta em mensagens reais (`conversation-center.tsx:106`, `demo-conversations.ts:141-148`) e intervalo sem trabalho duravel entre salvar inbound e enfileirar a resposta (`webhook:48-54`, `attendance.ts:55-67`).

Esses achados exigem comparacao com as fontes novas e migrations do outro computador antes de corrigir. A presenca de inbound-recovery.ts e outras diferencas em producao impede extrapolar o diagnostico do GitHub para todo o site.

### Verificacoes externas ainda necessarias

- Configuracao, permissao e estado atual do WhatsApp/Meta; a pagina disponivel exige login. Nenhuma mensagem real foi enviada durante esta auditoria.
- Migrations efetivamente aplicadas, isolamento no banco remoto e restauracao de backup. Os documentos de 11/09 registram bloqueios antigos, inclusive erro Meta 130497; nao comprovam que continuam hoje.
- Fluxos autenticados de duas empresas/corretores e entrega real de mensagem no aparelho.
- Agendamento efetivo das retentativas: o GitHub configura cron diario; o intervalo de backoff nao garante execucao em segundos.

## Alteracoes feitas nesta verificacao

Nenhum dado de cliente foi alterado e nenhum deploy/push foi feito. O trabalho anterior foi preservado; uma copia local de seguranca verificada foi criada em `work/sync-backup-20260924`. Foi preparado um procedimento de sincronizacao e orientacao do projeto para prevenir novas publicacoes de fontes divergentes.

O novo `scripts/check-sync.cjs` passou nos testes isolados e, executado online nesta copia, detectou corretamente os 11 commits de atraso e os arquivos pendentes, retornando bloqueio sem integrar ou sobrescrever nada. Essas orientacoes e scripts ainda sao locais: precisam ser incorporados ao historico reconciliado e recebidos no outro computador.
