import type { InterestProfile } from './qualification';

const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function confirmsSummary(message: string) {
  const text = normalized(message);
  return /^(sim|isso mesmo|isso|correto|certo|esta certo|esta correto|confirmo|perfeito|ok)(?=$|\s*[,;.!])/.test(text)
    && !/\b(mas|exceto|menos|errado|incorreto|corrigir|corrija|mudar|mude|alterar|altere|trocar|troque|na verdade)\b/.test(text);
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
