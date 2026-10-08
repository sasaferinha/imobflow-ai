# Novo painel ImobFlow: integração e publicação

## Unificação visual em 08/10/2026

- Base da evolução visual: `06ece1c6e69896e72578a9ba54ee94fc6e5ff8df`, alinhada ao GitHub e à produção no início do trabalho. O checkout antigo com alterações locais foi preservado.
- Fonte Nunito local, azuis ImobFlow, controles, bordas, espaçamentos e estados de foco compartilhados pelo CRM e suas telas operacionais. Conversas ganhou nova caixa de entrada, mensagens, composição e ficha comercial; agenda, resultados, metas, imóveis, leads, oportunidades, importação, equipe e integrações usam o mesmo padrão.
- Login, recuperação de senha, administração de licenças, apresentação, simulador e fontes da página pública também foram alinhados. Nenhuma migração, credencial, permissão ou regra de envio foi alterada.
- Conferência visual local com dados fictícios: telas operacionais no modo independente e dentro do host Evolution integrado, desktop e largura móvel de 390px, temas claro/escuro, formulário da agenda e preservação do rascunho ao navegar. A rota temporária usada para essa conferência foi removida e não faz parte da publicação.
- Regressão adicional: `pnpm run test:crm-design`, integrada ao `build:production`, valida análise CSS, escopo/importação, renderização TSX, estrutura acessível e fluxo de importação com confirmação, trava de duplo clique e isolamento da demonstração.
- Validação de liberação: `pnpm run build:production`, revisão dos arquivos alterados e conferência de páginas públicas, versão e saúde após publicação. A inspeção local não substitui um teste de envio real ou uma sessão autenticada de produção; nenhuma mensagem foi enviada durante esta alteração.
- Limite do lint: `dashboard-client.tsx` já apresentava duas ocorrências de `react-hooks/set-state-in-effect` e um aviso de dependências; `evolution/live-entry.tsx` já apresentava `react-hooks/error-boundaries`. As ocorrências foram reproduzidas na revisão-base com `git show`; os novos estilos não as introduzem. A sincronização funcional existente foi preservada nesta alteração visual.
- Retorno visual: reverter o commit de unificação e publicar novamente, preservando os dados. O atalho clássico passa a compartilhar os estilos atualizados; ele não restaura, sozinho, o visual anterior.

## Escopo

Preparado sobre `90ca31e02201adbed34021cd848e33ccd4b2a76c`, fonte da publicação vigente auditada, para preservar as correções de setembro. A cópia antiga de trabalho não é fonte de publicação.

- Identidade ImobFlow azul, fonte Nunito e nova organização de CRM.
- Pessoas, interesses e negociação projetados dos leads existentes, com identidade estável e sem importar exemplos da prévia.
- Imóveis e visitas permanecem nos cadastros canônicos. Conversas, WhatsApp, importação, resultados financeiros, corretores e integrações continuam nos componentes operacionais existentes.
- Cadastros adicionais e histórico do novo CRM ficam no workspace por empresa. Apenas metadados complementares são persistidos; a base canônica é relida.
- Alterações no workspace e na base canônica são confirmadas em uma transação, com versão e precondições de concorrência. Foto adicional e qualificações não editadas são preservadas.
- Carteiras legadas usam o responsável canônico. Permissões do workspace não ampliam esse acesso. Responsável ambíguo fica visível apenas ao administrador.
- Histórico de visitas concluídas fica protegido contra confirmação ou exclusão pelo painel clássico.

## Pré-requisitos e ativação

1. Executar `pnpm run build:production` em `apps/dashboard`; inclui regressões operacionais e novos testes de modelo, API, permissões e SQL com dados sintéticos.
2. Revisar, fazer commit e enviar a revisão ao GitHub. Confirmar o SHA remoto; não publicar árvore suja.
3. Aplicar **somente** as migrações `20261007190000_crm_evolution_workspace.sql` e `20261007210000_crm_evolution_legacy_bridge.sql`, nessa ordem. Ambas são aditivas e não inserem clientes ou exemplos.
4. Configurar `CRM_EVOLUTION_ENABLED=true`, `CRM_EVOLUTION_INTEGRATED=true`, e `CRM_EVOLUTION_COMPANIES` como lista explícita de UUIDs existentes autorizados. Lista vazia ou curingas não habilitam empresas.
5. Gerar uma publicação Production sem promover os domínios, a partir da revisão limpa enviada. Verificar build, versão, páginas públicas, APIs sem sessão e saúde.
6. Promover ao domínio principal apenas depois da conferência. Validar `/api/version` e saúde novamente. Uma verificação sem sessão não comprova a experiência de uma conta autenticada.

As credenciais existentes não são copiadas para o repositório. Os testes não enviam mensagens, não testam entrega de email/WhatsApp e não gravam cadastros de clientes em produção.

## Retorno seguro

- Acesso imediato ao fluxo anterior: `/painel?experiencia=classica`.
- Desativar `CRM_EVOLUTION_ENABLED` em uma nova publicação restaura o fluxo clássico como padrão.
- Alternativamente, promover a publicação anterior auditada `dpl_BjerXEmL3ASoy9Gm4aSnKdCE7fXK`. A nova versão clássica preserva os estados ampliados da agenda; a publicação anterior pode exibir estados concluídos como aguardando, por isso prefira desativar a flag na revisão nova.
- Não apagar tabelas novas nem reverter dados. Alterações canônicas continuam disponíveis no clássico; módulos adicionais e histórico ficam guardados para reativação.

## Limites e comportamentos explícitos

- 5.000 registros projetados, 30.000 eventos e documento de workspace até 1,5 MB nesta versão. A base atual foi conferida por contagens, sem exportar dados de clientes.
- Especialização venda/aluguel é metadado; distribuição automática continua desligada.
- Alteração do responsável de um cliente com conversa exige o fluxo de Conversas, que preserva o atendimento automático.
- Resultado convertido não reabre sem estorno. Múltiplos interesses independentes para um mesmo lead canônico ainda exigem evolução do modelo; o sistema bloqueia duplicação silenciosa.
- Proposta aceita atualiza negociação e disponibilidade do imóvel. Não lança receita automaticamente no módulo financeiro; esse módulo mantém seu fluxo atual.
- Conteúdo de site/portais no CRM não equivale a publicação externa. Integrações mantêm suas verificações próprias.
- Testes SQL em PGlite cobrem transações, conflitos e privilégios, não carga distribuída entre conexões reais. A verificação de produção não é um teste de entrega de mensagens.
