# Controle administrativo de conversas

O administrador ativo pode assumir ou devolver ao bot uma conversa de outro corretor da mesma imobiliária. O servidor continua usando a empresa e o corretor da sessão autenticada. Corretores comuns continuam limitados ao atendimento próprio; nenhuma permissão entre empresas foi adicionada.

A migration `20261108020000_admin_conversation_control.sql` atualiza a função `change_conversation_owner` e cria o registro de auditoria `conversation_owner_events`. Não altera conversas ao ser aplicada. Preserva o bloqueio durante envios em andamento e cancela mensagens pendentes na troca de atendimento, conforme o comportamento anterior. Devolver ao bot habilita o processamento das próximas mensagens; não envia respostas antigas automaticamente.

Antes de publicar, conferir o schema remoto e aplicar a migration no projeto correto. A existência do arquivo no Git não comprova aplicação no Supabase. Na preparação desta revisão, a aplicação remota ainda dependia da conexão do plugin Supabase; verificar o histórico de migrations para conhecer o estado atual.

Validação: `node apps/dashboard/scripts/test-admin-conversation-control.cjs`, `node apps/dashboard/scripts/test-conversation-attendance.cjs` e `pnpm --dir apps/dashboard run build:production`. Os testes usam dados fictícios e não comprovam entrega de mensagens reais.

Para reverter as permissões, restaurar em uma nova migration a função da migration `20261102120000_team_management.sql`, preservando a tabela de auditoria, e reverter os controles da interface. Não apagar histórico ou restaurar dados antigos de conversas.

Esta revisão inclui também busca por imóvel nos formulários: dois caracteres mínimos, pesquisa sem distinção de acentos por nome/tipo/localização/código, oito resultados visíveis e seleção explícita. O vínculo existente é preservado ao editar. Validação: `node apps/dashboard/scripts/test-property-search-field.cjs`.
