# Ajustes de atendimento — 29/09/2026

Investigacao da conversa solicitada: repeticao do resumo apos pedido de correcao e respostas concorrentes a mensagens consecutivas. Testes usam dados ficticios; nao sao enviados testes a clientes reais.

## Comportamento corrigido

- Pedidos naturais de correcao e rotulos como "bairro" ou "garagem" mudam a etapa da conversa, nao viram valores de cidade/bairro. Uma correcao explicita local tem prioridade sobre campos antigos ecoados pelo extrator de IA.
- Cumprimentos de quem ja informou suas preferencias oferecem manter ou alterar a busca. Confirmacoes curtas nao aprovam um resumo que acabou de mudar no mesmo lote ou cujo ultimo envio ainda esta pendente/cancelado.
- Resumos usam linhas com marcadores, apenas dados conhecidos, e uma pergunta ao final. Explicacoes, links e perguntas ficam separados por paragrafos. O painel preserva essas quebras de linha em texto simples.
- Mensagens recebidas dentro de uma janela de silencio de 3 segundos sao interpretadas em ordem e resultam em uma unica resposta. Apenas a ultima parte pode consultar o modelo; as anteriores usam o parser local.

## Protecoes de concorrencia e entrega

A migration `20260929050000_attendance_turns.sql` acrescenta sequencia de chegada, lease por conversa, watermark na outbox e metadados de encaminhamento. Uma transacao valida empresa, conversa, responsabilidade, pausa, versao do perfil e novas mensagens antes de aplicar o perfil e enfileirar a resposta. Conflito nao produz mensagem generica ao cliente.

Uma nova entrada invalida uma resposta automatica antiga ainda nao enviada, inclusive na ultima verificacao antes do POST para a Meta. O pedido de atendimento humano tem prioridade e nao deve desaparecer quando chega outra mensagem. A fila guarda esse pedido e permite recuperar uma falha transitoria sem liberar outros turnos automaticos.

A pausa apos encaminhamento usa uma reconciliacao limitada aos novos registros `attendance_handoff`, apos resultado terminal, na resposta direta ou no recovery. Pedidos pendentes mantem prioridade sem mudar o protocolo de tentativas dos envios manuais. Mudancas manuais de responsavel/liberacao invalidam apenas a reconciliacao tardia desse metadado. As funcoes compartilhadas de finalizacao e recuperacao da outbox nao foram substituidas.

Conteudo identico ja enviado ou com tentativa iniciada/ambigua nos ultimos 45 segundos e suprimido; uma resposta pendente obsoleta nao suprime sua substituta. A supressao continua salvando preferencias validas. Nao ha reenvio automatico quando o resultado do POST e ambiguo. Nao existe garantia de cancelamento depois que o POST ja foi iniciado.

O recovery conserva todas as partes validas ainda pendentes, respeita o limite de tentativas e a janela de 24 horas. Trabalhos historicos concluidos/cancelados nao sao reabertos. O lote e limitado a 40 partes; excesso direciona para uma pessoa, sem dezenas de chamadas ao modelo.

## Validacao e publicacao

```powershell
pnpm --dir apps/dashboard run test:bot-turns
pnpm --dir apps/dashboard run build:production
```

As regressões usam o worker real com fronteiras simuladas e PostgreSQL isolado (PGlite) para leases, perfil atomico, duplicatas, supersession, encaminhamento, recovery, estados da outbox e isolamento entre empresas. Nao comprovam entrega no celular nem concorrencia entre conexoes independentes em producao.

Aplicar somente a migration indicada antes do deploy do codigo que chama os novos RPCs. Ela nao apaga leads nem conversas, nao troca numeros/credenciais e nao envia mensagens. Nao executar um `db push` abrangente sobre a copia antiga deste computador. Conferir GitHub, versao publicada e saude depois do deploy. Nao reinjetar mensagens antigas para testar.

Rollback: voltar o codigo para a revisao anterior preserva a migration aditiva e os dados. Verificar primeiro trabalhos de turno pendentes e encaminhamentos; nao remover colunas/tabelas com trabalho em andamento nem repetir POSTs de resultado incerto. O caminho preferencial para defeitos de fila e uma correcao incremental revisada.
