# Lista operacional: decisões e implementação de 13/10/2026

Base conferida no GitHub: `main@408cedcadcfbf8827e9a78447a3c92c33e8c0df7`.
Trabalho separado na branch `codex/operations-list-20261013`; não integra nem substitui o PR #2.
Este documento descreve fontes e testes locais, não ativação do banco ou publicação.

## Decisões confirmadas pelo usuário

- A ficha deve estar completa tanto na classificação comercial do lead quanto no Registro de atendimento. Isso não autoriza exigir uma visita antes de toda proposta.
- Após 30 dias sem contato real, o lead fica sem corretor; outro pode assumir. Não é atribuição automática a um novo responsável.
- Contato recebido do cliente e envio humano confirmado renovam o prazo. Resposta automática e edição administrativa não renovam o prazo.
- Visita futura ou negociação em andamento mantém o responsável e gera revisão para o gestor.
- O cadastro deve usar Robust CRM como referência. A documentação pública não mostra a ficha interna completa: faltam capturas das telas de clientes/imóveis para reproduzir os detalhes com fidelidade.
- Leads novos devem avisar os plantonistas primeiro; após cinco minutos sem aceite, outros corretores podem assumir. Não é atribuição automática.
- Prioridade de integrações: Instagram, Facebook e sincronização automática do catálogo com o site da imobiliária cliente. O usuário confirmou que ainda não existe um site para o primeiro teste.

## Implementado nesta etapa

### Lembretes e cobrança de captação (itens 3, 10 e 13)

- Avisos de mensagens novas e lembretes de mensagens não lidas a cada 5, 15, 30 ou 60 minutos, com permissão explícita. Só funcionam enquanto a área estiver aberta; não são push com o navegador fechado.
- Atualizações da caixa de entrada não reiniciam o relógio de lembretes. Ler mensagens, desativar alertas ou sair da área cancela os lembretes.
- Cobranças vencidas também são lembradas no intervalo selecionado; respondidas, concluídas ou canceladas não continuam cobrando o corretor.
- Metas de captação do mês de São Paulo, com quantidade pendente, geram cobranças internas vinculadas à meta e ao responsável. Intervalo mínimo entre novas cobranças: 1 a 30 dias, escolhido pelo gestor.
- Cobrança aberta ou aguardando conferência evita duplicatas. Renomear a meta/cobrança não perde o vínculo auditável.
- O botão de cobrança manual da meta também registra esse vínculo. A rotina e o botão automático usam o mesmo comando e controle de versão.
- Até 20 cobranças por lote, numa única gravação transacional do espaço de trabalho. Conflito de versão preserva os dados e exige atualização.

### Ficha completa (itens 5, 7, 8 e 9)

- Nova opção de exigir completude ao classificar e ao registrar atividade/etapa, validada no servidor, sem inventar cadastro a partir de mensagens.
- Critérios atuais: nome, pessoa vinculada, telefone ou email, responsável, origem, finalidade Venda/Aluguel, tipo de imóvel, cidade/região e orçamento máximo positivo.
- Notas e coleta parcial continuam possíveis; contatos recebidos não são descartados. Correção de fechamento preserva o histórico mesmo quando o cadastro antigo está incompleto.
- Não ativa sequência de etapas nem altera as regras opcionais anteriores de visita/agendamento.
- Limite: aplica-se ao novo CRM e Registro. As rotas clássicas independentes de agenda/cadastro não foram convertidas em um bloqueio universal. Cadastro integral igual ao Robust permanece pendente da referência visual.

### Carteira disponível após 30 dias (item 9)

- Migration aditiva `20261013200000_inactive_lead_pool.sql`, ainda não aplicada em produção.
- Rotina exige administrador ativo da própria empresa, configuração específica ativada e CRM integrado à base canônica.
- Conta contato recebido e saída humana com evidência de envio, incluindo envio confirmado tardiamente; não conta resposta de IA, mensagem pendente/falha ou simples edição do CRM.
- Mantém leads convertidos/perdidos, visitas futuras, propostas em negociação e situações de visita/proposta que exigem revisão conservadora.
- Envios pendentes, em processamento ou de resultado incerto, respostas reservadas e atendimento em processamento impedem a liberação.
- Retira os responsáveis do lead e de suas conversas, mantém o bot pausado e guarda auditoria dos responsáveis anteriores. Não apaga contatos, mensagens ou resultados.
- Outro corretor usa o controle existente de **Assumir atendimento**. A rotina não escolhe o próximo corretor.
- Processamento de até 25 candidatos por execução com rotação persistida: contatos protegidos/ocupados não monopolizam o início da carteira.
- Contatos protegidos geram até cinco novas cobranças de revisão para o gestor por execução; deduplicação ocorre antes desse limite e considera o instante do contato, independentemente do formato de fuso.
- Tabelas e função não são acessíveis por `anon` ou `authenticated`; execução somente no servidor. Repetição da rotina não duplica liberação de carteira já sem responsável.

