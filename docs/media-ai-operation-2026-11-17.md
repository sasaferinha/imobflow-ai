# Operação do estúdio de IA — 17/11/2026

O estúdio usa serviços reais para aprimorar uma foto ou criar um vídeo de cinco segundos. A integração fica na demonstração autenticada em `/modelo-imobiliaria/midias`, com acesso de administrador (`owner`). O catálogo de imóveis de clientes não é alterado por uma geração.

Este documento descreve código e procedimentos. Sua presença no Git não comprova que a migration foi aplicada, que os agendadores foram ativados ou que houve uma chamada paga. Nenhuma credencial deve ser registrada aqui.

## Escopo e permissões

- A sessão real do CRM determina `company_id` e `actor_id`. O identificador fictício do modelo público não autoriza uso da IA.
- Os quatro imóveis de demonstração têm posições de foto permitidas pelo servidor e pelo banco. O navegador não fornece uma URL para o servidor buscar imagens nem escolhe o fornecedor/modelo.
- A criação exige proprietário ativo, empresa correta, permissão explicitamente habilitada e chave do fornecedor. A reserva e o claim conferem novamente a autorização no banco.
- `media_ai_entitlements` e `media_ai_jobs` têm RLS obrigatória, bloqueio restritivo para `anon`/`authenticated` e acesso de serviço. O proprietário do CRM não consegue se habilitar ou aumentar a cota pelo navegador.
- Consultas e arquivos retornados pela aplicação são limitados à empresa e ao administrador que criou o pedido. A coleta interna trabalha com a identidade persistida de cada pedido e não cria novas gerações.
- O usuário compara o resultado com a foto original antes de aprovar. Prompts de preservação não garantem fidelidade: alterações de geometria, materiais ou defeitos devem ser rejeitadas. Não há publicação automática no site real.

## Configuração de servidor

| Variável/recurso | Utilização |
| --- | --- |
| `MEDIA_AI_OPENAI_KEY` | Chave dedicada, preferencial, para aprimoramento de fotos. |
| `OPENAI_API_KEY` | Alternativa quando a chave dedicada não está configurada; pode compartilhar a conta usada por outras funções do CRM. |
| `RUNWAYML_API_SECRET` | Chave de API de desenvolvedor da Runway para criar/consultar vídeos. |
| `SUPABASE_URL` e `SUPABASE_SECRET_KEY` | Banco e armazenamento privados, exclusivamente no servidor. |
| `MESSAGE_RECOVERY_SECRET` | Protege `POST /api/media-studio/recover`. Reutiliza a credencial existente da recuperação de mensagens. |
| Vault `imobflow_message_recovery_secret` | Deve corresponder a `MESSAGE_RECOVERY_SECRET`; o agendador utiliza o valor existente, sem criá-lo ou substituí-lo. |
| `CRON_SECRET` | Protege a limpeza em `GET /api/media-studio/maintenance`. |

Configure chaves pelo gerenciador de segredos do ambiente; nunca por `NEXT_PUBLIC_*`, arquivos versionados, respostas HTTP ou mensagens no chat. Não copie valores da fila interna do `pg_net`: ela contém temporariamente o cabeçalho de autorização.

Modelos e contratos de entrada/saída estão em `docs/media-ai-providers-2026-11-17.md`. A presença de uma chave não comprova créditos, acesso ao modelo nem autorização para gastar.

## Limites e prevenção de cobrança duplicada

O padrão de `media_ai_entitlements` é `enabled=false`, `photo_enabled=true`, `video_enabled=false`, três fotos e um vídeo por empresa por dia UTC. Sem linha de permissão, o acesso também fica fechado. Nenhuma empresa recebe habilitação automática nesta migration.

Os limites individuais aceitam valores de 1 a 10, alteráveis somente por serviço autorizado. Há também um teto global de 100 reservas de foto e 100 de vídeo por dia UTC. A quota é compartilhada entre os administradores da mesma empresa.

Cada reserva conta, inclusive quando termina em `failed` ou `unknown`. Isso evita tentativas ilimitadas quando a resposta do fornecedor é incerta. Os locks transacionais seguem a ordem global/tipo/dia e depois empresa. O banco não conta apenas os arquivos concluídos.

`request_id` e hash da entrada identificam o pedido dentro da empresa/administrador. Repetir a mesma requisição recupera a mesma linha; trocar a foto ou os parâmetros mantendo o identificador causa conflito. Somente um claim pode mudar `reserved` para `submitting`.

