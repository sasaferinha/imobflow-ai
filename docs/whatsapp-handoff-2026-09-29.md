# Conversa pelo aplicativo apos bloqueio de 24 horas

Quando o envio de texto ou compartilhamento de imovel recebe `template_required` (erro exibido pela API), o compositor oferece **Abrir conversa no WhatsApp**. Tambem reconhece o erro de entrega 131047 exibido na ultima mensagem. Outros erros nao habilitam esse atalho.

O link oficial `https://wa.me/<telefone-do-cliente>?text=...` leva apenas o texto, codificado, sem anexos. O telefone precisa estar em formato internacional; nao inferimos pais nem usamos o telefone da empresa como destinatario. Telefone ausente/invalido mostra orientacao, sem link.

O WhatsApp aberto depende do dispositivo e da sessao. Nao e possivel selecionar ou autenticar automaticamente o numero remetente pelo link. A interface orienta usar Business/Web conectado a empresa, nao uma conta pessoal. A pessoa revisa e confirma o envio no WhatsApp. Fonte: https://faq.whatsapp.com/5913398998672934/?locale=pt_BR

O clique nao salva mensagem, nao limpa rascunho e nao marca entrega. A sincronizacao posterior continua dependendo do webhook de coexistencia ja existente. Nao alteramos a janela da API nem a assinatura Meta. O envio manual da empresa nao e tratado como nova mensagem recebida do cliente.

O atalho respeita disponibilidade do historico e permissao de atendimento e nao aparece na demonstracao. Nova mensagem recebida ou envio bem-sucedido encerra o aviso da tentativa local. Mudanca de contato nao reaproveita texto/telefone da conversa anterior.

Validacao: `node scripts/test-whatsapp-handoff.cjs` no dashboard testa o componente e o handler real com dados ficticios: rejeicao antes do envio, recusa assincrona, texto Unicode/rascunho editado, ausencia de falso envio, permissao, demonstracao, recuperacao e isolamento entre contatos. Incluido em `build:production`. Nenhuma mensagem real foi enviada e nenhuma migration e necessaria.
