import type { TenantAISettings } from './tenant-settings';
import type { InterestProfile } from './qualification';
import { naturalPreferences } from './natural-qualification';

type Purpose = 'Venda' | 'Aluguel';
const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const saleWords = /\b(?:compr\w*|vend\w*|adquir\w*|financi\w*)\b/;
const rentalWords = /\b(?:alug\w*|loca(?:r|m|mos|cao|coes|do|dos|da|das))\b/;

export function serviceAllowed(settings: TenantAISettings, purpose: unknown) {
  return purpose !== 'Venda' && purpose !== 'Aluguel' || settings.services.includes(purpose);
}

/** Text checks are conservative: a model/admin text cannot offer a disabled service. */
export function mentionsUnsupportedService(text: string, settings: TenantAISettings) {
  const value = normalized(text);
  return (!settings.services.includes('Venda') && saleWords.test(value))
    || (!settings.services.includes('Aluguel') && rentalWords.test(value));
}

export function tenantCopy(text: string, settings: TenantAISettings, fallback: string) {
  return text.trim() && !mentionsUnsupportedService(text, settings) ? text.trim() : fallback;
}

export function handoffCopy(settings: TenantAISettings, fallback: string) {
  return tenantCopy(settings.handoffMessage, settings, fallback);
}

export function unsupportedServiceReply(settings: TenantAISettings) {
  const handoff = handoffCopy(settings, 'Vou direcionar sua conversa para um corretor conferir como podemos ajudar.');
  if (settings.unsupportedService === 'handoff') return handoff;
  const scope = settings.services.includes('Venda') ? 'Esta imobiliária trabalha com compra e venda de imóveis e não oferece locação.' : 'Esta imobiliária trabalha com locação de imóveis e não oferece compra e venda.';
  return settings.unsupportedService === 'explain_close'
    ? `${scope} Por isso, não vou continuar a qualificação automática desta solicitação.`
    : `${scope}\n\n${handoff}`;
}

export function tenantQualificationQuestion(profile: InterestProfile, settings: TenantAISettings, legacyQuestion: string) {
  if (settings.services.length === 2 || (profile.purpose && !(profile.correctionRequested && profile.correctionField === 'purpose'))) return legacyQuestion;
  return settings.services.includes('Venda')
    ? 'Trabalhamos com compra e venda de imóveis. Você procura comprar para morar ou investir?'
    : 'Trabalhamos com locação de imóveis. Você procura um imóvel para alugar?';
}

/** Intent comes only from customer messages/profile; offered services never become intent. */
export function customerPurpose(messages: Array<{ side: string; text: string }>, existing: unknown): Purpose | undefined {
  let purpose: Purpose | undefined = existing === 'Venda' || existing === 'Aluguel' ? existing : undefined;
  for (const message of messages) {
    if (message.side !== 'incoming') continue;
    const explicit = naturalPreferences(message.text, {}).purpose;
    if (explicit) purpose = explicit;
  }
  return purpose;
}
