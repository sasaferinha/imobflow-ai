# Provedores do estúdio de mídia — 17/11/2026

## Contratos implementados

`apps/dashboard/lib/media-studio/providers.ts` utiliza HTTP no servidor, sem SDK ou chamadas de criação repetidas automaticamente.

- Foto: `enhancePhoto` envia uma imagem raster de até 2 MiB ao endpoint `POST /v1/images/edits`, usando `gpt-image-2.6-sunburst`, qualidade média e complexidade baixa. Recebe um JPEG de até 10 MiB. A chave dedicada `MEDIA_AI_OPENAI_KEY` tem prioridade sobre `OPENAI_API_KEY`. Parâmetros conferidos na [referência oficial de edição de imagens](https://developers.openai.com/api/reference/resources/images/methods/edit).
- Vídeo: `startVideo` cria uma tarefa `gen4_turbo` de cinco segundos; `inspectVideo` consulta seu estado. Chave `RUNWAYML_API_SECRET`, versão de API `2024-11-06`, imagem em data URI e formatos horizontal/vertical. O [contrato oficial do SDK Runway](https://github.com/runwayml/sdk-node/blob/main/src/resources/image-to-video.ts) documenta esses campos.
- Consulta de vídeo: o chamador deve persistir o ID e consultar em intervalos de pelo menos cinco segundos. O adaptador retorna `progress` entre 0 e 1 quando disponível. Falhas terminais usam código interno genérico, sem repassar o diagnóstico do fornecedor. Ver [contrato oficial de tarefas](https://github.com/runwayml/sdk-node/blob/main/src/resources/tasks.ts).
- Download: `downloadVideo` aceita somente HTTPS no host exato `dnznrvs05pmza.cloudfront.net`, sem redirecionamento, credenciais na URL ou cabeçalho de autorização. Confere tamanho durante o streaming (até 30.000.000 bytes, o mesmo limite do armazenamento), MIME e assinatura MP4. O host é o exemplo publicado em [formatos de saída Runway](https://docs.dev.runwayml.com/assets/outputs/). Se o fornecedor entregar outro host, a operação bloqueia; uma ampliação exige confirmação documental. As URLs expiram em 24–48 horas, portanto o chamador deve copiar o resultado para armazenamento próprio e não expor a URL temporária ao cliente.

## Limites operacionais

Os prompts pedem preservação de geometria, materiais, cores e defeitos visíveis. São instruções ao modelo, não garantia de fidelidade: o resultado exige comparação e aprovação humana antes de uso comercial.

`MediaProviderError` contém apenas `code` e `ambiguous`. Em criação, erro de rede, timeout, HTTP 408/5xx ou resposta aceita inválida ficam ambíguos: a geração pode ter sido cobrada, e o chamador não deve criar outra automaticamente. Rejeições 4xx conhecidas e cancelamento anterior ao envio não são ambíguos. As consultas/downloads não iniciam novas gerações.

Os adaptadores não concedem acesso nem controlam orçamento: sessão, empresa, permissão, reserva de cota, idempotência, armazenamento privado e aprovação pertencem à orquestração. Não aceitar URLs de download enviadas pelo navegador. Nenhum resultado sintético ou processamento local substitui silenciosamente um erro de IA.

## Validação desta implementação

Testes de contrato com `fetch` simulado, bytes sintéticos e chaves fictícias: requisições, respostas, limites de entrada/stream, falsificação de MIME, timeout/cancelamento, resposta ambígua, ausência de retry, identidade da tarefa e bloqueio de URLs externas/redirecionamentos. Comando: `node apps/dashboard/scripts/test-media-ai-providers.cjs`.

Não foram feitas chamadas pagas. A qualidade visual, disponibilidade dos modelos para as contas contratadas e entrega real ainda dependem de credenciais e de um teste autorizado com limite de gasto.
