import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
/** Follow runtime edges only. Core domain facades remain installed package boundaries;
 * App host aliases/Next dependencies must not enter standalone Operator factory graphs. */
function hostDependencies(entry: string): string[] {
  const seen = new Set<string>(),
    forbidden = new Set<string>();
  function visit(path: string) {
    if (seen.has(path)) return;
    seen.add(path);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function dependency(specifier: string) {
      if (specifier.startsWith("@/") || specifier === "next" || specifier.startsWith("next/")) {
        forbidden.add(`${path}: ${specifier}`);
        return;
      }
      if (!specifier.startsWith(".")) return;
      const candidate = resolve(dirname(path), specifier);
      const extensionless = candidate.replace(/\.(?:js|mjs|cjs)$/, "");
      const found = [
        candidate,
        `${extensionless}.ts`,
        `${extensionless}.tsx`,
        `${candidate}/index.ts`,
      ].find(existsSync);
      if (!found) throw new Error(`Unresolved Operator runtime module: ${path}: ${specifier}`);
      visit(found);
    }
    function node(value: ts.Node) {
      if (ts.isImportDeclaration(value) && ts.isStringLiteral(value.moduleSpecifier)) {
        const clause = value.importClause;
        const bindings = clause?.namedBindings;
        const onlyTypes =
          clause?.isTypeOnly ||
          (!clause?.name &&
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((part) => part.isTypeOnly));
        if (!onlyTypes) dependency(value.moduleSpecifier.text);
      } else if (
        ts.isExportDeclaration(value) &&
        value.moduleSpecifier &&
        ts.isStringLiteral(value.moduleSpecifier)
      ) {
        const clause = value.exportClause;
        const onlyTypes =
          value.isTypeOnly ||
          (clause &&
            ts.isNamedExports(clause) &&
            clause.elements.length > 0 &&
            clause.elements.every((part) => part.isTypeOnly));
        if (!onlyTypes) dependency(value.moduleSpecifier.text);
      } else if (
        ts.isCallExpression(value) &&
        value.expression.kind === ts.SyntaxKind.ImportKeyword &&
        value.arguments[0] &&
        ts.isStringLiteral(value.arguments[0])
      ) {
        dependency(value.arguments[0].text);
      }
      ts.forEachChild(value, node);
    }
    ts.forEachChild(source, node);
  }
  visit(entry);
  return [...forbidden].sort();
}
describe("standalone Operator module boundary", () => {
  it.each(["../system-health-checks.ts", "./operator-event-source.ts", "./operator-host.ts"])(
    "keeps %s independent of application bootstrap and Next",
    (entry) => {
      expect(hostDependencies(resolve(here, entry))).toEqual([]);
    },
  );
});
