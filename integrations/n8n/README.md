# Imóvel disponível após informar preferências

Estado: **preparado, não ativado**. O cliente ainda não conectou n8n nem WhatsApp.
O JSON é um artefato para importar; não foi criado em uma instância remota.
Nenhuma credencial foi configurada, nenhuma mensagem real foi enviada.

## O que está implementado

- Fluxo importável `04-immediate-property-offer.json`: webhook autenticado → validação → endpoint do ImobFlow → resultado.
- Endpoint do dashboard `POST /api/integrations/n8n/property-offer`, fechado sem configuração explícita por empresa.
- Busca no **Supabase atual**; não depende do banco Prisma separado em `apps/api`.
- Seleção determinística de até um imóvel, incluindo os antigos: finalidade, tipo, bairro, faixa de orçamento e quartos; status precisa ser explicitamente `Disponível`.
- Preferências extras não verificáveis (ex.: acessibilidade, varanda, pagamento) bloqueiam o envio para revisão, em vez de afirmar compatibilidade inexistente. Para casa/apartamento é obrigatório informar quartos. Não há porcentagem de compatibilidade.
- Mensagem de texto com resumo do imóvel e link HTTPS opcional. Não envia fotos nesta versão.
- Confere mensagem recebida real dentro de 24 horas, vínculo com número receptor/remetente, versão atual do perfil, disponibilidade e atendimento humano.
- Reserva transacional única por empresa/lead/imóvel e evento recebido. Reentrega do evento não gera segundo envio.
- Guarda recibo e mensagem no mesmo histórico Supabase após aceitação do provedor, sem atribuir o cliente a um corretor fictício.

O fluxo `new-property` existente continua sendo uma preparação manual de rascunhos. Não foi reativada a antiga `recommendations` nem `qualification`.

## O que ainda impede a ativação

1. Instância n8n com HTTPS e acesso administrativo.
2. Número WhatsApp Business e credenciais. O adaptador preparado aqui é **Meta Cloud API**; Evolution ou outro serviço exige adaptação e novos testes.
3. **Conector de entrada para o Supabase do painel ainda precisa ser integrado.** Deve validar a assinatura Meta, resolver `phone_number_id` para uma única empresa, persistir mensagem e preferências e emitir o evento abaixo. O webhook antigo em `apps/api` usa outro banco e já envia respostas: não conectá-lo a este fluxo, pois causaria respostas duplicadas e bases divergentes.
4. Aplicar e registrar a migração `supabase/migrations/20260909110000_property_auto_deliveries.sql`; configurar os segredos no servidor; publicar o código do dashboard se ainda não publicado.
5. Importar o JSON, vincular credenciais e validar o ciclo completo em um número controlado. Somente então publicar/ativar o workflow. A configuração desativada é deliberada.

## Contrato da entrada (somente servidor confiável)

Depois de salvar a mensagem recebida e as preferências confirmadas, emitir:

```json
{
  "type": "lead.preferences.updated",
  "leadId": "UUID_DO_LEAD_PERSISTIDO",
  "incomingMessageId": "UUID_DA_MENSAGEM_RECEBIDA",
  "profileUpdatedAt": "TIMESTAMP_EXATO_DE_LEADS_UPDATED_AT"
}
```

- `profileUpdatedAt` deve ser o valor retornado pelo banco. Evento antigo não pode usar um perfil alterado depois.
- Sem empresa, telefone, texto de resposta, imóvel ou URL no corpo. A credencial define a empresa; o banco define o destinatário e conteúdo.
- `messages.created_at` conserva o timestamp ORIGINAL do provedor, não o horário da importação. `external_message_id` conserva seu ID; `sender_type='client'`, `direction='incoming'`.
- `conversations.channel='whatsapp'`, `external_conversation_id='meta:<phone_number_id>:<telefone_normalizado_do_lead>'`. Este formato vincula o evento ao número da empresa e ao remetente.
- `leads.updated_at` e `properties.updated_at` devem ser atualizados em toda alteração; o RPC compara os snapshots antes de reservar. A ingestão deve serializar atualizações por lead com as mesmas transações de perfil/mensagem, antes de emitir o evento.
- Confirmar critérios, incluindo eventuais restrições no texto, antes de emitir. Este fluxo não inventa dados e **não contém extrator de linguagem natural**.
- Não emitir eventos originados em mensagens de saída, demonstrações ou simples cadastro manual.

