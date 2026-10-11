# Origem do cliente no registro

O botão Registro de Conversas agora inclui a seção Origem do cliente em todas as ações. O corretor seleciona uma origem principal usando controles quadrados: Facebook, Instagram, Cliente pessoal, Tráfego pago, Indicação, WhatsApp, Site, Portal imobiliário, Placa no imóvel, Atendimento presencial ou Outros. Outros aceita um detalhe opcional. Origens configuradas e valores legados permanecem disponíveis, sem reclassificação automática.

A origem descreve como o cliente chegou à imobiliária. Canal descreve como o contato foi realizado; os campos são independentes. O mesmo seletor é usado no cadastro de leads e atendimentos. Em registros integrados existentes, a correção é feita por Registro em Conversas; atendimentos vinculados herdam a origem do lead.

O comando register aceita source opcional, limitado a 200 caracteres. Ao mudar, grava atendimento, lead vinculado e leads.source na mesma transação, com histórico. Omitir o campo preserva a origem existente. Repetições usam o mesmo identificador e payload; conflitos exigem revisão dos dados atualizados, sem sobrescrever silenciosamente uma origem que o corretor não alterou. Permissões de empresa e carteira continuam obrigatórias.

Não há alteração de schema nem migration. A classificação automática de etapas permanece limitada a Lead/Atendimento. Este trabalho não modifica clientes reais durante a validação.

## Validação

- Testes de modelo, API com PGlite, ponte canônica e interface: seleção única, Outros, valores legados, permissões, atualização conjunta, rollback, concorrência e repetição idempotente.
- Navegador local com dados fictícios: salvar/reabrir origem, campo Outros e formulário em 390 px sem transbordamento horizontal; seletor também conferido no cadastro geral.
- Executar `pnpm --dir apps/dashboard run build:production` antes da publicação; confirmar `/api/version` e saúde do domínio após o deploy.

Limitação existente: atendimentos fechados não aceitam registros. A correção de origem em um caso nativo que compartilhe o lead com outro atendimento de origem divergente é bloqueada para preservar a coerência e o histórico. O fluxo integrado atual possui um atendimento canônico por lead.
