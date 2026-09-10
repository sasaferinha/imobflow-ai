# ImobFlow — continuação de acesso e prontidão

## Estado da entrega

Migrações de recuperação/gestão de equipe e Basic com três corretores aplicadas ao Supabase de produção e verificadas com testes transacionais revertidos. Baseline Neon aplicada por conexão autenticada, fora das requisições do site. Publicação da interface em andamento; verificação final de versão pendente.

Contagens preservadas após migração e testes: 3 empresas, 4 contas, 3 imóveis. Todas as empresas existentes agora têm limite de 3 corretores. Nenhum funcionário foi desativado. Dois administradores legados não possuem e-mail; precisam informar um endereço confirmado para usar o login por e-mail. A validação de e-mail das funções existentes está correta; o aparente escape duplicado era representação JSON.

Domínio próprio e envio de e-mail foram explicitamente adiados pelo usuário. Não configurar nem contratar esses serviços nesta entrega.

## Implementado

- Três opções de acesso: cadastrar empresa, login do corretor e login do administrador. O servidor valida a função da conta, não apenas a interface.
- Troca da própria senha com confirmação da senha atual; mínimo de oito caracteres. Senhas continuam usando scrypt.
- Links aleatórios de recuperação, hash no banco, duração de 30 minutos, uso único e invalidação após alteração de senha/e-mail/desativação.
- Administrador pode gerar um link de recuperação para corretor ativo da mesma empresa, confirmando sua própria senha. Não devolve nem revela a senha do corretor.
- Recuperação pública por e-mail preparada, mas indisponível enquanto remetente e serviço não forem configurados. Não afirma que enviou e-mail sem configuração.
- Desativação/reativação apenas por administrador, bloqueada para o próprio administrador e para usuários de outras empresas. Preserva os dados comerciais; revoga sessões e links existentes.
- Limite de três corretores ativos; administrador não ocupa uma vaga. Reativação e criação usam a mesma trava da empresa.
- Metas alteráveis apenas pelo administrador, na API e na interface. Corretores continuam podendo cadastrar/excluir imóveis.
- Formulário público por `/imobiliaria/[slug]`; resolução da empresa no servidor, sem empresa padrão e sem devolver o cadastro interno na resposta pública. O link fica acessível em Gerenciar corretores.
- Removido CREATE/ALTER/DROP de rotinas de desempenho e automação. Estrutura Neon agora tem migração SQL explícita e versionada, com validação conservadora das chaves existentes.

## Verificações executadas

- `pnpm --dir apps/dashboard test`: regressões existentes e contratos de acesso.
- `pnpm --dir apps/dashboard build:production`: compilação, TypeScript e geração das rotas.
- `test-account-sql.cjs` com PGlite 0.5.8 em memória: execução do SQL real da migração sobre esquema isolado, expiração/reutilização/supersessão de tokens, mudança de senha/e-mail, revogação de sessões, papel do administrador, isolamento de empresas e limite de vagas. Fixtures revertidas com ROLLBACK.
- Migração Neon aplicada duas vezes no banco isolado: primeira instalação e repetição idempotente.
- Prévia local `/painel` respondeu HTTP 200. Testes visuais/interativos pelo navegador não foram possíveis por falha do controle do navegador.

Limitações: contratos de API usam banco simulado; testes SQL foram executados também no Supabase real, sem persistir fixtures. Concorrência entre conexões independentes, restauração de backup e testes visuais ainda não foram comprovados. O controle do navegador continua falhando. Não houve envio para clientes reais.

Verificação adicional: versão de autenticação impede que um login anterior à troca de senha/e-mail ou desativação/reativação recrie sessão. Alteração de e-mail e emissão administrativa de recuperação verificam as credenciais sob trava. A criação da quarta vaga e reativação acima do limite foram recusadas no teste do banco real. Todos os testes automatizados do dashboard agora são exigidos pelo comando de publicação.

Auditor de segurança Supabase: nenhum WARN/ERROR; informação de RLS sem políticas esperada nas tabelas acessíveis apenas pelo servidor. Isso não substitui auditoria completa: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Sequência de publicação

1. Conexões confirmadas e alterações aplicadas atomicamente. Backup recuperável e restauração em ambiente separado continuam pendentes.
2. Inspecionar o esquema atual, aplicar `supabase/migrations/20260910090000_account_recovery_and_staff.sql` e executar `supabase/tests/account_recovery_and_staff.sql` (termina em ROLLBACK). Se a migração já existir, verificar funções antes de tentar novamente; não apagar tabelas para repeti-la.
3. No Neon, revisar e aplicar `neon/migrations/20260910090000_runtime_schema_baseline.sql`. Ela recusa chaves primárias históricas incompatíveis; não reatribuir registros de empresa automaticamente.
4. Confirmar `APP_BASE_URL` com a origem de produção. Deixar e-mail desativado conforme pedido do usuário.
5. Revisar/publicar somente os arquivos validados e verificar o identificador do lançamento na Vercel.
6. Testar administrador e corretor em sessões independentes: mudança de senha, link de recuperação, desativação com sessão aberta, reativação sem reviver cookies antigos, tentativa de quarta vaga e proteção entre duas empresas. Não usar contas reais sem combinar o teste.

## O que ainda falta para operação real

### 1. WhatsApp

Salvar uma mensagem no painel não comprova entrega no WhatsApp. É necessário conectar um número empresarial a um provedor/API, receber mensagens por webhook, associar cada número à imobiliária correta e registrar as confirmações de envio/entrega e falhas. Nenhum provedor está conectado nesta entrega. Não apresentar o histórico interno como comprovação de entrega.

### 2. Entrada de clientes de várias empresas

O formulário antigo destinava solicitações públicas a uma empresa padrão. O novo usa um link próprio para cada imobiliária. Isso evita misturar leads; não substitui testes de autorização entre empresas em todas as demais rotas. Não utilizar um número global de WhatsApp para empresas diferentes.

### 4. Banco e crescimento

A retirada de alterações estruturais durante requisições está implementada. O esquema real foi verificado; backups ainda precisam ser verificados. As listas/históricos e a varredura de automações mantêm limites de leitura de aproximadamente 10 mil registros: não anunciar suporte a volume ilimitado. Trabalho pendente: paginação por conversa/lead, carregamento incremental sem perder mensagens antigas, varredura retomável por lotes com renovação de trava e teste de carga. Aumentar o plano do banco sozinho não corrige esses limites do código.

### 5. n8n

O fluxo em `integrations/n8n/04-immediate-property-offer.json` continua inativo. Requer instância n8n, WhatsApp/API autorizado, credenciais separadas por empresa, entrada estruturada do perfil do cliente, migração de entregas automáticas e teste de ponta a ponta. O adaptador preparado usa a API da Meta, não qualquer conector intercambiavelmente. Há critérios e prevenção de duplicidade testados com simulações, não envio real. Não ativar enquanto esses itens faltarem.

### 6. Backup

É uma cópia recuperável dos registros e arquivos. Precisamos abranger Supabase (clientes, imóveis, contas, mensagens), Neon (metas/resultados) e os objetos das fotos. Confirmar retenção e recuperação em projeto separado, sem restaurar sobre produção. Um indicador verde de conexão não prova existência de backup nem capacidade de restauração. Configuração e teste real continuam pendentes.

### 7. Critério de liberação

Ainda não afirmar que o SaaS está 100% pronto: faltam publicação coordenada, teste completo com duas empresas e dois papéis, integração real de mensagens, validação de cópias recuperáveis e tratamento de crescimento. Nenhuma compra, cobrança ou contratação foi realizada.