## Credenciais e configuração

No n8n, credenciais separadas por empresa:

1. Webhook Header Auth: nome `x-n8n-secret`, segredo aleatório exclusivo compartilhado apenas com o conector de entrada.
2. HTTP Request Header Auth: nome `Authorization`, valor `Bearer <token aleatório exclusivo da empresa>`.

O operador gera token criptograficamente aleatório (32 bytes em base64url, no mínimo 43 caracteres) e calcula seu SHA-256. Armazena a configuração JSON no segredo **server-only** `N8N_PROPERTY_AUTOMATION_CONNECTIONS`:

```json
[
  {
    "companyId": "UUID_REAL_DA_EMPRESA",
    "tokenSha256": "SHA256_HEXADECIMAL_DO_TOKEN_N8N",
    "enabled": false,
    "provider": "meta",
    "phoneNumberId": "ID_DO_NUMERO_DESTA_EMPRESA",
    "accessToken": "TOKEN_META_DESTA_EMPRESA",
    "apiVersion": "VERSAO_GRAPH_SUPORTADA_PELA_CONTA"
  }
]
```

Este exemplo é propositalmente inválido/inativo. Não tem segredos reais. Nunca usar `NEXT_PUBLIC_`, senha de corretor ou chave Supabase para essa integração. Não expor configuração em logs, arquivos versionados, capturas de tela ou mensagens de chat. Não há fallback para uma empresa padrão nem uma versão Graph presumida. Configuração ausente, duplicada, inválida ou desabilitada resulta em HTTP 401 sem envio.

O template aponta para o domínio principal existente. Para homologação, altere o HTTP Request para o deployment de teste e use credenciais exclusivas de teste.

## Estados, erros e recuperação

- `accepted`: existe recibo Meta persistido; **não significa entregue ou lido**. Confirmações de entrega dependem de webhook verificado futuro.
- `skipped`: nenhum envio neste processamento (ex.: sem imóvel, duplicado, sem critérios ou atendido por corretor).
- HTTP 409 / `uncertain`: pode ter sido aceito pelo provedor. A reserva fica bloqueada; não reenviar automaticamente. Inspecionar o recibo/execução e reconciliar via `finish_property_auto_delivery` com o ID verdadeiro, sem novo envio.
- Erro antes da reserva pode ser reprocessado; nunca incluir um segundo nó de envio direto no n8n. Não habilitar retry automático do nó HTTP.
- Se o processo cair após reservar, o estado `sending` continua reservado. É uma escolha conservadora: pode exigir intervenção, mas não arrisca duplicar a mensagem. Não há promessa de exactly-once externo.
- A decisão é validada no instante da reserva. Uma alteração de imóvel ou tomada da conversa depois desse instante não cancela uma requisição já iniciada no provedor.

O painel atual exibe a mensagem aceita via sua sincronização normal. Não oferece ainda uma tela de reconciliação nem status de entrega; por isso o acompanhamento operacional de pendências é requisito antes de ativar.

## Verificação

```powershell
node apps/dashboard/scripts/test-immediate-property-match.cjs
node apps/dashboard/scripts/test-n8n-property-dispatch.cjs
pnpm --dir apps/dashboard run build:production
```

SQL transacional: `supabase/tests/property_auto_deliveries.sql`. Rodar com a migração disponível, sempre em transação com rollback. Não chama provedores nem envia mensagens.

### Verificação realizada em 09/09/2026

- 133 casos de seleção/bloqueio e 10 grupos de testes de contrato/integração com banco/provedor simulados: aprovados.
- Suíte de regressão do dashboard, TypeScript e build Next de produção: aprovados.
- Migração + testes SQL executados no Supabase em **uma única transação revertida**: isolamento, permissões, atualização de versão, deduplicação, janela de entrada, atendimento humano, recibo e histórico aprovados.
- A migração **não foi instalada permanentemente**; nenhum cliente/imóvel real alterado, nenhum provedor chamado. Não houve publicação nem ativação no n8n. O endpoint precisa acompanhar a publicação do código antes da conexão real.

Documentação usada: [Webhook n8n](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [HTTP Request n8n](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/). Validar versão e permissões da Meta na conexão real antes de ativar.
