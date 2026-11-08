# Fluidez do painel — 08/11/2026

## Alterações

- Atualizações de leitura do CRM usam estado separado do salvamento, sem bloquear o formulário. Respostas iniciadas antes de uma escrita ou de outra atualização não substituem os dados mais novos. Uma trava síncrona impede duplo clique de gerar duas escritas.
- Sincronização do painel e histórico da conversa compara respostas serializáveis e não reaplica snapshots idênticos. Erros, notificações de alteração e retorno de foco invalidam essa comparação, preservando recuperação e sincronização entre abas. Não há cache compartilhado entre usuários.
- Indicadores, pendências, filtros, busca global e referências reutilizam cálculos enquanto suas entradas não mudam. Um relógio de minuto atualiza os indicadores temporais na aba visível.
- Listas do CRM e catálogo mostram 40 registros inicialmente; o usuário pode expandir em blocos. A pesquisa considera todos os registros carregados e reseta a janela. No funil, o limite é por etapa; as contagens continuam completas.
- Fotos do catálogo usam carregamento tardio e decodificação assíncrona. Seletores de imóveis reutilizam opções e um índice de bairros, evitando uma busca completa por bairro para cada imóvel a cada digitação.

## Evidência e limites

`node apps/dashboard/scripts/test-panel-performance.cjs` exercita componentes reais com 2.000 registros fictícios: 40 cartões iniciais em vez de 2.000, expansão para 80, busca de registro fora da janela inicial, reset, formulário disponível durante atualização, proteção contra duplo clique e resposta atrasada após salvar. Também verifica catálogo e imagens tardias. A redução de 98% se refere à quantidade inicial de cartões, não à latência total em produção.

`node apps/dashboard/scripts/test-dashboard-sync.cjs` verifica supressão de respostas idênticas, reaplicação após falha, invalidação explícita, leitura serializada, timeout, cancelamento e isolamento da demonstração. `pnpm --dir apps/dashboard run build:production` valida a suíte e a compilação.

Não há migration, mudança de credenciais, envio a clientes ou contratação de infraestrutura. A ordem da leitura de contador/histórico das conversas foi preservada para evitar confirmação indevida de mensagens novas.

Ainda não há paginação do snapshot completo no servidor: reduzir cartões não reduz o volume total transferido. Os salvamentos integrados continuam confirmando o commit e relendo a base canônica. Alterar esse contrato exige perfil de latência autenticado e testes de concorrência específicos. Não usar sucesso otimista para afirmar entrega de WhatsApp. Não há comprovação de latência ou de melhoria percentual na conta de produção nesta revisão.
