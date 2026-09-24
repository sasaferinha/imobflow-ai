# Indicadores e negocios ligados ao CRM

## Publicacao e compatibilidade

Aplicar `supabase/migrations/20260924100000_crm_performance_and_deals.sql` no projeto correto antes do novo aplicativo. A migration e transacional, cria tabelas e funcoes privadas e preserva vendas/metas antigas no Neon. Nao ha DDL disparado por requisicoes web. A migration de perfil `20260924110000_account_profile.sql` depende dela. Testes locais nao comprovam aplicacao remota.

Novos negocios ficam no Supabase (`property_deals`) junto do catalogo. Registrar o negocio e alterar o estado do imovel ocorre na mesma transacao: nao e mais necessario tentar compensar uma gravacao Neon depois de falhar no Supabase. Metas continuam no Neon; as chaves novas usam `id:<broker UUID>`. O historico de nomes permite associar vendas/metas antigas ao ID quando ha exatamente uma correspondencia. Nomes ambiguos ficam separados, sem atribuicao inventada.

## Significado dos indicadores

- Competencia: inicio inclusivo e fim exclusivo do mes em `America/Sao_Paulo`.
- Leads recebidos: clientes criados no periodo. As datas de criacao existentes sao conhecidas e entram no historico. A primeira atribuicao conhecida a corretor fica registrada.
- Leads convertidos: leads distintos com evento de mudanca para `Convertido` no mes ou vinculados a um negocio ativo cuja data pertence ao mes. Venda e aluguel podem converter; varios negocios/eventos do mesmo lead contam uma vez no agregado do mes.
- Taxa de conversao: dentre os leads recebidos naquele mes, quantos converteram ate o final dele. Assim, clientes antigos fechados agora nao fazem a taxa ultrapassar 100%. O numero de conversoes do periodo e diferente dessa coorte.
- Leads recuperados: clientes que enviaram uma mensagem apos pelo menos 30 dias sem contato recebido. Usa a ultima mensagem de entrada anterior ou, quando nao existe, o ultimo contato conhecido do lead/data de criacao. Disparar uma mensagem de saida nao prova recuperacao e nao incrementa o indicador.
- Visitas agendadas: horarios da agenda no mes, excluindo canceladas. Nao sao rotulados como visitas realizadas, pois o fluxo atual nao registra presenca.
- VGV e ticket medio: apenas vendas; alugueis aparecem separadamente como valor mensal. Ranking ordenado por VGV, sem eleger um lider com zero vendas. Empates mostram a mesma posicao/maior VGV.

Conversoes/recuperacoes antigas sem timestamp comprovado NAO sao retroativamente estimadas. A interface mostra o inicio do rastreamento. Os antigos contadores manuais permanecem guardados no Neon, mas deixam de participar do calculo e da edicao. Os dados sao atualizados no painel/perfil periodicamente e ao receber eventos locais/de outras abas.

Registrar um negocio vincula o cliente real selecionado. Cliente externo sem lead pode ser informado, mas nao aumenta a conversao de leads. O lead vinculado passa a `Convertido` na mesma transacao e deixa de ser elegivel para reativacao/recuperacao. Essa mudanca automatica tem procedencia (`last_deal_id`) e nao cria uma conversao manual separada; cancelar retira a conversao baseada no negocio. Uma mudanca posterior de etapa feita pelo usuario limpa essa procedencia e nao sera revertida por um cancelamento antigo. Um evento manual de conversao separado continua sendo um evento real independente.

## Cancelamento seguro

Cancelar marca `cancelled_at`/`cancelled_by`; nao apaga a venda. O imovel volta ao estado anterior (`Disponivel` ou `Reservado`) somente se ainda carrega o `last_deal_id` do negocio cancelado e o estado esperado. Um negocio posterior ou mudanca manual de situacao e preservado. Repetir um cancelamento nao altera o imovel novamente.

O lead volta a etapa anterior apenas quando ainda esta fechado por aquele negocio e nao existe outro negocio ativo vinculado. Com mais de um negocio ativo, a procedencia passa para o negocio restante e a etapa continua `Convertido`; o estado original e carregado em `deal_restore_status` ate o ultimo cancelamento, qualquer que seja a ordem. O campo `previous_lead_status` do negocio preserva a etapa observada no registro. Assim, cancelar nao altera historico de negocios anteriores nem perde uma mudanca manual de etapa posterior.

Vendas antigas Neon nao guardavam IDs seguros de imovel/lead. Seu cancelamento cria um registro privado em `cancelled_legacy_sales`, retira a venda dos totais e mantem os dados originais. A interface orienta revisar o catalogo: nao e seguro reabrir um imovel apenas porque seu titulo coincide com uma venda antiga.

## Validacao local

```powershell
pnpm --dir apps/dashboard exec tsc --noEmit
pnpm --dir apps/dashboard exec node scripts/test-performance-crm.cjs
pnpm --dir apps/dashboard exec node scripts/test-property-deals.cjs
pnpm --dir apps/dashboard exec node scripts/test-account-access.cjs
```

Os testes exercitam isolamento de empresa e corretor, SQL real em PGlite, aliases de nomes, limites do mes/fuso, recuperacao por entrada, coorte de conversao, estado do catalogo, cancelamento idempotente e protecao de negocio posterior. Fazer tambem um teste autenticado apos aplicar schema/publicar, usando imovel/lead de teste e conferindo o resultado em duas abas/contas autorizadas. Nao enviar mensagens a clientes reais para provar apenas os indicadores.
