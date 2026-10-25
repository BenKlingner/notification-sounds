const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

// Test the TypeScript without adding a runtime loader dependency. Only Paseo's
// registration wrappers are stubbed; schemas and plugin behavior execute normally.
exports.loader = function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (!path.extname(file)) file += '.ts';
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const localRequire = (name) => {
      if (name in overrides) return overrides[name];
      if (name === '@getpaseo/plugin') return {
        defineRpc: value => value,
        defineSettings: value => value,
        settingsRpc: () => ({ read: { name: 'settings.read' }, write: { name: 'settings.write' } }),
      };
      return name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : require(name);
    };
    vm.runInNewContext('(function(require,module,exports){' + source + '\n})', {
      Buffer, process, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, ...globals,
    }, { filename: file })(localRequire, module, module.exports);
    return module.exports;
  }
  return load;
};

exports.flush = async () => { for (let n = 0; n < 50; n++) await Promise.resolve(); };
exports.deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
