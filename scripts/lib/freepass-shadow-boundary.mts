import ts from 'typescript';

/** Static regression fence for the explicit inline after() pattern used by guest-listing. */
export function hasDeferredShadowBoundary(source: string): boolean {
  const file = ts.createSourceFile('guest-listing.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imported = (moduleName: string, exportName: string): string | undefined => {
    for (const node of file.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)
        || node.moduleSpecifier.text !== moduleName || node.importClause?.isTypeOnly) continue;
      const bindings = node.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const item of bindings.elements) {
        if (!item.isTypeOnly && (item.propertyName?.text ?? item.name.text) === exportName) return item.name.text;
      }
    }
    return undefined;
  };
  const after = imported('next/server', 'after');
  const observe = imported('@/lib/server/freepass-data-shadow', 'observeFreepassDataShadow');
  if (!after || !observe) return false;
  let deferredCalls = 0;
  let eagerCalls = 0;
  function visit(node: ts.Node, deferred: boolean): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === after) {
        const callback = node.arguments[0];
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          visit(callback.body, true);
          // Unexpected extra arguments are still evaluated on the request path.
          for (const argument of node.arguments.slice(1)) visit(argument, deferred);
          return;
        }
      }
      if (node.expression.text === observe) {
        if (deferred) deferredCalls += 1;
        else eagerCalls += 1;
      }
    }
    ts.forEachChild(node, (child) => visit(child, deferred));
  }
  visit(file, false);
  return deferredCalls > 0 && eagerCalls === 0;
}
