# Referência HTTP e OpenAPI

Contrato operacional da API `0.1.0`. A UI Swagger fica em `GET /docs`; o JSON e o YAML gerados pelo plugin ficam em `GET /docs/json` e `GET /docs/yaml`. Esta página complementa o documento gerado com os schemas Zod aplicados dentro dos handlers.

## Convenções

- Base local: `http://localhost:3000`.
- JSON é obrigatório nos corpos, exceto o challenge Meta, respondido como `text/plain`.
- Datas usam ISO 8601; valores monetários são números em BRL.
- O limite de corpo é 1 MiB.
- O rate limit global por IP é 120 requisições/minuto em produção e 1000/minuto nos demais ambientes.
- Envie `x-correlation-id` para preservar um identificador de rastreamento. Se ausente, Fastify gera um; erros sempre o devolvem como `correlationId`.

## Autenticação e tenant

Todas as rotas de imóveis, leads, conversas, agendamentos e desenvolvimento exigem:

```http
X-API-Key: <INTERNAL_API_KEY>
X-Tenant-Id: <tenant-id>
```

`X-Tenant-Id` é tecnicamente opcional: sem ele a API usa `DEFAULT_TENANT_ID`. Recomenda-se enviá-lo explicitamente fora da demo. A autenticação confirma que o tenant existe; todos os recursos são buscados dentro desse escopo. Um ID existente em outro tenant resulta em `404`, não em vazamento do recurso.

`/health`, `/docs` e os webhooks não usam essa chave. Webhooks Meta têm autenticação própria:

- GET: comparação do `hub.verify_token` com `WHATSAPP_VERIFY_TOKEN`;
- POST: HMAC-SHA256 do raw body com `WHATSAPP_APP_SECRET`, recebido em `x-hub-signature-256: sha256=<hex>`.

