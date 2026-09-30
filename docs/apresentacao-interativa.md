# Apresentação interativa

Rota pública: `/apresentacao`. Usa o painel de administrador existente em um iframe de `/demonstracao`, com dados fictícios e o transporte isolado já utilizado pela demonstração pública. Não conecta contas nem envia mensagens reais.

A apresentação abre `/demonstracao?mode=admin`: o mesmo `DashboardClient` de `/painel`, com conta fictícia `owner` chamada Administrador, visão geral inicial e tema escuro (alternável pelo botão do painel). Marina e Rafael são corretores separados, com seus próprios atendimentos e resultados. Nenhuma sessão ou preferência privada é lida. O parâmetro seleciona apenas a aparência da demonstração, nunca permissões de uma conta real.

O modo de apresentação não aplica os ajustes de altura/barra lateral usados na prévia da landing page; herda o layout administrativo compartilhado. O aviso de dados fictícios permanece no contorno da apresentação e também na demonstração aberta em outra aba.

## Como apresentar

1. Abra a página e selecione **Tela cheia**.
2. Clique nas áreas do painel: a explicação lateral acompanha a navegação. **Anterior** e **Próxima área** também abrem a área correspondente.
3. Use **Ocultar explicação** para explorar só o produto.
4. Use **Editar texto** para adaptar o título, explicação, três passos e mensagem final. As alterações são locais ao navegador; não são publicadas para outros visitantes. **Restaurar original** restaura apenas a área selecionada.

## Implementação e validação

- Conteúdo: `apps/dashboard/app/apresentacao/content.ts`.
- Interface: `apps/dashboard/app/apresentacao/presentation.tsx` e módulo CSS.
- Mensagens entre iframe e página exigem origem e janela de origem correspondentes. Somente áreas conhecidas são aceitas.
- A página pede o estado ao iframe no carregamento e repete a solicitação a cada 750 ms, até receber uma resposta válida. Isso recupera avisos perdidos quando o painel fica pronto antes da página. Após 15 segundos sem resposta, oferece **Tentar novamente** e **Abrir demonstração**, em vez de um carregamento infinito. Uma resposta tardia também recupera a apresentação.
- Os cabeçalhos são definidos pelo Next: somente `/demonstracao` permite incorporação pela mesma origem (`SAMEORIGIN` e `frame-ancestors 'self'`). As demais rotas mantêm `DENY`. O CSP da demonstração continua bloqueando conexões, formulários e iframes internos; não duplicar `X-Frame-Options` no `vercel.json`.
- O evento de área ativa inclui o modal Corretores apenas em modo demonstrativo; o painel de produção mantém seu comportamento.
- Regressão automatizada: `pnpm run test:presentation`, incluída em `build:production`. Exercita a troca de mensagens, carregamento fora de ordem, timeout, resposta tardia, cleanup, retry e cabeçalhos de incorporação sem acessar produção.
- Validação visual no navegador: abrir `/apresentacao`, confirmar que o painel aparece, navegar por **Próxima área** e pelos menus internos, ocultar/mostrar a explicação e verificar também uma largura de celular. A navegação e os textos editados devem continuar funcionando.
- O teste de isolamento existente `scripts/test-product-demo.cjs` também deve passar.
