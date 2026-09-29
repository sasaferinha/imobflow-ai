import { financingAnswer, qualificationQuestion, qualificationSummary, OPTIONAL_PREFERENCES_QUESTION, type InterestProfile } from "./qualification";
import { naturalPreferences } from './natural-qualification';
import { changedPreferences, confirmsSummary, requestedCorrectionField, requestsSummaryCorrection } from './conversation-understanding';
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
export function requestsHuman(message: string) {
  // A mention ("casa para uma pessoa", "meu corretor") is not a handoff request.
  const target = '(?:corretora?|atendente|humano|pessoa|alguem)';
  const article = '(?:(?:um|uma|o|a)\\s+)?';
  return normalize(message).replace(/,?\s*por favor\b/g, '').split(/[,.!?;]|\bmas\b/).some((part) => {
    const text = part.trim();
    if (/\bnao\s+(?:quero|preciso|gostaria|desejo|prefiro)\b/.test(text)) return false;
    return new RegExp(`^${article}(?:atendimento humano|${target})$`).test(text)
      || new RegExp(`\\b(?:falar|conversar)\\s+com\\s+${article}${target}\\b`).test(text)
      || new RegExp(`\\b(?:passar|passe|transferir|transfira|encaminhar|encaminhe)\\s+para\\s+${article}${target}\\b`).test(text)
      || new RegExp(`\\b(?:chamar|chame)\\s+${article}${target}\\b`).test(text)
      || new RegExp(`\\bser atendid[oa]\\s+por\\s+${article}${target}\\b`).test(text)
      || new RegExp(`\\b(?:quero|preciso|gostaria|desejo|prefiro)\\s+(?:de\\s+)?${article}(?:atendimento humano|${target})\\b`).test(text);
  });
}
export function basicPreferences(
  message: string,
  current: InterestProfile,
): InterestProfile {
  const answer = normalize(message).replace(/[.!]+$/, '');
  const question = qualificationQuestion(current);
  const correctionField = requestedCorrectionField(message);
  const fieldOnly = current.correctionRequested && correctionField && /^(?:o |a |os |as |meu |minha )?(?:objetivo|tipo(?: de imovel)?|cidade|bairros?|regiao|regioes|orcamento|valor|preco|limite|quartos?|dormitorios?|vagas?|garagem|pagamento|financiamento)$/.test(answer);
  // Interpret a field label before location extraction: "garagem" names the
  // next correction, it is not a neighborhood called Garagem.
  if (fieldOnly) return { correctionRequested: true, correctionField,
    ...(current.summaryConfirmed ? { summaryConfirmed: false } : {}) };
  if (question === qualificationSummary(current)) {
    if (confirmsSummary(message)) return { summaryConfirmed: true, correctionRequested: false };
    if (/^(nao|errado|incorreto|nao esta (?:certo|correto)|(?:esta |isso esta )?errado)$/.test(answer)) return { correctionRequested: true, correctionField: null };
  }
  if (question === OPTIONAL_PREFERENCES_QUESTION && /^(nao|nenhuma?|nada|nao sei|ainda nao sei|tanto faz|sem preferencia|nao tenho preferencia|pode seguir|podemos seguir)$/.test(answer)) return { preferencesRecorded: true };
  // An undecided answer is valid at the financing step, not a hypothetical search.
  if (financingAnswer(message, current) === 'Indeciso') return { financingIntent: 'Indeciso' };
  if (message.length > 4000 || /\b(ignore|ignora|instrucoes|instrucao|sistema|talvez|exemplo|suponha)\b/.test(normalize(message))) return {};
  // A targeted revision changes only that field; the original profile is never
  // cleared to ask again. This lets "trocar o bairro" -> "Centro" work offline.
  const parsingProfile = current.correctionRequested && current.correctionField
    ? { ...current, [current.correctionField]: undefined }
    : current;
  const natural = naturalPreferences(message, parsingProfile);
  // The narrow legacy parser supplies bare prices and lists at their own step.
  // Do not let its free-text location fallback turn unrelated prose into a city.
  const strict = strictPreferences(message, parsingProfile);
  delete strict.city;
  if (!/[,;]/.test(message)) delete strict.regions;
  const patch = { ...strict, ...natural };
  if (current.correctionRequested && current.correctionField === 'parkingSpaces') {
    const counts: Record<string, number> = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
    const bare = answer.replace(/^(?:quero|preciso de|pode ser|apenas|so)\s+/, '');
    const number = counts[bare] ?? (/^\d{1,2}$/.test(bare) ? Number(bare) : undefined);
    if (number != null && number <= 30) {
      delete patch.bedrooms;
      patch.parkingSpaces = number;
    }
  }
  if (question === OPTIONAL_PREFERENCES_QUESTION && message.trim() && !message.includes('?') && !/\b(como|qual|ignore|instrucoes)\b/.test(answer)) {
    patch.preferencesRecorded = true;
    patch.preferenceNotes = message.trim().slice(0, 500);
  }
  const choice = normalize(message);
  // Multiple transaction alternatives are not a confirmed choice.
  if(/\bou\b/.test(choice) && /\b(alugar|aluguel|locacao|locar)\b/.test(choice) && /\b(financiar|financiamento)\b/.test(choice)) delete patch.purpose;
  const financingIntent=financingAnswer(message,{...current,...patch});
  if(financingIntent === 'Sim' && !current.purpose && !patch.purpose) patch.purpose='Venda';
  if(financingIntent)patch.financingIntent=financingIntent;
  const explicitCorrection = requestsSummaryCorrection(message);
  if (explicitCorrection && !Object.keys(changedPreferences(patch, current)).length) {
    return { correctionRequested: true, correctionField: correctionField || null,
      ...(current.summaryConfirmed ? { summaryConfirmed: false } : {}) };
  }
  if (Object.keys(patch).length && (current.summaryConfirmed || current.correctionRequested)) {
    patch.summaryConfirmed = false;
    patch.correctionRequested = false;
    if (current.correctionField) patch.correctionField = null;
  }
  return patch;
}
function strictPreferences(
  message: string,
  current: InterestProfile,
): InterestProfile {
  const text = message.trim();
  const n = normalize(text);
  const patch: InterestProfile = {};
  if (/\b(nao|ignore|ignora|instrucao|instrucoes|sistema)\b/.test(n))
    return patch;
  if (
    !current.purpose &&
    /\b(comprar|compra|venda)\b/.test(n) &&
    !/\b(alugar|aluguel|locacao)\b/.test(n)
  )
    patch.purpose = "Venda";
  else if (
    !current.purpose &&
    /\b(alugar|aluguel|locacao)\b/.test(n) &&
    !/\b(comprar|compra|venda)\b/.test(n)
  )
    patch.purpose = "Aluguel";
  const kinds = [
    ["Apartamento", /\b(apartamento|apto|ape)\b/],
    ["Casa", /\bcasa\b/],
    ["Terreno", /\bterreno\b/],
    ["Comercial", /\b(comercial|loja|sala)\b/],
  ] as const;
  const matches = kinds.filter(([, rx]) => rx.test(n));
  if (!current.propertyType && matches.length === 1)
    patch.propertyType = matches[0][0];
  // Free-text locations are accepted only at their explicit question, never from
  // a message that also changed purpose/type or contains an instruction/question.
  const location =
    text.length >= 2 &&
    text.length <= 120 &&
    /^[\p{L}\p{M} .,'/-]+$/u.test(text) &&
    !/\b(nao|sei|talvez|qualquer|ignora|ignore|quero|prefiro|financiar|financiamento|financiada|financiado|obrigad|ola|oi|ok|sim|bom dia|boa tarde|boa noite)\b/.test(
      n,
    );
  if (
    current.purpose &&
    current.propertyType &&
    !Object.keys(patch).length &&
    location
  ) {
    if (!current.city) patch.city = text;
    else if (!current.regions?.length)
      patch.regions = text
        .split(/[,;/]/)
        .map((s) => s.trim())
        .filter(Boolean);
  }
  if (
    current.purpose &&
    current.propertyType &&
    current.city &&
    current.regions?.length &&
    !current.budgetMax
  ) {
    const match = n.match(
      /^(?:ate\s+)?(?:r\$\s*)?([\d.,]+)\s*(mil|milhao|milhoes)?(?:\s*reais)?$/,
    );
    if (match) {
      const raw = match[1];
      const number = Number(
        raw.includes(",")
          ? raw.replace(/\./g, "").replace(",", ".")
          : raw.replace(/\.(?=\d{3}(?:\.|$))/g, ""),
      );
      const amount =
        number * (match[2] === "mil" ? 1000 : match[2] ? 1000000 : 1);
      if (amount > 0 && amount <= 1e9) patch.budgetMax = amount;
    }
  }
  if (current.budgetMax) {
    const number = n.match(
      /^(\d{1,2})(?:\s*(quartos?|vagas?)(?: de garagem)?)?$/,
    );
    if (
      current.bedrooms == null &&
      number &&
      !/vaga/.test(n) &&
      Number(number[1]) <= 30
    )
      patch.bedrooms = Number(number[1]);
    else if (current.bedrooms != null && current.parkingSpaces == null) {
      if (/^(nenhuma|sem vaga|sem garagem|zero)$/.test(n))
        patch.parkingSpaces = 0;
      else if (number && !/quarto/.test(n) && Number(number[1]) <= 30)
        patch.parkingSpaces = Number(number[1]);
    }
  }
  return patch;
}
