import {
  Project,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";

import type { PlanCollectionShape } from "../plan.js";

/**
 * Read literal collection slugs and field names without executing operator code.
 * Computed names/types and spreads are skipped. Only row/collapsible containers
 * are flattened; array/group children belong to their own sub-records.
 */
export function extractCollectionFromFile(filePath: string): PlanCollectionShape | null {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: false,
    compilerOptions: { allowJs: false, noEmit: true },
  });
  const source = project.addSourceFileAtPath(filePath);
  return extractFromSourceFile(source);
}

/**
 * Test-friendly variant — extract from already-parsed source.
 * The exported entry above wraps this with FS reads.
 */
export function extractFromSourceFile(source: SourceFile): PlanCollectionShape | null {
  const defineCall = findDefineCollectionCall(source);
  if (!defineCall) return null;

  const arg = defineCall.getArguments()[0];
  if (!arg || !arg.isKind(SyntaxKind.ObjectLiteralExpression)) return null;
  const obj = arg;

  const slug = readStringProperty(obj, "slug");
  if (!slug) return null;

  const fieldsProp = obj.getProperty("fields");
  const fieldNames: string[] = [];
  if (fieldsProp && fieldsProp.isKind(SyntaxKind.PropertyAssignment)) {
    const initializer = fieldsProp.getInitializer();
    if (initializer && initializer.isKind(SyntaxKind.ArrayLiteralExpression)) {
      for (const el of initializer.getElements()) {
        if (el.isKind(SyntaxKind.ObjectLiteralExpression)) {
          collectFieldNames(el, fieldNames);
        }
      }
    }
  }

  return { filePath: source.getFilePath(), slug, fieldNames };
}

function findDefineCollectionCall(source: SourceFile): CallExpression | undefined {
  // Walk every CallExpression; pick the first whose callee
  // is the identifier `defineCollection`. Multiple calls in
  // one file are unusual but if present we take the first
  // (consumer can split into multiple files).
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() === "defineCollection") return call;
  }
  return undefined;
}

function readStringProperty(obj: ObjectLiteralExpression, name: string): string | undefined {
  const prop = obj.getProperty(name);
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) return undefined;
  const initializer = prop.getInitializer();
  if (!initializer) return undefined;
  if (initializer.isKind(SyntaxKind.StringLiteral)) {
    return initializer.getLiteralValue();
  }
  return undefined;
}

function collectFieldNames(literal: ObjectLiteralExpression, out: string[]): void {
  const type = readStringProperty(literal, "type");
  if (!type) return;

  if (type === "row" || type === "collapsible") {
    const innerFields = literal.getProperty("fields");
    if (innerFields && innerFields.isKind(SyntaxKind.PropertyAssignment)) {
      const init = innerFields.getInitializer();
      if (init && init.isKind(SyntaxKind.ArrayLiteralExpression)) {
        for (const el of init.getElements()) {
          if (el.isKind(SyntaxKind.ObjectLiteralExpression)) {
            collectFieldNames(el, out);
          }
        }
      }
    }
    return;
  }

  const name = readStringProperty(literal, "name");
  if (name) out.push(name);
}
