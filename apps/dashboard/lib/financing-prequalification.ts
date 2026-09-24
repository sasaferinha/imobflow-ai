import { simulateFinancing, type FinancingInput } from './financing';

// Illustrative inputs, not a personalized bank offer. The 10.99% effective
// annual rate was published for CAIXA SBPE in December 2025; TR is NOT included.
// https://caixanoticias.caixa.gov.br/Paginas/Not%C3%ADcias/2025/12-DEZEMBRO/CAIXA-volta-a-permitir-mais-de-um-financiamento--imobiliario-pelo-SBPE.aspx
export const PREQUALIFICATION_DEFAULTS = {
  annualRate: 10.99,
  months: 420,
  system: 'PRICE' as const,
  incomeShare: 0.3,
};

// Urban gross household income limits, Portaria MCID 333/2026, checked 2026-09-12.
// This identifies an INCOME band only; it does not establish MCMV eligibility.
// https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/habitacao/programa-minha-casa-minha-vida/sobre-o-minha-casa-minha-vida-1
export const MCMV_INCOME_BANDS = [
  { label: 'Faixa 1', ceiling: 3200 },
  { label: 'Faixa 2', ceiling: 5000 },
  { label: 'Faixa 3', ceiling: 9600 },
  { label: 'Classe Média', ceiling: 13000 },
] as const;

export type FinancingPrequalificationInput = {
  monthlyIncome: number;
  propertyValue: number;
  // Includes only savings/FGTS the user has entered; no subsidy is inferred.
  downPayment: number;
  annualRate?: number;
  months?: number;
  system?: FinancingInput['system'];
};

export function calculatePrequalification(input: FinancingPrequalificationInput) {
  const { monthlyIncome, propertyValue, downPayment } = input;
  const annualRate = input.annualRate ?? PREQUALIFICATION_DEFAULTS.annualRate;
  const months = input.months ?? PREQUALIFICATION_DEFAULTS.months;
  const system = input.system ?? PREQUALIFICATION_DEFAULTS.system;
  if (!Number.isFinite(monthlyIncome) || monthlyIncome <= 0 || monthlyIncome > 10_000_000) {
    throw new Error('Informe uma renda familiar mensal maior que zero e até R$ 10 milhões.');
  }
  if (!Number.isInteger(months) || months < 1 || months > 420) {
    throw new Error('Informe um prazo inteiro entre 1 e 420 meses.');
  }

  // Use the existing effective-rate SAC/Price calculation, including its
  // input validation. All affordability figures use these same assumptions.
  const financing = simulateFinancing({ propertyValue, downPayment, months, annualRate, system });
  const estimatedPayment = financing.schedule[0].payment;
  const lastPayment = financing.schedule[financing.schedule.length - 1].payment;

  // CAIXA's public 30% income reference; excludes other debts, insurance,
  // fees, indexation, appraisal limits and bank-specific financing quotas.
  // https://www.caixa.gov.br/voce/habitacao/financiamento-de-imoveis/Paginas/default.aspx
  const incomeReferencePayment = monthlyIncome * PREQUALIFICATION_DEFAULTS.incomeShare;
  const financingCapacity = incomeReferencePayment / (estimatedPayment / financing.principal);
  const requiredDownPayment = Math.max(0, propertyValue - financingCapacity);
  const extraDownPayment = Math.max(0, requiredDownPayment - downPayment);
  const incomeBand = MCMV_INCOME_BANDS.find((band) => monthlyIncome <= band.ceiling) ?? null;

  return {
    financing,
    monthlyIncome,
    propertyValue,
    downPayment,
    annualRate,
    months,
    system,
    incomeBand,
    subsidy: 0,
    estimatedPayment,
    lastPayment,
    incomeReferencePayment,
    paymentIncomePercent: estimatedPayment / monthlyIncome * 100,
    financingCapacity,
    propertyCapacity: financingCapacity + downPayment,
    requiredDownPayment,
    extraDownPayment,
    minimumIncome: estimatedPayment / PREQUALIFICATION_DEFAULTS.incomeShare,
    // Tolerance is half a cent to prevent floating-point boundary flips.
    withinIncomeReference: estimatedPayment <= incomeReferencePayment + 0.005,
  };
}

export type FinancingPrequalification = ReturnType<typeof calculatePrequalification>;
