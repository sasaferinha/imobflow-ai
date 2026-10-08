# Novo painel ImobFlow: integração e publicação

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
