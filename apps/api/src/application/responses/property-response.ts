import type { RankedProperty } from '../../domain/properties/property.js';
import type { LeadProfile } from '../../domain/leads/lead-profile.js';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function formatPropertyRecommendations(matches: RankedProperty[]): string {
  if (matches.length === 0) {
    return 'Não encontrei um imóvel disponível que atenda exatamente a esses critérios agora. Posso ampliar um pouco a região ou a faixa de valor para buscar outras opções?';
  }
  const heading = matches.length === 1
    ? 'Encontrei uma opção disponível que combina com o que você procura:'
    : `Encontrei ${matches.length} opções disponíveis que combinam com o que você procura:`;
  const cards = matches.map(({ property }, index) => {
    const details = [
      `${property.neighborhood}, ${property.city}/${property.state}`,
      `${property.bedrooms} quarto${property.bedrooms === 1 ? '' : 's'}`,
      `${property.bathrooms} banheiro${property.bathrooms === 1 ? '' : 's'}`,
      `${property.areaM2} m²`,
    ];
    return `${index + 1}. ${property.title} (ref. ${property.externalId})\n${details.join(' · ')}\n${money.format(property.price)}${property.propertyUrl ? `\n${property.propertyUrl}` : ''}`;
  });
  return `${heading}\n\n${cards.join('\n\n')}\n\nQuer ver detalhes de alguma delas ou agendar uma visita?`;
}

export function nextQualificationQuestion(profile: LeadProfile): string {
  if (!profile.transactionType) return 'Você está procurando um imóvel para comprar ou alugar?';
  if (!profile.city && !profile.neighborhoods?.length) return 'Em qual cidade ou região você gostaria de procurar?';
  if (profile.maxPrice === undefined) return 'Qual é o valor máximo ou a faixa de investimento que você tem em mente?';
  if (!profile.propertyType) return 'Você prefere apartamento, casa, terreno ou outro tipo de imóvel?';
  if (profile.minBedrooms === undefined && profile.propertyType !== 'LAND') return 'Quantos quartos você gostaria?';
  if (!profile.paymentMethod && profile.transactionType === 'BUY') return 'Você pretende comprar à vista ou por financiamento?';
  return 'Há alguma característica indispensável, como varanda, elevador, quintal ou área de lazer?';
}
