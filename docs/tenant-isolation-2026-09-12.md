# Isolamento entre empresas — validação local

## Alterações

A migração `supabase/migrations/20260912190000_tenant_relationship_isolation.sql`
fecha o acesso direto de `PUBLIC`, `anon` e `authenticated` às 24 tabelas do
aplicativo e à tabela opcional `property_auto_deliveries`, quando instalada.
Habilita RLS e acrescenta políticas restritivas para os dois papéis
do navegador. O produto usa sessões próprias, resolvidas no servidor; não usa
claims de empresa em JWTs do Supabase para autorizar esses papéis.

Chaves estrangeiras compostas passam a exigir a mesma empresa entre conversa e
lead/corretor, mensagem e conversa, visita e lead/imóvel, evento e lead/imóvel,
convite e criador, demonstração e corretor, fila e mensagem/conversa/corretor.
Os vínculos existentes de oportunidades já tinham essa proteção. Alterar
`company_id` de registros operacionais agora falha, inclusive com a chave do
servidor. Nenhum registro é transferido, apagado ou corrigido automaticamente.

As permissões existentes de `service_role` são preservadas. Foi acrescentada
somente a execução de `match_normalize(text)`: os índices de leads usam essa
função pura, mas a migração anterior havia retirado a permissão pública sem
concedê-la ao servidor, impedindo atualizações legítimas sob esse papel.

Reservas de entrega automática conservam IDs históricos depois da exclusão de
um imóvel. Mantêm escrita apenas por RPCs que verificam a empresa sob trava;
não recebem FKs que destruiriam o histórico ou bloqueariam exclusões normais.
Licenças podem adquirir uma empresa durante a ativação e ficam fora do gatilho
de imutabilidade por esse motivo.

O carregamento de conexões WhatsApp recusa um número atribuído a empresas
diferentes no ambiente e no banco. Salvar uma conexão verifica ambas as fontes,
e o índice único do banco continua arbitrando gravações concorrentes. Falha ao
ler as conexões não ativa um mapeamento antigo do ambiente. A validação pode ser
chamada antes das ações de ativação na Meta e é repetida antes de salvar.
Uma configuração persistida substitui todos os números do ambiente da mesma
empresa, inclusive quando desativada. Os números antigos do ambiente continuam
participando da detecção de conflito entre empresas, até sua remoção explícita
da configuração. Linhas apenas de horário comercial, sem configuração WhatsApp,
não suprimem uma conexão válida do ambiente.

## Testes reproduzíveis

Na pasta `apps/dashboard`:

```text
node scripts/test-tenant-isolation-sql.cjs
node scripts/test-tenant-isolation-api.cjs
node scripts/test-whatsapp-connection-isolation.cjs
```

O primeiro executa SQL PostgreSQL real em PGlite, incluindo as migrações
versionadas anteriores sem reescrevê-las. Exercita permissões reais dos papéis,
política permissiva antiga, concessão acidental de acesso após a migração,
inserções/alterações com referências de outra empresa, RPCs com empresa,
corretor ou objeto adulterados, imutabilidade da empresa, e operações legítimas.
Também confere que dados antigos incompatíveis abortam toda a migração sem
alterar linhas e que exclusões normais preservam seus cascades e histórico.

O segundo executa o `account_session` real, `protectedRoute`, AsyncLocalStorage,
rotas de imóveis/leads/agenda, helpers e cliente Supabase. Usa um adaptador
PostgREST para PGlite com `service_role`, sem adicionar filtros de empresa no
adaptador. Cobre A tentando ler/editar/excluir B, campos de empresa adulterados,
12 requisições intercaladas, sessões ausentes/falsas/revogadas, CSRF, resolução
do slug público e CRUD permitido dentro da mesma empresa. O terceiro cobre
conflitos de mapeamento do WhatsApp, conexão desativada e falha de configuração.

## Aplicação e limites

A migração foi revisada, validada em transação com rollback no esquema real e
aplicada ao Supabase de produção em 12/09/2026. A conferência posterior encontrou
24 políticas restritivas e as 11 novas FKs. Nenhum dado de cliente foi removido.
Requer as migrações anteriores de oportunidades, atendimento, conversas e
conexão WhatsApp. A tabela histórica opcional `property_auto_deliveries` pode
não existir: somente ela é ignorada nos dois laços de proteção, sem recriar ou
ativar esse fluxo. A variante sem sua migração também é testada em PGlite.
Todas as tabelas essenciais continuam obrigatórias; sua ausência aborta.
A validação é atômica: vínculos antigos incompatíveis ou
`company_id` nulo abortam a operação. O tempo de espera por trava é de cinco
segundos; o operador pode repetir em horário adequado após investigar a causa.
O arquivo é uma migração de execução única, não um script idempotente.

**RLS não isola chamadas feitas com `service_role`: esse papel ignora RLS.**
O teste demonstra isso expressamente consultando as duas empresas sem filtro.
O código servidor continua responsável por derivar a empresa da sessão/entrada
verificada e filtrar toda leitura, alteração ou exclusão. FKs e gatilhos
protegem a consistência das relações, não impedem uma consulta privilegiada
sem filtro nem uma exclusão privilegiada da empresa errada. O banco Neon
continua usando filtros explícitos do servidor e não recebe novas políticas
com esta migração do Supabase.

O esquema legado de CRM anterior às migrações versionadas é representado por
uma fixture mínima; isso não comprova equivalência com todo o esquema de
produção. O adaptador não substitui testes HTTP no ambiente publicado,
PostgREST real, concorrência entre conexões independentes, restauração de
backup ou auditoria de todas as rotas. Nenhum banco externo ou provedor recebeu
escritas durante essas verificações.
