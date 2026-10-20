// Load the real AI policy/provider modules with an explicitly supplied isolated runtime.
// Local imports are confined to lib/ai; this never supplies network access itself.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../lib/ai');
function loadLocalAI(filename, globals = {}) {
  const cache = new Map();
  function load(name) {
    const file = path.resolve(root, name);
    if (path.dirname(file) !== root || !file.endsWith('.ts')) throw Error('unexpected_ai_import');
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} }; cache.set(file, module.exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, Date, Intl, AbortSignal, console, ...globals,
      require: dependency => dependency === 'server-only' ? {} : dependency.startsWith('./') ? load(dependency + '.ts') : (() => { throw Error('unexpected_ai_import'); })(),
    }, { filename: file });
    cache.set(file, module.exports); return module.exports;
  }
  return load(filename);
}
module.exports = { loadLocalAI };