### Preferência de plantão de cinco minutos (item 14)

- Migration aditiva `20261013210000_duty_priority.sql`, ainda não aplicada em produção. Nova opção de gestão `dutyPriorityEnabled`, desligada por padrão.
- Na entrada de lead novo sem responsável, grava os plantonistas ativos e compatíveis naquele instante, consultando as contas ativas da própria empresa. Com finalidade desconhecida, não inventa um setor: considera o plantão disponível. Sem plantonista elegível, não cria espera.
- Durante cinco minutos, a RPC de assumir atendimento recusa outro corretor; depois permite aceite normal. Não escolhe corretor, muda fila de mensagens ou reinicia o prazo em cada mensagem.
- Primeiro aceite mantém a proteção existente contra tomada por outro corretor. Desligar a regra libera a espera; apagar a escala não contorna um prazo já iniciado. Cadastro com responsável já definido permanece preservado.
- A caixa de entrada fornece somente o prazo e se o usuário pertence ao plantão. Botão e avisos respeitam o prazo; a decisão final continua sendo do banco.
- Na área de Conversas aberta e com alertas ativados, plantonistas recebem avisos primeiro; avisos novos dos demais são adiados até o prazo terminar, sem revelar dados privados nas notificações do sistema.
- Limite: preferência é registrada também no lead social/importado, mas avisos e aceite aqui estão conectados às conversas nativas. A integração social atual guarda entradas no catálogo, sem conversa/DM completa no painel. A expansão desses canais e push com o app fechado permanecem pendentes.

## Ativação e limites

Todas as novas regras de gestão ficam desligadas por padrão. Não houve alteração de configuração de contas, envio externo, migration remota ou deploy nesta etapa.

Ativar a liberação ou o plantão exige verificação de prontidão no servidor. Sem as migrations, o salvamento recusa a ativação e preserva regras/versão anteriores. A liberação também exige integração canônica. Desativar as regras continua permitido.

Antes de ativar a rotina em uma empresa:

1. Revisar/aplicar as duas migrations aditivas desta revisão depois das migrations anteriores, com backup e teste de restauração próprios do ambiente. Os testes locais não provam backup restaurável.
2. Confirmar gates existentes `CRM_EVOLUTION_ENABLED`, empresa autorizada e `CRM_EVOLUTION_INTEGRATED`; publicar a revisão somente após autorização.
3. Confirmar a rotina autenticada existente e sua frequência. O intervalo configurado é mínimo, não garantia de execução exata; o cron pode adiar quando não há orçamento de tempo.
4. Conferir em uma carteira pequena e autorizada: contato recente, lead inativo, compromisso futuro, proposta ativa, fila de envio e dois corretores tentando assumir.
5. Somente então habilitar as opções na empresa. Limites de tamanho/volume do espaço de trabalho e concorrência entre conexões reais continuam sendo avaliações separadas.

## Próxima etapa: integrações vendáveis para outras imobiliárias

O espaço atual **Integrações** já possui WhatsApp e diagnóstico de Instagram/Facebook. O receptor social atual associa contas por configuração do servidor (`META_SOCIAL_CONNECTIONS`), não oferece login autônomo por cliente e não responde a DMs pelo painel. O campo `publicUrl` e as marcações de catálogo não comprovam publicação externa. A rota pública `/imobiliaria/[slug]` é uma página de contato, não um catálogo sincronizado.

Proposta de arquitetura, ainda não implementada nesta entrega:

