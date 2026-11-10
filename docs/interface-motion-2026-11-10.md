# Movimento e carregamento do painel

Base: GitHub main `5480489`, recebida sem descartar as sete atualizações posteriores à cópia local.

- Navegação principal: transição de 180 ms por opacidade e deslocamento de 6 px na superfície existente. Sem chave de remontagem, espera artificial ou bloqueio de interação. Atualizações de dados não repetem a animação.
- Janelas nativas e modais clássicos: entrada de 160 ms. Busca global: 120 ms. Botões: resposta de cor e pressão; atualização manual: ícone em movimento durante a requisição.
- Carregamento inicial de `/painel` e módulos carregados sob demanda: prévia estrutural com anúncio acessível. Ela desaparece quando o conteúdo chega, sem temporizador.
- Preferência por movimento reduzido: novas animações desativadas. A transição ativa também é cancelada se a preferência mudar.
- Sem dependência nova, mudança no banco, envio de mensagens ou alteração de permissões.

Validação local: `pnpm --dir apps/dashboard run build:production` passou, incluindo a suíte completa e a compilação Next.js. TypeScript, navegação e desempenho sintético (preservação de formulários, atualização sem remontagem e paginação) passaram. ESLint dos arquivos TSX alterados: zero erros, um aviso preexistente de dependência `setView`. Estes testes não medem latência de produção nem substituem revisão visual em aparelhos reais.

Publicação autorizada pelo usuário em 10/11/2026. Enviar a revisão testada ao GitHub e verificar o deployment no domínio oficial. Nenhuma migration necessária nesta entrega.
