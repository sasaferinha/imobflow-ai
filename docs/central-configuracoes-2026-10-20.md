# Central de configurações da imobiliária — 20/10/2026

## Pedido e decisões

Transformar as configurações em uma entrada simples para o administrador preparar a operação de futuros clientes. Preservar o formulário compacto de IA já publicado. Os sites serão de fornecedores diferentes; o objetivo futuro é publicar, atualizar preço/fotos/dados e retirar anúncios vendidos, alugados, desativados ou excluídos. O usuário ainda não sabe informar um fornecedor/site piloto.

## Entregue nesta revisão

- `#settings`: três cartões — WhatsApp, IA e site — com linguagem simples e ações explícitas. Corretores e acessos ficam em um atalho adicional no painel integrado. Regras operacionais, prazos e listas existentes ficam em uma seção inicialmente recolhida; nada foi apagado.
- WhatsApp: reutiliza a tela de integrações existente, com conexão oficial Meta, status, verificação e desvinculação. Abrir a central não dispara login, conexão ou envio. A disponibilidade real do cadastro Meta depende da configuração da plataforma e da autorização do cliente. Não foi conectado ou modificado nenhum número nesta revisão.
- IA: reutiliza as preferências isoladas por imobiliária e os controles separados do automático e do assistente do corretor. Ter preferências salvas não comprova resposta real do provedor.
- `#website-settings`: salva somente endereço HTTPS público, fornecedor opcional e escopo solicitado `full`. Tem validação, descarte, proteção de rascunho ao sair, reconciliação de conflito e mensagem pronta para copiar e encaminhar ao fornecedor.
- URL do rascunho só entra no texto para copiar depois de validada; links com usuário/senha, parâmetros ou fragmentos não entram. Nenhum texto é enviado automaticamente.
- Apenas administradores acessam central e preparação do site, inclusive por hash direto. O servidor exige o papel e empresa autenticados para salvar. `settings.website` é removido das respostas para corretores, assim como `settings.ai`.
- Auditoria `updatedAt/updatedBy` é gerada no servidor. O cliente não pode enviar status de conexão, token, chave ou campos extras. Persistência usa o workspace e controle de versão existentes, sem migration.

## Limite essencial: não há sincronização de sites nesta revisão

O cadastro é **preparação**, não conexão. O status permanece “Integração ainda não ativa” ou “Aguardando integração”, mesmo após salvar. Nenhum imóvel é publicado, atualizado ou retirado no site externo. O CRUD de imóveis e seus efeitos internos permanecem inalterados. Nenhuma API, feed, plugin, webhook, fila externa ou credencial de fornecedor foi criada.

Validação do endereço é sintática e não consulta DNS, não verifica domínio/posse e não faz requisições. Um futuro conector precisa validar os destinos/endereços resolvidos e redirecionamentos, além de exigir autorização e credenciais segregadas por empresa. O campo de site não é armazenamento de segredos.

## Próximo passo para ativação real

Obter endereço e contato/documentação de um fornecedor piloto. Confirmar API/feed/plugin, autenticação, campos/fotos, atualização, exclusão e custo antes de escolher o adaptador. Implementar fila durável com tentativas limitadas, idempotência por imóvel/revisão/destino, retorno de erro/recibo e retirada de anúncios. Testar com duas imobiliárias isoladas e um destino de teste, sem publicar carteira real de forma implícita. Não prometer compatibilidade universal ou atualização instantânea.

## Verificação

- `pnpm run test:settings`: regras de URL/schema, autorização e isolamento por empresa, ocultação para corretores, metadata, preservação de configuração antiga/IA, nenhum acesso externo; testes de UI da central e formulário.
- `pnpm run test:evolution`, `pnpm run test:tenant-ai`, TypeScript e build de produção.
- QA visual local com dados fictícios: central, formulário de site, URL inválida, fornecedor em branco, salvamento, retorno à central e responsividade.
- Nenhuma verificação desta revisão comprova entrega WhatsApp, resposta real de IA ou publicação em site externo. Não houve alteração de credenciais, cobrança, envio a clientes ou contato com fornecedores.
