const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const postcss = createRequire(require.resolve('next'))('postcss');

// Static source contracts only: this does not render a browser or prove layout geometry.
const app = path.join(__dirname, '..', 'app');
const source = fs.readFileSync(path.join(app, 'product-preview.tsx'), 'utf8');
const css = postcss.parse(fs.readFileSync(path.join(app, 'product-preview.module.css'), 'utf8'));
const links = [...source.matchAll(/<a\b[^>]*className=\{s\.explorePanel\}[^>]*>[\s\S]*?<\/a>/g)];
assert.equal(links.length, 1, 'Keep one prominent CTA with native link semantics.');
const link = links[0][0];
for (const attribute of ['href="/demonstracao"', 'target="_blank"', 'rel="noopener noreferrer"']) {
  assert.ok(link.includes(attribute), `CTA must preserve ${attribute}`);
}
assert.match(link, /aria-label="Explorar painel completo \(abre em uma nova aba\)"/);
assert.match(link, />Explorar painel completo <span aria-hidden="true">↗<\/span>/);
assert.doesNotMatch(link, /\b(?:onClick|role|tabIndex)=/, 'Do not replace native link behavior.');
const frames = [...source.matchAll(/<iframe\b[^>]*>/g)];
assert.equal(frames.length, 1, 'Keep the existing demonstration iframe.');
for (const attribute of ['src="/demonstracao"', 'sandbox="allow-scripts allow-same-origin"', 'tabIndex={-1}']) {
  assert.ok(frames[0][0].includes(attribute), `Iframe must preserve ${attribute}`);
}

function rule(selector, media) {
  const matches = [];
  css.walkRules(selector, candidate => {
    if (media ? candidate.parent.type === 'atrule' && candidate.parent.name === 'media'
      && candidate.parent.params.replace(/\s/g, '') === media : candidate.parent.type === 'root') matches.push(candidate);
  });
  assert.equal(matches.length, 1, `Expected one ${selector} rule in ${media || 'base styles'}`);
  return matches[0];
}
function declaration(style, property, value, important = false) {
  const declarations = style.nodes.filter(node => node.type === 'decl' && node.prop === property);
  assert.equal(declarations.length, 1, `${style.selector}: expected explicit ${property}`);
  assert.equal(declarations[0].value, value, `${style.selector}: ${property}`);
  assert.equal(Boolean(declarations[0].important), important, `${style.selector}: ${property} priority`);
}

const base = rule('.caption .explorePanel');
for (const [property, value] of Object.entries({
  display: 'inline-flex', 'min-height': '56px', 'max-width': '100%', padding: '16px 24px',
  background: '#0062d6', 'font-size': '16px', 'font-weight': '650',
})) declaration(base, property, value);
declaration(base, 'color', '#fff', true);
declaration(base, 'text-decoration', 'none', true);
const hover = rule('.caption .explorePanel:hover');
declaration(hover, 'background', '#004faa');
declaration(hover, 'color', '#fff', true);
declaration(hover, 'text-decoration', 'none', true);
const focus = rule('.caption .explorePanel:focus-visible');
declaration(focus, 'outline', '3px solid #004faa');
declaration(focus, 'outline-offset', '4px');
const mobile = rule('.caption .explorePanel', '(max-width:600px)');
declaration(mobile, 'width', '100%');
declaration(mobile, 'min-width', '0');

console.log('PASS product preview CTA static contracts: prominent styling, hover/focus, mobile width and isolated demo links; no browser rendering tested');
