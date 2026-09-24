# Configuração de WhatsApp em produção

Em 13/09/2026, `WHATSAPP_META_CONNECTIONS` foi atualizada para `[]` na
Vercel (Production), desativando o mapeamento legado conflitante.
As conexões e credenciais persistidas em `conversation_settings` foram
preservadas. A validação de duplicidade e isolamento permanece ativa.

Não reintroduzir associações antigas nessa variável ao publicar. Novas
imobiliárias devem conectar o número pelo painel. A consulta à Meta não
substitui o teste real de envio e recebimento.
