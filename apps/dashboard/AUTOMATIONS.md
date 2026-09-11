# Automações internas do ImobFlow

O fluxo principal roda no backend e no Supabase. n8n não participa do chatbot,
da qualificação, dos matches nem das notificações.

## Atendimento

O webhook verificado da Meta salva a mensagem e agenda o atendimento direto.
Saudações e perguntas simples usam textos determinísticos. Mensagens naturais
que podem conter novas preferências usam a OpenAI uma vez para extração
estruturada. Sem `OPENAI_API_KEY`, o webhook continua respondendo à Meta e envia
uma confirmação segura ao cliente.

O perfil preserva campos conhecidos e só aceita campos novos quando a extração
tem confiança mínima. Uma extração atrasada não sobrescreve uma atualização mais
recente. Depois das 18h, horário de Brasília, o cliente recebe um aviso por dia.

## Oportunidades

Um imóvel criado ou atualizado solicita uma busca dos leads da mesma empresa.
O banco filtra finalidade, tipo, cidade, região, orçamento, quartos, situação do
lead e disponibilidade antes de calcular a pontuação. Apenas resultados a partir
de 75 viram oportunidades. A combinação empresa + lead + imóvel é única.

Matches fortes criam notificação interna. Owner vê todos os matches da empresa;
corretor vê os leads atribuídos ao próprio nome. O botão de WhatsApp monta um
texto determinístico e abre `wa.me`; o corretor revisa e envia manualmente.

## Varredura diária

`GET /api/automations/cron` usa `CRON_SECRET`, processa lotes idempotentes e
retoma do cursor persistido. Configure a agenda declarada em `vercel.json`.
`INACTIVE_LEAD_DAYS` controla a inatividade, com padrão de 7 dias.

## Configuração

- `OPENAI_API_KEY`: chave server-side opcional para interpretar preferências.
- `OPENAI_MODEL`: modelo de extração; padrão `gpt-4o-mini`.
- `INACTIVE_LEAD_DAYS`: dias sem contato; padrão `7`.
- `CRON_SECRET`: proteção do agendador.
- Variáveis Meta e Supabase existentes continuam obrigatórias para o WhatsApp.

As migrations `20260911033633_core_opportunities.sql`,
`20260911033640_direct_attendance.sql` e
`20260911033755_harden_core_opportunity_functions.sql` são aditivas. A primeira cria perfil de
interesse, oportunidades, notificações, índices e rotinas de match. A segunda
cria reservas de resposta e atualização concorrente do perfil.
