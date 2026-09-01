# Real Estate AI MVP

MVP backend de atendimento imobiliário por WhatsApp, com qualificação de leads, busca determinística de imóveis, memória de conversa, handoff humano, agendamentos e automações via n8n. O serviço é um monólito modular em Node.js/TypeScript, Fastify, Prisma e PostgreSQL.

O projeto inicia em modo totalmente local: LLM e WhatsApp usam providers `mock`, o seed cria um tenant, um corretor e 28 imóveis fictícios. OpenAI e Meta WhatsApp Cloud API são habilitados somente por configuração.

## O que está implementado

- ingestão idempotente de mensagens por `whatsappMessageId`;
- isolamento por `tenantId` em API e repositórios;
- extração estruturada de perfil, scoring e temperatura do lead;
- busca/ranking de imóveis fundamentada exclusivamente no catálogo;
- resumo compacto da conversa e limite de contexto recente;
- handoff para corretor e retomada explícita da IA;
- solicitação de visita e outbox persistente para integrações;
- providers substituíveis: mock/OpenAI e mock/Meta;
- três workflows n8n importáveis para webhook, follow-up e notificação do corretor;
- OpenAPI/Swagger e logs estruturados.

Leia também:

- [Status atual e mapa da estrutura](docs/PROJECT_STATUS.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Referência HTTP](docs/OPENAPI.md)
- [Operação, integrações e incidentes](docs/OPERATIONS.md)

## Arquitetura em uma visão

```text
Meta WhatsApp ou /dev/simulate-message
                  |
                  v
        Fastify + Zod + autenticação
                  |
                  v
        MessageIngestionService
          idempotência + persistência
                  |
                  v
       ConversationOrchestrator
        |         |          |
        v         v          v
      LLM      ToolRegistry  handoff
   estruturado   segura      /visita
        |         |          |
        +---------+----------+
                  v
              PostgreSQL
                  |
                  v
          OutboxWorker -> n8n
```

O LLM não acessa banco, filesystem, rede arbitrária ou credenciais. Ele produz dados validados por Zod; consultas e mutações passam por tools allowlisted. Imóveis mencionados ao lead vêm do resultado do repositório, não da geração livre do modelo.

## Pré-requisitos

Para execução local:

- Node.js 20 ou superior;
- npm;
- PostgreSQL 16, ou Docker com Docker Compose.

Para o caminho integralmente conteinerizado, basta Docker. O `Dockerfile` usa Node.js 22 Alpine e o Compose sobe PostgreSQL 16 Alpine e a API.

## Configuração do ambiente

Crie `.env` a partir do exemplo:

```bash
cp .env.example .env
```

No PowerShell:

```powershell
Copy-Item .env.example .env
```

Configurações do backend:

| Variável | Padrão do exemplo | Uso |
|---|---:|---|
| `NODE_ENV` | `development` | `development`, `test` ou `production`; controla também a rota `/dev/simulate-message`. |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Bind HTTP. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent`. |
| `DATABASE_URL` | PostgreSQL local | Conexão Prisma. |
| `INTERNAL_API_KEY` | valor de desenvolvimento | Chave das rotas internas; mínimo de 16 caracteres. Troque obrigatoriamente em produção. |
| `DEFAULT_TENANT_ID` | `tenant_demo` | Tenant usado quando `x-tenant-id` não é informado e pelo webhook Meta atual. |
| `LLM_PROVIDER` | `mock` | `mock` ou `openai`. |
| `OPENAI_API_KEY` | vazio | Obrigatória com `LLM_PROVIDER=openai`. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Modelo enviado à Responses API. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Base da API, útil também para testes compatíveis. |
| `LLM_MAX_RETRIES` | `1` | Repetições após a tentativa inicial; aceita de 0 a 3. |
| `WHATSAPP_PROVIDER` | `mock` | `mock` ou `meta`. |
| `WHATSAPP_ACCESS_TOKEN` | vazio | Token da Meta; obrigatório no modo `meta`. |
| `WHATSAPP_PHONE_NUMBER_ID` | vazio | ID numérico do telefone; obrigatório no modo `meta`. |
| `WHATSAPP_VERIFY_TOKEN` | vazio | Token escolhido para a verificação do webhook; obrigatório no modo `meta`. |
| `WHATSAPP_APP_SECRET` | vazio | App Secret usado no HMAC `x-hub-signature-256`; obrigatório no modo `meta`. |
| `WHATSAPP_API_VERSION` | `v23.0` | Versão Graph API no formato `vN.N`. |
| `N8N_EVENTS_WEBHOOK_URL` | vazio | Production URL do workflow de eventos; sem valor, o worker não inicia. |
| `N8N_SHARED_SECRET` | vazio | Segredo enviado ao n8n no header `x-n8n-secret`. |
| `OUTBOX_POLL_INTERVAL_MS` | `5000` | Intervalo do worker; mínimo de 1000 ms. |
| `LLM_INPUT_USD_PER_MILLION` | `0` | Tarifa usada apenas para estimativa de custo nos logs. |
| `LLM_OUTPUT_USD_PER_MILLION` | `0` | Tarifa usada apenas para estimativa de custo nos logs. |

O processo falha no boot se uma variável for inválida ou se faltar credencial exigida pelo provider selecionado. Em `production`, uma `INTERNAL_API_KEY` contendo `change-me` também é rejeitada.

## Execução com Docker

```bash
docker compose up --build -d
docker compose run --rm api npm run db:seed
curl http://localhost:3000/health
```

A API aguarda o health check do PostgreSQL, aplica `prisma migrate deploy` e inicia em `http://localhost:3000`. O seed é idempotente e cadastra `tenant_demo`, `broker_demo` e 28 anúncios explicitamente fictícios.

