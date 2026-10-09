# Operação integrada — 09/10/2026

Base revisada: `main@fdf4befeaffc0d579f8465ab33e260ea894cc82e`.
Implementação: `codex/integrated-crm-operations`. Preservar o checkout antigo deste PC.

## Entrega e acesso

- `/painel#operations`: Central de gestão, cobranças e respostas, completude de cadastros, metas de captação, plantões, resumos semanais e recomendações de revisão de carteira.
- `/painel#settings`: regras opcionais do funil e rotina. Desligadas por padrão as travas, análise de redistribuição e publicação semanal no mural.
- Conversas: `Assistente` analisa até 40 textos recentes, sugere resposta e alterações de preferências com citação literal. O corretor escolhe os campos, confere e salva; respostas vão ao rascunho, nunca diretamente ao cliente. `Registro` continua separado.
- Alertas opcionais do navegador para mensagens novas e cobranças vencidas. Exigem permissão; funcionam apenas enquanto a respectiva área estiver aberta. Não são push com aplicativo fechado e não garantem entrega pelo sistema operacional.
- Pessoas, leads e imóveis têm formulários agrupados e novos campos. Novos contatos incompletos são preservados. Completude é informação preenchida, não certificação da veracidade.
- Relatório consultável/exportável em CSV. Resumo automático semanal opt-in no mural de toda a equipe, só com totais agregados, usando o cron existente. Mostra semana completa anterior no fuso São Paulo, sem inventar eventos anteriores à implantação.

## Limites intencionais

- Não há transferência automática de carteira após 30 dias. A lista identifica registros sem atualização, protege compromissos/propostas em andamento e recomenda corretores por especialidade, plantão e carga. O responsável precisa revisar; conversas continuam usando os controles de posse existentes. Não confundir `updatedAt` com contato efetivo com cliente.
- Não há classificação silenciosa de visita/proposta/fechamento por IA. O botão Registro é a confirmação humana desses eventos.
- A contagem da meta usa imóveis cadastrados no mês e responsável atribuído, não imóveis vendidos nem captações externas não registradas. O cadastro canônico de imóveis continua exclusivo do administrador.
- Campos adicionais de qualificação/documentação são persistidos no espaço CRM. Não foram todos convertidos em filtros do motor de matching ou regras de crédito.
- “Robust.io” na lista era uma referência, não um requisito específico novo. Mantido o padrão visual azul existente; não foi feita nova varredura do sistema Robust nesta entrega.

## Canais Meta

WhatsApp conserva a conexão e o envio existentes. Não alterar suas credenciais para habilitar canais sociais.

Novo webhook: `/api/integrations/meta/social`.

- Facebook Lead Ads: recebe `leadgen`, busca `id,field_data` no Graph, mapeia apenas campos explícitos e guarda respostas. Orçamento ambíguo permanece desconhecido. Cada formulário tem ID determinístico por empresa/Página/lead da Meta; reenvios não duplicam nem sobrescrevem cadastro.
- Instagram: entrada de texto para conta profissional. Cria contato sem inventar telefone, guarda as últimas 40 mensagens textuais por remetente e mostra consulta na área Integrações. Não há envio de DM pelo painel, mídias, sincronização retroativa ou mistura com o pipeline de envio WhatsApp.
- A UI distingue configuração salva de recebimento real. Testes de produção com Meta NÃO foram realizados nesta entrega; dependem de autorização e contas escolhidas.

Configuração no servidor (não colocar valores reais em Git ou chat):

```json
[
  {
    "companyId": "UUID_DA_IMOBILIARIA",
    "pageId": "ID_DA_PAGINA",
    "instagramId": "ID_DA_CONTA_PROFISSIONAL",
    "accessToken": "TOKEN_AUTORIZADO_DA_PAGINA",
    "apiVersion": "v26.0",
    "enabled": false
  }
]
```

Guardar esse JSON em `META_SOCIAL_CONNECTIONS`, configurar `META_SOCIAL_WEBHOOK_VERIFY_TOKEN` exclusivo e `META_APP_SECRET` correspondente ao aplicativo. `enabled` só funciona quando explicitamente `true`. Não existe fallback para uma empresa padrão. IDs de contas repetidos são rejeitados, inclusive em configurações desativadas. Tokens nunca retornam ao navegador.

Antes de ativar: confirmar titularidade da Página/Instagram, permissões de leitura de leads/mensagens, eventual revisão do app Meta, assinatura e inscrição corretas dos webhooks. Instagram requer conta profissional. O teste de ativação deve usar contato fictício autorizado, sem enviar para clientes reais.

O assistente usa `OPENAI_API_KEY` e o `OPENAI_MODEL` existentes; sem chave apresenta configuração pendente. A entrega original foi validada apenas com IA simulada; o teste real posterior e a pendência de credencial estão documentados na auditoria abaixo. Usa Responses com Structured Outputs, `store:false`, timeout, limites de frequência, verificações de carteira antes/depois da análise. Só envia contexto quando o usuário clica em analisar.

