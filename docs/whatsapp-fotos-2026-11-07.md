# Envio de ofertas com fotos pelo WhatsApp da imobiliária

## Implementação

- Oportunidades permite selecionar até cinco fotos, editar o texto, conferir destinatário e confirmar o envio pelo número conectado da imobiliária.
- Texto e cada foto são mensagens separadas, com recibos individuais. Aceitação na fila não significa entrega; webhooks existentes atualizam entrega/leitura.
- A conversa precisa existir no WhatsApp integrado, estar assumida pelo corretor conectado e ter recebido uma mensagem do cliente nas últimas 24 horas. Não transfere atendimento nem envia modelo pago automaticamente.
- Imagens precisam estar no catálogo atual do imóvel, no armazenamento da mesma empresa, em JPG/PNG. WebP e URLs externas são recusados no envio direto.
- Criação atômica do lote e chaves estáveis por tentativa evitam duplicação ao repetir a mesma solicitação. Resultados incertos do provedor não são reenviados automaticamente. Fechar e abrir novamente a oferta exige conferir o histórico antes de fazer outro envio.
- Envios demorados ou recusados temporariamente permanecem na fila existente; recuperação depende do executor de mensagens configurado. O resultado de cada mensagem fica visível, sem prometer entrega do lote inteiro.
- Compartilhamento manual continua em uma seção secundária, com indicação das limitações do navegador.

## Banco

Migration: `supabase/migrations/20261108010000_property_whatsapp_media.sql`.
Aplicada pelo SQL Editor no projeto ImobFlow em transação, com registro em `supabase_migrations.schema_migrations`, antes da publicação. Sem inserir clientes ou mensagens reais.
MD5 do conteúdo normalizado para LF: `5b2ef53a3cf80b573803d236ea33be61`.
Compatibilidade verificada com `properties.images` e `messages.media_urls` em `text[]` no remoto; testes locais cobrem também JSONB.
As novas funções e tabela são privadas para o servidor; anon/authenticated não recebem acesso.

## Validação

- `pnpm --dir apps/dashboard run build:production`: passou.
- `pnpm --dir apps/dashboard exec tsc --noEmit`: passou.
- `pnpm --dir apps/dashboard run test:property-whatsapp`: contratos UI/API/SQL, confirmação, texto editado, fotos selecionadas, origem, isolamento, repetição, expiração, recibos e recuperação; nenhum envio real.
- Lint do código versionado passou com quatro avisos anteriores. O lint sem excluir a pasta local ignorada `work` encontra nove erros no arquivo antigo `work/qa-conversation.cjs`; esse arquivo não faz parte da publicação.
- Entrega real de texto/fotos ainda requer teste autorizado com telefone do proprietário. Não comprovada por testes simulados ou pelo build.

## Reversão

Reverter o commit da aplicação por novo commit, sem reset/force push. Manter a migration aditiva e os recibos para auditoria; não apagar fila/histórico. Uma reversão não cancela mensagens já aceitas pelo provedor. Não remover o leitor de `image_url` enquanto houver lotes de fotos pendentes.
