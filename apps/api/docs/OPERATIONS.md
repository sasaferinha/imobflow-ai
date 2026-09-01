# Runbook de operação

Este documento cobre preparação de ambiente, deploy, Meta WhatsApp, OpenAI, n8n, observabilidade, retries e resposta a incidentes. Os comandos partem da raiz do projeto.

## Perfis de execução

| Perfil | Banco | LLM | WhatsApp | Indicação |
|---|---|---|---|---|
| Demo local | PostgreSQL local/Compose | `mock` | `mock` | Desenvolvimento e apresentação sem credenciais. |
| Integração OpenAI | PostgreSQL | `openai` | `mock` | Avaliar extração e linguagem sem enviar mensagens reais. |
| Piloto Meta | PostgreSQL gerenciado | `openai` ou `mock` | `meta` | Número de teste/piloto e webhook HTTPS. |

O `docker-compose.yml` é um ambiente de desenvolvimento: usa senha conhecida, publica a porta do PostgreSQL e não inclui n8n. Para produção, prefira banco gerenciado, secrets fora do `.env`, imagem versionada e um runtime com health/readiness, restart policy e rede privada.

## Checklist antes do deploy

1. Fixe uma revisão do código e preserve um backup recente do PostgreSQL.
2. Valide `DATABASE_URL` e aplique uma `INTERNAL_API_KEY` aleatória, sem `change-me`.
3. Selecione explicitamente `LLM_PROVIDER` e `WHATSAPP_PROVIDER`; confirme as credenciais condicionais.
4. Execute:

   ```bash
   npm install
   npm run db:generate
   npm run typecheck
   npm test
   npm run build
   ```

5. Revise a migration pendente e aplique com `npm run db:migrate` antes de iniciar a nova versão.
6. Não rode `npm run db:seed` em produção, salvo se quiser deliberadamente o tenant/corretor demo e os 28 anúncios fictícios.
7. Inicie a API e confirme `GET /health` antes de liberar tráfego.
8. Faça smoke tests autenticados usando um tenant não produtivo.

O projeto usa migrations forward-only. Não existe rollback SQL automático; diante de uma migration incompatível, pare o rollout e faça correção para frente ou restaure um backup testado.

## Inicialização e encerramento

Local:

```bash
npm run db:migrate
npm start
```

Compose:

```bash
docker compose up --build -d
docker compose logs -f api
```

O servidor instala handlers de `SIGINT` e `SIGTERM`. No shutdown ele para o timer da outbox, fecha Fastify e desconecta o Prisma. Configure um grace period suficiente no orquestrador.

O `OutboxWorker` só inicia depois que o listener HTTP sobe e somente quando `N8N_EVENTS_WEBHOOK_URL` está definido.

## Health, logs e sinais úteis

`GET /health` consulta o banco:

- `200`, `status=ok`, `database=up`: processo e PostgreSQL respondendo;
- `503`, `status=degraded`, `database=down`: não encaminhe tráfego ao processo.

Em desenvolvimento os logs usam `pino-pretty`; nos demais ambientes são JSON. `LOG_LEVEL` controla o nível. Headers `authorization` e `x-api-key`, além de campos comuns de token/chave, são redigidos como `[REDACTED]`.

Passe `x-correlation-id` em requisições internas. O mesmo valor aparece em respostas de erro e nos principais logs do pipeline. Eventos úteis:

| Evento de log | Interpretação |
|---|---|
| `server_started` / `server_start_failed` | Resultado do boot. |
| `message_received` | Mensagem persistida e pronta para orquestração. |
| `duplicate_message_ignored` | Mesmo ID externo já existia no tenant. |
| `message_processed` / `message_pipeline_completed` | Orquestração e entrega concluídas. |
| `message_pipeline_failed` | Mensagem marcada `FAILED`. |
| `whatsapp_message_processing_failed` | Item do webhook falhou; o envelope ainda pode ter recebido HTTP 200. |
| `property_search_completed` | Quantidade e IDs resultantes da busca. |
| `tool_call_started/completed/failed` | Execução de uma tool allowlisted. |
| `llm_usage` | Provider, modelo, tokens e custo configurado estimado. |
| `llm_extraction_failed_using_fallback` | OpenAI falhou e o extrator mock foi usado. |
| `llm_reply_failed_using_safe_message` | Resposta segura fixa substituiu a geração. |
| `llm_summary_failed` | Resumo anterior foi preservado/atualizado sem nova sumarização. |
| `outbox_publish_failed` | n8n indisponível ou respondeu fora de 2xx. |
| `health_database_unavailable` | Query de saúde ao PostgreSQL falhou. |

