# Fechamento do piloto ImobFlow — 25/11/2026

Objetivo: colocar uma imobiliária em operação com atendimento, carteira, Match, visitas e fechamento. Este documento registra preparação local e pendências; não comprova publicação nem entrega real de mensagens.

## Estado confirmado e histórico

- **18/11, histórico:** a [auditoria](auditoria-imobflow-2026-11-18.md) registrou credenciais nativas do Instagram ausentes e testes operacionais pendentes. A [conferência Meta](conexao-meta-2026-11-08.md) também registra falha anterior de autorização do WhatsApp. Revalidar esses estados; não tratá-los como leitura atual do ambiente.
- **24/11, painel observado:** Instagram exibia **Não conectado**, com o botão de conectar desabilitado e aviso de habilitação pendente. Facebook também exibia **Não conectado na conta acessada**. Isso não descreve todas as empresas do sistema.
- **25/11, acesso externo:** a Vercel pediu login e o login seguro não foi concluído. O painel ImobFlow também voltou a pedir autenticação na conferência desta etapa. Nenhuma variável remota foi lida ou alterada.
- **Revisão local:** branch `fix/instagram-readiness-20261125`, baseada em `473313c20e9c06c932c68f985da8307349341ba1`. Nenhum deploy ou teste real de atendimento foi realizado nesta etapa; nenhuma mensagem foi enviada.

## Correções preparadas

1. **Áudio social:** o parser preserva a URL válida do áudio recebido, permitindo que a transcrição encontre a mídia. A validação compartilhada restringe o download aos endereços Meta aceitos, incluindo o caminho específico `lookaside.fbsbx.com/ig_messaging_cdn`; mantém limites de tamanho, tipo e tempo. **A correção beneficia novos áudios recebidos após a publicação. Não recupera URLs de mensagens antigas já gravadas sem mídia.** Referências: [parser](../apps/dashboard/lib/meta-social.ts), [validação de mídia](../apps/dashboard/lib/social-model.ts), [transcrição](../apps/dashboard/lib/social-audio.ts).
2. **Diagnóstico OAuth do Instagram:** retorno com categorias fixas para cancelamento, tentativa expirada, configuração, permissões, conta incompatível/conflitante e falhas do provedor ou da inscrição. A tela apresenta orientação e referência de suporte; logs registram somente categoria permitida e referência gerada, sem código, token ou resposta bruta da Meta. Preservadas as verificações de state/cookie e o retorno público ao painel. Referências: [resultado OAuth](../apps/dashboard/lib/instagram-oauth-result.ts), [callback](../apps/dashboard/app/api/integrations/meta/instagram/callback/route.ts), [página de retorno](../apps/dashboard/app/integracoes/retorno/page.tsx).

**Validação local concluída:** `pnpm --dir apps/dashboard build:production` passou, incluindo as suítes integradas, o novo percurso parser → persistência → transcrição e a compilação Next.js. `pnpm --dir apps/dashboard lint` terminou sem erros; permanecem nove avisos em arquivos fora desta alteração. A revisão cruzada de áudio e OAuth não encontrou bloqueios. Não há migration nova nesta correção; a produção precisa manter o schema compatível com a [migration do Instagram nativo](../supabase/migrations/20261118010000_instagram_native_login.sql). Testes simulados não comprovam conta conectada, credencial remota válida ou entrega. Seguir a [sincronização segura](sincronizacao.md) antes de publicar.

A API auxiliar também passou: geração do Prisma, 53 testes em oito arquivos e typecheck. Executar pela raiz do workspace, com o lockfile raiz preservado: `pnpm --filter realestate-ai-mvp db:generate`, `pnpm --filter realestate-ai-mvp test` e `pnpm --filter realestate-ai-mvp typecheck`. Nenhuma dependência foi alterada nesta revisão.

## Cinco critérios para liberar a primeira imobiliária

| Critério | Ação e condição de aceite | Natureza |
|---|---|---|
| 1. Versão e empresa corretas | Publicar revisão validada, conferir migrations compatíveis e domínio/versão. Ativar `CRM_EVOLUTION_ENABLED=true`, incluir o UUID da empresa em `CRM_EVOLUTION_COMPANIES` e configurar `CRM_EVOLUTION_INTEGRATED=true`. Confirmar CRM integrado com administrador e dois corretores. | Publicação e configuração |
| 2. Canais e IA | Configurar Instagram abaixo; autorizar conta profissional; verificar WhatsApp e renovar se necessário. Com destinatários e conteúdo autorizados, comprovar entrada, resposta humana, novo áudio, IA e Match no canal correto. Conferir `OPENAI_API_KEY`, acesso/crédito e `OPENAI_TRANSCRIBE_MODEL` efetivo. | Credenciais e teste externo |
| 3. Jornada e permissões | Executar lead → plantão/carteira → Match → visita → avaliação → fechamento, com dois corretores. Conferir acesso, financeiro e disponibilidade no catálogo. Definir quem pode fechar imóvel de outro corretor: hoje o fechamento exige também permissão de edição do imóvel. | Teste operacional e decisão de negócio |
| 4. Rotinas sem painel aberto | Conferir cron autenticado, recuperação de mensagens e, se utilizado, push. Exigir evidência HTTP recente e resultado funcional; recuperar falha controlada sem duplicação. | Configuração e teste externo |
| 5. Dados e operação | Cadastrar equipe/imóveis, horários/plantão e comissões quando utilizadas; definir suporte e escopo aceito. Conferir acessos administrativos e restauração de backup em ambiente separado. | Preparação operacional/comercial |

