# Configuração de imobflow.net.br

## Confirmado nos painéis

- Registro.br: editor liberado aproximadamente às 04:26; cinco registros abaixo salvos às 04:27, com confirmação "Zona DNS atualizada com sucesso!". O prazo de aproximadamente 2 horas exibido se refere à delegação para servidores externos/retorno ao modo básico, não impediu salvar a zona.
- Vercel, projeto `imobflow`: `www.imobflow.net.br` adicionado à produção; `imobflow.net.br` redireciona com 308 para www. Ambos aguardam DNS. O endereço anterior continua disponível.
- Resend: domínio criado na região São Paulo, ID `76c18025-414c-4ea6-8470-1dbd8ce6a21e`. Envio habilitado na configuração; recebimento desabilitado. Verificação iniciada após salvar DNS; status Pending.

## Registros salvos

| Tipo | Nome relativo | Valor |
| --- | --- | --- |
| A | raiz (vazio/@ conforme editor) | 216.198.79.1 |
| CNAME | www | ce301cd6068fa2d7.vercel-dns-017.com. |
| TXT | resend._domainkey | p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC9QrhyPG5Bsee0HGqD8f0e/YGOGgnuNeIhiioKf5ffHEhJKSUahHY/mNwZaCGGSNHhQ9kM5VB0UuhGhy55ZXQn/fz9XhoCOFRKgvPaPPKhQ9+Z1gQnbhM/VuxA9COnk9fqkMxx+NT+o4+SnYWmX4XYzx0FehBbUqGlm4B2BuUlLQIDAQAB |
| CNAME | rsend | rsend-sae1.forge.rmta.net |
| CNAME | send | send.forge.rmta.net |

Valores copiados das telas de configuração da Vercel e do Resend. DKIM é chave pública, não credencial secreta. Antes de salvar, conferir registros existentes para preservar alterações posteriores.

## Ainda pendente

1. Aguardar propagação e verificar DNS/HTTPS na Vercel e domínio no Resend.
2. `PASSWORD_EMAIL_FROM=ImobFlow <nao-responda@imobflow.net.br>` salvo como Config em Production. `RESEND_API_KEY` criado após confirmação explícita do usuário e salvo como Secret em Production; permissão Sending access. O seletor de domínio só oferecia All domains enquanto o domínio estava pendente. Restringir ao domínio após verificação se o produto permitir. Redeploy da produção atual solicitado para aplicar os valores.
3. Após HTTPS funcional, configurar `APP_BASE_URL=https://www.imobflow.net.br` e redeploy do projeto.
4. Testar recuperação para conta de teste autorizada, confirmando recebimento e validade do link sem expor tokens.

Chave nova nomeada `ImobFlow - Recuperacao de senha`, transferida diretamente do formulário Resend para a Vercel sem imprimi-la nem salvá-la em arquivo. Nenhuma chave antiga removida. `APP_BASE_URL` ainda não alterado porque `www.imobflow.net.br` não resolve no DNS público; código usa URL Vercel existente como fallback.

Deploy `BgsREbALGXTnrPkfAMtyij3hVTz6`, fonte de produção existente `d6a49fe`, finalizou Ready às 04:40 BRT (59s). Configurações Resend aplicadas à produção. Última verificação do Resend permanece Pending e DNS público de www ainda não resolvia; teste de entrega e troca de URL ainda pendentes.

## Correções publicadas posteriormente

- Commit `3428450cddf5b2218e1262bcf8db6633dcdfd203` enviado a main e codex/pilot-conversations.
- Deploy produção `NAFKiYPkUerEbfm97byKLrWGmKw1` Ready; `/api/version` do domínio Vercel confirmou o commit.
- Corrigidos replay do efeito de recuperação, JSON inválido, detecção de pedido humano, formato de horários e pedido humano após resposta de ausência já enviada.
- Testes de regressão, TypeScript e build executados. Smoke no navegador confirmou formulário de recuperação com fragmento sintético removido da URL, botão habilitado e navegação para painel autenticado/conversas sem alterar contas nem enviar mensagens.
- DNS público segue sem www/DKIM; Resend Pending. Sessão Registro.br expirou. Nenhuma alteração adicional de DNS feita.