Métricas ainda não são exportadas. Em produção, derive ao menos taxas/latências para HTTP, mensagens processadas/falhas, chamadas e tokens do LLM, envios Meta e profundidade/idade da outbox.

## OpenAI provider

Configuração mínima:

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1
LLM_MAX_RETRIES=1
```

O provider usa a Responses API em `${OPENAI_BASE_URL}/responses` com:

- `json_schema` estrito para extração, resposta e resumo;
- `store: false`;
- timeout interno de 30 segundos;
- texto recente limitado e no máximo 12 mensagens;
- no máximo cinco imóveis fundamentados no input do gerador;
- validação de IDs citados contra os imóveis enviados pelo backend.

### Retry e fallback do LLM

`LLM_MAX_RETRIES=N` significa até `N + 1` tentativas. O env aceita de 0 a 3. O backoff começa em 250 ms e dobra entre tentativas. São repetidas falhas de rede/timeout, respostas inválidas ou estruturadas inválidas, HTTP 408/409/429/5xx e alguns estados incompletos do provider. Erros 4xx não transitórios e recusas não são repetidos.

Depois do esgotamento:

- extração cai para o provider mock determinístico;
- geração livre cai para uma mensagem segura curta;
- falha de resumo não derruba a conversa;
- recomendações de imóveis continuam formatadas deterministicamente pelo backend quando já há filtros válidos.

Se o fallback aumentar, confirme validade/limite da chave, acesso do projeto ao modelo, rate limits, egress/DNS e status do provider. Nunca imprima `OPENAI_API_KEY` em diagnóstico.

## Meta WhatsApp Cloud API

### Provisionamento

1. Crie/selecione um app Meta Business com o produto WhatsApp.
2. Registre o número e obtenha `WHATSAPP_PHONE_NUMBER_ID`.
3. Gere um token adequado ao ambiente e guarde-o como `WHATSAPP_ACCESS_TOKEN`.
4. Copie o App Secret para `WHATSAPP_APP_SECRET`.
5. Escolha um verify token aleatório e configure o mesmo valor em `WHATSAPP_VERIFY_TOKEN` e no painel Meta.
6. Publique a API atrás de HTTPS. A URL pode ser direta ou passar pelo workflow 01 do n8n.
7. Assine o campo de mensagens no painel e conclua o challenge GET.
8. Envie uma mensagem de um número permitido e acompanhe logs/banco.

Configuração:

```dotenv
WHATSAPP_PROVIDER=meta
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
WHATSAPP_API_VERSION=v23.0
```

### Callback direto

Use:

```text
https://api.exemplo.com/webhooks/whatsapp
```

O GET valida o verify token. O POST só é aceito quando o HMAC do raw body confere. Preserve os bytes originais em CDN, WAF, ingress e proxy; reserializar JSON invalida a assinatura.

### Callback via n8n

Use a Production URL do workflow 01:

```text
https://n8n.exemplo.com/webhook/realestate-ai/whatsapp
```

O n8n responde ao challenge e encaminha o POST como binário bruto ao backend, inclusive `content-type` e `x-hub-signature-256`. O backend continua sendo a autoridade da assinatura.

### Envio e janela de atendimento

O provider da API envia texto/imagem/template pelo endpoint:

```text
POST https://graph.facebook.com/<WHATSAPP_API_VERSION>/<WHATSAPP_PHONE_NUMBER_ID>/messages
```

Respostas comuns do agente são texto e devem respeitar as políticas/janela da Meta. Follow-ups e notificações do corretor nos workflows usam templates previamente aprovados.

O provider Meta classifica HTTP 408/429/5xx e falhas de rede como potencialmente transitórios, mas não implementa um loop de retry próprio. Falha de envio persiste uma mensagem outbound com `processingStatus=FAILED`, emite `whatsapp.send_failed` e marca a inbound como `FAILED`. Trate a outbox/alerta; não presuma reenvio automático.

O webhook processa cada mensagem e devolve 200 após aceitar o envelope, inclusive quando um item falha. Isso protege contra reentregas em massa, mas torna alertas de `whatsapp_message_processing_failed` essenciais.

### Isolamento do webhook

O backend atual atribui mensagens recebidas a `DEFAULT_TENANT_ID`. `phone_number_id` é preservado em metadata, porém ainda não decide o tenant. Use um número dedicado ao tenant piloto. Multi-tenant real exige uma tabela/configuração verificada `phone_number_id -> tenantId` antes da ingestão.

## n8n

Os workflows são artefatos importáveis; n8n não faz parte do Compose deste repositório. Use uma instância com HTTPS, persistência, credenciais cifradas, retenção de execuções e acesso de rede ao backend.

### Ordem e URLs

| Arquivo | Production path | Função |
|---|---|---|
| `01-whatsapp-webhook-to-backend.json` | `/webhook/realestate-ai/whatsapp` | GET de verificação e POST raw Meta para backend. |
| `02-followup-event-to-meta-template.json` | `/webhook/realestate-ai/events` | Entrada da outbox; follow-up, roteamento ou ignore explícito. |
| `03-lead-qualified-notify-broker.json` | `/webhook/realestate-ai/lead-qualified` | Consulta lead/conversa e envia resumo ao corretor. |

Importe os três. Configure e ative 03, depois 02; ative 01 antes de cadastrar sua Production URL na Meta.

### Credenciais n8n

Crie credenciais Header Auth e associe manualmente após o import:

| Uso/nodes | Nome do header | Valor |
|---|---|---|
| Webhooks dos workflows 02 e 03; encaminhamento 02 -> 03 | `x-n8n-secret` | mesmo segredo de `N8N_SHARED_SECRET` no backend |
| `Buscar Lead` / `Buscar Conversa` | `x-api-key` | `INTERNAL_API_KEY` do backend |
| Requests à Graph API | `Authorization` | `Bearer <WHATSAPP_ACCESS_TOKEN>` |

Os requests ao backend também enviam `x-tenant-id` retirado do envelope autenticado.

### Variáveis da instância n8n

| Variável | Workflows | Uso |
|---|---|---|
| `BACKEND_BASE_URL` | 01, 02, 03 | Base alcançável da API, sem barra final. |
| `WHATSAPP_VERIFY_TOKEN` | 01 | Challenge Meta. |
| `WHATSAPP_PHONE_NUMBER_ID` | 02, 03 | Endpoint Graph API. |
| `WHATSAPP_API_VERSION` | 02, 03 | Padrão dos fluxos: `v23.0`. |
| `META_TEMPLATE_LANGUAGE` | 02, 03 | Padrão `pt_BR`. |
| `META_FOLLOWUP_TEMPLATE_NAME` | 02 | Template aprovado de follow-up. |
| `META_FOLLOWUP_TEMPLATE_ALLOWLIST` | 02 | CSV; deve conter exatamente o template selecionado. |
| `N8N_INTERNAL_BASE_URL` | 02 | Base usada para chamar o workflow 03; fallback `http://n8n:5678`. |
| `BROKER_NOTIFICATION_PHONE` | 03 | Telefone do corretor, 10 a 15 dígitos. |
| `META_BROKER_TEMPLATE_NAME` | 03 | Template aprovado para o resumo. |
| `BACKOFFICE_BASE_URL` | 03 | Opcional; gera link para `/conversations/:id`. |

