import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Load actual component handlers with browser/UI services supplied by the test.
export function loadComponent(relativePath, mocks) {
  const filename = new URL('../../' + relativePath, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const componentStub = new Proxy({ __esModule: true }, {
    get(target, name) {
      return name in target ? target[name] : () => null;
    },
  });
  const testRequire = (name) => {
    if (name in mocks) return mocks[name];
    if (name === 'react') return require(name);
    return componentStub;
  };
  new Function('require', 'module', 'exports', compiled)(testRequire, module, module.exports);
  return module.exports;
}