Referências: [rollout por empresa](../apps/dashboard/lib/evolution/feature.ts), [integração canônica](../apps/dashboard/lib/evolution/server.ts), [entrega integrada](entrega-integrada-2026-11-08.md), [pendências auditadas](auditoria-imobflow-2026-11-18.md).

## Configuração Meta para conferir com acesso seguro

O fluxo nativo usa conta Instagram profissional, sem exigir Página do Facebook. Escopos implementados: `instagram_business_basic` e `instagram_business_manage_messages`. Conferir no aplicativo Meta o acesso permitido para as contas do piloto; eventual aprovação para clientes externos é uma etapa separada.

| Configuração | Requisito no código |
|---|---|
| `META_INSTAGRAM_APP_ID` | Identificador numérico do produto Instagram Login. |
| `META_INSTAGRAM_APP_SECRET` | Segredo específico do Instagram Login; também verifica a assinatura dos eventos. |
| `META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | Token de verificação do webhook; se ausente, o código usa `META_SOCIAL_WEBHOOK_VERIFY_TOKEN`, que precisa estar configurado. |
| Proteção dos tokens | `META_SOCIAL_TOKEN_ENCRYPTION_KEY` válida, com 64 caracteres hexadecimais, ou a proteção existente derivada de `META_APP_SECRET`. Preservar o mecanismo já usado: trocar chave/segredo sem migração pode impedir a leitura de vínculos anteriores. |

Não enviar valores pelo chat, gravá-los no Git ou incluí-los nas evidências. Referências: [login nativo](../apps/dashboard/lib/instagram-login.ts), [API Instagram](../apps/dashboard/lib/instagram-api.ts), [proteção das conexões](../apps/dashboard/lib/social-connections.ts).

| Uso | URL de produção |
|---|---|
| Callback Instagram Login | `https://www.imobflow.net.br/api/integrations/meta/instagram/callback` |
| Webhook Instagram | `https://www.imobflow.net.br/api/integrations/meta/instagram` — eventos `messages` e `messaging_postbacks` |
| Callback Facebook/Messenger | `https://www.imobflow.net.br/api/integrations/meta/social/callback` |
| Webhook Facebook/Messenger | `https://www.imobflow.net.br/api/integrations/meta/social` |
| Webhook WhatsApp | `https://www.imobflow.net.br/api/integrations/meta/whatsapp` |

Facebook/Messenger conserva suas credenciais próprias `META_APP_ID`, `META_APP_SECRET` e `META_SOCIAL_WEBHOOK_VERIFY_TOKEN`. Para conferir WhatsApp sem enviar mensagens, o administrador pode usar `GET /api/conversations/whatsapp?verify=1`: retorna verificação atual; token salvo sozinho fica como `unchecked`. Referência: [rota WhatsApp](../apps/dashboard/app/api/conversations/whatsapp/route.ts).

## Rotinas: conferir HTTP e resultado

- **Automações:** o [Vercel cron](../apps/dashboard/vercel.json) chama `/api/automations/cron` diariamente às 06h de São Paulo (09h UTC) e exige `CRON_SECRET`. Isso não substitui o worker em minuto.
- **Recuperação:** [script operacional](../supabase/operations/message-recovery-cron.sql) agenda `/api/automations/recover` a cada minuto quando há trabalho. Exige `MESSAGE_RECOVERY_SECRET` no servidor e o mesmo valor em `imobflow_message_recovery_secret` no Vault. Conferir job ativo, `last_http_status` e `last_success_at`; um job SQL bem-sucedido pode ter apenas enfileirado uma chamada HTTP.
- **Push:** [script operacional](../supabase/operations/web-push-cron.sql) cria job inicialmente inativo. Conferir ativação, VAPID, `VAPID_SUBJECT`, `WEB_PUSH_ENABLED=true`, `WEB_PUSH_SCHEDULER_CONFIGURED=true` e segredo `WEB_PUSH_SCHEDULER_SECRET` correspondente a `imobflow_web_push_scheduler_secret` no Vault. Exigir HTTP recente e recebimento no dispositivo opt-in. Não imprimir headers/segredos das filas.

## Teste final autorizado e escopo

Antes de qualquer envio, combinar contas, destinatários e conteúdo. Em seguida:

1. Conectar Instagram como administrador e verificar recebimento **após** a confirmação do vínculo; validar também WhatsApp.
2. Receber texto e áudio novos, responder e conferir a chegada no aplicativo destinatário; verificar transcrição e IA sem trocar o canal.
3. Usar dois corretores para validar plantão, carteira, troca de responsável, Match e a jornada completa do critério 3.
4. Conferir isolamento entre contas/empresas e uma recuperação controlada sem resposta duplicada; testar push apenas em dispositivo autorizado.
5. Registrar resultados, horários e referências técnicas sem dados de clientes ou segredos. **Esses testes reais continuam pendentes; nenhuma mensagem foi enviada nesta etapa.**

O piloto fica pronto quando essa jornada funciona com permissões corretas e recuperação comprovada. Estúdio ligado à galeria real, domínio próprio de cliente e campanhas podem ficar fora somente se esse for o escopo aceito. O estúdio ainda exige implementação; domínio/campanhas exigem configuração e validação próprias. Match WhatsApp ainda abre o aplicativo externo e prepara fotos; backfill de relatórios após interrupções longas também permanece pendente. Não apresentar esses itens como concluídos. Detalhes na [auditoria de 18/11](auditoria-imobflow-2026-11-18.md).