Os fluxos usam expressões `$env`. Habilite acesso às variáveis conforme a política da sua instalação n8n ou substitua-as por configuração segura equivalente; não fixe segredos dentro do JSON versionado.

Requisitos dos templates:

- follow-up: uma variável de corpo (`{{1}}`) para o nome;
- corretor: uma variável de corpo (`{{1}}`) para o resumo determinístico, limitado a 1000 caracteres.

### Ligar a outbox

No backend:

```dotenv
N8N_EVENTS_WEBHOOK_URL=https://n8n.exemplo.com/webhook/realestate-ai/events
N8N_SHARED_SECRET=um-segredo-longo
OUTBOX_POLL_INTERVAL_MS=5000
```

Smoke test seguro do roteamento, usando um tipo não tratado:

```bash
curl -X POST https://n8n.exemplo.com/webhook/realestate-ai/events \
  -H 'content-type: application/json' \
  -H 'x-n8n-secret: um-segredo-longo' \
  -d '{"id":"smoke-1","type":"operations.smoke","tenantId":"tenant_demo","aggregateType":"Test","aggregateId":"smoke-1","occurredAt":"2026-08-27T12:00:00.000Z","payload":{}}'
```

O workflow deve responder `202` com `ignored: true`; não deve chamar a Meta.

