# Conexão operacional da Meta — 8 de novembro de 2026

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

- Concluir a autorização limitada à Página escolhida e verificar seu vínculo no painel depois da publicação da correção.
- Na Meta, inserir e verificar o token do webhook de Page e assinar os eventos necessários. O segredo não deve ser salvo no Git ou informado em relatórios. O endpoint pronto no servidor, isoladamente, não confirma essa assinatura na Meta.
- Vincular uma conta profissional real do Instagram à Página e realizar sua autorização, além da configuração do objeto Instagram no webhook.
- Renovar a autorização do WhatsApp: a verificação no CRM informou token expirado ou revogado. A tentativa de reconexão ainda não foi concluída.
- Concluir a análise de permissões sociais e de anúncios quando exigida pela Meta. A análise anterior de `business_management` pediu demonstração completa do caso de uso; não reenviar uma gravação que não mostre o fluxo real.
- Testar recebimento, resposta, áudio e Match nos canais autorizados, com destinatário e conteúdo de teste escolhidos. Nenhuma mensagem real, convite de amizade ou campanha paga foi enviado ou ativado nesta configuração.
- O usuário ainda não possui domínio próprio para o primeiro site. O endereço da ImobFlow permanece disponível.

Não apresentar uma Página criada, autorização iniciada ou webhook testado isoladamente como atendimento integrado concluído.
