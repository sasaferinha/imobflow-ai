# Cadastro de lead em página própria

Solicitação de 19/10/2026: substituir a janela de criação de lead por uma página ampla. A lista de leads, a edição de registros existentes e os outros cadastros não mudam.

- Endereço dentro do painel: `/painel#leads/new`, acessível pelo botão Lead da lista e por link direto após autenticação.
- Mesmos campos guiados, regras de preenchimento, vínculos com pessoas, permissões e gravação auditada. Não cria automaticamente uma pessoa nem envia mensagens.
- Seções de cliente, origem, interesse e informações complementares, resumo da completude e ações Voltar, Cancelar e Salvar lead.
- Layout amplo com rolagem da página, coluna auxiliar em telas grandes e coluna única no celular. Não usa diálogo ou sobreposição.
- Confirma descarte de preenchimento ao cancelar, navegar pelo menu ou voltar no navegador. Solicita confirmação do navegador ao recarregar/sair com preenchimento pendente. Não armazena rascunhos com dados pessoais no navegador; uma saída confirmada descarta os dados.
- Durante salvamento, impede nova submissão e saída interna; erros e conflitos preservam o formulário para revisão e nova tentativa. Usa a mesma verificação de versão e revisão de origem do CRM.

Validação: teste dedicado `scripts/test-lead-registration-page.cjs` incluído em `test:crm-design` e, portanto, no build de produção. Cobre navegação, modo de página, owner/broker, isolamento dos outros editores, CAS/409, erros, rascunho, confirmação de saída e envio duplicado. Build completo, regressões e TypeScript aprovados. Inspeção visual local com o componente real e dados fictícios: desktop e quadro responsivo de 390px; campos por seleção e atalhos entre seções funcionam. Não foram criados registros reais. ESLint do arquivo mantém um erro preexistente no efeito de retenção do painel operacional, fora deste ajuste. Evidências de implantação devem ser registradas no PR correspondente.

Sem alteração de schema, credenciais, integrações ou regras automáticas. A publicação anterior (PR #8) permanece como referência de recuperação. Este ajuste não ativa as notificações push ou migrations operacionais pendentes.
