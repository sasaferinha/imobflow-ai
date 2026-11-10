# Movimento e carregamento do painel — revisão de 10/11/2026

A primeira versão (21784a5) foi publicada com transição de 180 ms e skeleton. A verificação HTTP/build não comprovou equivalência visual com a referência. O usuário relatou diferença e pediu comparação no navegador.

## Evidência da revisão

- Robust: navegação somente de leitura em Pessoas, Dashboard e Imóveis; nenhum cadastro ou configuração alterado. Foi observado um indicador central giratório com “Montando…”, animação de entrada de 0,5 s/ease e abertura do menu de 0,3 s. Os avisos de notificações permaneceram intactos.
- ImobFlow: painel autenticado acessado e navegação de Dashboard para Leads conferida. A primeira implementação não correspondia ao carregamento central observado.
- Correção local: usando o componente real com dados fictícios, captura durante a entrada de Leads mostrou opacidade 0,881 e deslocamento vertical 2,848 px antes de chegar ao estado final. Outra entrada em Imóveis também foi observada. A revisão final foi novamente observada: cartões com animação de 600 ms e deslocamento em andamento de 89,4 px; spinner de 60 px, borda de 5 px e giro de 900 ms. Os parâmetros foram conferidos nos estilos carregados pela página de referência, sem incorporar seus arquivos ao projeto.
- Evidência local: `work/motion-loading-verified.jpg`. A rota temporária de QA foi removida antes do build e não deve ser publicada.

## Alterações

- Entrada de telas de 500 ms por opacidade; cartões entram em 600 ms com deslocamento vertical inicial de 20%; mantém a superfície existente, sem remontar formulários ou conversas.
- Indicador central giratório em azul com “Montando…” no carregamento inicial, módulos sob demanda e relatórios mensais.
- Menu lateral móvel e janelas com entrada de 300 ms; conteúdo das abas móveis com entrada de 500 ms.
- Movimento reduzido continua respeitado. Sem atraso artificial: telas já disponíveis não fingem buscar dados. A duração da rede não é igual entre os dois produtos.
- Sem nova dependência, migration, alteração de dados ou envio de mensagens.

TypeScript, teste de navegação e teste de área móvel passaram. A comparação identifica o padrão observado; não é prova de equivalência pixel a pixel ou de todos os fluxos do Robust.