1. **Central de conexões por empresa:** Instagram, Página/Formulários do Facebook e site, cada um com autorização, conta vinculada, permissões, último sucesso, erro e desconexão. Só administradores da empresa podem conectar.
2. **Autorização oficial:** cliente entra na Meta e escolhe ativos; não envia senha/token por chat. Callback ligado à sessão/empresa, estado de uso único, conferência real dos ativos e permissões antes de salvar. Separar acesso para receber leads, mensagens e publicar conteúdo.
3. **Credenciais por empresa no servidor:** substituir a lista global de contas por persistência segura, com criptografia/gestão de chaves, validade, reconexão e revogação. Conta não pode ser vinculada silenciosamente a duas empresas.
4. **Catálogo como fonte única:** um imóvel cadastrado/alterado gera uma tarefa durável de publicação para o site autorizado. Fotos, preço, disponibilidade, arquivamento e remoção precisam acompanhar a revisão correta, sem expor proprietário/contatos privados.
5. **Conectores de sites:** API/plugin/feed conforme a plataforma, ou catálogo hospedado pela ImobFlow. Um link de site sozinho não concede acesso de escrita; sites de fornecedores fechados podem exigir contrato/API.
6. **Fila e observabilidade:** chaves de idempotência por empresa/imóvel/destino/revisão, tentativas controladas, recibo/link externo e histórico. Falha em uma empresa não deve parar outras; credencial revogada não deve virar ciclo de tentativas infinito.
7. **Piloto e liberação nacional:** testar uma imobiliária, incluindo duas empresas isoladas, desconexão, autorização expirada e atualização/retirada de imóvel. Acesso a contas de terceiros depende das permissões e aprovações da Meta para os produtos escolhidos; não é liberado só por criar um botão.

O usuário solicitou publicação automática do imóvel no site após o cadastro. Não foi solicitada publicação automática de posts nas redes sociais. Falta escolher a plataforma/site piloto (ainda não existe um site disponível) e obter as capturas dos formulários Robust. A preferência dos plantonistas foi confirmada em cinco minutos. Essas pendências não autorizam testes de publicação em contas externas de clientes.

Referências primárias consultadas:

- [Robust CRM — documentação pública](https://doc.robustcrm.com.br/)
- [Coleção oficial Meta — Instagram](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Coleção oficial Meta — conversas e requisitos de acesso](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a)

## Validação desta revisão

### Encaixe da área de Conversas

- Layout restrito a Conversas: ocupa a altura disponível do painel em desktop/notebook, com lista, histórico e ficha rolando internamente. Não oculta a barra do navegador globalmente.
- Ficha inicialmente fechada, disponível em “Ficha do cliente”. Entre 761 e 1100 px, a ficha aberta ocupa o lugar da leitura; fechar restaura o foco ao botão e mantém o rascunho. Histórico oculto não é reconhecido como lido.
- Em celular, janela baixa, configurações expandidas ou aviso de falha, preserva rolagem necessária. Conteúdo adicional no chat pode rolar internamente para não cortar controles.
- Verificação no navegador com componentes/estilos reais e dados fictícios: 1366×768, 1280×720, 1024×768 e 820×640 sem rolagem externa; 390×844 sem transbordamento horizontal, com rolagem vertical necessária. Ficha aberta testada em desktop/tablet e painel clássico em 1366×768. Em 820×640 e com a ficha aberta em 1280×720, o chat usa rolagem interna adicional para manter controles acessíveis.
- `npm run test:conversation-layout`, `npm run test:crm-design`, testes de handoff WhatsApp, assistente UI, atendimento e cadastro UI passaram; `npx next build` passou (inclui TypeScript). Dados reais, entrega externa e produção não foram testados nesta alteração de layout.
- Esta atualização permanece na branch de trabalho/PR; não houve deploy, merge ou migration remota.

- Novos testes de domínio/lembretes, UI com relógio/timers isolados e SQL com todas as migrations em PGlite, sem serviços externos.
- Plantão: escala registrada na chegada, finalidade, ausência de plantonista, primeiro aceite, limite exato de cinco minutos, conta de outra empresa, regra desligada e escala legada inválida. UI cobre aviso imediato ao plantonista e diferido aos demais.
- Teste integrado usa sessão, rota real, ponte canônica e SQL CAS para gerar cobrança, bloquear outro corretor, responder e evitar duplicata.
- Scheduler exercita opt-in, concorrência, revisão protegida por empresa/gestor, deduplicação antes do limite, normalização de horário, integração obrigatória e reserva de tempo.
- Build Next/TypeScript passou após preservar fora da verificação um validator gerado em 24/09, que apontava para uma rota antiga. Nenhum fonte foi descartado.
- ESLint dos arquivos TypeScript alterados passou. O lint global encontrou cinco erros e quatro avisos anteriores em arquivos fora desta alteração; não foi mascarado com desativação das regras.
- Testes simulados não certificam entrega real no WhatsApp, conexão Meta, OAuth de clientes, site externo, schema remoto ou carga nacional.
