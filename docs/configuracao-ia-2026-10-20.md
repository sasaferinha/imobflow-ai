# Configuração de IA por imobiliária

## Acesso e opções

No painel, o administrador acessa **Configurações > Configurar IA** (`/painel#ai-settings`). Corretores não recebem a configuração privada no estado do CRM, não podem salvar suas alterações e não acessam a página por link direto. A validação no servidor usa o papel e a empresa da sessão, não campos informados pelo navegador.

A página permite escolher venda, locação ou ambas; nome da assistente; mensagem inicial e encaminhamento; triagem automática ou encaminhamento humano; habilitação do assistente do corretor; conduta para pedidos fora dos serviços; contexto comercial e regiões; tom, tamanho das respostas e emojis; orientações de venda/locação e até seis perguntas frequentes.

### Interface simplificada

Após pedido do usuário, a abertura mostra somente três controles: serviços, modo do atendimento automático e sugestões ao corretor. A regra atual de pedidos fora do escopo aparece como um resumo. Nome, mensagens, estilo e conhecimento foram mantidos em **Personalizar mensagens e orientações**, fechado inicialmente. A prévia fica em **Ver exemplo de atendimento**, também fechado. Foram removidos o banner grande, os atalhos por seção e a coluna lateral redundante; os valores salvos não foram removidos ou redefinidos.

Validação completa continua no salvamento, mesmo com opções recolhidas. Um campo opcional inválido abre a seção e leva foco ao aviso; alterar apenas um controle essencial preserva todos os valores personalizados ocultos. Os testes de interface cobrem esses casos além dos controles anteriores de acesso, rascunho, concorrência e descarte. Esta simplificação não muda a política, o modelo de dados nem as integrações.

**Escopo real:** serviços, modo automático, nome, abertura e encaminhamento afetam a triagem automática elegível. Contexto comercial, regiões, orientações, FAQ e estilo são referências para as sugestões do assistente do corretor. Não alteram o catálogo nem limitam geograficamente os clientes. A página identifica essa distinção. Não houve reescrita do motor de extração automática de preferências.

## Segurança e aplicação

- Escolhas só passam a valer depois de salvar; usam o versionamento/CAS existente. Conflitos preservam o rascunho e exigem revisão explícita.
- Cada empresa tem sua configuração em `crm_evolution_workspaces.document.settings.ai`, com data e administrador derivados do servidor. Nenhuma nova migration é necessária.
- Empresas sem configuração mantêm o padrão anterior: venda e locação e os recursos existentes habilitados. Falha na leitura não substitui regras desconhecidas por esse padrão permissivo.
- Uma modalidade habilitada não prova o interesse do cliente: sua intenção não é inventada nem trocada para caber na imobiliária. Respostas curtas só confirmam a modalidade depois de uma pergunta compatível realmente enviada.
- Pedidos fora de escopo usam a conduta escolhida. “Encerrar triagem” pausa a automação: não apaga cliente nem marca o negócio como perdido/concluído.
- Conversas já assumidas ou pausadas não são reativadas por esta configuração. Fila, lotes, janelas de atendimento e condições de envio continuam nas proteções existentes.
- Textos comerciais são dados de referência, não instruções privilegiadas capazes de revogar regras de segurança. O assistente continua exigindo evidência da conversa e revisão humana para alterações; não envia sua sugestão ao cliente sozinho.
- O servidor consulta a política da empresa, bloqueia assistente desabilitado e revalida acesso/configuração depois da resposta do provedor.
- A página não recebe nem exibe chaves. O indicador de provedor só confirma presença de configuração; não comprova credenciais válidas, disponibilidade ou qualidade de resposta.
- A prévia lateral é ilustrativa, baseada em regras locais. Não chama IA nem envia mensagens.

## Validação e operação

`pnpm --dir apps/dashboard run test:tenant-ai` cobre validação, dados por empresa, defaults, regras de modalidades, modo humano, assistência desabilitada, falha de leitura, interface, rascunhos e conflitos. Os testes existentes de API/CRM também exercitam recusa de corretor, metadata forjada, tenant e CAS. A suíte faz parte de `build:production`.

QA de navegador usa o harness local ignorado `work/qa-ai-settings-20261020`, dados sintéticos e persistência apenas em memória. Nenhuma configuração de empresa real ou mensagem de cliente deve ser usada para testes sem autorização específica. Chamadas reais pagas ao provedor não fazem parte da validação automática.

Validação desta entrega: `build:production` completo passou, incluindo a compilação Next.js, TypeScript, as três suítes novas e regressões existentes. No navegador, foram conferidos layouts largo/estreito, seleção de venda sem locação, prévia de pedido incompatível, salvamento e redirecionamento do corretor ao tentar abrir a rota administrativa. Testes simulados não comprovam funcionamento do provedor pago nem entrega de mensagens reais.

Esta entrega não ativa as migrations operacionais pendentes, notificações push ou integrações de terceiros. Não altera credenciais nem contrata serviços.

## Retorno à versão anterior

Baseline antes desta entrega: `main@87e3cfb4180157e9436687ab772ce7e963530269`, deployment `dpl_DEKoCfnNJkjETv7AmdJCB3EivTHT`. Uma reversão deve ser registrada e publicada pelo fluxo normal, preservando registros e auditoria. “Restaurar padrão” na nova página apenas prepara o rascunho; exige salvar e não apaga o histórico. Não usar reset destrutivo nem copiar um checkout antigo sobre produção.
