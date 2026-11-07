# Sites das imobiliárias — 7 de novembro de 2026

## Comportamento

O administrador abre **Configurações → Editar site da imobiliária**. O editor nasce com a marca da empresa, permite ajustar identidade, capa, apresentação, destaque de campanha, vídeo e canais de contato. O conteúdo fica em rascunho até a publicação explícita. Também é possível restaurar a publicação anterior ou retirar o site do ar sem apagar os imóveis.

O site usa `/imobiliaria/<slug da empresa>`. A primeira versão não provisiona domínios personalizados nem substitui sites de fornecedores externos. A preparação de conexão externa continua disponível separadamente. As páginas antigas de atendimento continuam funcionando enquanto a imobiliária não publica seu site.

O catálogo consulta a base do CRM. Imóveis disponíveis aparecem; vendidos, alugados, reservados e arquivados ficam fora. Não existe cópia manual do estoque. Novas leituras refletem preço, fotos e disponibilidade; visitantes com a página aberta recebem atualização periódica quando a aba está visível. O formulário reconfere a disponibilidade antes de registrar interesse.

O formulário de um imóvel cria o contato na imobiliária correspondente. Endereço privado do imóvel, proprietário, notas internas, comissões e dados dos clientes não compõem a resposta pública. Ocultar preços também retira seus valores da resposta pública. Os canais e textos de contato publicados são os que o administrador escolhe no editor.

## Marketing e mídia

O dono pode criar e desativar contas de marketing ou redefinir suas senhas. A desativação e a troca de senha encerram as sessões anteriores. Essas contas têm tabela e sessão próprias e permitem editar apenas o site daquela empresa; não recebem acesso ao CRM. Senhas usam o mesmo algoritmo de proteção das contas existentes, tokens ficam em cookies HTTP-only e sua revogação é conferida no servidor. A entrada de marketing é `/site/acesso`; o editor restrito é `/site/editar`.

Logo, capa e imagem de campanha aceitam upload JPG, PNG ou WebP de até 2 MB, ou endereço público HTTPS. Vídeos aceitam links YouTube/Vimeo ou arquivos MP4/WebM já hospedados em HTTPS. Não há upload de arquivos grandes de vídeo nesta versão. URLs não são buscadas pelo servidor, e conteúdos não são interpretados como HTML.

## Piloto fictício

`/modelo-imobiliaria` apresenta a Horizonte Imobiliária, explicitamente fictícia. `/modelo-imobiliaria/editor` usa o mesmo editor com armazenamento local do navegador. Permite publicar conteúdo de demonstração e simular alterações no catálogo sem escrever no CRM, criar clientes reais ou disparar mensagens. Os testes de banco usam duas empresas sintéticas isoladas.

## Implantação e reversão

Aplicar `20261108000000_company_websites.sql` e `20261108001000_website_media.sql` antes do código. São tabelas, funções e bucket novos; nenhum catálogo existente é publicado automaticamente. Não executar reset do banco. As migrations devem ser registradas no histórico remoto na mesma transação de aplicação.

O acesso público usa somente a versão publicada. Escritas verificam a versão esperada para impedir a substituição silenciosa do trabalho de outra pessoa. Rascunhos, auditoria e credenciais nunca entram na resposta pública.

Para reverter o código, reverter apenas esta entrega no Git e republicar. Preservar as tabelas e o bucket para não perder conteúdo ou arquivos. A interface permite restaurar conteúdo anterior sem reverter o software.

## Validação

Testes específicos cobrem publicação, rascunho, reversão, concorrência, catálogo, isolamento, marketing e mídia. A conferência visual inclui o site, filtros, ficha do imóvel e editor em computador e celular. A demonstração não comprova envio de mensagens por provedores externos.
