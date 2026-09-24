# Fotos de imóveis no WhatsApp

## Funcionamento

A ação manual **Enviar imóvel** no portfólio e na conversa enfileira o texto e até cinco fotos cadastradas no imóvel da mesma imobiliária. Cada foto é uma mensagem `image` real da Meta com recibo e status próprios; não é apenas um link. A tela não afirma entrega no celular quando existe apenas aceite da API.

Fotos JPEG, PNG e WebP do armazenamento gerenciado são lidas pelo servidor, verificadas e convertidas em JPEG. A conversão limita entrada a 5 MB / 24 milhões de pixels e saída a 1600×1600, remove metadados e usa o upload de mídia da Meta. URLs externas, caminhos de outra empresa, redirecionamentos e imagens retiradas do imóvel são rejeitados. O bucket legado de imóveis permanece como estava; esta mudança não torna público nenhum bucket privado.

Os registros de texto e fotos são criados em uma transação, com chave idempotente. Cada foto aguarda o aceite da anterior. Falha ambígua após o POST de mensagem não provoca reenvio automático. Falhas antes do envio, inclusive upload de mídia, podem ser recuperadas pela fila. A alteração de responsável e a janela de 24 horas continuam verificadas no claim. Oferta de imóvel é registrada em `lead_property_events` somente no aceite do texto, também quando enviado pelo recuperador.

## Limites intencionais

- É uma oferta manual do corretor. O atendimento automático atual continua qualificando e encaminhando; não passa a disparar catálogos ou campanhas sozinho.
- Fotos livres exigem uma mensagem do cliente nas últimas 24 horas. Fora desse prazo, o corretor precisa enviar um modelo aprovado e aguardar resposta; este release não cria modelos de mídia na Meta.
- Cada foto pode ficar na fila quando o orçamento da requisição terminar. O recuperador precisa estar instalado e operacional; não depende de a aba permanecer aberta.
- Uma mídia removida ou um imóvel vendido/alugado antes do envio não deve continuar sendo oferecido. A preparação revalida imóvel e foto.

## Aplicação e validação

Aplicar `supabase/migrations/20260924130000_property_image_outbox.sql` depois de `20260912221000_message_recovery.sql` e das migrations de isolamento. A aplicação precisa dessa migration antes do deploy. Usa as credenciais Supabase/Meta já configuradas, sem novos segredos. Manter `supabase/operations/message-recovery-cron.sql` instalado, com segredo de recuperação correspondente à Vercel.

Teste local sem leads reais:

```powershell
node apps/dashboard/scripts/test-property-whatsapp-media.cjs
node apps/dashboard/scripts/test-message-recovery.cjs
```

Os testes cobrem conversão WebP real, MIME, limites, isolamento, payload Meta, recibos, ordenação, expiração da janela, atomicidade e retries. Não comprovam entrega real. Depois de publicado, testar uma única oferta com telefone consentido, mensagem recebida recentemente e imóvel de teste; conferir cada status no painel e as imagens no celular.

Referência: [Meta — Media](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media), [coleção oficial Meta no Postman](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3).
