# Arquitetura implementada — AI Automation para imobiliárias

## A. Resumo

O MVP é um monólito modular em Node.js/TypeScript com Fastify, Prisma e PostgreSQL. O processo HTTP permanece fino; regras de negócio ficam em serviços de aplicação e funções puras do domínio. Integrações externas são acessadas por interfaces substituíveis.

O LLM interpreta texto e redige respostas, mas não possui acesso ao banco, rede, filesystem ou credenciais. Toda ação passa por uma `ToolRegistry` com schemas Zod. Imóveis citados ao lead são exclusivamente os objetos retornados pelo `PropertyRepository`.

O modo `mock` executa a demonstração sem credenciais. Em produção, `OpenAILLMProvider` e `MetaWhatsAppProvider` substituem os mocks por configuração.

## B. Fluxo completo

```text
WhatsApp Cloud API                  POST /dev/simulate-message (somente dev)
        |                                          |
        +------------------+-----------------------+
                           v
                 Fastify / validação Zod
                 assinatura Meta / rate limit
                 tenant / correlationId
                           |
                           v
                 MessageIngestionService
                 idempotência por message id
                           |
                           v
                ConversationOrchestrator
                  |                    |
                  v                    v
        summary + mensagens       LLMProvider
             recentes          extração estruturada
                  |                    |
                  +---------+----------+
                            v
                    schema Zod + fallback
                            |
                            v
                     ToolRegistry segura
              +-------------+-------------+
              |             |             |
              v             v             v
       Lead/profile     Property       handoff /
       + score          search/rank    appointment
              |             |             |
              +-------------+-------------+
                            v
                       PostgreSQL
              entidades + resumo + outbox
                            |
                            v
                   resposta fundamentada
                            |
                            v
                 WhatsAppProvider.sendText
                            |
                            v
                   WhatsApp Cloud API
```

Se a conversa estiver em `HUMAN_HANDOFF`, a ingestão apenas persiste novas mensagens; nenhuma resposta automática comum é enviada. O endpoint `resume-ai` reativa explicitamente a automação.

## C. Schema principal

- `Tenant`: raiz de isolamento.
- `Broker`: corretor de um tenant.
- `Lead`: contato, intenção, perfil estruturado, score e temperatura.
- `Conversation`: canal, estado `AI_ACTIVE/HUMAN_HANDOFF/CLOSED` e timestamps.
- `Message`: direção, remetente, conteúdo, tipo, estado de processamento, metadata e id externo idempotente.
- `ConversationSummary`: memória estruturada compacta em relação 1:1.
- `Property`: catálogo, disponibilidade, atributos, features e imagens.
- `PropertyInterest`: imóveis apresentados/visualizados/favoritados pelo lead.
- `Appointment`: solicitação/agendamento de visita.
- `LeadAssignment`: atribuição do lead a um corretor.
- `FollowUpJob`: infraestrutura de follow-up com data, status e payload.
- `OutboxEvent`: eventos persistidos para entrega confiável ao n8n.

As entidades de negócio possuem `tenantId`; índices e chaves únicas incorporam o tenant quando necessário. Valores monetários usam `Decimal`, não ponto flutuante.

## D. Estrutura de pastas implementada

```text
src/
  application/
    appointments/       # serviço de agendamento
    handoff/            # transferência e retomada da IA
    ingestion/          # idempotência e pipeline de mensagens
    orchestrator/       # estado e decisões da conversa
    responses/          # respostas determinísticas
    tools/              # tools allowlisted e validadas
  config/               # env validado
  domain/               # tipos, scoring, matching, erros
  infrastructure/       # Prisma, logging, outbox
  integrations/
    ai/                 # interface, mock e OpenAI
    calendar/           # interface e mock
    crm/                # interface e implementação local
    whatsapp/           # interface, mock e Meta Cloud API
  modules/
    appointments/
    conversations/
    followups/
    leads/
    properties/
  routes/               # adaptadores HTTP
  types/                # extensões de tipos do Fastify
  app.ts
  container.ts
  server.ts
prisma/
  migrations/
  schema.prisma
  seed.ts
tests/                  # domínio, aplicação, providers e isolamento
n8n/                    # três workflows importáveis
docs/                   # arquitetura, API, operação e status
```

## E. Componentes entregues

- Configuração e execução: TypeScript strict, env validado, Dockerfile e Compose.
- Persistência: schema Prisma, migration inicial e seed idempotente com 28 imóveis fictícios.
- Bootstrap: servidor Fastify, container de dependências e encerramento controlado.
- Domínio: perfil e score do lead, filtros e ranking de imóveis, erros tipados.
- Infraestrutura: Prisma, logs estruturados e outbox persistente com worker.
- Integrações: LLM mock/OpenAI, WhatsApp mock/Meta, Calendar mock e CRM local.
- Aplicação: ingestão idempotente, memória, tools seguras, orquestrador, handoff e agendamento.
- HTTP: health, webhook Meta, simulador, imóveis, leads, conversas e agendamentos.
- Qualidade: 53 testes automatizados, documentação e três workflows n8n.

O estado verificável de cada etapa está em [PROJECT_STATUS.md](PROJECT_STATUS.md).

## F. Decisões técnicas

1. **Fastify** em vez de NestJS: menor superfície e inicialização rápida, mantendo módulos e injeção explícita.
2. **Prisma**: schema tipado, migrations reproduzíveis e boa legibilidade para a equipe piloto.
3. **PostgreSQL/Supabase compatível**: PostgreSQL local via Compose; `DATABASE_URL` conecta igualmente ao Supabase.
4. **Outbox no banco**: eventos sobrevivem a restart e podem ser reenviados; não há Kafka/Redis.
5. **Zod nas fronteiras**: HTTP, env, outputs do LLM e argumentos de tools são validados.
6. **Providers desacoplados**: seleção por env, com mocks seguros para demo.
7. **API interna por chave**: `X-API-Key` e `X-Tenant-Id`; webhook Meta usa assinatura própria.
8. **Memória limitada**: resumo estruturado mais últimas 12 mensagens.
9. **Scoring/ranking determinísticos**: regras declarativas e funções puras, fáceis de ajustar.
10. **Sem resposta inventada**: o código formata cartões de imóveis diretamente dos resultados do repositório; o LLM não recebe liberdade para criar ofertas.

## G. Riscos e atenção

- A Meta exige verificação do webhook, assinatura e templates aprovados fora da janela de atendimento; credenciais reais precisam ser configuradas antes do piloto.
- Webhooks podem chegar duplicados e concorrentes. A constraint única no banco é a garantia final de idempotência.
- Todo novo repositório deve receber `tenantId`; uma consulta sem escopo é tratada como defeito de segurança.
- Outputs de LLM podem ser inválidos ou sofrer prompt injection. Eles são tratados como dados não confiáveis, validados e limitados a uma allowlist.
- O mock de linguagem cobre frases comuns em português, mas não substitui a qualidade do provider real em linguagem livre.
- Falha entre persistência e envio ao WhatsApp é registrada; produção deve operar retries/alertas sobre mensagens e outbox pendentes.
- A chave de API simples é apropriada para o piloto interno, não para um painel SaaS público. Evoluir para identidade, papéis e auditoria antes do multi-tenant comercial.
- O endpoint de desenvolvimento é registrado somente quando `NODE_ENV=development`.
