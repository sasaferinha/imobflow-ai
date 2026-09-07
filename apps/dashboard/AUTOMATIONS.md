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

- Não existe envio por WhatsApp, e-mail ou integração com CRM externo.
- Recomendações são pré-seleções por finalidade e região exata; preço, tipo e disponibilidade exigem revisão humana.
- Imóveis demonstrativos com `reference_key` não entram nas recomendações automáticas. O motor não cria imóveis de exemplo.
- O follow-up é uma tarefa interna. Não presume ausência de resposta em canais ainda não conectados.
- Qualificação usa regras determinísticas existentes, não um serviço de IA externo.
- Instalação de uma única empresa, protegida pelo login administrativo existente. Não é uma arquitetura multiempresa: não importar bases de empresas diferentes neste banco antes de implementar isolamento por empresa e autenticação correspondente.
- Limite seguro de 10.000 leads por execução. Acima disso, interrompe com falha registrada; é necessário implementar processamento paginado antes de ampliar.
- Execuções concorrentes têm uma trava de dois minutos e resultados com chave única; uma solicitação concorrente recebe indicação de ocupado. Eventos perdidos/interrompidos são recuperados na próxima varredura ou execução manual.
- Pausar impede novos processamentos; não apaga resultados anteriores.
- As consultas mostram os últimos 100 resultados e 40 execuções; os demais permanecem no banco.

## Validação

`node scripts/test-automations.cjs` testa as regras puras sem banco. A compilação Next verifica tipos e rotas. Testes de persistência, concorrência e agendamento em PostgreSQL/Vercel ainda exigem a conexão real, que foi adiada pelo usuário.
