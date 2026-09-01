# ImobFlow AI

Plataforma de atendimento imobiliário com IA, composta por uma API completa e um painel visual interativo.

## Estrutura

- `apps/api`: backend Fastify + Prisma, integrações com IA, WhatsApp, CRM e calendário, testes e documentação operacional.
- `apps/dashboard`: aplicativo visual em React/Vinext, publicado com OpenAI Sites.

## Aplicativo publicado

https://imobflow-ai-demo.carvalho15.chatgpt.site/

## Desenvolvimento

Requisitos: Node.js 22+ e pnpm 11.

```bash
pnpm install
pnpm dev:dashboard
```

Para executar a API:

```bash
cp apps/api/.env.example apps/api/.env
pnpm db:generate
pnpm dev:api
```

Os valores de `.env.example` são apenas exemplos locais. Nunca envie credenciais reais ao repositório.

## Verificação

```bash
pnpm build
pnpm test
```

Consulte `apps/api/docs` para arquitetura, API, operação e estado atual do projeto.
