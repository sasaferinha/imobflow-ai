# Instagram: conexão simples e diagnóstico

## Situação verificada

Na conferência de 25–26/11/2026, a Vercel não tinha variáveis `META_INSTAGRAM_*` no projeto nem nas variáveis compartilhadas vinculadas. `META_SOCIAL_WEBHOOK_VERIFY_TOKEN` já existia em Production. Na Meta, o aplicativo Instagram próprio existia, mas seu retorno OAuth e o webhook nativo não estavam configurados. Isso impede o login direto, independentemente da conexão anterior do Facebook.

Após confirmação explícita do responsável, foi salvo na Meta o retorno `https://www.imobflow.net.br/api/integrations/meta/instagram/callback`. O identificador público do aplicativo Instagram foi cadastrado como `META_INSTAGRAM_APP_ID` em Production na Vercel. A chave secreta não foi revelada nem copiada para arquivos ou mensagens. Uma alteração de ambiente só entra em vigor em novo deployment.

Ainda é necessário inserir `META_INSTAGRAM_APP_SECRET` no ambiente de produção, verificar o webhook `https://www.imobflow.net.br/api/integrations/meta/instagram`, conferir as permissões de perfil e mensagens e autorizar uma conta profissional real. Não foi concluída nenhuma conexão Instagram nem validada a entrega de mensagens nesta conferência.

## Alterações no produto

- Um botão principal por canal inicia a autorização oficial; a conta conectada e a ação de desconexão permanecem no próprio cartão.
- Ajuda opcional recolhida explica a conta profissional e o login independente do Facebook.
- Quando a tentativa de abrir a autorização falha, o botão repete a ação do canal correto, em vez de apenas recarregar o estado.
- O botão Instagram só fica disponível quando os pré-requisitos locais exigidos pelo servidor estão presentes. Essa disponibilidade não atesta aprovação da Meta nem inscrição real do webhook.
- O retorno de OAuth apresenta orientações fixas para cancelamento, expiração, permissão, tipo de conta, vínculo existente e falhas do provedor. Não reflete códigos de autorização, tokens, mensagens brutas ou identificadores de empresas.
- O estado de uso único, cookie, verificação de administrador, isolamento por imobiliária e histórico separado continuam obrigatórios. Uma indicação na URL nunca cria uma conexão.

## Validação e limites

Os testes de OAuth nativo, conexões, interface e retorno passaram com respostas HTTP/banco simuladas. Houve revisão independente do diff. Esses testes não substituem a autorização real de uma conta profissional, recebimento e resposta pelo CRM. Nenhuma mensagem ou campanha foi enviada.

O código não inclui migração de banco ou mudança de escopos. A interface exige somente `instagram_business_basic` e `instagram_business_manage_messages` para o fluxo nativo existente.

## Configuração Meta

A Meta agora recomenda Unified Login para novos recursos, mas informa que o login Instagram existente continua funcionando sem data de encerramento anunciada. A correção mantém o fluxo nativo já implementado; migrar requer configurar outro login, rever tokens, endpoints e webhooks e autorizar as contas novamente. Não é uma simples troca de URL.

Referências oficiais consultadas:

- [Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Migração para Unified Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/migration-guide/)

Para clientes externos, verificar Advanced Access das permissões; o aplicativo estar publicado não comprova aprovação de todas elas. Para teste, usar uma conta própria com a função adequada no aplicativo. Credenciais da plataforma são configuração da ImobFlow; o cliente não deve copiar tokens ou chaves para conectar sua conta.
