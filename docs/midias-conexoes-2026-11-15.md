# Mídias e conexões — revisão de 15/11/2026

## Estúdio de demonstração

Em `/modelo-imobiliaria/midias`, a foto tem uma única ação: **Aprimorar foto**. Não há presets, controles de contraste, cor ou iluminação. O processamento automático analisa a luminosidade e aplica uma correção limitada, preservando a estrutura da imagem. A comparação mostra o resultado efetivamente preparado; não usa filtro visual como substituto da exportação.

- Compare antes/depois, aprove, baixe em JPEG ou restaure a foto original.
- É possível experimentar fotos próprias JPEG, PNG ou WebP de até 12 MB. São verificadas e normalizadas localmente; não há upload para o CRM ou provedor de IA.
- A aprovação substitui apenas o slot selecionado do imóvel fictício. Uma nova melhoria usa a foto aprovada, inclusive quando ela foi importada; restaurar o original é uma ação explícita.
- No vídeo, selecione e ordene as fotos, escolha horizontal ou vertical, duração de 2, 3 ou 5 segundos por foto e movimento suave ou estático. A apresentação usa as fotos aprovadas e não tem áudio.
- O navegador tenta exportar MP4 quando há suporte; caso contrário, usa WebM. Algumas redes exigem conversão de WebM para MP4. A preparação tem progresso e cancelamento, com encerramento das gravações e liberação das URLs temporárias.

As aprovações ficam no IndexedDB deste navegador e aparecem somente no catálogo fictício em `/modelo-imobiliaria`. Não publicam mídias de empresas reais, não sincronizam entre dispositivos e desaparecem se os dados do navegador forem apagados. Sem armazenamento disponível, baixar continua possível, mas aprovar no site fica desabilitado.

**IA generativa permanece pendente.** A opção de câmera com IA é uma prévia ilustrativa, identificada como tal, sem geração de ambientes, download de vídeo de IA ou cobrança. Ainda é necessário conectar e validar um fornecedor antes de oferecer geração real. Preços e planos não foram definidos nesta revisão.

## Fotos de exemplo

Os dois exemplos foram obtidos na internet e guardados em `apps/dashboard/public/demo-media/`, com créditos em `CREDITS.md`:

- Sala clara: Zak Chapman, [Living Room — Pexels](https://www.pexels.com/photo/living-room-2029683/).
- Sala aconchegante: Max Vakhtbovych, [An Interior of a Living Room — Pexels](https://www.pexels.com/photo/an-interior-of-a-living-room-8089170/).

A [licença Pexels](https://www.pexels.com/license/) permite o uso e a edição. As fotos são ilustrações; não representam imóveis reais anunciados pela ImobFlow nem endosso dos fotógrafos.

## Conexões sociais

Instagram e Facebook seguem a interação simples adotada para WhatsApp: **Conectar** quando desconectado; conta e situação visíveis, com **Desconectar**, quando conectado. Escolher a conta faz parte da conexão, sem botões permanentes de seleção ou atualização de estado. A atualização acontece automaticamente.

Cada imobiliária mantém uma conta ativa por canal. Para trocar, desconecte a atual e conecte a outra. Contas anteriores continuam com identidade, leads, destinatários e mensagens próprios; o novo vínculo não herda esse histórico nem passa a enviar mensagens por ele. Permissões do Facebook não comprovam autorização do Instagram. A liberação da Meta e a entrega real ainda exigem verificação das contas envolvidas.

## Banco e implantação

Aplicar as migrations antes de liberar a versão correspondente da aplicação:

1. `20261115100000_social_oauth_channel.sql`: guarda no pedido OAuth o canal escolhido, para recuperar o fluxo correto no retorno da Meta.
2. `20261115101000_social_account_switch.sql`: permite histórico de contas desconectadas mantendo uma única conta ativa por canal; preserva a identidade dos atendimentos e coordena desconexão com mensagens em envio.

Este registro não confirma aplicação dessas migrations no banco remoto nem publicação da versão.

Em caso de regressão visual, reverta apenas os componentes afetados ou publique uma correção mantendo o contrato de contas históricas. Não apague contas antigas, destinatários ou mensagens e não restaure a antiga unicidade por empresa/canal após uma troca: isso invalidaria registros preservados. Um rollback da aplicação deve continuar reconhecendo contas ativas e arquivadas; as migrations não devem ser desfeitas para acompanhar uma reversão de interface.

## Validação concluída no código

- TypeScript, ESLint focal e build de produção completos passaram.
- Renderer: importação e formatos, correção automática de imagens escuras/claras/equilibradas, preservação de altas luzes, movimento, duração, cancelamento, limites e limpeza de recursos.
- Interface do estúdio: ação única, aprovação explícita, reedição da foto importada, isolamento de slots, ordem de fotos, opções de exportação, falha de armazenamento e revogação de URLs.
- Persistência demonstrativa: rollback de transações, restauração do original, isolamento dos imóveis fictícios e atualização entre abas.
- Conexões: retorno OAuth por canal, seleção dentro do fluxo, troca de conta, preservação do histórico e restrição de conta ativa, com testes de aplicação e SQL.

Conferência no navegador local: aprimoramento em um toque e aprovação da foto de exemplo; apresentação horizontal MP4 em 1280×720 com duas fotos e aproximadamente quatro segundos; apresentação vertical MP4 em 720×1280 com duas fotos e aproximadamente seis segundos. Foto e vídeo aprovados apareceram no detalhe do imóvel fictício em outra aba. O fluxo de conectar e desconectar Instagram foi exercitado com contas simuladas, mantendo Facebook conectado.

Testes simulados não comprovam entrega pela Meta nem compatibilidade de todos os codecs. A implantação ainda precisa ser confirmada após o envio desta revisão.
