# Lista operacional: decisões e implementação de 13/10/2026

Base conferida no GitHub: `main@408cedcadcfbf8827e9a78447a3c92c33e8c0df7`.
Trabalho separado na branch `codex/operations-list-20261013`; não integra nem substitui o PR #2.
Este documento descreve fontes e testes locais, não ativação do banco ou publicação.

## Publicação principal solicitada — 19/10/2026

O usuário autorizou publicar o trabalho das últimas semanas no painel principal. A conferência remota encontrou cinco commits revisados no PR #8 além de `main@408cedc`; as demais branches recentes de layout, conta, Registro, IA, funil e histórico já estão contidas nessa base. O PR #2 antigo, conflitante e de setembro, o backup e o protótipo local com alterações não revisadas ficam preservados e fora deste pacote. Trabalho de outro computador nunca enviado ao GitHub não pode ser certificado.

- Publicar o código usa a configuração de produção existente; não promover diretamente a prévia, que não possui as mesmas variáveis de ambiente.
- As seis migrations operacionais novas não foram aplicadas remotamente. Supabase ainda não conectado; não há comprovação de schema, backup/restauração ou rotina por minuto. Não ativar push nem liberar carteiras por suposição.
- Proteção adicional: o agendador agora confere `inactivePool=true` e `verifiedInactiveContacts=true` a cada execução, mesmo se a opção já estiver gravada como ligada. Schema ausente/antigo/indisponível bloqueia somente essa liberação e registra o motivo; cobranças e relatório independentes continuam. Não registra liberações que não ocorreram.
- Cadastros guiados, ajuste de Conversas, controles e lembretes locais podem ser publicados sem essas migrations; aviso urgente fica indisponível sem política 3, e push permanece sem envio sem configuração/consentimento. Publicar o código não equivale a ativar todos os serviços.
- Referência de recuperação anterior à publicação: deployment `dpl_4fwAPdNJrDEX7iLwiEtduZegVBmo`, servido por `www.imobflow.net.br`, e main `408cedcadcfbf8827e9a78447a3c92c33e8c0df7`. Nenhum rollback foi executado; nenhuma alteração de dados foi incluída nesta preparação.

Quatro testes direcionados, TypeScript e lint da proteção do agendador passaram com dados sintéticos. A execução completa de `build:production` também passou após a proteção, com testes externos de IA desativados. A publicação final e as verificações de domínio/versão serão registradas no PR #8; nenhum segredo, contratação ou alteração de plano integra este pacote.

## Ajuste confirmado dos avisos — 19/10/2026

Esta seção substitui a regra histórica de “última mensagem sem resposta” e de tentativa única descrita abaixo. Não certifica ativação em produção.

- **Relógio:** primeira mensagem recebida válida do cliente, mesmo enquanto a IA atende. Novas mensagens, leitura e resposta da IA não reiniciam nem encerram a espera. O aceite por um corretor ou o encerramento do atendimento remove a pendência.
- **Prazos:** dois minutos para o plantão confirmado e cinco para os demais. Uma mensagem integrada com atraso não deve criar um novo prazo: a prioridade de aceite é encurtada para, no máximo, primeira chegada + cinco minutos, sem ampliar a preferência nem trocar os plantonistas registrados.
- **Expediente:** usa o horário, fuso, dias da semana e feriados cadastrados na própria imobiliária. Somente quando o cadastro está ausente ou vazio usa o padrão existente (segunda a sexta, 08h–18h, America/Sao_Paulo, sem feriados presumidos). Configuração inválida ou indisponível não autoriza avisar. A espera continua em tempo corrido fora do expediente; clientes já vencidos ficam elegíveis quando ele abre.
- **Persistência:** aviso destacado em Conversas e nova tentativa de push a cada cinco minutos completos enquanto o cliente continua sem responsável. O intervalo é por corretor/aparelho/lead, inclusive após falha, nova mensagem, logout e novo login; não existe rajada para compensar intervalos perdidos. A rotina por minuto e as restrições do celular podem atrasar a entrega; não se promete horário exato no aparelho.
- **Fechamento e privacidade:** snapshot de até 30 segundos, limitado ao fechamento do expediente; push vencido é descartado e o worker revalida a conta e o expediente antes de mostrar. Texto genérico, sem nome/telefone do cliente. Notificações já recebidas continuam abrindo Conversas após o expediente se a conta ainda estiver autorizada. Ativar a permissão do aparelho fora do expediente é permitido.
- **Migrações aditivas:** `20261019140000_persistent_unassigned_push.sql` preserva recibos, acrescenta intervalo atômico e alinha a reserva de plantão; `20261019150000_business_hours_push_candidates.sql` filtra empresas fechadas antes da paginação. A aplicação exige marcador de política versão 3, para não funcionar silenciosamente com o comportamento anterior. Nenhuma migration publicada anteriormente foi reescrita.
- **Limite histórico:** não há evento confiável de nova chegada após devolver/reabrir um atendimento. Um lead que volte a ficar sem responsável utiliza a primeira entrada conhecida; não inventamos aceite humano a partir de atividade da IA. Um novo ciclo com relógio independente exigiria registrar esse evento explicitamente.

