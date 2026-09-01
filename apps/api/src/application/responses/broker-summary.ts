import type { LeadRecord } from '../../modules/leads/lead-repository.js';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function formatBrokerSummary(input: {
  lead: LeadRecord;
  conversationId: string;
  presentedPropertyIds: string[];
  nextStep?: string;
}): string {
  const profile = input.lead.profile;
  const intention = profile.transactionType === 'BUY' ? 'Compra' : profile.transactionType === 'RENT' ? 'Locação' : input.lead.intent;
  return [
    'NOVO LEAD QUALIFICADO',
    '',
    `Nome: ${input.lead.name ?? profile.name ?? 'Não informado'}`,
    `Telefone: ${maskPhone(input.lead.phone)}`,
    `Intenção: ${intention}`,
    `Tipo: ${profile.propertyType ?? 'Não informado'}`,
    `Região: ${[profile.city, ...(profile.neighborhoods ?? [])].filter(Boolean).join(' / ') || 'Não informada'}`,
    `Orçamento: ${profile.maxPrice !== undefined ? `Até ${money.format(profile.maxPrice)}` : 'Não informado'}`,
    `Quartos: ${profile.minBedrooms !== undefined ? `${profile.minBedrooms}+` : 'Não informado'}`,
    `Pagamento: ${profile.paymentMethod ?? 'Não informado'}`,
    `Prazo: ${profile.purchaseTimelineDays !== undefined ? `Até ${profile.purchaseTimelineDays} dias` : 'Não informado'}`,
    `Imóveis apresentados: ${input.presentedPropertyIds.length ? input.presentedPropertyIds.join(', ') : 'Nenhum'}`,
    `Lead Score: ${input.lead.score}/100`,
    `Classificação: ${input.lead.temperature}`,
    `Próximo passo: ${input.nextStep ?? 'Corretor deve entrar em contato'}`,
    `Conversa: ${input.conversationId}`,
  ].join('\n');
}

function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  return `${phone.slice(0, -4).replace(/\d/g, '*')}${phone.slice(-4)}`;
}
