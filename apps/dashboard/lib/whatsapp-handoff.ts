// Matches the API's preflight rejection and Meta's asynchronous 131047 delivery error.
export function isWhatsAppWindowError(message?: string) {
  return Boolean(message && /(?:fora da janela de 24 horas|janela de 24 horas expirou)/i.test(message));
}

export function whatsappConversationLink(phone: string, text: string) {
  // Do not infer a country or turn arbitrary text/URLs into a recipient.
  if (!/^[+\d\s().-]+$/.test(phone)) return null;
  const digits = phone.replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}${text.trim() ? `?text=${encodeURIComponent(text.trim())}` : ''}`;
}
