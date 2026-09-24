const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadPure(name) {
  const source = fs.readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports,
    require: (dependency) => {
      assert.equal(dependency, './financing');
      return loadPure('financing');
    },
  });
  return mod.exports;
}

const { calculatePrequalification: calculate } = loadPure('financing-prequalification');
const base = { monthlyIncome: 5000, propertyValue: 250000, downPayment: 50000 };
const near = (actual, expected, tolerance = 0.000001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

// Zero interest is an independent arithmetic oracle, for both amortization systems.
for (const system of ['PRICE', 'SAC']) {
  const result = calculate({ ...base, annualRate: 0, months: 200, system });
  near(result.estimatedPayment, 1000);
  near(result.lastPayment, 1000);
  near(result.paymentIncomePercent, 20);
  near(result.financingCapacity, 300000);
  near(result.propertyCapacity, 350000);
  assert.equal(result.extraDownPayment, 0);
  assert.equal(result.withinIncomeReference, true);
  near(result.financing.totalInterest, 0);
  near(result.financing.totalWithDownPayment, 250000);
}

// A 12.682503...% effective annual rate is exactly 1% monthly, NOT annual / 12.
const effectiveRate = (1.01 ** 12 - 1) * 100;
// Two monthly Price payments repay R$ 200k at 1% monthly: R$ 101,502.487562 each.
const price = calculate({ ...base, annualRate: effectiveRate, months: 2, system: 'PRICE' });
near(price.estimatedPayment, 101502.48756218906);
near(price.lastPayment, 101502.48756218906);
near(price.financing.schedule.at(-1).balance, 0);
const sac = calculate({ ...base, annualRate: effectiveRate, months: 200, system: 'SAC' });
near(sac.estimatedPayment, 3000);
near(sac.lastPayment, 1010);
near(sac.financingCapacity, 100000);
near(sac.requiredDownPayment, 150000);
near(sac.extraDownPayment, 100000);
near(sac.minimumIncome, 10000);
assert.equal(sac.withinIncomeReference, false);

// Paying the suggested additional entry brings the same loan within the income reference.
for (const system of ['PRICE', 'SAC']) {
  const original = calculate({ ...base, monthlyIncome: 1800, system });
  const adjusted = calculate({ ...base, monthlyIncome: 1800, system, downPayment: base.downPayment + original.extraDownPayment });
  assert.ok(original.extraDownPayment > 0);
  near(adjusted.estimatedPayment, 540);
  assert.equal(adjusted.withinIncomeReference, true);
  near(adjusted.extraDownPayment, 0);
  const largerEntry = calculate({ ...base, downPayment: 80000, system });
  assert.ok(largerEntry.estimatedPayment < calculate({ ...base, system }).estimatedPayment);
}

// Income labels never generate a government benefit or change the loan's rate.
for (const [income, label] of [[3200, 'Faixa 1'], [3200.01, 'Faixa 2'], [5000, 'Faixa 2'], [5000.01, 'Faixa 3'], [9600, 'Faixa 3'], [9600.01, 'Classe Média'], [13000, 'Classe Média'], [13000.01, undefined]]) {
  const result = calculate({ ...base, monthlyIncome: income });
  assert.equal(result.incomeBand?.label, label);
  assert.equal(result.subsidy, 0);
  assert.equal(result.annualRate, 10.99);
  near(result.financing.principal, 200000);
}

for (const monthlyIncome of [0, -1, NaN, Infinity, 10000001]) {
  assert.throws(() => calculate({ ...base, monthlyIncome }), /renda familiar/);
}
for (const months of [0, 421, 35.5, NaN]) {
  assert.throws(() => calculate({ ...base, months }), /prazo inteiro/);
}
for (const invalid of [{ downPayment: -1 }, { downPayment: 250000 }, { propertyValue: NaN }, { annualRate: Infinity }, { annualRate: -1 }, { system: 'OTHER' }]) {
  assert.throws(() => calculate({ ...base, ...invalid }));
}
const extreme = calculate({ monthlyIncome: 0.01, propertyValue: 100000000, downPayment: 0, annualRate: 100, months: 420 });
assert.ok(Number.isFinite(extreme.estimatedPayment));
assert.ok(Number.isFinite(extreme.extraDownPayment));
assert.ok(extreme.extraDownPayment > 0);
console.log('Financing prequalification: effective rates, income capacity, entry gaps, bands and invalid inputs passed.');