## Envelope de erro

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Payload inválido",
    "details": {},
    "correlationId": "req-123"
  }
}
```

`details` só aparece quando disponível. Códigos comuns:

| HTTP | `code` | Situação |
|---:|---|---|
| 400 | `VALIDATION_ERROR` / `REQUEST_ERROR` | Body, query, parâmetro ou JSON inválido. |
| 401 | `UNAUTHORIZED` | API key, tenant, verify token ou assinatura inválida. |
| 404 | `NOT_FOUND` / `ROUTE_NOT_FOUND` | Recurso ou rota inexistente. |
| 409 | `CONFLICT` | Unicidade no banco; agendamento indisponível usa `CALENDAR_SLOT_UNAVAILABLE`. |
| 429 | `REQUEST_ERROR` | Rate limit excedido. |
| 500 | `INTERNAL_ERROR` | Falha inesperada; detalhes internos ficam apenas nos logs. |
| 502 | `PROVIDER_ERROR` | Provider externo falhou durante uma chamada síncrona. |

## Índice de endpoints

| Método | Rota | Auth | Ambiente | Descrição |
|---|---|---|---|---|
| GET | `/health` | pública | todos | Saúde da API e do banco. |
| GET | `/docs` | pública | todos | Swagger UI. |
| GET | `/webhooks/whatsapp` | verify token Meta | todos | Challenge de cadastro. |
| POST | `/webhooks/whatsapp` | assinatura Meta | todos | Ingestão de eventos Meta. |
| GET | `/properties` | interna | todos | Busca e ranking de imóveis. |
| GET | `/properties/:id` | interna | todos | Detalhe de imóvel. |
| POST | `/properties` | interna | todos | Cadastro de imóvel. |
| PATCH | `/properties/:id` | interna | todos | Alteração parcial. |
| GET | `/leads` | interna | todos | Últimos 50 leads. |
| GET | `/leads/:id` | interna | todos | Detalhe de lead. |
| PATCH | `/leads/:id` | interna | todos | Nome, status e/ou perfil. |
| GET | `/conversations/:id` | interna | todos | Conversa, lead, resumo e até 100 mensagens. |
| POST | `/conversations/:id/handoff` | interna | todos | Pausa a IA e solicita humano. |
| POST | `/conversations/:id/resume-ai` | interna | todos | Reativa a IA. |
| GET | `/appointments` | interna | todos | Lista agendamentos. |
| POST | `/appointments` | interna | todos | Solicita agendamento. |
| POST | `/dev/simulate-message` | interna | somente `development` | Executa o pipeline sem webhook Meta. |

## Sistema

### `GET /health`

Resposta `200`:

```json
{
  "status": "ok",
  "database": "up",
  "timestamp": "2026-08-27T12:00:00.000Z"
}
```

Se `SELECT 1` falhar, responde `503` com `status: "degraded"` e `database: "down"`.

## Webhook WhatsApp

### `GET /webhooks/whatsapp`

Query obrigatória:

```text
hub.mode=subscribe
hub.verify_token=<WHATSAPP_VERIFY_TOKEN>
hub.challenge=<valor-da-meta>
```

Retorna o challenge como texto (`200`) ou `UNAUTHORIZED` (`401`).

### `POST /webhooks/whatsapp`

Recebe o envelope oficial da WhatsApp Cloud API e exige o header de assinatura. Tipos normalizados: `TEXT`, `IMAGE`, `AUDIO`, `DOCUMENT` e `UNKNOWN`; botões e respostas interativas com título viram texto.

Resposta de aceite:

```json
{ "received": true, "messages": 1 }
```

A API confirma leitura, processa as mensagens sequencialmente e registra falhas por item. Depois que o envelope foi aceito, retorna `200` mesmo quando um item falha, evitando uma tempestade de reentrega da Meta. Duplicatas são neutralizadas pela constraint `(tenantId, whatsappMessageId)`.

## Imóveis

### `GET /properties`

Filtros de query:

| Campo | Tipo/valores | Regra |
|---|---|---|
| `transactionType` | `BUY` ou `RENT` | opcional |
| `propertyType` | `APARTMENT`, `HOUSE`, `LAND`, `COMMERCIAL`, `OTHER` | opcional |
| `city` | string | comparação case-insensitive |
| `state` | UF com 2 letras | normalizada para maiúsculas |
| `neighborhoods` | CSV ou query repetida | máximo 10 |
| `minPrice`, `maxPrice` | número | `minPrice <= maxPrice` |
| `minBedrooms`, `minBathrooms`, `minParkingSpaces` | inteiro >= 0 | opcional |
| `minAreaM2` | número >= 0 | opcional |
| `furnished`, `acceptsFinancing` | boolean | opcional |
| `features` | CSV ou query repetida | máximo 20 |
| `limit` | inteiro de 1 a 20 | padrão 5 |

Somente imóveis `ACTIVE` e `available=true` entram na busca. A resposta traz ranking determinístico:

```json
{
  "data": [
    {
      "property": {
        "id": "...",
        "externalId": "DEMO-001",
        "title": "...",
        "transactionType": "BUY",
        "propertyType": "APARTMENT",
        "price": 745000,
        "city": "São Paulo",
        "state": "SP",
        "neighborhood": "Vila Mariana",
        "available": true
      },
      "score": 100,
      "reasons": ["..." ]
    }
  ],
  "count": 1
}
```

O objeto `property` completo também contém `description`, `status`, `condoFee`, `propertyTax`, `address`, `latitude`, `longitude`, `bedrooms`, `bathrooms`, `parkingSpaces`, `areaM2`, `furnished`, `acceptsFinancing`, `features`, `imageUrls`, `propertyUrl`, `brokerId`, `createdAt` e `updatedAt`.

### `GET /properties/:id`

Resposta `200`: `{ "data": <property> }`. Retorna `404` quando o imóvel não pertence ao tenant.

### `POST /properties`

Body:

```json
{
  "externalId": "SITE-123",
  "title": "Apartamento com varanda",
  "description": "Descrição do anúncio",
  "transactionType": "BUY",
  "propertyType": "APARTMENT",
  "status": "ACTIVE",
  "price": 750000,
  "condoFee": 800,
  "propertyTax": 250,
  "city": "São Paulo",
  "state": "SP",
  "neighborhood": "Vila Mariana",
  "address": "Rua Exemplo, 10",
  "latitude": -23.58,
  "longitude": -46.63,
  "bedrooms": 2,
  "bathrooms": 2,
  "parkingSpaces": 1,
  "areaM2": 72,
  "furnished": false,
  "acceptsFinancing": true,
  "features": ["varanda"],
  "imageUrls": ["https://example.com/imovel.jpg"],
  "propertyUrl": "https://example.com/imoveis/SITE-123",
  "brokerId": "broker_demo",
  "available": true
}
```

Obrigatórios sem default: `externalId`, `title`, `description`, `transactionType`, `propertyType`, `price`, `city`, `state`, `neighborhood` e `areaM2`. Defaults: `status=ACTIVE`, quartos/banheiros/vagas `0`, `furnished=false`, `acceptsFinancing=true`, arrays vazios e `available=true`. Status aceitos: `ACTIVE`, `INACTIVE`, `SOLD`, `RENTED`.

Retorna `201` com `{ "data": <property> }` e grava `property.created` na outbox. `externalId` deve ser único dentro do tenant.

### `PATCH /properties/:id`

Aceita qualquer subconjunto do body de criação, exceto `externalId`. Retorna `{ "data": <property> }`.

## Leads

### `GET /leads`

Retorna no máximo 50 itens por `updatedAt` decrescente:

```json
{ "data": [<lead>], "count": 1 }
```

Um lead contém `id`, `tenantId`, `phone`, `name`, `email`, `intent`, `profile`, `score`, `temperature`, `status`, `lastInteractionAt`, `createdAt` e `updatedAt`.

### `GET /leads/:id`

Retorna `{ "data": <lead> }` ou `404` no escopo do tenant.

### `PATCH /leads/:id`

```json
{
  "name": "Ana",
  "status": "ACTIVE",
  "profile": {
    "transactionType": "BUY",
    "propertyType": "APARTMENT",
    "city": "São Paulo",
    "state": "SP",
    "neighborhoods": ["Vila Mariana"],
    "maxPrice": 800000,
    "minBedrooms": 2,
    "paymentMethod": "FINANCING",
    "purchaseTimelineDays": 90
  }
}
```

Todos os campos são opcionais, mas o objeto não aceita chaves desconhecidas. O `profile` é mesclado ao atual; arrays de bairros, features e notas são deduplicados. Alterar o perfil recalcula score/temperatura mantendo a intenção atual.

Campos de perfil aceitos: `name`, `city`, `state`, `neighborhoods`, `transactionType`, `propertyType`, `minPrice`, `maxPrice`, `minBedrooms`, `minBathrooms`, `minParkingSpaces`, `minAreaM2`, `purpose` (`LIVE|INVEST`), `paymentMethod` (`CASH|FINANCING|CONSORTIUM|OTHER`), `financingPreApproved`, `downPayment`, `purchaseTimelineDays`, `features`, `notes`, `interactedPropertyId`, `requestedVisit` e `requestedHuman`.

## Conversas

### `GET /conversations/:id`

Retorna `{ "data": <conversation> }` com o lead, o resumo 1:1 e até 100 mensagens em ordem cronológica. Mensagens incluem direção, sender, conteúdo, tipo, status de processamento, metadata e ID externo.

### `POST /conversations/:id/handoff`

Sem body. Define `status=HUMAN_HANDOFF`, grava `conversation.handoff_requested` e devolve:

```json
{
  "data": {
    "conversation": { "id": "...", "status": "HUMAN_HANDOFF" },
    "brokerSummary": "..."
  }
}
```

Mensagens novas continuam persistidas durante o handoff, mas não recebem automação comum.

### `POST /conversations/:id/resume-ai`

Sem body. Define `status=AI_ACTIVE`, grava `conversation.ai_resumed` e retorna `{ "data": <conversation> }`.

## Agendamentos

### `GET /appointments`

Query opcional `from` e `to`, ambas datas ISO 8601. Retorna até 200 itens por `scheduledAt` crescente:

```json
{ "data": [<appointment>], "count": 1 }
```

### `POST /appointments`

```json
{
  "leadId": "...",
  "propertyId": "...",
  "brokerId": "broker_demo",
  "scheduledAt": "2026-09-01T14:00:00.000Z",
  "duration": 60,
  "notes": "Visita ao imóvel"
}
```

`leadId` e `scheduledAt` são obrigatórios. `propertyId`, `brokerId` e `notes` podem ser `null`; `duration` é um inteiro de 15 a 480 minutos, padrão 60. Todos os IDs são validados dentro do tenant.

O provider de calendário atual é mock e impede choque de agenda dentro do processo. A resposta é `201` com `{ "data": <appointment> }`; o serviço grava `appointment.created`. Slot ocupado retorna `409 CALENDAR_SLOT_UNAVAILABLE`.

## Simulador de desenvolvimento

### `POST /dev/simulate-message`

Existe somente com `NODE_ENV=development`; nos demais ambientes retorna `404`.

```json
{
  "phone": "5511999999999",
  "message": "Quero comprar apartamento em São Paulo até 800 mil",
  "messageType": "TEXT",
  "whatsappMessageId": "demo-msg-001"
}
```

- `phone`: 10 a 30 caracteres antes da normalização, resultando em 10 a 15 dígitos;
- `message`: até 4000 caracteres, padrão vazio;
- `messageType`: `TEXT`, `IMAGE`, `AUDIO`, `DOCUMENT` ou `UNKNOWN`, padrão `TEXT`;
- `whatsappMessageId`: opcional; a API gera um `dev_<uuid>` quando ausente.

Primeiro processamento:

```json
{
  "data": {
    "duplicate": false,
    "leadId": "...",
    "conversationId": "...",
    "inboundMessageId": "...",
    "reply": "...",
    "handoff": false,
    "matchedPropertyIds": ["..."],
    "score": 55,
    "temperature": "WARM"
  }
}
```

Reenvio do mesmo ID:

```json
{
  "data": {
    "duplicate": true,
    "externalMessageId": "demo-msg-001"
  }
}
```
