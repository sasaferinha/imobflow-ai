# Conversas: ordem e nao lidas

- A lista e ordenada pela ultima mensagem persistida (data completa e desempate por ID), sem trocar a conversa que a pessoa esta atendendo. Previa e horario vem de um resumo por conversa, inclusive para conversas fora das ultimas 200 mensagens globais.
- O menu Conversas soma mensagens RECEBIDAS ainda nao lidas, nao a quantidade de contatos. Cada contato tambem mostra seu contador e o filtro Nao lidas usa esse estado. Acima de 99, o selo compacto mostra 99+; o nome acessivel conserva o total.
- Leitura e individual por conta/corretor, salva no banco e compartilhada entre sessoes da mesma conta. Nao representa confirmacao de leitura do aplicativo WhatsApp nem envia recibos a Meta.
- A leitura exige historico carregado, aba visivel, janela em foco e rolagem no fim. A fronteira de recebimento e capturada ANTES de buscar mensagens. Eventos recebidos durante esse intervalo nao sao apagados por uma confirmacao atrasada. O cursor so avanca; falhas conservam o contador para nova tentativa.
- Na primeira ativacao nao existia historico confiavel de leituras. As mensagens recebidas antigas entram na contagem ate abrir as respectivas conversas. Nao inventar leituras anteriores nem zerar contas de outros corretores.

## Banco e desempenho

`20260928210000_conversation_inbox.sql` cria `conversation_inbox` (um resumo por conversa) e `conversation_reads` (um cursor por corretor/conversa). Um trigger AFTER INSERT atualiza o contador de recebidas atomicamente, inclusive para eventos atrasados; duplicatas rejeitadas pela PK/identificador externo nao contam duas vezes. RLS e grants bloqueiam anon/authenticated; RPCs validam conta ativa e empresa, e FKs compostas impedem cruzamento de tenants.

O resumo e consultado a cada 5 segundos enquanto a pagina esta visivel, sem recarregar o historico completo. Nao e websocket nem entrega instantanea: ha o intervalo de consulta e o tempo da rede. O historico da conversa selecionada conserva sua paginacao e sincronizacao existente. Mensagens de clientes nunca sao enviadas para testar o recurso.

Aplicar a migration exata antes da publicacao e registrar a versao. O backfill bloqueia INSERTs por uma transacao curta, com lock_timeout de 5 segundos; na verificacao previa a base tinha 163 mensagens. Nao usar db push da copia antiga. Em rollback da aplicacao, conservar as tabelas e o trigger para nao perder fronteiras. Exclusao fisica futura de mensagens exige manter/reconstruir o resumo; nao remover esse FK para contornar o problema.

## Verificacao

- `node scripts/test-conversation-inbox.cjs`: SQL real/PGlite, backfill, ordem, mais de 200 nao lidas, usuarios/empresas isolados, mensagens atrasadas, duplicatas, leituras fora de ordem, API/CSRF e efeito real do componente (visibilidade/foco/rolagem/falha/repeticao/cleanup/demo).
- `node scripts/test-dashboard-efficiency.cjs`: resumo leve em todas as abas, soma e ocultacao do badge, sem retomada das consultas pesadas em abas fechadas.
- `pnpm --dir apps/dashboard run build:production`: suites anteriores, paginacao, TypeScript e build Next.
- ESLint dos componentes/rotas/helpers alterados sem erros.

Testes isolados nao substituem verificacao do dominio, schema e navegacao autenticada apos o deploy. Nao foi feito teste de carga de producao nem envio real a clientes.
