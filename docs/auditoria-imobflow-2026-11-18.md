# Revisão da ImobFlow em 18 de novembro de 2026

A ImobFlow tem implementação dos quinze pedidos do CRM, mas ainda há diferenças entre recurso implementado, integração configurada e funcionamento comprovado com clientes. As prioridades são concluir as conexões reais, levar o estúdio da demonstração para os imóveis reais e validar o atendimento completo com dois corretores.

Esta revisão inclui correções de segurança no acesso às carteiras, preparação do login independente do Instagram e atualização de dependências. A confirmação de publicação deve ser conferida no resultado da implantação; a presença deste arquivo, sozinha, não comprova que o domínio esteja servindo essa versão.

## Correções desta revisão

| Achado | Correção e efeito |
| --- | --- |
| APIs clássicas permitiam leitura ou alteração fora da carteira do corretor, dentro da mesma imobiliária. | Leads e agenda passaram a usar a carteira canônica; alterações de imóvel exigem captador ou administrador. O banco revalida identidade, empresa e responsabilidade na mesma transação da alteração. |
| O financeiro antigo permitia consulta ampla e registro direto por corretor. Seus registros identificam o corretor por nome, sem uma identidade histórica confiável. | Consulta e registro financeiro clássicos ficaram exclusivos do administrador. Corretores continuam usando as negociações do CRM integrado, com identificação própria. A tela clássica orienta esse caminho sem mostrar totais fictícios. A exclusão de vendas já exigia administrador antes desta revisão. |
| Uma tarefa de IA social poderia ser iniciada após a autorização nativa expirar. | A fila e a leitura anterior à chamada da IA verificam novamente a conexão. Tarefas sem autorização válida não avançam para processamento. |
| A conexão nativa expirada ainda poderia aparecer como conectada. | A interface mostra “Reconexão necessária”, permite renovar a mesma conta ou desconectar e mantém o histórico. |
| Respostas de autenticação negada não explicitavam a política privada de cache. | Respostas 401 e 503 de rotas protegidas também recebem `private, no-store`. |
| A auditoria de dependências de produção apontou 34 ocorrências: 3 críticas, 7 altas, 18 moderadas e 6 baixas. | Next.js passou de 16.3.3 para 16.4.5; Sharp, Fastify, Zod e dependências transitivas foram atualizados. A auditoria posterior retornou zero ocorrências conhecidas no conjunto de produção instalado. Isso não é evidência de invasão anterior nem garantia de ausência de outras falhas. |

A segunda revisão também evitou duas regressões: a leitura parcial de um corretor poderia cancelar lembretes de colegas, e uma nova listagem poderia ser truncada pelo limite do PostgREST. A leitura interna das automações continua abrangendo a empresa; a listagem usa um único array JSON, com limite explícito e teste com 1.101 leads.