## Dados, segurança e reversão

Sem nova migration. Cobranças, metas e plantões usam o workspace JSON versionado existente; alterações de leads seguem a ponte canônica e a transação CAS existentes. Testes locais SQL não comprovam configurações Meta, delivery, backups ou carga de produção.

Reversão preferencial: desligar regras operacionais opcionais. Para experiência anterior, usar `/painel?experiencia=classica`. Para reverter o código inteiro, reverter o commit desta entrega e publicar a revisão testada, preservando dados e auditoria. Não restaurar documento antigo sobre workspace novo; não usar reset/force push. Desativar bindings sociais antes de retirar o receptor do ar.

## Roteiro de testes do usuário

1. Administrador cria cobrança para corretor com prazo e instrução. Corretor só vê sua cobrança, responde e marca Respondida. Gestor confere e conclui. Verificar histórico.
2. Abrir lead incompleto, conferir campos faltantes e preencher só informações conhecidas. Reabrir e confirmar persistência.
3. Definir meta e plantão; conferir responsável, mês, finalidade e horários de São Paulo. Conferir que nenhum lead mudou de carteira sozinho.
4. Em Conversas, usar Assistente, revisar evidência, adicionar texto ao rascunho. Não clicar Enviar se a conversa for real. Confirmar que Registro continua operando normalmente.
5. Ativar uma trava do funil por vez em ambiente controlado. Verificar mensagem clara ao faltar pré-requisito, depois desativar se a regra não refletir a operação.
6. Conferir resumo por semana e CSV. Se habilitar mural semanal, conferir no próximo cron configurado; não esperar email.
7. Depois de autorizar Meta, enviar formulário e DM fictícios, reenviar evento e confirmar ausência de duplicatas, empresa correta e nenhuma resposta automática.

## Validação técnica

`pnpm --dir apps/dashboard run build:production` inclui testes anteriores e `test:crm-operations`.
Este último cobre domínio, UI, permissões, IA simulada, assinatura/autenticação social, idempotência, SQL local, cron e limites de semana.
QA visual usa dados fictícios em fixture local removida antes da publicação. Não publicar a rota `qa-operations-local`.

