# Webhook do WhatsApp Cloud API

O endpoint do ImobFlow para receber eventos da Meta é:

`https://imobflow-ai-rosy.vercel.app/api/integrations/meta/whatsapp`

Ele não aceita eventos sem a assinatura `X-Hub-Signature-256` da Meta. Uma
mensagem recebida é associada ao `phoneNumberId` configurado no servidor; o
corpo do webhook não escolhe a imobiliária. Eventos repetidos da Meta são
ignorados pelo identificador externo da mensagem.

## Configuração de teste

1. Publique esta versão antes de configurar a Meta.
2. Em **Vercel → Settings → Environment Variables**, crie para Production:
   `META_APP_SECRET` (o App Secret da aplicação Meta) e
   `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` (uma senha aleatória longa criada
   somente para esta verificação).
3. Crie `WHATSAPP_META_CONNECTIONS` com uma lista JSON. Cada `phoneNumberId`
   pode pertencer a uma só empresa. Exemplo estrutural, sem valores reais:

```json
[
  {
    "companyId": "UUID_DA_EMPRESA_NO_IMOBFLOW",
    "phoneNumberId": "ID_DO_NUMERO_DE_TESTE_NA_META",
    "enabled": true
  }
]
```

Para receber fotos, crie também `META_WHATSAPP_ACCESS_TOKEN` como segredo de
Production. Use um token de acesso do sistema com acesso ao número WhatsApp;
ele fica apenas no servidor e não deve ser enviado pelo navegador. Fotos de até
5 MB são armazenadas de forma privada e só aparecem para membros autenticados
da mesma imobiliária.

4. Faça uma nova publicação na Vercel para os segredos entrarem em vigor.
5. Na Meta, em **WhatsApp → Configuração**, informe a URL acima como
   *Callback URL* e use exatamente o mesmo valor de
   `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` no campo *Verify token*. Assine o
   campo `messages` da conta WhatsApp.
6. Envie uma mensagem do telefone de teste autorizado para o número de teste.
   Ela deve aparecer como novo lead/conversa da imobiliária mapeada, sem
   atribuição automática a corretor.

Não compartilhar App Secret, verify token, token de acesso ou números de
clientes em chat, commits ou capturas de tela. A rota atual recebe mensagens;
o envio do painel para a API Meta e a exibição de status de entrega continuam
uma etapa separada e precisam de token de envio com expiração/rotação.
