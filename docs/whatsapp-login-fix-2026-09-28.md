# Correção da abertura do login Meta — 28/09/2026

Base isolada: `a898ec17667c6d132d7166475368e700ad4e63f6`, conferida no GitHub e no deployment de produção `dpl_5nrtwUN27mzz37LD7u9VbxLD5gBF`.

O bootstrap público `https://connect.facebook.net/pt_BR/sdk.js` instala inicialmente `window.FB` com `__buffer`, `init` e `login` provisórios. O bundle substitui esse objeto. A interface tratava a existência de `FB` como prontidão e guardava a referência provisória; chamadas posteriores podiam ficar na fila antiga sem abrir a autorização.

Correção limitada ao frontend: recusar o objeto provisório, continuar aguardando a biblioteca real, liberar o botão somente quando pronta e reler a referência antes do clique. A chamada de login permanece síncrona no gesto do usuário. Erros de inicialização são apresentados na tela. Sem mudanças de credenciais, permissões, banco, número ou webhook.

Regressão: `node scripts/test-meta-sdk-readiness.cjs` no painel cobre callback antecipado, objeto provisório, substituição pelo SDK real, falha de inicialização, bloqueio do botão e limpeza dos temporizadores. Incluída no comando de testes da aplicação. Testes simulados não comprovam autorização real nem coexistência; verificar a abertura da janela após a publicação sem concluir permissões pelo usuário.