Uma reserva ainda não enviada vence na virada do dia UTC. O erro `media_reservation_expired` exige um novo pedido, que usa a quota atual. Reservas expiradas ou já purgadas também não podem iniciar uma chamada. Gerações já enviadas nunca voltam automaticamente a `reserved`.

Entradas raster têm limite de 2 MiB, decodificação e normalização no servidor. Os caminhos privados são gerados como `empresa/pedido/input.jpg`, `empresa/pedido/result.jpg` ou `empresa/pedido/result.mp4`. Vídeos e bucket têm limite de 30.000.000 bytes. URLs e credenciais do fornecedor não são persistidas na tabela de jobs.

## Ordem de implantação

1. Conferir a sincronização e preservar quaisquer alterações de outro computador conforme `docs/sincronizacao.md`. Executar os testes pertinentes e revisar o diff. Não publicar uma árvore não registrada no GitHub.
2. Aplicar primeiro `supabase/migrations/20261117010000_media_ai_jobs.sql` no projeto Supabase correto, pelo acesso autorizado. Conferir tabelas, funções, RLS, grants e bucket privado `media-ai`. Manter as permissões desabilitadas.
3. Configurar/verificar as variáveis de servidor no ambiente de destino sem expor seus valores. Confirmar que as duas pontas da recuperação utilizam a credencial já existente; não rotacionar o segredo compartilhado durante esta implantação.
4. Publicar a revisão que corresponde ao código testado e conferir o domínio/versão. Verificar autenticação, bloqueio para visitantes/corretores e estado desabilitado sem acionar geração paga.
5. Somente após o endpoint de recuperação estar publicado, aplicar manualmente `supabase/operations/media-ai-recovery-cron.sql`. Esse arquivo de operações não faz parte das migrations automáticas: instala um job **inativo**, não chama HTTP, não habilita IA e não altera o agendador de WhatsApp.
6. Conferir os metadados do novo job e do endpoint. Ativar apenas `imobflow-media-ai-recovery` com `cron.alter_job(job_id, active := true)` usando o identificador lido em `cron.job`. Não substituir outros jobs nem executar o arquivo de instalação repetidamente: ele rejeita uma instalação existente para exigir revisão.
7. Confirmar a conta de desenvolvedor/créditos da Runway e o teto de gasto autorizado para o teste. Só então habilitar a empresa real verificada em `media_ai_entitlements`, primeiro com as menores cotas necessárias. Esse registro é administrado no servidor, não pelo editor de demonstração.
8. Fazer o teste real controlado: uma foto, comparação/aprovação, um vídeo, retomada pelo histórico e download. Conferir a cobrança no fornecedor, o tenant/ator registrados e os limites. Não considerar mocks ou build como prova de entrega real.

Antes de liberar a empresa piloto, confirmar que o ambiente aceita a duração das rotas: criação até 300 segundos, recuperação até 180 segundos e manutenção até 60 segundos. A disponibilidade de cada modelo e a duração efetiva também dependem dos planos dos serviços.

## Recuperação sem depender do navegador

O job `imobflow-media-ai-recovery` verifica a fila a cada dois minutos. Ele só despacha HTTP quando há vídeo Runway `processing`, com tarefa conhecida, `poll_after` vencido, ainda dentro do prazo e sem `purged_at`.

A chamada é exclusivamente para `POST https://www.imobflow.net.br/api/media-studio/recover`; a rota coleta até três tarefas existentes. Ela consulta/downloads resultados e usa a mesma proteção de lease da interface. Não chama a criação de vídeo nem reserva quota nova.