### Proteções dos workflows

- Follow-up só é enviado se o lead existir, estiver `ACTIVE`, ainda não tiver interagido desde o evento, o horário estiver vencido e o template estiver na allowlist.
- Lead qualificado é reconsultado no backend; IDs de lead/conversa e tenant devem ser consistentes.
- A mensagem ao corretor é montada deterministicamente, sem LLM.
- Eventos desconhecidos são aceitos/ignorados de forma explícita.

## Entrega da outbox e retries

O worker seleciona até 20 eventos `PENDING` ou `FAILED`, vencidos por `availableAt`, com menos de 10 tentativas. Para cada evento:

1. muda o status para `PROCESSING` e incrementa `attempts`;
2. faz POST no n8n com timeout de 10 segundos;
3. em 2xx, marca `PUBLISHED` e preenche `publishedAt`;
4. em erro, marca `FAILED`, salva `lastError` (até 500 caracteres) e agenda novo horário.

O backoff após falhas é aproximadamente 2, 4, 8, 16, 32 e depois 60 minutos. Após 10 tentativas, o evento continua `FAILED`, mas deixa de ser selecionado automaticamente.

Limitações importantes:

- um crash depois de marcar `PROCESSING` deixa o evento preso; não há lease/reaper;
- a entrega é at-least-once, não exactly-once;
- se a Meta concluir e a resposta do n8n se perder, repetir o evento pode duplicar uma mensagem;
- os workflows não mantêm uma tabela própria de deduplicação por `event.id`.

Antes de reencaminhar, confira o histórico de execução do n8n e o efeito externo.

### Inspecionar backlog

Via Prisma Studio:

```bash
npm run db:studio
```

Ou no PostgreSQL:

```sql
SELECT status, type, count(*)
FROM outbox_events
GROUP BY status, type
ORDER BY status, type;

SELECT id, tenant_id, type, status, attempts, available_at, last_error, created_at
FROM outbox_events
WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
ORDER BY created_at;
```

Para reencaminhar um evento específico depois de confirmar que não houve efeito downstream:

```sql
BEGIN;
UPDATE outbox_events
SET status = 'PENDING', attempts = 0, available_at = now(), last_error = NULL
WHERE id = '<EVENT_ID>'
  AND status IN ('FAILED', 'PROCESSING');
COMMIT;
```

Não faça reset em lote sem avaliar duplicidade.

## Runbooks de incidente

### API não inicia

1. Leia `server_start_failed` e a mensagem `Configuração de ambiente inválida`.
2. Confirme que `INTERNAL_API_KEY` possui pelo menos 16 caracteres.
3. No modo OpenAI, valide `OPENAI_API_KEY`; no modo Meta, valide os quatro campos obrigatórios.
4. Confirme DNS/rede/SSL e credenciais de `DATABASE_URL`.
5. Execute `npm run db:generate` e `npm run db:migrate`.

### Health 503

1. Verifique estado do PostgreSQL e limite de conexões.
2. Teste a `DATABASE_URL` a partir da mesma rede/processo da API.
3. Em Compose, use `docker compose ps` e `docker compose logs postgres`.
4. Não marque a API como ready até o health voltar a 200.

### Webhook responde 401

