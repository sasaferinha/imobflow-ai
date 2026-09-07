# Automações internas

O painel não usa contadores simulados. Sem `DATABASE_URL`, apresenta o bloqueio de configuração e não permite executar ou ativar fluxos.

## Ativação posterior

1. Conectar o PostgreSQL Neon desta instalação via `DATABASE_URL` (somente servidor).
2. Configurar `CRON_SECRET` aleatório na Vercel Production. Adicionar `"crons": [{ "path": "/api/automations/cron", "schedule": "0 9 * * *" }]` ao `vercel.json` existente e publicar novamente. O agendamento não foi ativado enquanto o banco real está pendente.
3. Conferir o cron `/api/automations/cron` no projeto e executar os fluxos pelo painel autenticado.
4. Confirmar persistência após recarregar a página e consultar execuções agendadas no histórico.

As novas tabelas `site_automation_*` são criadas de maneira aditiva, seguindo a inicialização PostgreSQL já usada no projeto. Não apagar nem substituir as tabelas existentes. O usuário do banco precisa de permissão para essa inicialização.

O cron proposto roda diariamente às 09:00 UTC, compatível com a frequência diária do plano Hobby. Lembretes são elegíveis após 48 horas do último contato registrado (ou cadastro), mas a varredura diária pode criá-los até cerca de um dia depois. Cadastros, importações e atualizações também solicitam processamento no servidor via `after`.

## Limites explícitos

- Não existe envio automático por WhatsApp, e-mail ou integração com CRM externo. O novo fluxo oferece abertura manual do WhatsApp com rascunho revisado; o usuário confirma o envio no próprio WhatsApp. Nenhum evento de entrega é simulado.
- Recomendações são pré-seleções por finalidade e região exata; preço, tipo e disponibilidade exigem revisão humana.
- Imóveis demonstrativos com `reference_key` não entram nas recomendações automáticas. O motor não cria imóveis de exemplo.
- O follow-up é uma tarefa interna. Não presume ausência de resposta em canais ainda não conectados.
- Qualificação usa regras determinísticas existentes, não um serviço de IA externo.
- Instalação de uma única empresa, protegida pelo login administrativo existente. Não é uma arquitetura multiempresa: não importar bases de empresas diferentes neste banco antes de implementar isolamento por empresa e autenticação correspondente.
- Limite seguro de 10.000 leads por execução. Acima disso, interrompe com falha registrada; é necessário implementar processamento paginado antes de ampliar.
- Execuções concorrentes têm uma trava de dois minutos e resultados com chave única; uma solicitação concorrente recebe indicação de ocupado. Eventos perdidos/interrompidos são recuperados na próxima varredura ou execução manual.
- Pausar impede novos processamentos; não apaga resultados anteriores.
- As consultas mostram os últimos 100 resultados por fluxo e 40 execuções; os demais permanecem no banco.

## Novo imóvel compatível

- Processa leads reais e imóveis sem referência de demonstração. Cadastros e alterações de imóveis também disparam os fluxos após a resposta da API; há um botão “Buscar leads compatíveis”.
- Imóvel deve estar disponível, ter sido cadastrado nos últimos sete dias e após o último contato registrado do lead (ou cadastro se não houver contato). Importações preservam a data de último contato informada.
- Compara finalidade (compra/aluguel), bairro exato sem distinção de acentos/caixa, tipo, quartos e teto de orçamento. Múltiplos bairros podem ser separados por vírgula, ponto e vírgula ou barra.
- O campo aditivo PostgreSQL `site_properties.property_type` é preenchido pelo novo seletor “Tipo do imóvel”. Cadastros antigos permanecem válidos; se não houver tipo, só usa identificação explícita no título/descrição. Nunca presume que “Residencial” é apartamento.
- Informe quartos nas observações do lead e na descrição do imóvel: “2 quartos”, “dois quartos” ou “no mínimo 2 quartos” no lead. Faixas/negações ambíguas ficam fora do match. Este fluxo é voltado a imóveis residenciais com quartos informados; não faz comparação semântica de todas as preferências (vaga, varanda, acessibilidade etc.).
- Preços aceitam BRL com separador brasileiro, “mil”, “milhão/milhões” e aluguel “/mês”. Orçamentos aceitam valor, “Até ...” ou faixa explícita, usando o teto. Valores não interpretáveis não geram match.
- Cada par lead/imóvel tem chave estável e única; repetir execução ou editar preço não duplica o aviso. Outros imóveis criam oportunidades independentes.
- “Revisar mensagem” busca os dados atuais no servidor autenticado e revalida todos os critérios, disponibilidade e janela de novidade. Rascunhos obsoletos não liberam o botão de WhatsApp.
- Telefone válido permite “Continuar no WhatsApp”; sem telefone válido é possível copiar a mensagem após revisar. Nenhuma ação marca mensagem como enviada ou entregue. “Marcar como revisado” somente encerra a tarefa interna.
- Banco e envio automático continuam pendentes de configuração real. Nenhuma integração externa ou credencial foi criada nesta alteração.

## Validação

`node scripts/test-automations.cjs` testa as regras puras sem banco. `node scripts/test-match-workflow.cjs` cobre o novo fluxo, repetição, revalidação de rascunhos e proteção da API com transporte simulado. `node scripts/test-property-deals.cjs` cobre mapeamento de tipo/situação e separação de vendas/aluguel. A compilação Next verifica tipos e rotas. Testes de persistência, concorrência e agendamento em PostgreSQL/Vercel ainda exigem a conexão real, que foi adiada pelo usuário.
