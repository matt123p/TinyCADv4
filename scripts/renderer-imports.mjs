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
  const visit = (node) => {
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
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return specifiers;
}
