# Landing e demonstracao guiada - 29/09/2026

## Escopo

- Landing publica com animacoes, identidade branca/azul e secao de match.
- Cores chapadas, sem degrades. Botoes, CTAs e controles com cantos retos.
- O tema plano tambem se aplica a demonstracao publica incorporada, sem
  alterar as telas de contas reais do CRM.
- Demonstracao guiada em quatro etapas: conversa, leads, match e indicadores.
- O painel incorporado usa somente os dados ficticios de `/demonstracao`.
- Selecao manual, teclado, pausa/retomada e pausa fora da tela/aba.
- Preferencia por movimento reduzido desativa a reproducao automatica.
- Apenas `/demonstracao` aceita iframe de mesma origem. As demais rotas
  preservam `X-Frame-Options: DENY` na configuracao da Vercel.
- Preservado o contato WhatsApp da revisao `e6f4105`.

## Validacao antes de publicar

```powershell
node scripts/check-sync.cjs
pnpm --dir apps/dashboard exec eslint app/business-landing.tsx app/product-preview.tsx
pnpm --dir apps/dashboard run build:production
git diff --check
```

Conferir a versao publicada em `/api/version`, os headers de `/demonstracao`,
a carga do iframe e a troca das quatro etapas no dominio publico. Revisar
desktop e celular, sem rolagem horizontal ou etiquetas cortadas.

Esta alteracao nao requer migration, variavel de ambiente ou mudanca no CRM.
Os testes de dados ficticios nao certificam entrega real de WhatsApp nem
conectividade com servicos de terceiros.