As atualizações de dependências seguem os avisos oficiais do [Next.js 16.4.5](https://github.com/vercel/next.js/releases/tag/v16.4.5), incluindo correções de [cache entre parâmetros de raiz](https://github.com/advisories/GHSA-mfr8-8qww-v76h) e de [processamento de imagens em configurações afetadas](https://github.com/advisories/GHSA-2464-fhr4-w9xw). Um aviso sobre uma dependência não prova que aquela forma de exploração estivesse disponível na ImobFlow.

## Instagram e Facebook separados

O novo fluxo do Instagram usa autorização do próprio Instagram, sem selecionar uma Página do Facebook. Facebook conserva sua conexão de Página e WhatsApp conserva o fluxo atual. Cada canal mantém uma conta ativa por imobiliária; trocar de conta exige desconectar a anterior. O histórico permanece associado à identidade que o originou.

O Instagram ainda depende de habilitar **Instagram Login** no aplicativo da Meta, configurar o retorno e o webhook e inserir as credenciais próprias na Vercel. As variáveis `META_INSTAGRAM_APP_ID` e `META_INSTAGRAM_APP_SECRET` não estavam configuradas nesta conferência. Por isso, o código apresenta a indisponibilidade em vez de abrir silenciosamente o login do Facebook.

O token nativo tem validade controlada. A renovação é feita por reconexão; renovação automática agendada ainda não existe. O procedimento está em [Conexão operacional da Meta](conexao-meta-2026-11-08.md).

## Situação dos quinze pedidos

| Nº | Pedido | Situação e próximo passo |
| --- | --- | --- |
| 1 | Funil individual por corretor | Implementado no CRM integrado, com seleção pelo administrador. Esta revisão fecha desvios das APIs clássicas. Falta validar a rotina com dois corretores reais. |
| 2 | Notificações também para o administrador | Regras de demora de contato e envio ao administrador implementadas. As rotinas agendadas estão ativas; falta comprovar recebimento no celular. |
| 3 | Cálculo de avaliação do imóvel | Existe estimativa por pelo menos três comparáveis e preço por metro quadrado, com ajuste de características. A fórmula ou ficha própria que você ficou de enviar continua pendente. |
| 4 | Priorizar corretores online no plantão | Presença, prioridade e espera para offline implementadas. Falta ensaio simultâneo em dois dispositivos. |
| 5 | Interpretar áudio do lead | Transcrição privada e uso no atendimento implementados. Qualidade e processamento real ainda precisam de teste autorizado. |
| 6 | Pedir avaliação do imóvel | Segue a decisão mais recente: encerrar visita gera link e o corretor escolhe enviá-lo. Há nota, observação e registro da resposta, sem substituir a documentação da visita. |
| 7 | Avisar sobre imóvel parado por um ano | Alerta para imóvel disponível ou reservado há 365 dias. Avaliar se está caro depende dos comparáveis; tempo parado, sozinho, não determina preço de mercado. |
| 8 | Marcar imóvel vendido | Fechamento marca vendido ou alugado e retira do catálogo público, preservando histórico. A autorização de fechamento atualmente acompanha a permissão de edição do imóvel. |
| 9 | Comissão por corretor | Percentual por negócio e valor fixo configuráveis, com registro da regra no fechamento. Falta cadastrar as regras reais da imobiliária. |
| 10 | Bloquear novos leads por pendências | Há regras para falta de registro e tarefas vencidas, com prazo de regularização. Não é ainda um editor genérico de qualquer sequência obrigatória. |
| 11 | Tráfego pela ImobFlow | Há métricas, atribuição, campanha pausada e rascunho de anúncio. O fluxo atual cobre Tráfego no feed do Facebook, para adultos no Brasil. Outros objetivos, públicos e posicionamentos exigem o Gerenciador da Meta. Validação completa da conta de anúncios continua pendente. |
| 12 | Iniciar e encerrar visitas | Implementado, vinculando lead, imóvel, corretor, horários e observações. Falta testar o percurso completo com a resposta do cliente. |
| 13 | Ficha e metas de captação | Ficha inclui data, conservação, documentos e relatório. Metas mensais por corretor são configuráveis pelo administrador. |
| 14 | Resumo dentro da conversa | Assistente gera resumo apoiado nas mensagens, com revisão humana antes de salvar a qualificação. Falta avaliar qualidade com atendimentos representativos. |
| 15 | Relatórios de compradores para marketing | Relatórios semanais ou mensais privados ao administrador, com compras confirmadas e preferências. Recuperação automática de períodos antigos perdidos ainda é limitada. |

“Implementado” indica presença no código e nas regras correspondentes. A tabela identifica os testes de operação real ainda necessários.

## O que falta e o que melhorar

1. **Estúdio em imóveis reais:** a galeria real ainda abre uma demonstração. Aprovar foto ou vídeo gerado não atualiza o imóvel real, e o catálogo público só exibe vídeo de imóvel no modo demonstrativo. Falta integrar seleção da foto real, aprovação, gravação na galeria e publicação no site. Habilitar fornecedor e créditos, sozinho, não conclui esse caminho. Nenhuma imobiliária tinha a cota de IA habilitada na conferência do banco. Mantido o combinado de preparar e testar serviços pagos depois.
2. **Integrações em operação:** habilitar o Instagram direto, renovar ou conferir o WhatsApp e testar recebimento, resposta, áudio, IA e Match nos canais respectivos. O banco tinha uma conexão Facebook ativa e nenhuma Instagram; conexão salva não comprova entrega. Clientes externos podem depender de aprovação adicional da Meta.
3. **Domínio próprio:** os três modelos, prévia, banner, vídeo por URL e publicação estão implementados. Falta um domínio real para validar DNS, propriedade e HTTPS. Reservas nunca verificadas hoje podem bloquear um domínio e consumir a cota de três vínculos mesmo desativadas. Existe encaminhamento ao suporte; falta recuperação segura pelo próprio cliente.
4. **Venda por outro corretor:** hoje o corretor precisa também ter permissão de editar o imóvel para confirmar a venda. Se outro corretor puder fechar, criar uma autorização específica de fechamento, sem abrir toda a ficha para edição.
5. **Match no WhatsApp:** o caminho de oportunidades ainda abre o WhatsApp externamente e prepara as fotos para anexar. Instagram e Facebook enviam pelo CRM. Unificar o envio interno melhora a rotina, mantendo o canal de origem.
6. **Relatórios após interrupções:** o agendador gera apenas o período imediatamente anterior. Uma interrupção longa pode deixar lacunas nos relatórios salvos; falta recuperação dos períodos intermediários.
7. **Atualização do site:** uma página já aberta consulta o catálogo a cada 60 segundos. Um novo carregamento busca os dados atuais. Para atualização mais imediata, reduzir esse intervalo ou adotar eventos, avaliando custo e volume.
8. **Segurança operacional:** conferir autenticação em duas etapas das contas administrativas, executar restauração de backup em ambiente separado e completar testes autenticados com administrador e dois corretores. A sessão atual do painel expirou durante a revisão, impedindo a última conferência visual autenticada.

## Validações e limites

Passaram os testes direcionados da carteira, incluindo 71 verificações SQL, 41 migrations integradas, concorrência de acesso, financeiro antigo, automações e OAuth nativo. A API auxiliar passou em 53 testes e na verificação de tipos após a atualização das dependências. Os provedores de mensagens e IA foram simulados: não houve envio real, geração paga ou ativação de campanha.

Todos os grupos de testes do processo de produção passaram com as correções finais, assim como a compilação Next.js 16.4.5. O teste de isolamento da API foi atualizado para montar o schema atual, mantendo suas verificações anteriores. A compilação precisou da permissão local para criar vínculos de dependências na pasta temporária; nenhuma proteção do Windows foi desativada. O lint terminou sem erros e com nove avisos de manutenção. Os testes externos opcionais permaneceram desligados.

Na conferência remota, nenhuma tabela pública com `company_id` estava sem RLS, e os papéis do navegador não tinham permissões diretas nas tabelas e funções públicas consultadas. As rotinas de recuperação de mensagens, notificações e mídia estavam agendadas e suas últimas execuções SQL tinham sucesso; isso não comprova entrega ao destinatário. No banco isolado, as funções privilegiadas tinham `search_path` definido e não eram executáveis pelos papéis anônimos ou autenticados do navegador.

O escopo foi revisão de código, testes isolados, auditoria de dependências e consultas de produção sem alteração de dados de clientes. Não foi um teste de invasão completo. Não há base para prometer risco zero.

## Aviso do OneDrive

Nenhuma exclusão em massa dos 849 itens foi executada nesta revisão. Os dois nomes mostrados no aviso foram localizados no cache de build `.next`; os outros 847 não foram conferidos individualmente. A orientação foi manter os itens. Instalação e compilação desta revisão foram feitas numa cópia temporária fora do OneDrive, sem copiar credenciais, `.git` ou dependências prontas. O procedimento ficou registrado em [Sincronização segura](sincronizacao.md).

## O que precisa da sua ajuda

- Configurar o produto Instagram Login da Meta e inserir suas credenciais no ambiente, sem enviá-las pelo chat; depois autorizar uma conta profissional para teste.
- Entrar novamente no painel e separar dois acessos de corretor, além de destinatários e mensagens de teste, para validar a operação real.
- Enviar a fórmula de avaliação e cadastrar os percentuais de comissão quando definidos.
- Quando tiverem um domínio, informar o endereço e o provedor de DNS.
- Manter o estúdio como demonstração até concluir o vínculo com imóveis reais e autorizar os testes pagos; conta Runway e orçamento seguem pendentes conforme combinado.
