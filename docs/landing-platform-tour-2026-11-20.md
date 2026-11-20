# Landing com apresentações da plataforma

A página pública usa uma composição clara e espaçosa, com tipografia grande, uma escultura de fluxo em CSS e cenas que explicam o trabalho da imobiliária. A referência visual foi o site Aircenter, observado no navegador; suas imagens, vídeos, textos e marca não foram reutilizados.

## Experiência

- Abertura com a proposta “Mais espaço para vender”, acesso ao painel, demonstração sem cadastro e contato comercial.
- Jornada interativa de conversa, perfil do lead e Match, seguida por um explorador de nove áreas: Conversas e IA; Leads, funil e Match; Imóveis e captação; Visitas e propostas; Equipe e plantões; Comissões e relatórios; Marketing e campanhas; Site da imobiliária; Estúdio de mídia.
- Apresentações específicas para corretor e administrador, catálogo conectado, demonstração do painel, perguntas frequentes e convite para conhecer a operação do cliente.
- Movimento decorativo leve e entradas ao rolar, com pausa disponível. A preferência de movimento reduzido desliga os efeitos; o conteúdo permanece legível sem JavaScript.
- Navegação por teclado, abas associadas aos painéis, foco visível e disposição própria para celular. O painel real mantém seu controle independente de reprodução.

## Fidelidade ao produto

As cenas usam dados fictícios identificados. Não incluem depoimentos, clientes, ganhos de conversão ou resultados comerciais inventados. As fotos são as imagens locais com créditos existentes em `public/demo-media/CREDITS.md`.

As conexões com a Meta dependem de autorização. A apresentação de campanhas usa cliques, CPC e objetivo, e distingue rascunhos pausados. O domínio próprio depende de configuração assistida. O estúdio é apresentado como demonstração de um adicional; geração por IA requer ativação, fornecedor e créditos. A página não executa essas gerações.

Os links para a demonstração abrem um documento próprio, preservando os cabeçalhos de isolamento da rota. Nenhuma política de segurança, API do CRM, credencial, dado de cliente ou schema do banco foi alterado.

## Validação e publicação

As fontes são validadas em cópia temporária fora do OneDrive, com conferência de igualdade. Verificações em `apps/dashboard`:

```powershell
node node_modules/eslint/bin/eslint.js app/business-landing.tsx app/landing-areas.tsx app/landing-motion.tsx app/page.tsx
node scripts/test-public-identity.cjs
node scripts/test-presentation-handshake.cjs
node scripts/test-presentation-headers.cjs
node scripts/test-product-preview-cta.cjs
node scripts/test-product-demo.cjs
node node_modules/next/dist/bin/next build
```

A conferência de navegador cobre computador, tablet e celular, abas, teclado, perguntas frequentes, pausa dos efeitos, geometria e demonstração incorporada em modo de produção. A publicação passa pelo GitHub e pela compilação da Vercel, com confirmação da versão no domínio oficial.

Nesta revisão, a conferência visual cobriu as oito áreas iniciais em 390px, cenários em 320px e 768px, teclado, FAQ e pausa dos efeitos. A aba separada do Estúdio e a correção final de 320px passaram por revisão de código e compilação; a última inspeção visual foi interrompida pela indisponibilidade do controle do navegador. Essa limitação não representa validação real das integrações ou da geração de mídia.