Referências usadas: [Structured Outputs / Responses](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [exemplo oficial Meta Lead Ads](https://github.com/fbsamples/lead-ads-webhook-sample), [coleção oficial Meta Instagram](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api). A habilidade Sites orientou a preservação do padrão visual; a documentação OpenAI orientou resposta estruturada e revisão explícita, sem migrar o provedor/modelo configurado.

## Auditoria e correções após relato de falha — 09/10/2026

Base auditada: `431d85486186ca0764f8294b4679a883ff634971`. O erro mostrado pelo usuário corresponde à rejeição da requisição pelo provedor de IA, que a primeira versão apresentava sem distinguir a causa. A validação simulada da entrega original não comprovava aceitação da chamada pelo provedor real.

**Causa confirmada:** em 09/10/2026 às 02:16:08 (São Paulo), o teste real em um build de produção separado (`dpl_3MijAq8mUHxmi4VWZVbsjU669DYv`, sem promoção para o domínio principal) recebeu HTTP **401 / `invalid_api_key`**. A análise falhou já no primeiro cenário fictício. A credencial configurada foi recusada; não há evidência de erro de schema ou falta de saldo nessa resposta. Nenhuma chave foi exposta ou alterada.

**Pendência para ativar a IA:** o responsável deve substituir `OPENAI_API_KEY` no ambiente **Production** do projeto ImobFlow na Vercel, sem enviar a chave no chat. Em seguida executar a publicação separada com `IMOBFLOW_VERIFY_BROKER_ASSISTANT=1`, exigir os três cenários reais aprovados e promover a revisão verificada. Atualizar variável na Vercel, sozinho, não atualiza um deployment já em execução.

A correção de diagnóstico passa a distinguir credencial recusada, cota, limite de frequência, modelo/permissão, incompatibilidade e indisponibilidade. Os logs guardam somente status, códigos/parâmetros permitidos e identificador da requisição; nunca a mensagem bruta do provedor, chave ou conteúdo de cliente. Isso torna a falha compreensível, mas não substitui uma credencial válida. As outras correções podem ser publicadas sem declarar a IA ativada.

Correções adicionais reproduzidas em testes isolados:

- Alterar uma atividade de Tarefa para Visita agora revalida as regras opcionais, mesmo mantendo o status. Antes essa edição contornava o pré-requisito.
- Formulários Facebook reconhecem `Locação`, maiúsculas e acentos Unicode. Finalidades ambíguas continuam desconhecidas.
- O relatório mostra `Novos atendimentos`, pois o número conta registros criados na semana, não atendimentos atualmente abertos.
- Alterações em outro cliente ou imóvel durante a análise não descartam mais a resposta da IA. Mudança na ficha analisada, responsável ou permissão continua bloqueada; salvamento usa a versão atual e preserva o controle de concorrência.
- O teste da rota agora usa o formato de assistência correto e passa a resposta pelo parser real da interface; antes uma resposta estruturalmente errada podia passar no teste.

### Cada item da imagem e a solução efetivamente entregue

| Item | Solução / acesso | Limite que permanece |
| --- | --- | --- |
| 1. Robust.io | Referência do visual do novo CRM, com cores ImobFlow. | Não significa cópia integral de todas as funções do Robust. |
| 2. Dica de resposta ao corretor | Conversas → Assistente → analisar → adicionar ao rascunho. | O corretor revisa; não envia sozinho. A integração real passa pela validação descrita nesta revisão. |
| 3. Notificações e lembretes | Alertas opcionais de mensagens novas e cobranças vencidas. | Exigem permissão e área aberta; não são push com o app fechado. |
| 4. IA por setor | Seleção automática, Compra e venda, Locação ou Geral. | Orienta as sugestões; não cria departamentos autônomos. |
| 5. Pré-requisitos entre etapas | Configurações → regras opcionais de cadastro/atendimento/visita, aplicadas ao novo CRM e Registro. | Desligadas por padrão. A API clássica de agendamentos ainda não consulta essas regras; não é bloqueio universal. |
| 6. Integrações externas | WhatsApp existente preservado; receptor de Facebook Lead Ads e Instagram implementado. | Meta depende de autorização e testes reais. Instagram recebe texto, mas ainda não envia DM pelo painel. |
| 7. Formulário mais completo do cliente | Pessoas e leads com novos campos agrupados de contato, interesse, prazo e qualificação. | Preencher apenas informações conhecidas; nem todos os campos alimentam o matching. |
| 8. IA catalogando o cliente | Até 40 textos, sugestões para seis preferências comerciais com evidência e confirmação humana. | Não interpreta áudio/imagens nem cataloga tudo automaticamente; não muda etapas sozinho. |
| 9. Cadastro completo / revisão em 30 dias | Indicador de completude e revisão de carteira por prazo configurável, inicialmente 30 dias. | Recomenda, não transfere automaticamente. Inatividade usa atualização/eventos do CRM, não exclusivamente último contato com cliente. |
| 10. Cobrança do gestor | Central de gestão: pedido, prazo, responsável, resposta, conferência do gestor e histórico. | Sem mensagens externas automáticas. |
| 11. Relatórios semanais | Resumo consultável, CSV e publicação semanal opcional no mural via rotina existente. | Não é email; não inventa histórico anterior à implantação. |
| 12. Qualificar formulários de redes | Mapeamento explícito dos campos Facebook e preservação de respostas. | Não há interpretação livre desses formulários por IA nesta entrega; campos ambíguos não são adivinhados. |
| 13. Metas de captação / avisos | Metas mensais por corretor e preparação de cobrança pelo gestor. | Contagem por imóveis cadastrados/atribuídos. Não há cobrança recorrente autônoma da meta. |
| 14. Plantão com preferência | Escalas por horário/especialidade, validação de sobreposição e preferência nas recomendações. | Não distribui leads automaticamente nem atesta presença do corretor. |
| 15. Cadastro de imóveis estruturado | Campos adicionais, organização visual e indicador de completude. | Nem todos os novos campos são obrigatórios; não é réplica integral do cadastro Robust. |

O item 16 da foto estava vazio. Não foi inventado um requisito para ele.

### Evidência de testes desta revisão

- `build:production` completo passou localmente após as correções da auditoria: testes anteriores, TypeScript e build Next.
- As suítes CRM/Registro/social/relatórios exercitam permissões, isolamento entre empresas, histórico, rejeição atômica, concorrência e assinatura/idempotência com dados fictícios e banco PGlite isolado.
- `test-broker-assistant-integrated.cjs` passou com sessão e autorização reais, rota, provedor (HTTP simulado), parser da UI, salvamento transacional e reabertura do cadastro canônico em PGlite. Cobre troca de carteira, atualizações concorrentes, ausência de autosave e nenhuma alteração/envio de mensagens.
- `test-broker-assistant-errors.cjs` passou com falhas de autenticação, cota, limite, modelo, schema, indisponibilidade e respostas não JSON; conteúdo privado não é retornado nem registrado.
- `check-broker-assistant-live.cjs` é uma barreira opt-in de publicação (`IMOBFLOW_VERIFY_BROKER_ASSISTANT=1`), usando o provedor e validador reais em três conversas fictícias: venda, aluguel e esclarecimento. Não consulta clientes nem escreve no banco ou envia mensagens. Só uma execução aprovada comprova o provedor real.
- **Teste real não aprovado:** o build isolado foi interrompido por credencial inválida. Os cenários de venda/aluguel/esclarecimento ainda precisam passar após a troca da chave. Não confundir esse diagnóstico confirmado com uma IA operacional.
- Configuração de email não comprova entrega; testes de receptor Meta não comprovam contas conectadas. Não houve envio de WhatsApp, DM ou email a clientes para testar estas alterações.
