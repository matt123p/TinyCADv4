import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual module with isolated browser services. Resolve import.meta.url
// before compiling to CommonJS so Worker/font URLs retain their real source base.
export function loadLayoutModule(relativePath, mocks, globals = {}) {
  const filename = new URL('../../' + relativePath, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React, esModuleInterop: true,
    },
    transformers: { before: [context => source => {
      const visit = node => {
        if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === 'url') {
          return ts.factory.createStringLiteral(filename.href);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(source, visit);
    }] },
  }).outputText;
  const module = { exports: {} };
  const sandbox = vm.createContext({
    module, exports: module.exports, URL, Error, console,
    require(name) {
      if (!(name in mocks)) throw new Error('Unexpected test dependency: ' + name);
      return mocks[name];
    },
    ...globals,
  });
  vm.runInContext(compiled, sandbox, { filename: filename.pathname });
  return { exports: module.exports, sandbox };
}
