# Agenda: formulário de visita em colunas estreitas

## Causa e correção

O seletor legado `.inline-form > div` tinha mais especificidade que
`.visit-record-field`. Ele transformava o seletor de cliente/imóvel em uma linha
flexível, comprimindo o rótulo e a descrição até quebrarem letra por letra.

O formulário compartilhado pelo painel e pela demonstração agora mantém cada
seletor em uma coluna explícita: rótulo, botão e descrição abaixo. Os botões
ocupam a largura disponível e os títulos longos podem quebrar linha. A correção
também impede o botão de fechar a seleção de crescer e permite que a paginação
se reorganize em telas estreitas. Nenhum fluxo de gravação ou dado foi alterado.

## Validação

- `pnpm run test:appointments`: busca/filtros, seleção por ID e contratos de CSS
  contra a colisão antiga. As verificações de CSS não são testes de geometria
  renderizada em navegador.
- `pnpm run build:production`: inclui as regressões da agenda, testes existentes
  e compilação Next de produção.
- Não há migration. Não foram criados agendamentos reais durante os testes.
- A validação visual no navegador permanece pendente; uma tentativa de prévia
  local havia sido negada e não foi repetida nem contornada.

Para conferir visualmente, abrir Agenda → Novo horário, selecionar cliente e
imóvel e confirmar rótulos acima dos campos, descrição abaixo e ausência de
rolagem horizontal. Repetir com nome longo e nos temas claro/escuro. Cancelar o
formulário ao terminar, sem salvar dados de teste em produção.
