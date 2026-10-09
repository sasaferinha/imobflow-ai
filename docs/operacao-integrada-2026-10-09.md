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

O assistente usa `OPENAI_API_KEY` e o `OPENAI_MODEL` existentes; sem chave apresenta configuração pendente. Não houve chamada real cobrada de IA para validar a entrega. Usa Responses com Structured Outputs, `store:false`, timeout, limites de frequência, verificações de carteira antes/depois da análise. Só envia contexto quando o usuário clica em analisar.

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
