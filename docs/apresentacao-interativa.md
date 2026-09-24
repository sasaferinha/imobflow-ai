# Apresentação interativa

Rota pública: `/apresentacao`. Usa o painel de administrador existente em um iframe de `/demonstracao`, com dados fictícios e o transporte isolado já utilizado pela demonstração pública. Não conecta contas nem envia mensagens reais.

## Como apresentar

1. Abra a página e selecione **Tela cheia**.
2. Clique nas áreas do painel: a explicação lateral acompanha a navegação. **Anterior** e **Próxima área** também abrem a área correspondente.
3. Use **Ocultar explicação** para explorar só o produto.
4. Use **Editar texto** para adaptar o título, explicação, três passos e mensagem final. As alterações são locais ao navegador; não são publicadas para outros visitantes. **Restaurar original** restaura apenas a área selecionada.

## Implementação e validação

- Conteúdo: `apps/dashboard/app/apresentacao/content.ts`.
- Interface: `apps/dashboard/app/apresentacao/presentation.tsx` e módulo CSS.
- Mensagens entre iframe e página exigem origem e janela de origem correspondentes. Somente áreas conhecidas são aceitas.
- O evento de área ativa inclui o modal Corretores apenas em modo demonstrativo; o painel de produção mantém seu comportamento.
- Verificação local: `.codex-build/test-presentation.cjs` (Playwright/Edge), usando `PRESENTATION_ORIGIN` para escolher a origem. Testa dez áreas, navegação bidirecional, edição/persistência/restauração, tela cheia, ocultar/mostrar, rejeição de mensagens de outra janela, celular, teclado, redução de movimento e ausência de chamadas às APIs.
- O teste de isolamento existente `scripts/test-product-demo.cjs` também deve passar.
