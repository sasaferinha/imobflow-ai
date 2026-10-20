# Instagram em Conversas — entrega visual e decisões de integração

## Decisões confirmadas pelo usuário em 20/10/2026

- Uma conta de Instagram por imobiliária inicialmente.
- Ler e responder pela aba Conversas, alternando ícones WhatsApp e Instagram.
- Cada imobiliária poderá escolher atendimento automático, sugestões ao corretor ou IA desligada. Instagram começa com IA desligada até teste real.
- Todo novo contato entra em triagem, não automaticamente como oportunidade qualificada.
- Textos e fotos primeiro; áudio e vídeo posteriormente, sujeitos ao suporte da Meta.
- Importar o histórico disponibilizado pela Meta sem disparar alertas de espera para mensagens antigas.
- Distribuição igual ao WhatsApp: plantonistas com aviso após 2 minutos, demais após 5 minutos, repetição a cada 5 minutos, somente no expediente. Contagem desde a chegada mesmo com IA.
- Somente o administrador altera as regras. O usuário corrigiu explicitamente a menção a corretor.
- Ainda não há conta Instagram disponível para teste.

## Implementação deste lote

- Seletor acessível de canais, com ícone e nome, dentro de Conversas. WhatsApp continua no fluxo existente.
- Área Instagram isolada, somente leitura, sem compositor, IA ou escrita no atendimento. Não reutiliza a fila WhatsApp.
- GET autenticado `/api/conversations/instagram`: até 100 contatos Instagram cadastrados mais recentemente na empresa da sessão, ordenados pela última mensagem retida; até 40 textos por contato. Não é histórico integral nem seleção global dos 100 mais ativos.
- Não expõe token, identificador de remetente externo, telefone ou perfil bruto. O retorno não declara conexão validada.
- A aplicação usa sessão própria no servidor e transporte Supabase privilegiado. Filtro da empresa e revalidação dos registros são explícitos, seguindo o escopo de leitura da caixa existente para administradores e corretores. Não se afirma RLS por JWT de usuário.
- Demonstração não consulta a API Instagram. Troca de canal desmonta o workspace WhatsApp, cancela consultas/confirmação de leitura e conserva rascunho no reducer do painel. Operação em andamento ou diálogo aberto bloqueia a troca manual.
- Alertas urgentes do WhatsApp abrem seu próprio canal. Não existem contadores fictícios de mensagens não lidas no Instagram.

## Ainda NÃO entregue / critérios de ativação

O seletor não significa integração completa. Permanecem pendentes: login/autorização por empresa, armazenamento e renovação/revogação de credenciais, confirmação de inscrição e recebimento, envio de DMs, fotos, importação de histórico, IA e regras de distribuição no canal Instagram.

Antes disso, implementar identidade explícita por canal/conta/conversa no backend, evitando interpretar ID Instagram como telefone WhatsApp. Não inserir conversas Instagram no dispatcher atual de WhatsApp. Mudanças de modelo exigem migration revisada e rollback seguro. Conferir permissões/liberações do app Meta para atender outras empresas.

Quando existir conta de teste autorizada: conectar, receber e responder mensagem de teste, validar foto, evitar duplicatas, validar isolamento entre empresas, reconexão/desconexão, importação sem notificações retroativas e pausa da IA ao assumir atendimento. Testes locais com dados fictícios não comprovam nenhum desses resultados externos.

## Validação

- `pnpm --dir apps/dashboard test:conversation-channels`: aprovado; cobre projeção/autorização da consulta, estados, troca dos canais, rascunhos e encerramento das consultas.
- `pnpm --dir apps/dashboard run build:production`: aprovado, incluindo as suítes de regressão e a compilação TypeScript/Next.
- Lint dos quatro novos arquivos TypeScript/TSX: aprovado.
- Navegador com dados fictícios: troca dos canais, preservação do rascunho WhatsApp, consulta Instagram, estado vazio e layout estreito de 390 px verificados. Não foram enviadas mensagens nem conectadas contas reais.

Nenhuma migration ou alteração de credencial é necessária para este lote de interface/consulta. Os resultados locais não comprovam funcionamento externo da Meta.
