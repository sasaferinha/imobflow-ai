# Interface Linha da ImobFlow

Em 9 de outubro de 2026, a interface foi adaptada ao modelo visual escolhido pelo usuário. A mudança abrange o painel integrado, módulos operacionais, painel clássico, acesso, apresentação, demonstração, páginas públicas e simulador. Preserva dados, contratos de API, permissões, integrações e os funis de negociação e captação.

## Organização e aparência

- Menu lateral claro de 208 px, oito destinos principais e submenus para os módulos adicionais existentes.
- Inter variável hospedada localmente, azul principal `#0066f5`, texto azul-marinho e fundo azul suave. A licença da fonte acompanha os arquivos em `public/fonts/linha`.
- Indicadores abertos no dashboard, filtros compactos, funis preservados, atividades e movimentações logo abaixo. Valores de venda e locação continuam separados.
- Componentes compartilhados de conversas, registros, assistente, agenda, fichas, importação, equipe e integrações com bordas leves e controles consistentes.
- Opções auxiliares da conta agrupadas em um menu. Navegação móvel com teclado, foco restaurado e bloqueio do conteúdo atrás do menu.

## Verificações concluídas

`pnpm --dir apps/dashboard run build:production` passou com as regressões de modelo, APIs simuladas, isolamento de empresas/carteiras, registros, agenda, integrações, apresentação e transporte demonstrativo. O último ajuste no aviso da demonstração foi seguido por `test:crm-design` e `next build`, também aprovados.

Foram adicionados `test-linha-navigation.cjs`, `test-public-identity.cjs` e `test-embedded-account-options.cjs` à validação visual. TypeScript e `git diff --check` passaram. As verificações direcionadas de lint apontaram problemas anteriores de efeitos/horário durante renderização; esta revisão não os apresenta como corrigidos.

A inspeção no navegador cobriu dashboard, conversas, rascunho preservado ao trocar de aba, agenda e seleção de cliente, ficha de imóvel, configurações, modos claro/escuro, acesso, demonstração e navegação sincronizada da apresentação. Dashboard e conversas também foram verificados em viewport de 390 × 844, sem transbordamento horizontal da página, incluindo o retorno de foco ao fechar o menu.

O painel integrado foi inspecionado com dados fictícios e transporte local isolado. A rota temporária dessa inspeção foi removida antes da compilação final e não faz parte da publicação. A demonstração foi conferida com a compilação de produção, mantendo sua política de isolamento de rede. Não foram enviadas mensagens ou emails, nem testadas entregas externas ou alteradas credenciais. A revisão visual não resolve problemas anteriores de configuração do provedor de IA.

## Publicação e retorno

A base desta revisão é `1324f6d959eb4c213c1c734ab3d722676d839d1f`, alinhada a `origin/main` antes das alterações. O deployment de produção observado como base foi `dpl_3i1yS3EMxc1HQksDNT5Xb6JjzYkT`, URL `https://imobflow-nzhm6jw5q-samuelvilas290-5501s-projects.vercel.app`. Esse identificador serve de referência para retorno visual, após revalidar seu estado na Vercel.

Não há migração de banco nesta alteração. A publicação deve partir de uma árvore limpa, revisada e enviada ao GitHub, usando o projeto Vercel existente com diretório raiz `apps/dashboard`. Primeiro criar o deployment Production sem promover o domínio; depois verificar versão, páginas e saúde antes da promoção. `/api/version` identifica o deployment, não necessariamente o commit Git.

Em caso de regressão, reverter o commit desta alteração em um novo commit ou promover o deployment anterior confirmado. Não executar reset destrutivo nem restauração do banco para desfazer esta mudança visual. A cópia antiga em `Documents/ChatGPT/imobflow` permanece preservada e não deve ser usada para sobrescrever a publicação atual.
