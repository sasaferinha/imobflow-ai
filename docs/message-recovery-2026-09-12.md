# Recuperação de envios e publicação — 12/09/2026

Produção: `https://www.imobflow.net.br/painel`.
Deploy: `dpl_5r5DkHjUdor5w6d9TNoEkriTdvU3`.

## Fila de mensagens

A fila persistida é consultada a cada minuto por `imobflow-message-recovery`
no Supabase (`pg_cron` + `pg_net`). O banco só chama o endpoint quando existem
envios pendentes vencidos ou execuções interrompidas. Não depende de navegador
aberto nem do cron diário da Vercel. Nenhum plano pago foi contratado.

O endpoint `POST /api/automations/recover` exige uma chave própria, aleatória,
guardada como segredo na Vercel (`MESSAGE_RECOVERY_SECRET`) e no Supabase Vault
(`imobflow_message_recovery_secret`). O job não contém o valor da chave.
Instalação reproduzível em `supabase/operations/message-recovery-cron.sql`;
provisionar o mesmo segredo nos dois serviços antes de instalar o job.

- Até três tentativas, com intervalo crescente para recusas temporárias explícitas.
- Uma falha antes da chamada à Meta pode voltar à fila.
- Timeout, sucesso sem recibo ou resposta ambígua não provocam reenvio cego.
- Recibo e estado da fila são persistidos atomicamente; repetir a persistência
  não repete o envio. Um recibo atrasado pode resolver o estado incerto.
- Execuções paradas por dois minutos são recuperadas sob trava. O marcador de
  tentativa distingue falha antes do envio de resultado desconhecido.
- `claim_outbox_message_v2` diferencia workers novos e antigos durante rollout.
  Workers antigos são tratados conservadoramente para evitar duplicação.
- Cada envio continua verificando empresa, responsável, pausa do bot e janela
  de atendimento. Não retoma atendimentos humanos automaticamente.
- O worker reserva orçamento para a chamada à Meta e a gravação do recibo.

`message_recovery_scheduler` registra o último tick, chamada HTTP e sucesso.
Consultar junto de `cron.job_run_details` e dos logs privados da Vercel; não
expor as tabelas de requisições HTTP ou o Vault ao navegador. Falhas permanentes
de token, configuração e restrições da Meta precisam de intervenção humana.
A rotina não corrige mensagens que nunca chegaram ao webhook nem substitui
disponibilidade dos provedores. Resultados incertos são deixados visíveis,
não reapresentados como entrega comprovada.

## Verificação

Passaram `pnpm run build:production`, testes de isolamento SQL/API, pausa,
conexão guiada, recuperação e regressões existentes. Os testes de recuperação
usam SQL PostgreSQL real em PGlite e Meta simulada, sem mensagens a clientes.
Layout da conexão conferido em 1440px, 390px e 320px. Produção respondeu HTTP
200 no site, painel e saúde do banco, e 401 sem autenticação nas conversas e
no endpoint de recuperação.

As duas migrações novas foram aplicadas em uma transação após preflight com
rollback. O teste autenticado do worker em produção retornou fila vazia,
sem enviar mensagens fictícias. Um primeiro teste HTTP retornou falha
temporária; a nova chamada foi bem-sucedida. O job deve continuar sendo
acompanhado durante o piloto; isso não é uma garantia de disponibilidade.

## Pendente fora do código

O fluxo Embedded Signup foi implementado, mas a variável
`META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` ainda não estava configurada em
produção na publicação. A configuração/liberação da Meta para empresas
clientes e um teste real de onboarding continuam necessários. Enquanto isso,
o painel oferece o caminho manual assistido e a conferência de acesso.
Detalhes em `docs/whatsapp-onboarding.md`.
