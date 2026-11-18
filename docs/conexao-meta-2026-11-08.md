# Conexão operacional da Meta — 8 de novembro de 2026

## Atualização de 18 de novembro de 2026

O fluxo novo usa Login do Instagram diretamente, independente do Facebook. Solicita apenas `instagram_business_basic` e `instagram_business_manage_messages`, sem seleção de Página. O perfil precisa ser profissional (empresa ou criador). Facebook continua autorizando sua própria Página; WhatsApp conserva o cadastro incorporado existente. Conexões antigas por Facebook Login permanecem identificadas como legadas, sem converter seu histórico ou destinatários para o novo namespace.

Configuração necessária no produto **Instagram → API setup with Instagram login** da Meta:

- Retorno OAuth: `https://www.imobflow.net.br/api/integrations/meta/instagram/callback`.
- Webhook Instagram: `https://www.imobflow.net.br/api/integrations/meta/instagram`, com eventos `messages` e `messaging_postbacks`.
- Produção: `META_INSTAGRAM_APP_ID` e `META_INSTAGRAM_APP_SECRET`, próprios do Instagram Login. `META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN` é opcional; quando ausente, reutiliza somente o segredo de verificação social. A assinatura dos eventos sempre exige o segredo específico do Instagram.
- Contas externas ao aplicativo dependem do acesso e da análise de permissões exigidos pela Meta. O consentimento do Facebook/WhatsApp não substitui essa autorização.

As credenciais `META_INSTAGRAM_*` não estavam configuradas na Vercel nesta conferência. Sem elas, o botão informa indisponibilidade; não há retorno silencioso ao login do Facebook. Não copiar segredos para documentação, Git ou chat. Manter o segredo Facebook atual e a chave de cifra: alterá-los sem migração impede ler as autorizações antigas.

O token nativo tem validade persistida; a reconexão renova a mesma identidade e preserva seu histórico. Ainda não existe renovação agendada desse token. Mensagens recebidas com assinatura válida continuam registradas quando o token de saída expira, mas envios e novos trabalhos automáticos são bloqueados. Trabalhos pendentes também revalidam a conexão antes de chamar a IA.

Na validação real, conectar duas contas independentes, receber uma mensagem em cada uma e conferir resposta, áudio, Match e troca de conta sem cruzar históricos. Esses passos exigem autorização de destinatário/conteúdo para envio; testes locais simulados não comprovam entrega. A assinatura do webhook precede o vínculo final no banco; uma mensagem nesse pequeno intervalo pode não ser registrada, portanto o teste de recebimento deve ocorrer depois da confirmação da conexão.

Referências oficiais: [Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login), [identidade da conta](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started), [webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup).

As seções seguintes são o histórico de configuração de novembro; exigências antigas de Página vinculada aplicam-se somente ao caminho legado.

## Estado confirmado

- A entrega integrada foi publicada a partir de `main@e4360c71975f15cff730f6e078c1a9a3ffe528d6`, após a revisão e os testes registrados em `entrega-integrada-2026-11-08.md`. As seis migrations de `20261108120000` a `20261108125000` foram verificadas no banco remoto. O agendador de push está instalado; isso não comprova recebimento em um dispositivo.
- O aplicativo Meta `imobflow` recebeu os casos de uso de Messenger, Instagram, anúncios e captação por anúncios. Adicionar um caso de uso não equivale à aprovação de permissões para clientes externos.
- Os retornos HTTPS de autorização social e de anúncios foram salvos e conferidos na configuração de Login do Facebook para Empresas.
- A configuração de mensagens do Instagram com Login do Facebook foi habilitada; o erro inicial de escopos inválidos deixou de aparecer.
- A Página **ImobFlow**, categoria **Empresa de software**, foi criada após confirmação do aceite das políticas. O site público informado é `https://www.imobflow.net.br/`. Nenhum telefone, endereço ou conta Instagram foi inventado.
- O segredo de verificação do webhook social foi configurado no ambiente de produção. A revisão de ambiente `dpl_4SjtMUD1YWtjUywu5eUFLzG8vRaD` manteve o mesmo código de main. O endpoint respondeu ao desafio válido com HTTP 200, rejeitou token inválido com 403 e POST sem assinatura com 401.

## Bloqueio observado na autorização

A Página foi encontrada pelo Facebook, mas a autorização conjunta exigia também selecionar uma conta Instagram. Como a conta administradora ainda não possui Instagram disponível, a opção de autorizar somente contas atuais desabilitava a continuação. Autorizar todas as contas futuras ampliaria desnecessariamente o acesso.

A correção separa a conexão por canal: Facebook deve poder autorizar, listar e selecionar sua Página sem solicitar permissões nem campos de Instagram. O Instagram conserva seu próprio fluxo. A seleção da empresa e do administrador, o estado de uso único, o cookie de segurança, a cifra dos tokens e a proibição de vincular a mesma Página a outra empresa continuam obrigatórios.

