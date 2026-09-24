// Read-only visual fixture: no account, API calls, or customer data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const base = path.join(__dirname, '..');
const item = { id: 'preview', leadId: 'lead-preview', propertyId: 'property-preview', leadName: 'Samuel', propertyTitle: 'Casinha Fofa', city: 'Lavras', district: 'Centro', price: 450000, bedrooms: 2, parkingSpaces: 2, score: 100, status: 'open', assignedTo: null, inactivityDays: 0, reasons: ['Objetivo compatível', 'Casa', 'Lavras · Centro', 'Dentro do orçamento'] };
const draft = { id: item.id, message: 'Olá, Samuel! Encontrei um imóvel que combina com o que você estava procurando: Casinha Fofa, em Centro, Lavras, com 2 quartos. Quer que eu te envie mais detalhes?', url: '#' };
const moduleCss = fs.readFileSync(path.join(base, 'app/opportunity-center.module.css'), 'utf8').replace(/:global\(([^)]+)\)/g, '$1');
const globalCss = ['globals.css', 'admin-layout.css', 'native-theme.css'].map(file => fs.readFileSync(path.join(base, 'app', file), 'utf8').replace(/@import[^;]+;/g, '')).join('\n');
const output = ts.transpileModule(fs.readFileSync(path.join(base, 'app/opportunity-center.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
let state = 0;
const inactive = process.argv.includes('--inactive');
const states = [[item],0,'',false,draft,{
  data: [{ id:'old-example',name:'Ana Martins',goal:'Comprar',propertyType:'Apartamento',region:'Centro',assignedTo:'Marina Alves',inactivityDays:18,lastContactAt:'2026-08-28T12:00:00Z' },
    { id:'old-example-2',name:'Lucas Oliveira',goal:'Alugar',propertyType:'Casa',region:'Vila Nova',assignedTo:null,inactivityDays:23,lastContactAt:null }],hasMore:false
},0,''];
vm.runInNewContext(output, { exports: mod.exports, module: mod, Intl, require(name) {
  if (name === 'react') return { ...React, useEffect() {}, useState() { return [states[state++], () => {}]; } };
  if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
  if (name === '@/lib/dashboard-sync') return {};
  if (name === '@/lib/dashboard-transport') return {};
  return require(name);
} });
const markup = renderToStaticMarkup(React.createElement(mod.exports.default, { onLead() {}, onProperty() {} }));
async function run() {
  const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    for (const [name, width, dark] of [['desktop', 1100, false], ['mobile', 390, false], ['dark', 1100, true]]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.setContent(`<html lang="pt-BR"><style>${globalCss}\n${moduleCss}\n.fixture.app-shell {display:block;padding:24px;min-height:100vh} .fixture h1 {font:600 28px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:-.04em;margin:0 0 8px} .fixture > p {color:var(--muted);font-size:14px;margin:0 0 28px}</style><body><main class="app-shell fixture ${dark ? 'dark-mode' : ''}"><h1>Oportunidades</h1><p>Conexões que podem se transformar em bons negócios.</p>${markup}</main></body></html>`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) throw new Error(`Horizontal overflow: ${name}`);
      await page.keyboard.press('Tab');
      if (await page.locator(':focus').count() !== 1) throw new Error('Keyboard focus missing');
      await page.screenshot({ path: path.join(base, '../../.codex-build', `imobflow-opportunities-${inactive ? 'inactive-' : ''}${name}.png`), fullPage: true });
      console.log(`PASS ${name}: no horizontal overflow; screenshot saved`);
    }
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
