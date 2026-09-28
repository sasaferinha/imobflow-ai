# Coexistencia: confirmacao da Meta sem Phone Number ID

## Defeito confirmado

Em 28/09/2026, o numero novo aparecia conectado no Gerenciador do WhatsApp, mas o ImobFlow mantinha apenas o vinculo antigo desativado, sem token salvo. Os logs consultados nao mostravam POST de conclusao do Embedded Signup.

A documentacao oficial da Meta para onboarding de usuarios do WhatsApp Business mostra este evento de coexistencia:

```json
{
  "data": { "waba_id": "<CUSTOMER_WABA_ID>" },
  "type": "WA_EMBEDDED_SIGNUP",
  "event": "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  "version": 3
}
```

Fonte: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/

O parser anterior exigia `phone_number_id` e rejeitava esse evento. A reproducao local com o payload oficial retornou `event: error`. Os testes antigos adicionavam artificialmente o campo ausente, portanto nao detectavam o defeito.

## Correcao

- Aceitar WABA sem telefone exclusivamente no evento de coexistencia.
- Aguardar tanto o evento quanto o codigo de autorizacao, independentemente da ordem.
- Descobrir o numero no servidor pela Graph API, com a autorizacao recem-concedida.
- Rejeitar selecao ambigua/incompleta; nunca assumir o numero antigo nem o primeiro de uma lista.
- Confirmar coexistencia na Meta antes de dispensar registro/PIN.
- Manter verificacao de propriedade por empresa, validacao da autorizacao e assinatura do webhook antes de salvar.

Nao existe migration ou exclusao de leads, conversas e mensagens nesta correcao.

## Validacao local

Em 28/09/2026 passaram: `test-whatsapp-onboarding.cjs` (incluindo payload oficial, ordem dos callbacks, ambiguidades, propriedade e falhas), TypeScript e `build:production` completo com as suites de isolamento e mensagens. O lint dos tres arquivos TypeScript alterados nao encontrou erros. Uma segunda revisao independente nao identificou bloqueador novo no diff. Essas verificacoes nao substituem a autorizacao e a entrega reais.

## Recuperacao e limites

Uma conclusao descartada pelo navegador nao deixa automaticamente um token recuperavel no banco. Sem credencial valida ja armazenada, sera necessario renovar a autorizacao do numero existente pelo fluxo oficial corrigido. Isso nao exige apagar a conta do WhatsApp Business, criar outro numero ou excluir o historico.

A aprovação da Meta, o numero conectado no celular e o cadastro salvo no ImobFlow sao sinais distintos. Nao exibir sucesso ficticio apenas substituindo o ID no banco.

O teste final precisa confirmar uma nova mensagem de outro telefone aparecendo no painel e, com autorizacao, a resposta entregue. Testes simulados e HTTP 200 nao comprovam entrega real. Sincronizacao do historico do aplicativo e um fluxo separado e nao foi implementada nesta correcao.

## Troca de numero

Os leads e as conversas pertencem a empresa, nao ao numero comercial. Esta correcao nao remapeia em massa conversas antigas, nao reativa envios pendentes do canal anterior e nao altera o numero antigo na Meta. Uma transicao completa entre canais precisa de historico de conexoes, identificacao do canal por mensagem e tratamento explicito de conversas antigas; nao deve ser simulada com troca global de IDs.
