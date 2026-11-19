# Landing com demonstração do atendimento

A página pública apresenta o valor da ImobFlow pela história de uma cliente: conversa, preferências organizadas e imóvel compatível. O visitante pode experimentar esse fluxo antes de explorar a demonstração completa do CRM.

## Alterações

- Abertura com a identidade branca e azul da ImobFlow e três etapas interativas, sem reprodução automática.
- Demonstração ilustrativa com Ana Martins, corretora e imóvel fictícios. No computador, conversa e resultado aparecem lado a lado; no celular, cada etapa ocupa a área principal.
- Benefícios separados para corretor e administrador, painel completo preservado, exemplo de catálogo conectado, perguntas frequentes e contato comercial.
- Navegação por teclado, foco visível, respeito a movimento reduzido e imagens locais com descrição.
- Fotos ilustrativas já disponíveis em `public/demo-media`, com créditos no mesmo diretório. São servidas diretamente, sem ampliar as permissões do roteamento de domínios.
- Título e descrição da página atualizados para o posicionamento comercial.
- O painel incorporado consulta o estado da demonstração e oferece nova tentativa após 15 segundos sem resposta. A contagem começa quando o visitante chega à seção; respostas de outras janelas, origens ou etapas desconhecidas são rejeitadas.

Não há migração, nova credencial, cobrança de IA ou alteração das funções operacionais do CRM. Os exemplos não enviam mensagens nem gravam dados de clientes.

## Validação

As fontes são copiadas para uma pasta temporária fora do OneDrive, sem `.git`, dependências, caches ou credenciais. A instalação existente nessa cópia segue o mesmo lockfile.

Comandos relevantes em `apps/dashboard`:

```powershell
node node_modules/eslint/bin/eslint.js app/business-landing.tsx app/landing-journey.tsx app/page.tsx app/product-preview.tsx
node scripts/test-public-identity.cjs
node scripts/test-presentation-handshake.cjs
node scripts/test-presentation-headers.cjs
node scripts/test-product-preview-cta.cjs
node scripts/test-product-demo.cjs
node node_modules/next/dist/bin/next build
```

A conferência visual inclui computador, 768px, 390px e 320px; alternância das etapas; teclado; perguntas frequentes; imagens; e painel incorporado em modo de produção. A página deve manter links de acesso ao painel, demonstração, privacidade, modelo de site e contato comercial.

O modo de desenvolvimento local pode não hidratar o painel incorporado com sua política de rede restrita. Validar também a compilação de produção; não enfraquecer a política da demonstração para acomodar ferramentas de desenvolvimento.

Antes de publicar, conferir `scripts/check-sync.cjs`, revisar o diff e enviar a revisão ao GitHub. Depois do deploy, confirmar o estado Ready, a revisão de origem e o domínio `www.imobflow.net.br`.