## Pendências de operação

- Concluído: autorização limitada à Página ImobFlow e vínculo verificado no painel, com atendimento humano como padrão.
- Na Meta, inserir e verificar o token do webhook de Page e assinar os eventos necessários. O segredo não deve ser salvo no Git ou informado em relatórios. O endpoint pronto no servidor, isoladamente, não confirma essa assinatura na Meta.
- Vincular uma conta profissional real do Instagram à Página e realizar sua autorização, além da configuração do objeto Instagram no webhook.
- Renovar a autorização do WhatsApp: a verificação no CRM informou token expirado ou revogado. A tentativa de reconexão ainda não foi concluída.
- Concluir a análise de permissões sociais e de anúncios quando exigida pela Meta. A análise anterior de `business_management` pediu demonstração completa do caso de uso; não reenviar uma gravação que não mostre o fluxo real.
- Testar recebimento, resposta, áudio e Match nos canais autorizados, com destinatário e conteúdo de teste escolhidos. Nenhuma mensagem real, convite de amizade ou campanha paga foi enviado ou ativado nesta configuração.
- O usuário ainda não possui domínio próprio para o primeiro site. O endereço da ImobFlow permanece disponível.

## Continuação da configuração

A conexão separada por canal foi publicada em `main@b2ca3e4585ff1b3222462f79d5c0c329bf169522` pelo PR #18. O domínio de produção foi verificado no deployment `dpl_2tRAywW3UBCaciycppFem237KGPv`. A autorização somente do Facebook avançou até a confirmação final sem solicitar uma conta Instagram.

Após confirmação explícita do usuário, as permissões da Página ImobFlow foram salvas na Meta e a Página foi vinculada no CRM, que exibiu **Conectado**, com atendimento humano como padrão. A leitura de metadados do banco confirmou uma autorização social não expirada e a conexão Facebook habilitada. Nenhum token foi lido ou incluído nesta documentação. O vínculo somente é gravado depois de a inscrição dos eventos da Página retornar sucesso; isso não confirma a verificação do callback do aplicativo nem entrega de mensagens.

O retorno da autorização exibiu inicialmente a tela de cadastro, apesar da sessão existente; uma atualização de página recuperou o administrador sem novo login. A sessão principal usa `SameSite=Strict`, e o state OAuth usa cookie separado `Lax`. A correção mantém essas proteções e termina o retorno em uma página pública do próprio domínio, com navegação explícita para a área apropriada do painel. A página não autentica ninguém, não transporta código/token e não aceita destino arbitrário.

A configuração pública do WhatsApp foi comparada com o painel da Meta: app `1215235061682650`, configuração `1079519511607694`, tipo Cadastro incorporado do WhatsApp, API `v26.0`. Login pelo SDK está habilitado e `https://www.imobflow.net.br/` é domínio permitido. A janela de reconexão não foi observada no navegador incorporado; não foi atribuída uma causa definitiva. HTTPS, modo estrito dos retornos e as demais proteções foram preservados. Nenhuma configuração nova de acesso foi concedida nesta conferência.

Permanecem pendentes: a entrada e verificação do token de callback Page pela pessoa responsável, a conferência dos campos `messages` e `leadgen`, uma conta profissional Instagram real, a reconexão do WhatsApp e os testes de entrega autorizados. Os campos extras atualmente inscritos não são interpretados como mensagens pelo consumidor.

Não apresentar uma Página criada, autorização iniciada ou webhook testado isoladamente como atendimento integrado concluído.

## Validação do retorno da autorização — 9 de novembro

O PR #19 foi publicado em `main@c8a9f41c67afdf269c4b978c0d1cb79c83532905`, deployment `dpl_B8UWi2SWXEg5Q3hGXAM9odfui5Qk`, com 249 verificações aprovadas no build de produção. No navegador, a opção de continuar com as configurações anteriores da Meta levou à nova página de retorno. O clique em **Voltar às integrações** abriu diretamente o painel autenticado, sem recarregar a página ou pedir novo login. A Página ImobFlow permaneceu conectada; nenhuma mensagem foi enviada.

A conferência HTTP encontrou a política global de referenciador da Vercel sobrepondo a exceção do Next. A configuração de implantação deve aplicar `no-referrer` ao retorno OAuth e aos dois callbacks de autorização social/anúncios, preservando `strict-origin-when-cross-origin` nas demais rotas. A validação inclui `node scripts/test-meta-oauth-return.cjs`, revisão independente e nova consulta HTTP após o alias de produção mudar para a revisão corrigida. Os resultados operacionais ficam nos arquivos ignorados `work/oauth-return-*-evidence.json`, sem credenciais.
