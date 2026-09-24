# Operação do WhatsApp — verificação em 24/09/2026

Este é o roteiro atual para preparar um piloto com números e clientes autorizados. O código recuperado da publicação não comprova, por si só, o estado atual da Meta, das credenciais, do banco ou dos agendadores. Não ative envios em massa antes do teste ponta a ponta.

## Fluxo em uso

O webhook `/api/integrations/meta/whatsapp` valida a assinatura da Meta, associa o Phone Number ID à imobiliária e grava mensagens recebidas. O atendimento, a qualificação e a fila de envio são internos ao ImobFlow; a resposta imediata tem uma recuperação persistente para falhas. O n8n é opcional para conectores futuros, não participa desse atendimento. A antiga rota `/api/integrations/n8n/property-offer` retorna HTTP 410 para impedir ofertas automáticas antigas.

## Antes de habilitar o número

1. Confirme que as fontes revisadas estão no GitHub e que a publicação usa essa revisão. Confira as migrations do Supabase, em especial `20260912221000_message_recovery.sql`, `20260914120000_inbound_recovery.sql`, `20260915200000_whatsapp_business_echo.sql` e `20260915230000_disconnect_whatsapp.sql`. A resposta 200 de saúde do banco não prova que todas foram aplicadas.
2. No SQL Editor do projeto correto, use apenas consultas de leitura para conferir migrações, job e fila. Se a tabela de histórico de migrations não existir, a conferência por versão é inconclusiva: verifique as estruturas correspondentes antes de concluir que falta uma migration. Não tente instalar ou reexecutar migrations sem preflight e plano de rollback.

   ```sql
   SELECT version FROM supabase_migrations.schema_migrations
   WHERE version IN ('20260912221000','20260914120000','20260915200000','20260915230000')
   ORDER BY version;

   SELECT jobname, schedule, active FROM cron.job
   WHERE jobname = 'imobflow-message-recovery';

   SELECT last_tick_at, last_request_at, last_http_status, last_success_at
   FROM public.message_recovery_scheduler WHERE id = true;

   SELECT state, count(*) FROM public.message_outbox GROUP BY state ORDER BY state;
   SELECT state, count(*) FROM public.inbound_reply_jobs GROUP BY state ORDER BY state;
   ```

   O agendador de recuperação é configurado em `supabase/operations/message-recovery-cron.sql`; ele requer o mesmo segredo em Vercel e Supabase Vault. Nunca consulte, copie ou publique o valor do segredo. Confira a execução real e os erros pelo status do scheduler, pelo histórico do cron e pelos logs privados; a mera existência do job não prova sucesso.
3. No painel da imobiliária, entre como administrador em **Integrações → WhatsApp Business**, confira o número salvo e use **Verificar conexão**. A consulta confirma acesso ao número, não entrega. Verifique no aplicativo Meta o callback HTTPS, a inscrição do webhook no campo `messages`, permissões e estado do número. Para coexistência com o WhatsApp Business, verifique também o evento de mensagens enviadas pelo aplicativo (`smb_message_echoes`). Não restabeleça o antigo mapeamento `WHATSAPP_META_CONNECTIONS`: ele foi zerado em produção em 13/09 e as conexões passaram a ser persistidas por empresa.

O registro de 15/09 informa que o número terminado em **3868** foi pausado e removido da Cloud API para ativação no aplicativo WhatsApp Business. A ativação no telefone, a elegibilidade de coexistência, a configuração do Embedded Signup e a reconexão **não foram verificadas nesta auditoria**. Não execute registro Cloud API convencional nem clique em reconectar às cegas: isso pode contrariar a migração para o aplicativo. Conclua essas etapas com acesso à conta Meta e confirme `is_on_biz_app` antes de habilitar o atendimento.

## Teste ponta a ponta

Com um contato de teste consentido e diferente do número da empresa:

1. Envie “oi” ao número conectado. Confira nos logs privados se o webhook recebeu `inboundMessages > 0` e se o lead e a conversa apareceram na empresa correta.
2. Confira no telefone de teste se chegou a resposta automática e se o painel distingue mensagem pendente, enviada e entregue. Se não chegou, confira conexão habilitada, assinatura/webhook Meta, fila e logs; não trate o status histórico da tela de integrações como prova de funcionamento atual.
3. Assuma a conversa como corretor, envie uma resposta pelo painel e confirme a chegada no telefone. Teste a pausa do bot e, separadamente, o envio fora da janela de 24 horas com um modelo aprovado pela Meta.
4. Se usar coexistência, envie também uma mensagem pelo WhatsApp Business do telefone e confirme que ela aparece no painel sem disparar resposta automática. Verifique atrasos e mensagens em `failed` ou `uncertain`; resultado incerto não deve ser reenviado cegamente.

## Limites conhecidos

- O painel exibe fotos recebidas e pode mostrar fotos de imóveis em prévias, mas o envio de imóvel ao cliente ainda usa texto/link ou modelo, não anexo de imagem.
- A fonte publicada não oferece exclusão de mensagens. Excluir o registro do banco diretamente comprometeria a fila e a deduplicação; mesmo uma futura exclusão no painel não apaga a cópia no WhatsApp do cliente.
- O status “Recebimento registrado” pode refletir mensagem antiga. A recuperação automática depende de job e credenciais operantes; a rotina atual reivindica uma resposta recebida pendente por chamada.
- Nenhum teste simulado substitui aprovação da Meta, webhook ativo, entrega no aparelho e conferência das migrations no banco remoto.

Para detalhes históricos, consulte `docs/message-recovery-2026-09-12.md`, `docs/whatsapp-production-mapping-2026-09-13.md` e `docs/whatsapp-app-migration-2026-09-15.md`. Eles registram o estado de suas datas, não certificam o estado atual.
