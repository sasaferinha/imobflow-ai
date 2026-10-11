# Cartões de leads e atendimentos — 11/10/2026

Base: `main@3b065816a0a6774514fd61e8d9a888b1ebc5a0ad`, recuperada do GitHub neste dispositivo e verificada com `node scripts/check-sync.cjs` antes da edição.

## Comportamento

- Clicar em uma etapa do dashboard abre Atendimentos diretamente em cartões, com a finalidade, jornada, etapa e filtros anteriores preservados. Uma preferência anterior por tabela/Kanban não impede essa abertura.
- O item Leads da navegação abre cartões de leads. Tabela e Kanban de atendimentos continuam disponíveis.
- Os cartões apresentam cliente, telefone disponível, jornada, finalidade, responsável, origem, situação e datas existentes. Cliente e atendimento abrem suas respectivas fichas.
- A pirâmide invertida reproduz a referência visual fornecida pelo usuário: ponta arredondada, faixas cinza alternadas e uma faixa colorida com o nome da etapa. Negociação usa seis etapas; captação usa três.
- Um lead com um atendimento vinculado mostra sua etapa real. Havendo múltiplos atendimentos, exibe seus vínculos sem escolher uma jornada arbitrariamente. Leads pendentes sem atendimento mostram a etapa inicial; outros estados sem vínculo não recebem uma etapa inventada.
- O prazo de revisão usa a configuração real de inatividade da etapa e a última atualização do atendimento aberto. Não copia o prazo de 28 dias da imagem.
- A navegação continua interna ao ImobFlow. Não há login, redirecionamento ou integração nova com o Robust.

## Preservação e verificação

Nenhuma mudança em banco, permissões, regras de etapa, credenciais ou envio de mensagens. As capturas fornecidas não foram incorporadas ao repositório. A conferência visual utilizou exclusivamente os registros fictícios de `createDemoState`; a rota temporária foi retirada antes da compilação.

`test-attendance-cards.cjs`, incluído em `test:crm-design`, cobre todas as combinações de etapa, jornada e finalidade, registros exibidos versus contagens, retorno ao modo cartões, alternativa em tabela, etapa vinculada, abertura da ficha e ausência de gravações.

Conferência no navegador em desktop de 1886 px e celular de 390 px: duas/uma coluna, pirâmides com destaque correto, busca utilizável e nenhuma rolagem horizontal. TypeScript e suíte de design aprovados.

Todas as suítes automatizadas executadas por `build:production` passaram. A primeira compilação encontrou um validador gerado pelo servidor de prévia apontando para a rota temporária já removida. Após remover somente esse arquivo de cache, `pnpm exec next build` passou (TypeScript e 31 páginas estáticas); os dois verificadores finais `--if-requested` concluíram sem executar integrações reais, pois elas não foram solicitadas.

Lint do componente ainda falha: a base já tinha seis diagnósticos de `react-hooks/set-state-in-effect`, `react-hooks/purity` e `react-hooks/refs`. A versão editada tem sete, com mais um diagnóstico de refs na mesma chamada de navegação do resumo de leads. Não houve correção geral desses problemas nesta alteração. Build e testes funcionais aprovados não equivalem a lint limpo.

## Continuidade

As conversas e alterações exclusivas do outro computador permanecem indisponíveis. Esta entrega parte do código versionado. Conferir a branch `codex/cartoes-funil-leads` antes de continuar em outro dispositivo e preservar eventuais alterações locais. Publicação em produção é uma etapa separada; não assumir que a interface publicada já contém estes cartões.
