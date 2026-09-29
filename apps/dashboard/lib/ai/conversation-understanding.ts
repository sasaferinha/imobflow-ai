import type { InterestProfile } from './qualification';

const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function confirmsSummary(message: string) {
  const text = normalized(message);
  return /^(sim|isso mesmo|isso|correto|certo|esta certo|esta correto|confirmo|perfeito|ok)(?=$|\s*[,;.!])/.test(text)
    && !/\b(nao|mas|exceto|menos|errado|incorreto|corrigir|corrija|mudar|mude|alterar|altere|trocar|troque|ajustar|atualizar|na verdade)\b/.test(text);
}

/** Explicit requests to revise the search, not every sentence containing "não". */
export function requestsSummaryCorrection(message: string) {
  const text = normalized(message).replace(/\s+/g, ' ');
  if (/\b(ignore|ignora|instrucoes|instrucao|sistema|suponha|exemplo)\b/.test(text)) return false;
  if (/\b(?:nao (?:esta|ta|ficou) (?:certo|correto)|(?:isso|resumo|cadastro|perfil|dados) (?:esta|estao|ta) (?:errad[oa]s?|incorreto))\b/.test(text)) return true;
  return text.split(/[,;.!?]|\bmas\b/).some(part => {
    const clause = part.trim();
    if (/\bnao\s+(?:quero|preciso|gostaria|desejo|prefiro|vou)\b/.test(clause)) return false;
    return /^(?:(?:eu\s+)?(?:quero|preciso|desejo|prefiro|vou|gostaria de|preciso de|pode|podemos)\s+)?(?:corrigir|corrija|mudar|mude|alterar|altere|trocar|troque|ajustar|ajuste|atualizar|atualize)(?:\s+(?:(?:o|a|os|as|meu|minha|meus|minhas|de|um|uma)\s+)*(?:isso|isto|tudo|dados|informacoes|resumo|cadastro|perfil|preferencias?|busca|objetivo|tipo|imovel|cidade|bairros?|regioes?|regiao|orcamento|valor|quartos?|dormitorios?|vagas?|garagem|pagamento|financiamento)\b|\s*$)/.test(clause)
      || /\b(?:mudei de ideia|quero outra opcao|na verdade)\b/.test(clause);
  });
}

export function requestedCorrectionField(message: string): InterestProfile['correctionField'] {
  const text = normalized(message);
  const fields: Array<[NonNullable<InterestProfile['correctionField']>, RegExp]> = [
    ['purpose', /\b(objetivo|comprar|alugar|compra|aluguel)\b/],
    ['propertyType', /\b(tipo(?: de imovel)?|casa|apartamento|terreno|galpao)\b/],
    ['city', /\bcidade\b/], ['regions', /\b(bairros?|regiao|regioes)\b/],
    ['budgetMax', /\b(orcamento|valor|preco|limite)\b/],
    ['bedrooms', /\b(quartos?|dormitorios?)\b/], ['parkingSpaces', /\b(vagas?|garagem)\b/],
    ['financingIntent', /\b(pagamento|financiamento|financiar|vista)\b/],
  ];
  const matches = fields.filter(([, pattern]) => pattern.test(text));
  return matches.length === 1 ? matches[0][0] : null;
}

export function needsBrokerAnswer(message: string) {
  const text = normalized(message);
  return /\b(onde (?:e|eh|fica|fica localizada)|endereco|localizacao|como (?:chego|chegar)|horario (?:de atendimento|de funcionamento)|que horas (?:abre|fecha)|documentos|documentacao|contrato|comissao|desconto|agendar|marcar (?:uma )?visita)\b/.test(text)
    || /\b(voces?|vcs?) (?:tem|temos|possuem)\b|\b(?:imovel|casa|apartamento) (?:esta |ta )?disponivel\b/.test(text);
}

export function changedPreferences(patch: InterestProfile, current: InterestProfile): InterestProfile {
  const comparable = (value: unknown): string => Array.isArray(value)
    ? JSON.stringify(value.map(item => normalized(String(item))).sort())
    : typeof value === 'string' ? normalized(value) : JSON.stringify(value);
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) =>
    value !== undefined && comparable(value) !== comparable(current[key as keyof InterestProfile]))) as InterestProfile;
}
