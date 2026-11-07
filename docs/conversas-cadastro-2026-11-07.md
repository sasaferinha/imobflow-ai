# Conversas e cadastro de lead — revisão de 07/11/2026

## Escopo

- Compactar o cabeçalho de Conversas no computador e devolver altura às mensagens.
- Recolher preferências ocasionais em “Alertas e horários”, mantendo componentes de alertas montados e avisos urgentes visíveis.
- Simplificar o início do cadastro de lead, reaproveitar o cliente e recolher informações opcionais; a origem usa seleção compacta com todas as opções e “Outros”.
- Preservar a ficha do cliente, Assistente, Devolver ao bot, permissões, validações e regras do administrador.
- A proposta de reorganização do celular e do fluxo de visitas permanece para uma etapa posterior.

## Conferência

A revisão de código foi feita também por um segundo revisor. Testes de layout/canais, cadastro, navegação e campos guiados passaram, assim como TypeScript e lint dos componentes alterados.

Após o feedback com os prints, a faixa de opções da conta foi integrada aos canais; o rodapé redundante foi retirado somente de Conversas; contato, status e compositor foram compactados sem remover ações. “Resposta sugerida” fechada compartilha a linha do compositor e expande ao abrir.

Na conferência de navegador a 1532 × 668, o topo do inbox passou de 270 para 104 pixels e a área de mensagens de 104 para aproximadamente 402 pixels. A 1366 × 768, o histórico mediu aproximadamente 486 pixels. A comparação usou a tela publicada como referência e uma fixture local com o shell real e dados fictícios; o ganho pode variar com tamanho da janela, avisos e conteúdo do atendimento.

Foram conferidos o recolhimento das preferências, preservação do rascunho, abertura da ficha, aviso urgente e campo de resposta visível em 1366 × 768 e aproximadamente 1093 × 614. Em altura de 550 pixels, a página permite rolagem natural. No cadastro, um orçamento negativo em grupo recolhido abriu o grupo e recebeu foco ao salvar, mantendo a validação nativa. Origem “Outros” e seleção do cliente também foram verificadas. Nenhuma mensagem foi enviada e nenhum cadastro real foi criado nesta validação visual.

## Publicação e reversão

Esta alteração é de interface e não adiciona migrations. O ajuste de fotos já presente na main foi incorporado antes da revisão para preservar o trabalho paralelo.

Publicar somente depois da compilação de produção e revisão final, em commit próprio. Se for necessário voltar, reverter o commit desta entrega, preservando as alterações de fotos e de outras entregas.
