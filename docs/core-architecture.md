# Arquitetura principal

```text
WhatsApp / site
  -> backend ImobFlow
  -> OpenAI (somente interpretação necessária)
  -> Supabase
  -> match determinístico
  -> oportunidade e notificação
  -> corretor
  -> WhatsApp aberto com mensagem pronta
```

O chatbot não envia a base de imóveis para a OpenAI. O banco reduz os candidatos
e calcula o score. O plano Basic não dispara oportunidades automaticamente.

O n8n é opcional e reservado a conectores externos. Desligá-lo não afeta o fluxo
principal do produto.
