# Auditoria de indisponibilidade — 14/09/2026

## Execução

- `pnpm test`: 17 scripts concluídos, sem falhas.
- `test-pilot-conversations.cjs`, `test-dashboard-sync.cjs`, `test-property-api.cjs`: concluídos, sem falhas.
- `test-outage-audit.cjs`: diagnóstico isolado adicional confirmou uma lacuna de recuperação.
- Produção: página inicial, painel, versão e saúde do banco HTTP 200; banco informou conexão ativa. Conversas sem autenticação HTTP 401. Endpoint de e-mail informou configuração presente; isso não comprova entrega.

## Proteções verificadas

- Falha simulada de IA mantém resposta determinística útil. Casos de ausência, resposta inválida e timeout simulados estão cobertos.
- Recusas temporárias da Meta (429 e 503 com erro explícito) mantêm envio pendente com intervalo e limite de três tentativas.
- Token inválido vira falha; não é repetido indefinidamente.
- Timeout e recibo ausente/ambíguo ficam incertos, sem reenvio cego.
- Travas, tentativas concorrentes, recibos atrasados, idempotência e recuperação de execuções interrompidas testados em banco isolado PGlite.
- Falha transitória ao persistir recibo tenta persistência novamente, sem repetir POST à Meta.
- Falha do banco antes de importar mensagem retorna 500, sem confirmar importação.
- Pausa humana impede retomada indevida do bot; controles entre empresas passaram.

## Lacuna confirmada: mensagem recebida sem resposta enfileirada

O webhook confirma recebimento depois de salvar a mensagem e agenda resposta com `after`. Se essa etapa falhar antes de enfileirar a resposta, apenas registra erro. Um webhook duplicado retorna `saved: false` e não agenda nova resposta. A recuperação existente percorre a fila de saída, não entradas sem resposta. Portanto, esse caso pode deixar o cliente sem resposta automática.

Reproduzido em teste do handler real, com dependências externas simuladas: falha antes de salvar -> 500; persistência bem-sucedida -> 200; falha de resposta em segundo plano; repetição da entrada -> nenhuma nova resposta agendada.

Recomendação: fila durável de processamento de entradas, recuperação limitada e idempotente, respeitando pausa humana e validade da conversa. Não implementado nesta auditoria.

## Limites

Não desligamos provedores, alteramos credenciais, enviamos mensagens a clientes ou provocamos indisponibilidade real. Não confirmamos nesta rodada execução atual do cron privado em produção, restauração de backup nem concorrência entre conexões reais do banco hospedado. Testes simulados não garantem disponibilidade. A consulta de saúde é apenas uma fotografia do momento.

Nenhuma mudança funcional ou publicação realizada; somente script diagnóstico e relatório adicionados.