O agendador tem lock próprio e impede sobreposição enquanto a chamada anterior estiver pendente ou tiver timeout de transporte, por até 180 segundos. O timeout HTTP é 170.000 ms. O script exige APIs de `pg_cron`, `pg_net`, Vault e a migration de jobs já existentes; não instala extensões nem cria segredos. Se `pg_net.max_timeout_ms` estiver disponível, ele deve permitir pelo menos 170.000 ms. A API oficial documenta o parâmetro inteiro de timeout e a configuração atual de teto: [referência pg_net](https://supabase.github.io/pg_net/api/), [configuração upstream](https://github.com/supabase/pg_net#extension-configuration).

O banco registra apenas horários, ID da requisição, status HTTP e estado operacional em `media_ai_scheduler`. `service_role` pode ler esses metadados; não pode executar o dispatcher nem editar essa tabela. Não registrar corpos/respostas integrais do fornecedor.

É necessário ativar e observar esse worker para coletar os vídeos antes que expirem as URLs temporárias do fornecedor. Com ele inativo ou indisponível, a interface pode consultar uma tarefa existente enquanto aberta, mas isso não substitui a coleta em segundo plano.

## Estados e tratamento de falhas

| Estado | Conduta |
| --- | --- |
| `reserved` | Ainda não enviado. Somente o claim vencedor pode continuar, no mesmo dia UTC. |
| `submitting` | Envio em andamento. Nunca criar outro pedido automaticamente para substituir este. |
| `processing` | Tarefa de vídeo conhecida. Recuperar sempre pelo mesmo ID, respeitando `poll_after`. |
| `completed` | Arquivo copiado para o bucket privado e metadados persistidos. Recuperação não aciona geração. |
| `failed` | Falha confirmada. A quota reservada permanece consumida; outro pedido é uma decisão explícita. |
| `unknown` | A chamada pode ter sido aceita/cobrada. Não reenviar nem alterar o estado manualmente para `reserved`. Conferir fornecedor, arquivo eventualmente salvo e histórico antes de qualquer intervenção. |

Um processo interrompido após o envio fica conservadoramente não reenviável; `submitting` antigo é apresentado como situação incerta. Quando existe `provider_task_id`, a recuperação pode continuar consultando aquela tarefa. Quando o ID nunca foi salvo, não há descoberta automática garantida da cobrança/saída: exige investigação do fornecedor.

Desabilitar `enabled`, `photo_enabled` ou `video_enabled` impede novas gerações. Resultados já existentes podem continuar disponíveis ao administrador que os criou até expirar; a coleta de uma tarefa conhecida também não cria novo gasto de geração.

## Retenção e observação

O prazo de acesso é sete dias a partir da reserva, e o backend recusa arquivos expirados. O cron da Vercel em `/api/media-studio/maintenance` está previsto para **10:00 UTC** diariamente. Ele remove somente os caminhos privados fixos de entrada e saída e marca `purged_at` depois da remoção.

A remoção física ocorre no próximo ciclo de limpeza que conseguir terminar; falhas permanecem elegíveis para nova tentativa. Não há promessa de remoção física exatamente no instante da expiração. IDs, status, quotas, hashes, caminhos e datas continuam no banco para idempotência e auditoria. Não apagar a linha do job para liberar quota nem limpar `result_path` de uma linha concluída.

Consultas de observação que não revelam credenciais:

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'imobflow-media-ai-recovery';

SELECT last_tick_at, last_request_at, last_request_id,
       last_http_status, last_success_at, last_result
FROM public.media_ai_scheduler;

SELECT kind, status, count(*)
FROM public.media_ai_jobs
WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
GROUP BY kind, status;

SELECT count(*) AS aguardando_remocao
FROM public.media_ai_jobs
WHERE expires_at <= now() AND purged_at IS NULL;
```

Para conter um problema, desabilitar primeiro as permissões da empresa. Se necessário, desativar somente o cron de recuperação de mídia. Preservar tabelas, arquivos e os agendadores de mensagens enquanto se investiga; não repetir gerações incertas.

## Validações locais e dependências restantes

```powershell
node apps/dashboard/scripts/test-media-ai-jobs-sql.cjs
node apps/dashboard/scripts/test-media-ai-scheduler-sql.cjs
node apps/dashboard/scripts/test-media-ai-providers.cjs
```

O teste de jobs executa as migrations em PostgreSQL/WASM isolado e verifica permissões, isolamento, quotas, reserva única, claim, caminhos, histórico, lease e expiração. O teste do agendador executa o arquivo de operações sem alterações, com `net`/`cron`/Vault inertes e sem rede; imprime o SHA-256 do arquivo revisado. Os testes de fornecedor usam respostas e chaves sintéticas. Complementar com os testes de backend/interface e build da revisão antes de publicar.

Dependências para validar a entrega real: acesso ao projeto correto no Supabase/Vercel, aplicação da migration, confirmação/ativação do worker após publicar, credenciais e créditos das APIs, e limite de gasto autorizado pelo usuário. Até isso ocorrer, descrever a integração como implementada e testada localmente; não afirmar que houve aprimoramento ou geração real em produção.
