# Negociações manuais e conversão histórica

## Negociações da mesma pessoa

O botão Nova negociação, dentro da conversa, permite ao corretor registrar outro objetivo da mesma pessoa sem esperar a qualificação automática. O formulário pede nome/objetivo e finalidade, com imóvel e observações opcionais. O atendimento adicional começa em Lead e possui etapas, agendamentos, propostas e resultado próprios.

A pessoa e a conversa continuam únicas. O seletor do Registro identifica a negociação que receberá a ação; os cartões de Atendimentos mostram o objetivo para distinguir interesses do mesmo cliente. O atendimento principal e sua classificação automática não devem ser alterados por registros nas negociações adicionais.

A criação é autenticada, limitada à carteira atual, idempotente e auditada. Dados de identidade, origem inicial e responsável são derivados do cadastro existente pelo servidor. A negociação começa com a origem do contato; uma correção posterior de origem pelo Registro da negociação adicional afeta somente esse atendimento. A carteira acompanha a atribuição atual do cliente.

O vínculo entre visita e negociação fica no documento transacionado do CRM e é validado contra o cliente da agenda canônica ao recarregar. Registros, edições genéricas e comentários exigem também uma conferência transacional da carteira canônica. Não há migração.

## Funil histórico

Carteira atual continua mostrando a distribuição presente. Conversão histórica seleciona um grupo de atendimentos pela data de criação e mostra as etapas comprovadas pelo histórico registrado até a consulta. Cada atendimento é uma unidade; duas negociações da mesma pessoa contam separadamente.

Alcance de uma etapa é a quantidade de atendimentos com evidência daquela etapa dividida pelo total selecionado. Conversão entre etapas consecutivas usa os atendimentos com evidência da primeira etapa e passagem posterior pela segunda, pela data dos registros no CRM. Uma visita informada retroativamente não reescreve a data do evento de registro. Não se dividem totais independentes, não se presumem etapas puladas e não se fabricam datas anteriores.

O resultado Negociado deve excluir fechamentos desfeitos e corresponder à confirmação atual. Clicar em uma contagem histórica abre os atendimentos usados no cálculo, inclusive os que já estão em outra etapa.

Cadastros importados e classificação automática de Lead/Atendimento não possuem necessariamente eventos de transição; o leitor automático atual não persiste esses eventos. A interface informa quantos atendimentos possuem alguma passagem comprovada e quais não possuem nenhuma etapa documentada. Isso não é uma contagem de históricos completos. Ausência de registro não comprova ausência de passagem pela etapa; os percentuais são do histórico disponível, não uma reconstrução integral do passado.

## Verificação

Passaram os testes específicos de isolamento por empresa/carteira, repetição e recuperação após falha, criação manual com atendimento anterior fechado, independência de objetivos/finalidades/fontes/etapas, agenda vinculada após recarga, fechamento e correção independentes, limites de data em São Paulo, etapas puladas, estornos, histórico incompleto e navegação dos números para os registros correspondentes.

No navegador local, a criação de Alugar sala comercial e seu avanço a Atendimento preservaram os outros três objetivos do cliente fictício. O formulário foi conferido em 390 px sem transbordamento horizontal. Um grupo de dois atendimentos de 10/10 mostrou dois com passagem por Atendimento e um por Agendamento (conversão 50%). O clique histórico abriu os IDs correspondentes, inclusive o atendimento atualmente em Visita. Apenas dados fictícios foram utilizados; nenhum cadastro real ou mensagem foi alterado.

Todas as suítes de build:production passaram. Após corrigir a tipagem do foco inicial do seletor, os testes da interface, TypeScript e a compilação Next de produção passaram. Os verificadores externos opcionais não foram solicitados. A conferência autenticada no navegador usou ambiente local e dados fictícios; a publicação deve ser confirmada pelo domínio oficial, versão e arquivos entregues.
