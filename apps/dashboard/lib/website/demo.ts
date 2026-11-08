import { safeWebsiteUrl, type PublicProperty, type SiteContent, type SiteDocument } from './model';

/** Isolated, fictional data. Never used to provision a real company or publish its stock. */
export const DEMO_STORAGE_KEY = 'imobflow.website-demo.v1';
export const DEMO_COMPANY = {
  id: '00000000-0000-4000-8000-000000000077',
  name: 'Horizonte Imobiliária',
  slug: 'horizonte-demonstracao',
};

// Illustrative Unsplash photographs; the properties and their commercial data are fictional.
const photos = {
  house: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=85',
  living: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1000&q=80',
  garden: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1000&q=80',
  apartment: 'https://images.unsplash.com/photo-1609766857326-18a204c2cf31?auto=format&fit=crop&w=1000&q=80',
  balcony: 'https://images.unsplash.com/photo-1612419299101-6c294dc2901d?auto=format&fit=crop&w=1000&q=80',
};

export const demoContent: SiteContent = {
  layout: 'classic',
  brandName: 'Horizonte Imobiliária',
  tagline: 'Novos lugares. Novas histórias.',
  primaryColor: '#184D42',
  logoUrl: '',
  heroImageUrl: photos.house,
  heroTitle: 'Um novo lugar para a sua melhor fase.',
  heroText: 'Encontre um imóvel que combine com a sua vida. Nossa equipe acompanha cada passo, da primeira visita à entrega das chaves.',
  aboutTitle: 'Mais que encontrar um imóvel. Encontrar o seu lugar.',
  aboutText: 'Cada mudança começa com uma história. Na Horizonte, ouvimos o que importa para você e ajudamos a encontrar espaços com sentido: para morar, investir ou recomeçar. Conte com uma conversa próxima e orientação em cada etapa.',
  contactPhone: '',
  contactEmail: '',
  contactAddress: 'Lavras, Minas Gerais · empresa de demonstração',
  instagramUrl: '',
  promotion: {
    enabled: true,
    title: 'Abra a porta para novas possibilidades.',
    text: 'Um lar com mais espaço, uma varanda para descansar ou um endereço perto de tudo. Conheça as opções da nossa seleção.',
    imageUrl: photos.garden,
    linkUrl: '',
    linkLabel: 'Explorar imóveis',
  },
  video: { enabled: false, title: 'Conheça a Horizonte', url: '' },
  showPrices: true,
};

export const demoProperties: PublicProperty[] = [
  { id: 'demo-casa-jardim', code: 'HZ001', title: 'Casa com piscina e espaços para viver bem', purpose: 'Venda', price: 1280000, district: 'Jardim das Palmeiras', city: 'Lavras', propertyType: 'Casa', bedrooms: 4, parkingSpaces: 3, area: 280, description: 'Ambientes amplos, boa iluminação e uma área externa para aproveitar os dias em família. A integração entre a sala e o jardim deixa a rotina mais leve.\n\nImóvel fictício, apresentado apenas para demonstrar o funcionamento do catálogo.', images: [photos.house, photos.living, photos.garden], features: 'Piscina, Jardim, Área gourmet, Suíte, Espaço para home office' },
  { id: 'demo-apartamento-centro', code: 'HZ002', title: 'Apartamento iluminado, perto de tudo', purpose: 'Venda', price: 495000, district: 'Centro', city: 'Lavras', propertyType: 'Apartamento', bedrooms: 2, parkingSpaces: 1, area: 84, description: 'Uma planta bem aproveitada, sala acolhedora e espaço para os momentos que importam. Praticidade para quem valoriza ter os serviços do dia a dia por perto.\n\nImóvel e valores fictícios para demonstração.', images: [photos.apartment, photos.balcony], features: 'Varanda, Elevador, Portaria, Armários planejados' },
  { id: 'demo-casa-verde', code: 'HZ003', title: 'Seu refúgio com jardim e varanda', purpose: 'Aluguel', price: 3800, district: 'Vila Verde', city: 'Lavras', propertyType: 'Casa', bedrooms: 3, parkingSpaces: 2, area: 165, description: 'Casa com jardim, varanda e ambientes que recebem luz natural. Um espaço para desacelerar sem abrir mão da praticidade.\n\nImóvel fictício. Nenhuma proposta ou visita é realizada nesta demonstração.', images: [photos.garden, photos.living], features: 'Jardim, Varanda, Aceita animais, Área de serviço' },
  { id: 'demo-apartamento-serra', code: 'HZ004', title: 'Conforto e uma vista para chamar de sua', purpose: 'Aluguel', price: 2200, district: 'Serra Azul', city: 'Lavras', propertyType: 'Apartamento', bedrooms: 2, parkingSpaces: 1, area: 76, description: 'Sala com varanda, cozinha funcional e dois quartos. Uma opção para quem procura conforto e um cantinho para aproveitar o fim do dia.\n\nDados e localização fictícios para demonstração.', images: [photos.balcony, photos.apartment], features: 'Varanda, Elevador, Vaga coberta' },
];

export function createDemoWebsiteSnapshot() {
  const site: SiteDocument = { version: 0, draft: structuredClone(demoContent), published: structuredClone(demoContent), publishedAt: null, updatedAt: null, previous: null };
  return { company: { ...DEMO_COMPANY }, role: 'owner' as const, site, properties: structuredClone(demoProperties), marketingAccounts: [] };
}

export function safeDemoImageUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2_900_000) return '';
  if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
  try { return safeWebsiteUrl(value); } catch { return ''; }
}

/** Shared by both demo surfaces: browser storage is never trusted as a typed catalogue. */
export function normalizeDemoProperties(input: unknown): PublicProperty[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || !['Venda', 'Aluguel'].includes(String(item.purpose)) || !Number.isFinite(item.price) || Number(item.price) < 0) return [];
    const text = (key: string, limit = 250) => typeof item[key] === 'string' ? item[key].slice(0, limit) : '';
    const number = (key: string) => typeof item[key] === 'number' && Number.isFinite(item[key]) ? Math.max(0, Math.min(1e12, item[key])) : 0;
    return [{ id: text('id'), code: text('code'), title: text('title'), purpose: item.purpose as 'Venda' | 'Aluguel', price: number('price'), district: text('district'), city: text('city'), propertyType: text('propertyType'), bedrooms: number('bedrooms'), parkingSpaces: number('parkingSpaces'), area: number('area'), description: text('description', 5000), features: text('features', 2000), images: Array.isArray(item.images) ? item.images.map(safeDemoImageUrl).filter(Boolean).slice(0, 12) : [] }];
  });
}
