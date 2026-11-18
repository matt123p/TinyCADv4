import ts from 'typescript';

// Parse actual JavaScript calls. PDF.js also contains generated worker source
// in strings; import-looking text inside those strings is not a module edge.
export function literalModuleSpecifiers(source, filename = 'renderer.js') {
  const ast = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const specifiers = [];
  // Generated bundles can contain binary expressions deeper than the JS call
  // stack. Walk explicitly while preserving source order for import references.
  const pending = [ast];
  while (pending.length > 0) {
    const node = pending.pop();
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const dynamicImport = expression.kind === ts.SyntaxKind.ImportKeyword;
      const resolve =
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'resolve' &&
        ts.isMetaProperty(expression.expression) &&
        expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
      const value = node.arguments[0];
      if (
        (dynamicImport || resolve) &&
        value &&
        (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
      )
        specifiers.push(value.text);
    }
    const children = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return specifiers;
}
