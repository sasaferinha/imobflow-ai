# Release: perfil, indicadores, negocios e mensagens

## Escopo

Este pacote implementa os cinco pontos aprovados: indicadores reais de CRM,
perfil persistente com identidade estavel, cancelamento de negocios sem quebrar
o catalogo, remocao visual segura de mensagens e fotos reais em ofertas manuais
pelo WhatsApp. Nao ativa campanhas automaticas nem altera o modelo de atendimento
OpenAI/n8n. WhatsApp e senha foram informados como resolvidos pelo responsavel;
as observacoes antigas sobre esses itens nao representam o estado atual.

## Aplicacao do banco antes da publicacao

As migrations devem ser revisadas e aplicadas ao projeto Supabase correto, em ordem,
preservando o historico do gerenciador de migrations:

1. `20260924100000_crm_performance_and_deals.sql`
2. `20260924110000_account_profile.sql`
3. `20260924120000_dashboard_message_visibility.sql`
4. `20260924130000_property_image_outbox.sql`

Nenhuma migration apaga vendas, mensagens, filas ou registros de clientes. Nao
ha DDL em requisicoes do aplicativo. Antes de aplicar, conferir migrations ja
instaladas, obter backup recuperavel e verificar o processo de restauracao.
O backup do banco nao inclui os objetos de imagem do Storage nem o Neon.

O build de producao agora executa `scripts/check-crm-schema.cjs`: consulta apenas
metadados do Supabase e bloqueia uma publicacao se faltarem tabelas, colunas ou
funcoes. Nao aplica SQL e nao imprime credenciais. Ambiente local sem credenciais
pode rodar testes/build, mas informa expressamente que o schema remoto nao foi
verificado. Na Vercel a verificacao e obrigatoria.

Conferir tambem o recuperador existente em
`supabase/operations/message-recovery-cron.sql`: fotos que excedam o tempo de uma
requisicao ficam na fila para esse trabalhador. Verificar `last_tick_at`,
`last_http_status`, estados pendentes e segredo do Vault correspondente a Vercel.
Nao reconfigurar numero Meta nem enviar mensagens a clientes como teste de schema.

## Validacao

```powershell
pnpm --dir apps/dashboard run build:production
pnpm --dir apps/dashboard run lint
pnpm --dir apps/dashboard run test:account-sql
```

`test:crm` inclui testes isolados de SQL PostgreSQL/PGlite, API, dados entre
imobiliarias, conversao de imagens e envio Meta simulado. O teste integrado aplica
as migrations anteriores e novas juntas e exercita renomeacao, aliases,
atribuicao, fila, tombstones, deduplicacao, registro e cancelamento de negocio.
Esses testes nao provam que o schema remoto foi aplicado ou que uma foto chegou
ao celular.

Depois de aplicar o banco e publicar o commit revisado:

- Conferir `/api/version` no dominio oficial e na URL antiga.
- Em uma conta de teste, salvar perfil e recarregar em outra aba/dispositivo.
- Criar e cancelar negocio de teste; conferir meta, ranking, etapa do lead e
  disponibilidade do imovel. Cancelamentos nunca devem apagar historico.
- Remover mensagem concluida do painel e conferir em outra aba. Mensagem em
  processamento nao pode ser removida; o WhatsApp do cliente permanece intacto.
- Com um telefone autorizado e janela de atendimento aberta, enviar uma unica
  oferta de teste e conferir recibos de cada foto e imagens no celular.

## Limites e retorno de versao

Vendas antigas sem ID de imovel nao permitem adivinhar qual imovel reabrir; o
painel avisa para revisao manual. Datas antigas de conversao e recuperacao nao
sao inventadas. Fotos livres exigem janela de 24 horas e usam ate cinco imagens
por oferta. Ocultar uma mensagem nao cancela resposta automatica nem elimina
registros tecnicos de auditoria.

Se for necessario voltar ao codigo anterior, nao remover tabelas/colunas. Antes
de voltar para um trabalhador de mensagens antigo, interromper novas ofertas e
revisar/drenar a fila de fotos: o codigo antigo nao conhece os anexos e suas
dependencias. Reverter um deployment nao reverte os dados do banco.

## Estado da entrega

Implementacao em `codex/complete-crm-workflows`, baseada em `main@a898ec1`
(revisao publica conferida na Vercel antes deste pacote). Em 24/09 passaram:

- `build:production`, incluindo toda a suite anterior e os seis testes CRM;
- `test:account-sql`, migrations em PostgreSQL/PGlite e baseline Neon isolado;
- `lint`: zero erros, um aviso preexistente em `whatsapp-integration.tsx:84`;
- navegacao local compilada: visao geral, perfil mensal, formulario de perfil,
  registro de negocio e modo escuro; sem erros no console ou overflow horizontal
  na janela conferida. A demonstracao permanece isolada, com 68 mutacoes bloqueadas.

O Supabase solicitou login. Nao foram aplicadas migrations remotas, enviados
WhatsApps de teste, alteradas credenciais ou publicado este pacote em producao.
Para retomar: entrar no projeto correto do Supabase, verificar backup e migrations,
seguir a ordem acima, executar o gate com as credenciais do ambiente e somente
entao revisar/integrar a branch e publicar. Nao pular o gate para liberar deploy.

A aplicacao remota das migrations e a publicacao devem ser registradas somente
depois de comprovadas. O dominio
de producao nao deve receber este pacote enquanto o banco estiver na estrutura
anterior. O outro computador so recebe a mudanca depois de consultar o GitHub;
trabalho local nao enviado de um computador offline continua fora desse alcance.
