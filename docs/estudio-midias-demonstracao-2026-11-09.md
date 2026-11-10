# Estúdio de mídias de imóveis — demonstração

Pedido: adicional opcional de fotos/vídeos, fora dos pacotes padrão. Preços, franquias e fornecedor de IA serão definidos com o proprietário posteriormente.

## Entrega

- `/modelo-imobiliaria/midias`: demonstração usando os quatro imóveis fictícios da Horizonte.
- Atalho em Gerenciar fotos e no editor do site demonstrativo. Nenhuma foto/identidade de imóvel real é transferida para o estúdio.
- Iluminação, contraste e cor; comparação da original com a prévia, aprovação, download JPEG e restauração da original. Esta etapa é processamento local, não restauração por IA.
- Vídeo de apresentação com as fotos aprovadas, título e marca Horizonte, 3 segundos por foto, horizontal 1280×720 ou vertical 720×1280. Exportação pelo navegador em WebM ou MP4 conforme suporte, sem áudio; prévia, download, aprovação e remoção.
- Opção Câmera com IA demonstra apenas o fluxo e um movimento ilustrativo sobre uma fotografia. Não chama fornecedor de IA, não cobra e não entrega um passeio gerado como se fosse real.
- Foto/vídeo aprovado aparece no respectivo imóvel em `/modelo-imobiliaria` no mesmo navegador; vídeo fica nos detalhes. Atualizações são notificadas entre abas. Retirar o site do ar continua prevalecendo sobre as mídias.

## Isolamento e limites

IndexedDB exclusivo da demonstração, IDs e índices de fotos limitados à lista fictícia. Nenhuma alteração no schema, Supabase, APIs de imóveis ou planos de clientes. O site real ignora o mapa de vídeos demonstrativos. O catálogo original permanece preservado e pode ser restaurado.

Blob de vídeo até 30.000.000 bytes; imagem persistida até 2.000.000 bytes. O gerador de JPEG aplica limite ainda mais conservador de 2.000.000 caracteres na data URL. Fontes do renderizador são imagens raster locais ou o host de imagens ilustrativas já usado pela demonstração, com limites e CORS, sem cookies ou redirecionamentos. URLs temporárias não são persistidas e são revogadas. Cancelamentos encerram gravação, tracks, animações e temporizadores.

## Limitações explícitas

As aprovações são locais ao navegador; não são publicação de mídias de uma imobiliária real nem sincronização entre dispositivos. WebM pode precisar de conversão para plataformas sociais que exijam MP4. Navegadores sem MediaRecorder/captureStream não geram vídeo. Manter a aba ativa durante a criação. Limpar dados do navegador remove os resultados demonstrativos.

Para comercializar: escolher provedores de restauração de foto e geração de vídeo IA, definir preços/cotas/contratação, implementar direitos do adicional por empresa, fila de processamento e armazenamento real, aplicar aprovação humana e sincronização ao catálogo do tenant, e validar custos/qualidade com mídias autorizadas. Nada disso foi ativado nesta demonstração.

## Validação

- Testes de renderer: pixels, proporção e limites, formatos, origem de imagem/CORS, cancelamento, timeouts, fallback WebM/MP4 e limpeza de recursos.
- Testes de armazenamento: IDs, limites, transações concorrentes, rollback/quota, dados corrompidos, restauração, isolamento, eventos entre abas e revogação de URLs.
- Regressões de site/editor e galeria; TypeScript e ESLint focais.
- Conferência real no navegador: preparar/aprovar foto, criar/aprovar vídeo, abrir imóvel no site demonstrativo e reproduzir vídeo.
- Revisão independente seguida de segunda conferência das correções antes da publicação.

Testes simulados de codec não substituem os testes reais de reprodução. Não houve chamadas a IA paga nem alterações em imóveis reais.
