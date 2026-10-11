# Correção de fechamento

A ação Editar fechamento permite corrigir valor e condições de uma proposta aceita ou desfazer um fechamento registrado por engano. Está disponível no Registro da conversa e nas fichas do atendimento ganho e da proposta aceita. O motivo e a confirmação dos efeitos são obrigatórios.

Corrigir dados mantém a data original de aceite/fechamento, o cliente, o imóvel, a finalidade e o responsável. Os indicadores atuais calculados pelas propostas aceitas passam a refletir o novo valor.

Desfazer um fechamento reabre o atendimento em Proposta, restaura o estado anterior da proposta e a situação anterior do imóvel comprovada pelo histórico (Disponível ou Reservado). Uma proposta criada diretamente como aceita é mantida como Rascunho. Os marcadores atuais de aceite/fechamento são removidos, preservando todos os eventos anteriores e acrescentando a correção com autor, data e motivo.

Um cliente convertido importado sem proposta aceita pode ter somente sua classificação corrigida, reabrindo em Atendimento. Esse caso não altera imóveis nem inventa dados de proposta.

## Persistência e acesso

O comando register/correct_close reutiliza a API autenticada, o identificador idempotente e a transação do CRM com controle de versão e da base canônica. O salvamento genérico continua bloqueado para reescrever resultados confirmados. Desfazer exige acesso de escrita também ao imóvel; no catálogo integrado, isso mantém a permissão atual de administrador. Corrigir valor e condições segue o acesso ao atendimento e à proposta.

Não há migração nem transação financeira nesta entrega. O fluxo de propostas não cria lançamentos em site_sales; registros financeiros independentes não são alterados.

O histórico interno é necessário para restaurar o imóvel. Conflitos de estado, outro fechamento para o mesmo imóvel e alterações concorrentes bloqueiam a operação. Edições externas que fizeram um ciclo de status e terminaram no mesmo valor, sem eventos no CRM, não podem ser reconstruídas com as evidências atuais; o formulário exige revisão explícita do efeito. Não inferir histórico ausente por aproximação de timestamps.

## Indicadores e validação

Funil, metas e propostas aceitas refletem o estado atual corrigido. Novos resumos semanais contam apenas fechamentos ainda confirmados, identificam correções e estornos e não duplicam um atendimento reaberto e fechado novamente. Resumos anteriormente publicados permanecem registros da situação na geração. Isso não implementa uma análise histórica completa de conversão entre etapas.

Passaram as suítes de build:production, incluindo modelo, API/SQL com PGlite, ponte canônica, interface e resumo semanal, repetição idempotente, conflito, rollback e isolamento por empresa/carteira. A compilação Next/TypeScript também passou.

No navegador local, com dados fictícios, a correção de valor/condições manteve o fechamento; a reabertura restaurou Proposta/Aberto, proposta Em negociação e imóvel Reservado. A entrada pela ficha e o formulário em 390 px foram conferidos. Nenhum cadastro real foi alterado durante os testes. A verificação de produção deve conferir versão, saúde do banco e acesso autenticado das APIs, sem testar gravações em clientes reais.
