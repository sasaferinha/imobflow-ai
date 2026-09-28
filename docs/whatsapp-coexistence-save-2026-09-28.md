# Persistência após cadastro de coexistência

Na produção, o evento FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING era tratado como FINISH comum: a interface exigia uma confirmação adicional de PIN antes de enviar a autorização ao servidor. A rota também recusava ausência de PIN antes de consultar a Meta, embora o ativador já dispensasse /register para is_on_biz_app=true.

Ajuste: preservar o tipo do evento e enviar a autorização imediatamente ao servidor no fluxo de coexistência. A rota aceita PIN ausente, mas somente a resposta autenticada da Meta permite dispensar o registro. Um sinal forjado do navegador não dispensa a validação. A conta, o número, o conflito entre imobiliárias e a assinatura de webhook continuam sendo verificados antes de salvar.

Nenhuma migration ou credencial alterada. Autorizações anteriores que não chegaram ao servidor não podem ser reconstruídas a partir de IDs públicos: precisam ser concluídas novamente pelo administrador. O status configurado só será exibido após persistência real.

Testes: origem e permissões, propriedade WABA/número, coexistência sem PIN, rejeição de sinal forjado, cadastro normal com PIN e parsing dos dois eventos de conclusão. A confirmação real do novo número ainda exige concluir a autorização pelo usuário; testes simulados não comprovam entrega de mensagens.
