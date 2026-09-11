# Conversas: preparação do piloto

## Implementado

- Horários por empresa (padrão segunda a sexta, 08h–18h, São Paulo), feriados e ausência deduplicada pelo período fechado.
- Qualificação determinística sem chamada à OpenAI no caminho da resposta.
- Caixa de saída persistida antes do envio, identificador por solicitação, reserva exclusiva, até três tentativas e backoff de 30/60 segundos para rejeições HTTP 429/5xx. Timeout/resultado ambíguo não é reenviado: pode ter sido aceito pela Meta.
- Status enviados pela Meta, associados por empresa e identificador externo. Eventos duplicados e fora de ordem não fazem uma entrega/lida regredir.
- Envio manual real de texto, com necessidade de assumir atendimento. Imóveis compartilham texto/link; imagens de catálogo não são apresentadas como anexos entregues.
- Assumir/devolver com identidade do corretor e exclusão mútua no banco. Envios já em andamento precisam terminar antes da troca; pendências antigas são canceladas.
- Recebimento transacional evita criação duplicada de lead/conversa pelo mesmo webhook.
- Fotos privadas com validação de origem, MIME, assinatura do arquivo e limite de 5 MB durante o download; retenção de sete dias. A rota autenticada valida empresa e expiração em cada leitura e usa uma URL assinada de 60 segundos internamente, sem expor o token ao navegador. Limpeza pelo agendador.
- Cadastro e envio manual de modelos com parâmetros de texto no corpo. O administrador informa nome/idioma reais e confirma aprovação realizada na Meta. Não cadastra nem aprova modelos na Meta.
- Painel apresenta falhas, autor, controle humano/automático, retentativas elegíveis, configurações e indicadores separados. Correções visuais em 390px e 1440px com dados fictícios.

## Ativação obrigatória

1. Reautenticar a conexão Supabase do ImobFlow. O MCP falhou na renovação OAuth; o CLI também está sem token. As variáveis locais de Supabase são placeholders, não credenciais utilizáveis.
2. Aplicar `supabase/migrations/20260911053238_pilot_conversations.sql` no projeto correto, pelo histórico de migrations. A migração é aditiva e restringe as novas tabelas/funções ao backend service_role. Testada em PGlite; ainda precisa de aplicação/verificação no banco remoto.
3. Só depois publicar o código em produção. O código depende da nova estrutura: publicar antes da migration interromperia conversas/webhooks. Manter a branch de preparação separada de main enquanto a conexão estiver bloqueada.
4. Confirmar deployment Ready e as rotas de saúde. Testar com número autorizado após resolver a restrição 130497; não é garantido que trocar o número remova a restrição da conta.
5. Cadastrar horários e modelos reais na tela de Conversas. Assumir conversa antes do envio manual.

## Agendador

O Vercel configurado no repositório executa o cron diariamente às 09:00 UTC. O backoff é o horário mínimo para nova tentativa, não promessa de execução em 30 segundos. Para processamento rápido contínuo, configurar um agendador compatível com o plano de hospedagem chamando `/api/automations/cron` com Bearer `CRON_SECRET`. Não confundir ChatGPT Pro com plano Vercel. A ação manual pode processar uma tentativa vencida antes do cron. O trabalhador revalida a janela de 24h e a atribuição antes de enviar.

## Verificação

- `pnpm test`: contratos existentes, isolamento e regressões; inclui as funções SQL novas no banco local PGlite.
- `pnpm run test:pilot`: horários, roteiro sem IA, status sanitizados, origens de mídia, arquivos válidos/inválidos/grandes/expirados, rejeições transitórias/permanentes, timeout, deduplicação, atribuição exclusiva, templates e privilégios.
- `pnpm lint`, `pnpm run build:production`.
- `node scripts/preview-conversation-fixture.cjs`: prévia visual local em 127.0.0.1:4318, somente dados fictícios e sem envio. Esta prévia testa renderização; não substitui teste integrado com backend autenticado.

Nenhuma mensagem real, compra, cadastro de número ou alteração na Meta/OpenAI foi feita durante os testes. O piloto externo continua dependendo da autenticação do banco, publicação e liberação da Meta. Créditos OpenAI são opcionais para o roteiro básico.
