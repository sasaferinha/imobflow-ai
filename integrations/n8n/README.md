# Integrações externas opcionais

O núcleo do ImobFlow não depende de n8n. Atendimento do WhatsApp, qualificação,
matches, oportunidades, notificações e varredura diária são executados pelo
backend do produto.

Esta pasta fica reservada para conectores futuros com sistemas externos, como
Imoview, Kenlo, Vista, Google Calendar e Google Sheets. Cada conector deve usar
uma credencial exclusiva por empresa, autenticar a origem e manter `company_id`
definido pelo servidor. Um payload externo nunca escolhe a empresa.

A antiga rota `/api/integrations/n8n/property-offer` responde HTTP 410. Isso
impede que workflows antigos continuem disparando ofertas automáticas.
