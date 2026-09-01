# Status atual do projeto

Este documento é o retrato estrutural do MVP em 27 de agosto de 2026. Ele separa o que já existe no repositório do que ainda depende de validação operacional ou evolução posterior.

## Visão rápida

```text
Canal / simulador
       |
       v
Rotas Fastify + autenticação + Zod
       |
       v
Ingestão idempotente de mensagens
       |
       v
Orquestrador de conversa
  |        |         |          |
  v        v         v          v
LLM      Tools     Handoff   Agendamento
  |        |         |          |
  +--------+---------+----------+
           |
           v
   Repositórios Prisma
           |
           v
 PostgreSQL + Outbox -> n8n
```

## Mapa da estrutura

| Camada | Local | Responsabilidade | Estado |
|---|---|---|---|
| Bootstrap | `src/app.ts`, `src/server.ts`, `src/container.ts` | Fastify, plugins, injeção de dependências e lifecycle | concluída |
| Configuração | `src/config` | validação de env e seleção de providers | concluída |
| Domínio | `src/domain` | perfil, score, matching e erros | concluída |
| Aplicação | `src/application` | ingestão, orquestração, tools, handoff e visitas | concluída |
| Módulos | `src/modules` | repositórios de leads, imóveis, conversas, visitas e follow-ups | concluída |
| Integrações | `src/integrations` | OpenAI, Meta WhatsApp, mocks, calendário e CRM | concluída para MVP |
| Infraestrutura | `src/infrastructure` | Prisma, logging e outbox | concluída |
| API | `src/routes` | health, webhooks, CRUD e simulador | concluída |
| Banco | `prisma` | schema, migration e seed com dados fictícios | concluída |
| Automação | `n8n` | webhook, follow-up e aviso ao corretor | artefatos prontos para importar |
| Testes | `tests` | regras críticas e contratos de providers | 53 testes passando |
| Documentação | `README.md`, `docs` | execução, API, arquitetura e operação | concluída |

## Ordem original de implementação

As quinze etapas estruturais solicitadas estão representadas no repositório:

1. scaffold, TypeScript, env, Docker, PostgreSQL e health check;
2. schema, migration e seed;
3. repositório, filtros e ranking de imóveis;
4. repositório e score de leads;
5. conversas, mensagens e resumo;
6. abstração de LLM com mock e OpenAI;
7. tool registry segura;
8. orquestrador de conversa;
9. provider WhatsApp mock e Meta;
10. handoff humano e retomada da IA;
11. agendamentos e `CalendarProvider` mock;
12. outbox e infraestrutura de follow-up;
13. testes automatizados;
14. workflows n8n;
15. README, referência HTTP e runbook.

## Verificações executadas

- Prisma Client gerado a partir do schema atual.
- TypeScript strict: sem erros.
- Vitest: 8 arquivos e 53 testes aprovados.
- Nenhum arquivo-fonte vazio, marcador de merge ou placeholder oculto foi encontrado.

## O que ainda precisa de ambiente externo

Estes itens não são lacunas da estrutura, mas precisam ser validados no ambiente do piloto:

- subir PostgreSQL, aplicar migration e executar o seed;
- iniciar a API e realizar o fluxo end-to-end pelo `/dev/simulate-message`;
- importar e configurar os workflows no n8n;
- validar credenciais e webhook da Meta em um número de teste;
- validar a OpenAI real com chave e modelo disponíveis para a conta;
- executar smoke test do Docker Compose no host de implantação.

## Limites assumidos nesta fase

- Não há frontend ou dashboard.
- O webhook Meta usa `DEFAULT_TENANT_ID`; roteamento por `phone_number_id` fica para o multi-tenant real.
- Calendar é mock e CRM é local.
- Áudio, imagem e documento recebem tratamento seguro, sem transcrição ou visão.
- A outbox possui retry, mas ainda não tem painel de replay, lease/reaper ou DLQ dedicada.

Com essa base congelada, as próximas alterações podem ser feitas por módulo sem reorganizar novamente o projeto inteiro.
