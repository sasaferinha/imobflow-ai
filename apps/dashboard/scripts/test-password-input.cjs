const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
let visible = false;
const mod = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../app/password-input.tsx'), 'utf8');
const jsx = (type, props) => ({ type, props });
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  module: mod, exports: mod.exports,
  require: name => name === 'react' ? { useId: () => 'password-test', useState: () => [visible, fn => { visible = fn(visible); }] } : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : { default: {} },
});
const render = () => mod.exports.default({ name: 'password', required: true, autoComplete: 'current-password' }).props.children;
let [input, button] = render();
assert.equal(input.props.type, 'password');
assert.equal(input.props.name, 'password');
assert.equal(input.props.required, true);
assert.equal(button.props.type, 'button');
assert.equal(button.props['aria-controls'], input.props.id);
button.props.onClick();
[input, button] = render();
assert.equal(input.props.type, 'text');
assert.equal(button.props['aria-pressed'], true);
button.props.onClick();
assert.equal(render()[0].props.type, 'password');
for (const file of ['password-modal.tsx', 'team-modal.tsx', 'painel/login-client.tsx', 'painel/admin/license-admin-client.tsx', 'painel/redefinir-senha/reset-client.tsx']) {
  const text = fs.readFileSync(path.join(__dirname, '../app', file), 'utf8');
  assert.match(text, /<PasswordInput/);
  assert.doesNotMatch(text, /type="password"/);
}
const login = fs.readFileSync(path.join(__dirname, '../app/painel/login-client.tsx'), 'utf8');
assert.match(login, /\{registering && <label>Nome da empresa/);
console.log('PASS password visibility toggles, safe button type, field attributes and registration-only company');
