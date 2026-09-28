# Corretores e consultas do painel — 28/09/2026

## Alteracoes

- Excluir corretor arquiva o cadastro, desativa acesso, revoga sessoes e links de recuperacao e oculta a linha em Corretores. Nao apaga leads, mensagens, negocios ou atribuicoes historicas. Administrador nao pode ser excluido. A API usa a empresa e identidade da sessao; o RPC confere novamente o tenant e bloqueia a vaga durante a transacao.
- Nao ha restauracao pelo painel. O identificador e os campos unicos de nome/email continuam reservados para preservar identidade. Uma eventual restauracao administrativa deve limpar `archived_at` explicitamente, respeitar as vagas e somente entao ativar. Nao recriar identidade nem apagar historico para reutilizar email.
- Consultas globais de mensagens apenas na aba Conversas; agenda apenas na aba Agenda. Leads continuam sendo atualizados separadamente, a cada 15 segundos em Leads/Conversas e 60 segundos nas demais telas. Atualizacoes por eventos/foco continuam ativas.
- Deduplicacao de leads e agrupamento de mensagens lineares; fila/status de entrega consultados apenas para mensagens de saida da pagina atual. Lotes de eventos em paralelo, no maximo quatro; nenhuma varredura do historico de entrega.
- Agenda vazia nao busca relacionamentos. Agenda com dados busca nomes/titulos, em paralelo, sem fotos e perfis completos.
- Conversas, importacao, integracao WhatsApp e modal de equipe carregam seus componentes sob demanda.

## Validacao

`pnpm --dir apps/dashboard run build:production` inclui testes de API, SQL/PGlite, controles de tenant, confirmacao de exclusao, efeitos reais dos componentes, paginação de 12.050 mensagens e build Next/TypeScript. ESLint dos arquivos alterados: sem erros; aviso preexistente de `normalizePhone` sem uso.

Os testes usam dados ficticios; nao sao um teste de carga da producao. Nao foi excluido corretor real para validar o recurso. A conexao e entrega WhatsApp nao foram modificadas.

## Publicacao e recuperacao

Aplicar somente `20260928180000_archive_brokers.sql` antes do deploy e registrar essa versao no historico do Supabase. Nao executar db push da copia antiga: ha outras migrations ainda nao alinhadas no historico remoto. A migration e aditiva e inicialmente nao altera nenhum cadastro.

Se houver rollback do aplicativo, manter a coluna/constraint/RPC: versoes antigas continuam sem permitir login de arquivados, embora possam voltar a exibi-los como inativos. Nao remover coluna nem constraint depois de arquivar registros.

## Crescimento

Historico de mensagens permanece paginado (50 por conversa, 200 no resumo global). A consulta global ainda le todas as conversas, e leads/catalogo ainda usam listas completas com limite operacional de 10 mil registros; esta entrega nao elimina esse limite. Para volumes maiores: resumo indexado por conversa, busca/paginacao de contatos no servidor, fotos fora do JSON do catalogo, atualizacoes incrementais/realtime com reconciliacao e teste de carga medindo p95/erros. Medir antes de contratar infraestrutura adicional; nao prometer ganho percentual sem baseline equivalente.