Logs e encerramento:

```bash
docker compose logs -f api
docker compose down
```

`docker compose down` preserva o volume `postgres_data`. Acrescentar `-v` remove os dados; use somente quando quiser recriar o banco.

## Execução local

Suba apenas o PostgreSQL e rode a aplicação no host:

```bash
docker compose up -d postgres
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Para validar uma entrega:

```bash
npm run typecheck
npm test
npm run build
```

Em produção, execute as migrations antes do processo compilado:

```bash
npm run db:migrate
npm run build
npm start
```

## Scripts disponíveis

| Script | Finalidade |
|---|---|
| `npm run dev` | Fastify em watch mode com `tsx`. |
| `npm run build` | Compila TypeScript em `dist/`. |
| `npm start` | Inicia o JavaScript compilado. |
| `npm run typecheck` | Validação TypeScript sem emitir arquivos. |
| `npm test` | Executa Vitest uma vez. |
| `npm run test:watch` | Executa Vitest em modo interativo. |
| `npm run db:generate` | Gera o Prisma Client. |
| `npm run db:migrate` | Aplica migrations existentes (`migrate deploy`). |
| `npm run db:migrate:dev` | Cria/aplica migrations no desenvolvimento. |
| `npm run db:seed` | Executa o seed idempotente. |
| `npm run db:studio` | Abre Prisma Studio. |

## Primeira conversa em modo local

Com `NODE_ENV=development`, providers `mock` e seed aplicado:

```bash
curl -X POST http://localhost:3000/dev/simulate-message \
  -H 'content-type: application/json' \
  -H 'x-api-key: dev-internal-key-change-me' \
  -H 'x-tenant-id: tenant_demo' \
  -d '{"phone":"5511999999999","message":"Quero comprar um apartamento em São Paulo até 800 mil, com 2 quartos"}'
```

A resposta inclui IDs de lead/conversa, resposta gerada, imóveis encontrados, score e temperatura. Reutilize o mesmo telefone para continuar a conversa. Informe `whatsappMessageId` manualmente para testar idempotência; IDs repetidos retornam `duplicate: true`.

A interface Swagger e o documento OpenAPI servido pela aplicação estão descritos em [docs/OPENAPI.md](docs/OPENAPI.md).

## OpenAI real

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
LLM_MAX_RETRIES=1
```

O provider chama `POST /responses` com Structured Outputs (`json_schema`, modo estrito), `store: false` e timeout. Outputs são tratados como não confiáveis, validados e limitados. Falhas transitórias são repetidas com backoff; extração pode cair para o mock determinístico e a resposta possui mensagem segura de contingência. Uso de tokens e custo estimado são registrados sem incluir a chave.

## Meta WhatsApp real

```dotenv
WHATSAPP_PROVIDER=meta
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=um-token-escolhido-por-voce
WHATSAPP_APP_SECRET=...
WHATSAPP_API_VERSION=v23.0
```

É possível apontar a Meta diretamente para `https://SEU_BACKEND/webhooks/whatsapp` ou usar o workflow `n8n/01-whatsapp-webhook-to-backend.json`. O GET confirma o challenge usando `WHATSAPP_VERIFY_TOKEN`; o POST exige o corpo bruto original e valida `x-hub-signature-256` com `WHATSAPP_APP_SECRET`. Não transforme/reformate o JSON em proxies.

O roteamento do webhook usa hoje `DEFAULT_TENANT_ID`. Antes de atender vários números/tenants em produção, implemente uma associação confiável entre `phone_number_id` e tenant.

## n8n

Importe, configure credenciais e publique nesta ordem:

1. `n8n/01-whatsapp-webhook-to-backend.json`: recebe Meta e encaminha o raw body ao backend;
2. `n8n/03-lead-qualified-notify-broker.json`: recebe `lead.qualified`, consulta backend e notifica o corretor;
3. `n8n/02-followup-event-to-meta-template.json`: recebe a outbox, envia follow-up ou encaminha lead qualificado ao workflow 03.

Depois configure `N8N_EVENTS_WEBHOOK_URL` com a Production URL `/webhook/realestate-ai/events` e use o mesmo segredo em `N8N_SHARED_SECRET` e na credencial Header Auth `x-n8n-secret` do n8n. As demais variáveis e credenciais estão detalhadas no [runbook](docs/OPERATIONS.md#n8n).

## Segurança e limites do MVP

- Não exponha `INTERNAL_API_KEY`, tokens Meta, App Secret, chave OpenAI ou segredos n8n no repositório ou nos logs.
- Use TLS e um secret manager em qualquer ambiente público.
- A API key interna é adequada ao piloto, não substitui identidade, RBAC e auditoria de um SaaS público.
- Toda nova consulta deve receber `tenantId`; omitir esse filtro é defeito de segurança.
- A API impõe validação de payload e rate limit, mas limites de borda/WAF ainda são recomendados.
- Mídias recebidas são registradas como metadados; o MVP não baixa nem interpreta áudio/imagem/documento.
- O provider Meta não possui fila própria de reenvio. Falhas de envio são persistidas e exigem tratamento operacional.

## Próximos passos recomendados

1. autenticação por identidade, RBAC, trilha de auditoria e gestão de chaves;
2. associação `phone_number_id -> tenant`, configuração por tenant e criptografia de credenciais;
3. retries/DLQ dedicados para mensagens Meta e recuperação automática de eventos `PROCESSING` abandonados;
4. métricas, tracing, alertas de SLO, dashboard de outbox e reconciliação;
5. calendar/CRM reais, disponibilidade transacional e cancelamento/reagendamento;
6. gestão de consentimento/LGPD, retenção, exportação e exclusão de dados;
7. testes de carga, segurança, contratos Meta/n8n e avaliação contínua do LLM.
