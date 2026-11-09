# Área de campanhas

Campanhas tem uma página própria no menu do administrador. O endereço direto é `/painel?area=campaigns#campaigns`; Configurações mantém um atalho e a autorização de anúncios da Meta retorna a essa página.

## Organização

- **Visão geral:** investimento, impressões, cliques e campanhas da conta selecionada, com período consultado e filtro de campanhas.
- **Criar campanha:** nome, objetivo e orçamento diário; a criação permanece pausada, na categoria Moradia.
- **Anúncios:** preparação de foto, texto e link para campanhas de Tráfego, com conjunto e anúncio pausados.
- **Resultados no CRM:** contatos com origem registrada e vendas registradas, separados da atribuição da Meta.
- **Conexão:** autorização e seleção da conta de anúncios da empresa.

Os detalhes de uma campanha permitem consultar seu orçamento e controlar a veiculação com confirmação explícita. Trocar a conta limpa dados e seleções da conta anterior. A navegação protege dados ainda não salvos.

## Limites preservados

A criação de anúncio nesta versão configura inicialmente o feed do Facebook, Brasil e público adulto amplo. Localização, posicionamentos adicionais, Instagram e requisitos da conta devem ser revisados no Gerenciador de Anúncios. Uma campanha criada não significa que um anúncio já esteja pronto ou em veiculação.

Conexão salva não comprova autorização vigente. Falhas de leitura devem aparecer como falhas, sem apresentar números inventados. Campos de data editados não alteram o período dos resultados até uma nova consulta.

Criações usam identificador persistente da solicitação. Após erro ou demora, conferir o resultado na Meta antes de iniciar outra solicitação evita duplicação. Ativar uma campanha exige confirmação do orçamento; a interface não ativa anúncios ao carregar, navegar ou consultar métricas.

## Validação

As verificações de navegação cobrem acesso de administrador/corretor, link direto e retorno da Meta sem relaxar a sessão. As verificações de campanhas usam um provedor simulado para exercitar formulários, filtros, confirmação de orçamento e troca de conta sem gastos. Conferir também o painel publicado, com leitura da conta real, depois do deploy.

Nenhuma alteração de banco de dados é necessária para esta organização da interface. Testes da interface não substituem aprovação da conta Meta, entrega de anúncios ou validação de campanhas pagas.
