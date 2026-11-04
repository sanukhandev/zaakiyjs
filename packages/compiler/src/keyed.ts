import * as ts from "typescript";

/**
 * Rewrite references to a keyed-loop item into reads of a scope-owned signal.
 * Parsing and printing expressions with the TypeScript AST avoids modifying
 * quoted strings, property names, or other text that merely resembles the
 * source identifier. Never eval or execute source expressions here.
 */
export function rewriteKeyedItemRead(
  expression: string, itemParameter: string, itemSignal: string
): { readonly source: string; readonly readsItem: boolean } {
  const file = ts.createSourceFile(
    "__zaakiy_keyed_expression.ts", "const __zaakiy_value = (" + expression + ");",
    ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS
  );
  const statement = file.statements[0];
  const init = statement && ts.isVariableStatement(statement)
    ? statement.declarationList.declarations[0]?.initializer : undefined;
  if (!init || (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) {
    throw new Error("Invalid keyed item expression");
  }

  const checkShadowing = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node.parameters.some(parameter =>
      ts.isIdentifier(parameter.name) && parameter.name.text === itemParameter)) {
      throw new Error("Nested closure shadows keyed item parameter: " + itemParameter);
    }
    ts.forEachChild(node, checkShadowing);
  };
  checkShadowing(init);

  let readsItem = false;
  const transformer: ts.TransformerFactory<ts.Expression> = context => root => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isIdentifier(node) && node.text === itemParameter) {
        const parent = node.parent;
        if (parent && (
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node) ||
          (ts.isMethodDeclaration(parent) && parent.name === node) ||
          (ts.isParameter(parent) && parent.name === node)
        )) return node;
        if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
          throw new Error("Shorthand keyed item objects require explicit property expressions");
        }
        readsItem = true;
        return ts.factory.createPropertyAccessExpression(
          ts.factory.createIdentifier(itemSignal), "value"
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.Expression;
  };
  const result = ts.transform(init, [transformer]);
  try {
    if (!readsItem) return { source: expression, readsItem: false };
    return {
      source: ts.createPrinter({ removeComments: false }).printNode(
        ts.EmitHint.Expression, result.transformed[0]!, file
      ),
      readsItem: true
    };
  } finally {
    result.dispose();
  }
}