Ativação continua pendente de conferência e aplicação segura das migrations no banco correto, configuração de push e rotina por minuto. Vercel Hobby não atende essa frequência; o caminho proposto é conferir Supabase Cron/pg_net/Vault já existente, sem contratar outro serviço. Acesso e limites dessa conta ainda precisam ser confirmados. Nenhuma cobrança adicional, mensagem a cliente ou notificação real foi disparada nesta implementação.

Validação desta revisão: `pnpm --dir apps/dashboard run build:production` passou integralmente, incluindo regressões, TypeScript e build Next; verificações externas de IA ficaram explicitamente desativadas. ESLint direcionado e `git diff --check` passaram. Novos testes cobrem os limites de 299999/300000 ms, falha/relogin, aceite após mensagem atrasada, fechamento exato, feriados/fusos/DST e 601 contatos de empresas fechadas sem ocultar uma aberta. Transporte push simulado com criptografia real; banco PGlite isolado. Não certifica concorrência entre conexões PostgreSQL reais, schema remoto ou entrega no aparelho.

## Atualização de decisões e implementação — 19/10/2026

Esta seção atualiza as descrições históricas abaixo; não prova ativação em produção.

- **Lead completo:** nome, telefone ou email, responsável, origem, compra/aluguel, tipo, cidade/região e orçamento máximo. Temperatura e demais preferências são opcionais. A referência a uma pessoa é um vínculo técnico que reutiliza o contato, sem duplicá-lo.
- **Cadastros guiados:** escolhas rápidas de finalidade, tipo, quantidades e comodidades; sugestões de localização somente da carteira autorizada; tipos e características personalizados preservados. Complementares recolhíveis e essenciais primeiro. A criação de imóvel sinaliza os campos exigidos pela base canônica; edição de legados incompletos não ganha exigências retroativas. Fotos e endereço exato não são exigidos na completude comercial. Identidade visual própria da ImobFlow, sem copiar o Robust.
- **Aviso urgente:** para cliente sem corretor, com última mensagem recebida aguardando resposta: a partir de dois minutos para o plantão confirmado e cinco para os demais. Repetir mensagens não reinicia a espera. Uma nova espera após resposta não herda um prazo antigo. Ler não equivale a responder. O aviso não assume a conversa nem envia mensagem; seu botão abre o atendimento e preserva rascunhos.
- **Confiabilidade do aviso:** consulta protegida `/api/conversations/urgent`, baseada em todos os atendimentos autorizados e paginada por contato, não nas últimas 200 mensagens globais. Até 50 alertas antigos elegíveis, calculados no servidor, com validade de 30 segundos. Falha, estado desconhecido, offline ou demonstração não produzem alegação de abandono. Modo automático sem resposta também pode gerar aviso; uma resposta do bot encerra aquela espera. O alerta visual fica em Conversas; não depende da permissão de notificações. Exige a migration `20261019130000_browser_web_push.sql` pela função compartilhada `broker_unassigned_waiting`, mas não exige ativar push ou cron.
- **Celular:** usuário escolheu push do navegador, com consentimento por aparelho, não WhatsApp/SMS nem uso automático do telefone. API, inscrição, worker e dispatcher preparados; desligados por padrão. Não há entrega real comprovada.
- **Privacidade do push:** sessão/empresa/conta verificadas, revogação ao sair ou expirar a sessão, conferência do vínculo pelo worker antes de exibir, mensagem genérica sem dados do cliente e destinos HTTPS permitidos. Uma tentativa por corretor/aparelho/ciclo de espera evita repetição, inclusive após novo login; falhas de resultado incerto não são reenviadas automaticamente.
- **Correção dos 30 dias:** nova migration `20261019120000_verified_inactive_contact.sql`, sem reescrever a migration de 13/10. Considera timestamp original validado do Instagram. Edição administrativa não comprova contato; histórico inconclusivo preserva a carteira e gera revisão do gestor, sem alegar visita ou negociação inexistente. Ativação exige prontidão `verifiedInactiveContacts=true`.

