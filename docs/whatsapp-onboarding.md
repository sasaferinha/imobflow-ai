# Conexão do WhatsApp no painel

> Histórico: este documento descreve o onboarding Cloud API padrão da data em que foi escrito. O código recuperado já contém tratamento parcial de coexistência com o WhatsApp Business, mas sua ativação real não foi verificada. Para o estado atual e a ordem segura de validação, consulte [Operação do WhatsApp — 24/09/2026](operacao-whatsapp-2026-09-24.md).

O administrador abre **Integrações → WhatsApp da sua empresa**. A tela separa
três etapas: preparar a conta Meta, autorizar o número e conferir uma mensagem
real. Uma configuração salva nunca é apresentada como prova de entrega.

## Conexão pela Meta

O botão fica disponível somente quando o servidor possui `META_APP_ID`,
`META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`, `META_APP_SECRET` e
`META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`. A consulta de disponibilidade retorna
somente identificadores públicos e indicadores booleanos. Ela não comprova
aprovação, modo de produção ou configuração do webhook na Meta.

O responsável pelo aplicativo deve concluir externamente:

- Configurar Facebook Login for Business com Embedded Signup para WhatsApp,
  os domínios HTTPS utilizados pelo painel e as permissões necessárias.
- Obter o acesso aplicável ao aplicativo e às empresas clientes, incluindo
  revisão/permissões da Meta. Acesso de teste não comprova liberação para
  clientes reais.
- Configurar o callback HTTPS `/api/integrations/meta/whatsapp`, verificar
  o webhook e assinar o campo `messages`.
- Resolver eventuais pendências do negócio, do número ou de pagamento no
  Gerenciador do WhatsApp. O ImobFlow não cria nem compartilha linha de crédito.

O administrador informa o PIN de proteção de seis dígitos do número; para um
número novo, escolhe e guarda o PIN. Ao entrar na Meta, escolhe a conta WhatsApp
e o número e autoriza o aplicativo. O servidor verifica a disponibilidade do
número na imobiliária, troca o código por um token, confirma que o número
pertence à conta autorizada, consulta seus dados, registra o número na Cloud
API, assina o aplicativo na conta e salva a configuração. Código, PIN e token
não aparecem na resposta; o PIN não é salvo pelo ImobFlow.

Se uma etapa da Meta falhar, a tela mostra a etapa que precisa de atenção e
não anuncia conexão concluída. O registro do número pode ter ocorrido antes
de uma falha de assinatura ou de armazenamento; nesse caso a mensagem orienta
a revisar a configuração e repetir a conexão. Este fluxo cobre o cadastro
Cloud API padrão; não implementa migração de On-Premises nem onboarding por
coexistência com o aplicativo WhatsApp Business.

## Caminho manual e conferência

Para uma conta já ativada na Cloud API, a configuração manual pede a
identificação do número e um token com as permissões apropriadas. O servidor
consulta o número na Meta antes de salvar. Credenciais inválidas, acesso
negado ou divergência do número não são salvos. O token fica vazio na tela
depois de cada tentativa e nunca é retornado pela consulta de configuração.
Registro e webhook continuam pré-requisitos externos do caminho manual.

**Conferir acesso na Meta** realiza uma consulta sem enviar mensagens. O
resultado distingue número salvo, acesso confirmado, autorização inválida e
integração pausada. Para conferir entrega, envie uma mensagem de outro telefone
ao número da empresa, abra **Conversas** e responda pelo painel. Verifique a
chegada da resposta no outro telefone. Até esse teste, o painel não afirma que
envio e recebimento foram comprovados.

## Validação local

`node apps/dashboard/scripts/test-whatsapp-onboarding.cjs` cobre restrições de
administrador/origem, ausência de configuração, vínculo entre conta e número,
registro/assinatura, erros sem segredos, configuração manual, paginação segura,
eventos do SDK em qualquer ordem, cancelamento, tempo limite e desmontagem.
Todos os acessos à Meta e ao banco são simulados; o teste não conecta números,
não envia mensagens e não modifica negócios reais.

Referências primárias consultadas:

- [Coleção oficial da Meta: Embedded Signup](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup)
- [Coleção oficial da Meta: WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
