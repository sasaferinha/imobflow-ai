import { type InterestProfile } from "./qualification";
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
export function requestsHuman(message: string) {
  return /\b(corretor|atendente|humano|pessoa)\b/.test(normalize(message));
}
export function basicPreferences(
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
    !/\b(nao|sei|talvez|qualquer|ignora|ignore|quero|prefiro|obrigad|ola|oi|ok|sim|bom dia|boa tarde|boa noite)\b/.test(
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
