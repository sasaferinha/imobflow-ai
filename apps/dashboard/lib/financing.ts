export type FinancingInput = { propertyValue: number; downPayment: number; months: number; annualRate: number; system: 'SAC' | 'PRICE' };
export type Installment = { month: number; payment: number; interest: number; amortization: number; balance: number };
export function simulateFinancing(input: FinancingInput) {
  const {propertyValue,downPayment,months,annualRate,system}=input;
  if(![propertyValue,downPayment,months,annualRate].every(Number.isFinite))throw new Error('Preencha todos os campos com números válidos.');
  if(propertyValue<=0 || propertyValue>100_000_000)throw new Error('Informe um valor de imóvel maior que zero e até R$ 100 milhões.');
  if(downPayment<0 || downPayment>=propertyValue)throw new Error('A entrada deve ser zero ou maior e menor que o valor do imóvel.');
  if(!Number.isInteger(months) || months<1 || months>600)throw new Error('Informe um prazo inteiro entre 1 e 600 meses.');
  if(annualRate<0 || annualRate>100)throw new Error('Informe uma taxa anual efetiva entre 0% e 100%.');
  if(system!=='SAC' && system!=='PRICE')throw new Error('Escolha SAC ou Price.');
  const principal=propertyValue-downPayment;
  const monthlyRate=Math.expm1(Math.log1p(annualRate/100)/12);
  // Payments at the end of each month. Stable even for rates close to zero.
  const fixed=monthlyRate===0 ? principal/months : principal*monthlyRate / -Math.expm1(-months*Math.log1p(monthlyRate));
  let balance=principal,totalInterest=0;
  const schedule: Installment[]=[];
  for(let month=1;month<=months;month++){
    const interest=balance*monthlyRate;
    const amortization=month===months ? balance : Math.min(balance,system==='SAC' ? principal/months : fixed-interest);
    balance=Math.max(0,balance-amortization);
    totalInterest+=interest;
    schedule.push({month,payment:amortization+interest,interest,amortization,balance});
  }
  return {principal,monthlyRate,totalInterest,totalPayments:principal+totalInterest,totalWithDownPayment:propertyValue+totalInterest,schedule};
}

// BRL-friendly form input; reject incomplete/ambiguous decimal separators.
export function parseFinancingNumber(raw: string): number {
  const text=raw.trim().replace(/^R\$\s*/i,'');
  if(!text)return NaN;
  if(/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text))return Number(text.replace(/\./g,'').replace(',','.'));
  if(/^\d+(?:[,.]\d{1,2})?$/.test(text))return Number(text.replace(',','.'));
  return NaN;
}
