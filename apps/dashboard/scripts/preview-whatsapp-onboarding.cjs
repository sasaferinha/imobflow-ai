// Static visual fixture with fictional state; controls do not call Meta or the app.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), http = require('node:http'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const base = path.join(__dirname, '..');
const output = ts.transpileModule(fs.readFileSync(path.join(base, 'app/whatsapp-integration.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const css = ['globals.css', 'admin-layout.css', 'native-theme.css', 'whatsapp-integration.css'].map(file => fs.readFileSync(path.join(base, 'app', file), 'utf8')).join('\n');
function markup(mode) {
  let hook = 0;
  const values = [
    { configured: mode === 'saved', enabled: true, hasAccessToken: mode === 'saved', phoneNumberId: mode === 'saved' ? '123456789012345' : '', apiVersion: 'v26.0', verification: mode === 'saved' ? 'verified' : 'unchecked', displayPhoneNumber: mode === 'saved' ? '+55 35 99999-1111' : undefined, verifiedName: mode === 'saved' ? 'Imobiliária de Teste' : undefined },
    { appId: '123456', configId: '654321', available: mode === 'ready', apiVersion: 'v26.0' }, false,
  ];
  const mod = { exports: {} };
  vm.runInNewContext(output, { module: mod, exports: mod.exports, require: name => {
    if (name === 'react') return { ...React, useState: initial => [hook < values.length ? values[hook++] : (hook++, initial), () => {}], useEffect() {}, useRef: initial => ({ current: initial }) };
    if (name === 'next/script') return { default: () => null };
    if (name.endsWith('.css') || name.startsWith('@/lib/')) return {};
    return require(name);
  } });
  return renderToStaticMarkup(React.createElement(mod.exports.default, { canEdit: true, onOpenConversations() {} }));
}
const port = Number(process.env.PORT || 4320);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; img-src data:");
  res.end(url.pathname === '/mobile' ? '<iframe title="Celular 390px" src="/" style="width:390px;height:1400px;border:1px solid #ccc"></iframe>' : `<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><main style="padding:24px;max-width:1050px;margin:auto"><p style="font-size:12px;color:#667085">Prévia local · dados fictícios · controles sem envio</p>${markup(url.pathname.slice(1))}</main></body></html>`);
}).listen(port, '127.0.0.1', () => console.log(`WhatsApp fixture: http://127.0.0.1:${port} (/, /ready, /saved, /mobile)`));
