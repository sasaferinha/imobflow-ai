import { FINANCING_QUESTION, PURPOSE_QUESTION, qualificationQuestion, type InterestProfile } from './qualification';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const words: Record<string, number> = { zero:0, um:1, uma:1, dois:2, duas:2, tres:3, quatro:4, cinco:5, seis:6, sete:7, oito:8, nove:9, dez:10 };
const count = '(?:\\d{1,2}|zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)';
const numericCount = (value: string) => words[value] ?? Number(value);
const unique = <T,>(values: T[]) => [...new Set(values)];

function money(value: string, unit?: string) {
  const number = Number(value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value.replace(/\.(?=\d{3}(?:\.|$))/g, ''));
  const result = number * (unit === 'mil' || unit === 'k' ? 1000 : unit ? 1000000 : 1);
  return result > 0 && result <= 1e9 ? result : undefined;
}

function cleanLocation(value: string) {
  const location = value.trim().replace(/[.!?]+$/, '').trim();
  if (!/^[\p{L}\p{M}][\p{L}\p{M} '\/-]{1,119}$/u.test(location)) return undefined;
  if (/\b(nao|sei|talvez|qualquer|tanto faz|quero|preciso|prefiro|obrigad[oa]|ola|oi|ok|sim|tudo|bem|entendi|entendeu|voce|voces|pode|como|qual|quanto|comprar|alugar|financiar|financiamento|financiada|financiado|apartamento|quartos?|vagas?|me|ajuda|ajude|consegue|sou|tenho|isso|favor|legal|certo|verdade)\b/.test(normalize(location))) return undefined;
  return location;
}

/** Conservative local extraction: only explicit, unambiguous preferences.
 * No provider call and no inferred inventory, availability or financial approval. */
export function naturalPreferences(message: string, current: InterestProfile): InterestProfile {
  const text = message.trim().slice(0,4000);
  const n = normalize(text);
  if (/\b(ignore|ignora|instrucoes|instrucao|sistema|talvez|exemplo|suponha)\b/.test(n)) return {};
  const patch: InterestProfile = {};
  // Treat a negated clause independently; never interpret "não quero casa" as Casa.
  const clauses = n.split(/,(?!\d)|[;!]|\.(?!\d)|\bmas\b|\be (?=sem\b|nao\b)/).filter(part => !/\b(nao|nem|sem)\b/.test(part));
  const positive = clauses.join(';');
  const buy = /\b(comprar|compra|venda|adquirir)\b/.test(positive);
  const rent = /\b(alugar|aluguel|locacao|locar)\b/.test(positive);
  if (buy !== rent) patch.purpose = buy ? 'Venda' : 'Aluguel';
  if (/^(?:quero )?investir$|\b(?:para investir|como investimento|para investimento)\b/.test(positive.trim())) {
    patch.intendedUse = 'Investir';
    if (!rent && !current.purpose) patch.purpose = 'Venda';
  } else if (/\bmorar\b/.test(positive)) patch.intendedUse = 'Morar';
  const kinds = [
    ['Apartamento', /\b(apartamento|apto|ape|apart|studio|kitnet)\b/], ['Casa', /\b(casa|sobrado|chacara)\b/],
    ['Terreno', /\b(terreno|lote)\b/], ['Comercial', /\b(comercial|loja|sala comercial|galpao)\b/],
  ] as const;
  const found = kinds.filter(([,rx])=>rx.test(positive));
  if(found.length===1)patch.propertyType=found[0][0];

  // More than one amount/count is ambiguous: ask again rather than choose one.
  const amounts = unique([...positive.matchAll(/(?:\bate\s+(?:uns?\s+)?|\b(?:orcamento|limite|valor maximo)(?:\s+(?:e|de|seria))?\s*[:=]?\s*|\b(?:posso|quero|pretendo) (?:pagar|gastar|investir)\s+|\b(?:por volta de|aproximadamente|cerca de|uns?)\s+|r\$\s*)(?:r\$\s*)?([\d.,]+)\s*(milhoes|milhao|mil|k)?\b/g)].map(m=>money(m[1],m[2])).filter((v):v is number=>v!=null));
  if(amounts.length===1 && !/\b(entre|a partir|mais de|menos de)\b|\d\s*(?:mil\s*)?(?:a|ou|-)\s*\d/.test(n))patch.budgetMax=amounts[0];
  for(const [key,unit] of [['bedrooms','quartos?|dormitorios?'],['parkingSpaces','vagas?(?: de garagem)?']] as const){
    const candidates=unique([...positive.matchAll(new RegExp(`\\b(${count})\\s+(?:${unit})\\b`,'g'))].map(m=>numericCount(m[1])));
    const ambiguous=new RegExp(`\\b${count}\\s*(?:a|ou|-)\\s*${count}\\s+(?:${unit})\\b`).test(n);
    if(candidates.length===1 && candidates[0]<=30 && !ambiguous)patch[key]=candidates[0];
  }
  if(/\b(?:nao preciso(?: de)?|nao quero|sem)\s+(?:vagas?(?: de garagem)?|garagem)\b/.test(n) && !/\bmas\b/.test(n)){
    if(patch.parkingSpaces == null)patch.parkingSpaces=0;
    else if(patch.parkingSpaces !== 0)delete patch.parkingSpaces;
  }

  // Location labels delimit names; a generic sentence never becomes a city.
  const end='(?=,|;|[.!?]|$|\\s+(?:com|no bairro|na regiao|ate|por|e com)\\b)';
  const cityMatch=text.match(new RegExp(`\\b(?:cidade de|cidade é|cidade e|cidade:|morar em|comprar em|alugar em|procuro em|busco em|(?:casa|apartamento|apto|terreno|imóvel|imovel) em)\\s+(.+?)${end}`,'iu'));
  // A labeled list can contain commas. Stop only before a different field,
  // otherwise "bairros: Centro, Vila Rica" silently drops the second option.
  const districtList=text.match(/\b(?:no bairro|nos bairros|na região|na regiao|nas regiões|nas regioes|bairro:|bairros:)\s+(.+?)(?=$|[.!?]|\s+(?:com|até|ate|por|e com)(?![\p{L}\p{M}])|[,;]\s*(?:com|sem|até|ate|orçamento|orcamento|meu orçamento|meu orcamento|limite|valor|r\$|cidade|em|\d+|(?:zero|um|uma|dois|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:quartos?|vagas?))(?![\p{L}\p{M}]))/iu);
  const districtMatch=!districtList && (cityMatch || current.city) ? text.match(new RegExp(`(?:^|,)\\s*(?:no|na)\\s+(.+?)${end}`,'iu')) : null;
  if(cityMatch && !/\b(nao|nem|sem)\b/.test(n)){const city=cleanLocation(cityMatch[1]);if(city)patch.city=city;}
  if(districtList && !/\b(nao|nem|sem)\b/.test(n)) {
    const regions=districtList[1].split(/[,;/]|\s+(?:e|ou)\s+/iu).map(cleanLocation);
    if(regions.length && regions.every((region): region is string => Boolean(region)))patch.regions=unique(regions);
  } else if(districtMatch && !/\b(nao|nem|sem)\b/.test(n)){const region=cleanLocation(districtMatch[1]);if(region)patch.regions=[region];}
  const context={...current,...patch};
  if(context.city && !context.regions?.length && /\b(qualquer bairro|qualquer regiao|sem preferencia(?: de bairro)?|tanto faz o bairro)\b/.test(n)) patch.regions=['Qualquer região'];
  if(current.purpose && current.propertyType && !Object.keys(patch).length){
    const place=cleanLocation(text.replace(/^(?:em|na cidade de|prefiro|pode ser)\s+/i,''));
    if(place){if(!current.city)patch.city=place;else if(!current.regions?.length)patch.regions=place.split(/\s+e\s+/).map(s=>s.trim());}
  }
  // Bare numbers (or words) belong only to the question currently being asked.
  const bare=n.replace(/^(?:quero|preciso de|pode ser|seriam|seria|apenas|so)\s+/,'').replace(/[.!]+$/,'');
  if(context.budgetMax && context.city && context.regions?.length && new RegExp(`^${count}$`).test(bare)){
    const value=numericCount(bare);
    if(value<=30){if(current.bedrooms==null)patch.bedrooms=value;else if(current.parkingSpaces==null)patch.parkingSpaces=value;}
  }
  const noPreference=/^(?:nao tenho preferencia|sem preferencia|tanto faz|qualquer quantidade)$/;
  if(context.budgetMax && context.propertyType !== 'Terreno' && noPreference.test(bare)) {
    if(current.bedrooms==null) patch.bedrooms=0;
    else if(current.parkingSpaces==null) patch.parkingSpaces=0;
  }
  const features = [
    ['Piscina', /\bpiscina\b/], ['Varanda', /\b(varanda|sacada)\b/], ['Quintal', /\bquintal\b/],
    ['Elevador', /\belevador\b/], ['Portaria', /\bportaria\b/], ['Área gourmet', /\b(area gourmet|churrasqueira)\b/],
    ['Aceita pets', /\b(pet|pets|animal|animais)\b/],
  ] as const;
  const requestedFeatures=features.filter(([,rx])=>rx.test(positive)).map(([label])=>label);
  if(requestedFeatures.length)patch.features=unique([...(current.features||[]),...requestedFeatures]);
  return patch;
}

export function clarificationReply(profile: InterestProfile) {
  if(qualificationQuestion(profile)===FINANCING_QUESTION)return FINANCING_QUESTION;
  if(!profile.purpose)return PURPOSE_QUESTION;
  if(!profile.propertyType)return 'Que tipo de imóvel você procura? Por exemplo: casa, apartamento ou terreno.';
  if(!profile.city)return 'Pode me dizer o nome da cidade onde procura o imóvel?';
  if(!profile.regions?.length)return 'Quais bairros você prefere? Se ainda não decidiu, posso chamar um corretor para ajudar.';
  if(!profile.budgetMax)return 'Até quanto você pretende investir? Pode escrever, por exemplo, “500 mil” ou “R$ 2.000”. Se ainda não definiu, posso chamar um corretor.';
  return qualificationQuestion(profile);
}
