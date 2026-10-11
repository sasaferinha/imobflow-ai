# Classificação inicial e etapas manuais

Solicitação de 11/10/2026: automatizar somente a distinção entre Lead e Atendimento. Agendamento, Visita, Proposta e Negociado exigem ação do corretor pelo botão Registro em Conversas.

## Regra

- Lead: contato que iniciou uma conversa e ainda não atingiu a troca mínima.
- Atendimento: pelo menos quatro mensagens válidas na mesma conversa, incluindo a sequência cliente → imobiliária → cliente. Várias respostas da imobiliária sem retorno do cliente não bastam.
- Mensagens pendentes ou com falha não contam como resposta efetivamente enviada. O classificador usa metadados, sem interpretar palavras como “visita” ou “proposta”.
- Conversas diferentes do mesmo contato não têm suas cronologias somadas. Basta uma conversa satisfazer a regra para caracterizar Atendimento.
- Agendamento, Visita, Proposta e Negociado continuam sendo registros humanos. O menu Registro já possui essas ações e mantém confirmação e histórico.

A contagem de quatro mensagens no total foi a interpretação comunicada ao usuário para “mais de 3 mensagens”, com retorno do cliente após a imobiliária.

## Preservação de dados

A classificação das duas primeiras etapas é calculada na leitura do CRM integrado, sem gravar etapas durante um GET. Registros humanos no CRM e etapas avançadas/encerradas da base legada são preservados. O cadastro clássico e as importações permitiam etapas humanas sem evento no histórico CRM; ausência desse evento não comprova classificação por IA.

A auditoria do código atual não encontrou IA gravando Visita, Proposta ou Convertido no cadastro do dashboard. Um erro em um contato existente exige conferir o cadastro e histórico reais; não é seguro rebaixar todos os contatos avançados por falta de autoria registrada.

## Validação e operação

Não há alteração de schema nem migration nesta entrega. Passaram os testes do classificador, leitor de metadados, integração CRM, Registro e demais verificações executadas pelo `build:production`. Os casos incluem limiar de mensagens, ausência de retorno, falhas de envio, múltiplos canais, isolamento de empresa, preservação de etapas humanas e leitura sem gravações. Após corrigir a tipagem de um status de entrega opcional, o teste do leitor e `next build` também passaram, incluindo TypeScript. Esses testes usam dados sintéticos e banco local; não validam a classificação de contatos reais sem sessão no painel. A publicação deve usar a revisão validada e sincronizada com o repositório oficial.

A leitura usa metadados limitados por conversa, quatro consultas simultâneas e no máximo dez consultas por conversa elegível. Não baixa o conteúdo das mensagens. Históricos indisponíveis ou com evidência insuficiente mantêm a etapa canônica/manual, que pode ser diferente de uma classificação calculada anteriormente. Muitas conversas elegíveis ainda têm custo proporcional; uma agregação no banco é uma melhoria futura para carteiras grandes.

A correção de qualquer registro específico em produção requer uma sessão autorizada no painel. Credenciais e conteúdo das conversas reais não devem ser salvos no repositório.