- GET: confira `hub.mode=subscribe`, verify token nos dois lados e challenge.
- POST: confira App Secret, header `x-hub-signature-256` e preservação byte a byte do raw body.
- Via n8n: confirme que o HTTP Request envia o campo binário `data`, não um JSON reserializado.

### Meta recebe 200, mas o lead não recebe resposta

1. Pesquise `whatsapp_message_processing_failed` pelo `whatsappMessageId`.
2. Procure a inbound em `messages` e inspecione `processing_status`/`metadata`.
3. Confira `conversation.status`; `HUMAN_HANDOFF` suprime resposta automática.
4. Confira logs de fallback LLM e erros do provider Meta.
5. Valide token, phone number ID, janela/template, permissão do destinatário e limites da Meta.
6. Se houver outbound `FAILED`, confirme primeiro se a Meta recebeu a mensagem antes de qualquer reenvio manual.

Não existe endpoint genérico de replay de mensagem. Alterar apenas `processing_status` no banco não reexecuta o pipeline.

### Outbox cresce ou n8n não recebe

1. Confirme que `N8N_EVENTS_WEBHOOK_URL` não está vazio e que a API reiniciou após a alteração.
2. Teste DNS/TLS/rede da API até a URL.
3. Confira o Header Auth `x-n8n-secret` e o status do workflow 02.
4. Consulte `lastError`, `attempts` e execuções n8n.
5. Corrija a causa; eventos com menos de 10 tentativas voltam automaticamente.
6. Para `PROCESSING` preso ou 10 tentativas, use o procedimento de requeue individual.

### Muitos fallbacks da OpenAI

1. Filtre `llm_extraction_failed_using_fallback`, `llm_reply_failed_using_safe_message` e `llm_summary_failed`.
2. Separe 401/403, 429, 5xx, timeout e output inválido.
3. Confirme modelo/base URL e quotas; não aumente retries indiscriminadamente durante 429 prolongado.
4. Mantenha o mock disponível e acompanhe impacto na qualidade/score.

## Banco, backup e retenção

Faça backup consistente antes de migrations e teste restauração periodicamente. Entidades com dados pessoais incluem leads, mensagens, resumos, agendamentos e metadata. Defina retenção conforme finalidade/consentimento e LGPD.

O seed usa `upsert` e é idempotente, mas é voltado somente à demo. O volume Compose `postgres_data` sobrevive a `docker compose down`; `docker compose down -v` o remove definitivamente.

O calendário atual é in-memory. Eventos externos mock somem no restart, enquanto agendamentos persistem no PostgreSQL; portanto a checagem de choque não é confiável entre reinícios. Não use o mock como agenda de produção.

## Checklist de segurança

- TLS fim a fim para backend, n8n e callbacks.
- Secrets em cofre/secret manager, com rotação e escopo mínimo.
- PostgreSQL sem porta pública e usuário da aplicação sem privilégio administrativo.
- API interna atrás de rede confiável/gateway; `INTERNAL_API_KEY` diferente por ambiente.
- WAF/rate limit de borda, limite de corpo e proteção de abuso por tenant/número.
- Validação obrigatória da assinatura Meta sobre raw body.
- Credenciais n8n cifradas; editor e histórico de execuções com acesso restrito.
- Logs sem conteúdo sensível desnecessário; revise retenção e acesso.
- Auditoria de toda nova consulta para garantir filtro `tenantId`.
- Política de consentimento, finalidade, retenção, portabilidade e exclusão LGPD.
- Dependências/imagens verificadas e atualizadas; execute análise de vulnerabilidades no CI.

## Lacunas antes de escala comercial

1. identidade/RBAC/auditoria substituindo a API key compartilhada;
2. roteamento seguro de número Meta para tenant e configuração/segredos por tenant;
3. fila de entrega WhatsApp, DLQ, deduplicação downstream e reconciliação;
4. lease/reaper da outbox e painel de replay com confirmação de efeito;
5. calendário e CRM reais, idempotência e compensação observável;
6. métricas, tracing distribuído, alertas e SLOs;
7. backup/PITR, retenção automatizada e fluxos LGPD;
8. testes de carga, caos, segurança e contratos com Meta/OpenAI/n8n.