### Ativação do push: pendências reais

1. Revisar e aplicar as migrations anteriores e `20261019130000_browser_web_push.sql`, no banco correto, com backup/restauração conferidos. Nenhuma migration remota aplicada nesta implementação.
2. Configurar no servidor `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` e `WEB_PUSH_ENABLED=true`; nunca expor a chave privada no cliente/logs.
3. Configurar uma rotina autenticada por minuto para `GET /api/notifications/push/dispatch`, com `Authorization: Bearer <CRON_SECRET>`. Somente depois declarar `WEB_PUSH_SCHEDULER_CONFIGURED=true`. A flag não prova execução nem entrega; não substitui monitoramento.
4. A conta Vercel foi consultada em 19/10 e está no plano Hobby, limitado a cron diário. O cron diário existente não foi alterado nem foi contratado outro plano. Avaliar Supabase Cron/pg_net/Vault já no ambiente, com acesso autorizado e limites conferidos; não acrescentar credenciais literais em SQL versionado.
5. Ativar no próprio celular, testar com clientes fictícios autorizados, validar logout/troca de conta, aceite por outro corretor, permissão revogada e recebimento com painel fechado. No iOS/iPadOS compatível, adicionar à Tela de Início. Sessão expirada, falta de conexão e restrições do sistema podem impedir entrega.

Referências: [Next.js PWA](https://nextjs.org/docs/app/guides/progressive-web-apps), [Vercel Cron — limites](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Supabase — agendamento seguro](https://supabase.com/docs/guides/functions/schedule-functions).

### Testes de 19/10

Testes sintéticos cobrem controles guiados, serialização de tipos personalizados e zero quartos/vagas, essenciais opcionais corretos, janelas de urgência, dados vencidos, leitura sem resposta, isolamento, origem e responsável preservados, Instagram real no parser ligado ao SQL isolado, histórico inconclusivo, prontidão da migration e revisão do gestor sem duplicação. O push usa criptografia real com transporte simulado; nenhuma mensagem de teste foi enviada a pessoas.

QA de navegador em fixture temporária com componentes reais: lead salvo apenas em memória sem temperatura, Galpão/zero quartos preservados no formulário clássico e disposição em notebook e tela estreita sem transbordamento horizontal. A fixture não integra a entrega. Testes locais não certificam schema remoto, execução periódica, carga entre conexões independentes ou recebimento no celular.

`pnpm --dir apps/dashboard run build:production` passou com todas as regressões, TypeScript e build Next. Checagens de IA externa foram explicitamente desativadas; os erros 401/429 nos testes são cenários simulados, não diagnóstico do provedor real. O primeiro build encontrou uma referência gerada para a fixture de QA já removida; regenerar os tipos de desenvolvimento resolveu, e o comando completo foi repetido com sucesso. ESLint dos componentes/serviços novos passou. Nos dois arquivos grandes de painel editados, a análise ainda aponta quatro erros `set-state-in-effect` e um aviso de dependência já presentes em `48a8379`; nenhuma regra de lint foi desabilitada para ocultá-los.

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
- A pedido do usuário, removidos “Ver demonstração”, seletor de modos e consulta automática da demonstração na área operacional de Conversas. Clientes reais e controles de atendimento permanecem; nenhum dado foi apagado e a rota pública de demonstração não foi removida. `node scripts/test-demo-conversations.cjs` cobre ausência do modo fictício, estado vazio e preservação de clientes/rascunhos.
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
