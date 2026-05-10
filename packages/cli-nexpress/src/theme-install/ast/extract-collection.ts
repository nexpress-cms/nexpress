import type { NpCollectionConfig, NpFieldConfig } from "@nexpress/core";
import {
  Project,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";

/**
 * Phase F.8-B — extract a (best-effort) `NpCollectionConfig`
 * shape from a `src/collections/<slug>.ts` file by walking its
 * AST. Static-only: we read literal `slug: "..."` declarations
 * and `fields: [ { name, type, ... }, ... ]` array literals.
 *
 * Why not run the file? Operator code execution is risky from
 * a CLI: `nexpress.config.ts` may pull DB connections, side-
 * effecting registry mutations, etc. Static AST extraction is
 * narrower (skips computed fields, dynamic spreads) but safer.
 *
 * Limitations (documented for the operator and F.8-B follow-ups):
 * - Fields whose `name` or `type` are computed (variables,
 *   spreads, function calls) are skipped silently. The
 *   operator's diff might miss field-level mismatches in
 *   those cases; the apply phase still patches what it can
 *   see and the operator can reconcile manually.
 * - `row` / `collapsible` containers are walked recursively to
 *   reach their inner fields (matching the runtime walker in
 *   `@nexpress/core`'s `flattenTopLevelFields`).
 * - `array` / `group` field children are NOT walked — the
 *   runtime walker doesn't reach into them, and theme
 *   requirements address top-level fields only.
 */

export interface ExtractedCollection {
  /** Source file path the extractor read. */
  filePath: string;
  /** The synthesized NpCollectionConfig the planner can pass
   *  to checkThemeRequirements. Only `slug` + `fields` are
   *  populated; the runtime config has more fields, but the
   *  check function only reads these two. */
  config: Pick<NpCollectionConfig, "slug" | "fields" | "labels">;
}

export function extractCollectionFromFile(
  filePath: string,
): ExtractedCollection | null {
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
export function extractFromSourceFile(
  source: SourceFile,
): ExtractedCollection | null {
  const defineCall = findDefineCollectionCall(source);
  if (!defineCall) return null;

  const arg = defineCall.getArguments()[0];
  if (!arg || !arg.isKind(SyntaxKind.ObjectLiteralExpression)) return null;
  const obj = arg;

  const slug = readStringProperty(obj, "slug");
  if (!slug) return null;

  const fieldsProp = obj.getProperty("fields");
  const fields: NpFieldConfig[] = [];
  if (fieldsProp && fieldsProp.isKind(SyntaxKind.PropertyAssignment)) {
    const initializer = (fieldsProp).getInitializer();
    if (
      initializer &&
      initializer.isKind(SyntaxKind.ArrayLiteralExpression)
    ) {
      for (const el of initializer.getElements()) {
        if (el.isKind(SyntaxKind.ObjectLiteralExpression)) {
          collectFields(el, fields);
        }
      }
    }
  }

  return {
    filePath: source.getFilePath(),
    config: {
      slug,
      // Labels aren't actually needed for the check; supply
      // a placeholder so the type stays satisfied.
      labels: { singular: slug, plural: slug },
      fields,
    },
  };
}

function findDefineCollectionCall(
  source: SourceFile,
): CallExpression | undefined {
  // Walk every CallExpression; pick the first whose callee
  // is the identifier `defineCollection`. Multiple calls in
  // one file are unusual but if present we take the first
  // (consumer can split into multiple files).
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() === "defineCollection") return call;
  }
  return undefined;
}

function readStringProperty(
  obj: ObjectLiteralExpression,
  name: string,
): string | undefined {
  const prop = obj.getProperty(name);
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) return undefined;
  const initializer = (prop).getInitializer();
  if (!initializer) return undefined;
  if (initializer.isKind(SyntaxKind.StringLiteral)) {
    return initializer.getLiteralValue();
  }
  return undefined;
}

/**
 * Walks a single field literal. For `row` / `collapsible`
 * containers, recurses into their `fields: [...]` to reach
 * top-level descendants (matching the runtime walker). For
 * leaf fields (`text`, `checkbox`, `relationship`, etc.),
 * pushes a synthesized `NpFieldConfig`.
 */
function collectFields(
  literal: ObjectLiteralExpression,
  out: NpFieldConfig[],
): void {
  const type = readStringProperty(literal, "type");
  if (!type) return;

  if (type === "row" || type === "collapsible") {
    const innerFields = literal.getProperty("fields");
    if (innerFields && innerFields.isKind(SyntaxKind.PropertyAssignment)) {
      const init = (innerFields).getInitializer();
      if (init && init.isKind(SyntaxKind.ArrayLiteralExpression)) {
        for (const el of init.getElements()) {
          if (el.isKind(SyntaxKind.ObjectLiteralExpression)) {
            collectFields(el, out);
          }
        }
      }
    }
    return;
  }

  const name = readStringProperty(literal, "name");
  if (!name) return;
  // Read relationTo (string or array literal). The planner
  // needs name + type and (for relationship fields)
  // relationTo. Other field-type-specific options aren't read.
  const relationTo = readRelationTo(literal);
  // Synthesize a partial NpFieldConfig — `checkThemeRequirements`
  // only reads `name`, `type`, and `relationTo`. The cast is
  // safe inside this CLI-only path; runtime collection configs
  // come from defineCollection() not this synthesizer.
  out.push({
    name,
    type,
    ...(relationTo ? { relationTo } : {}),
  } as unknown as NpFieldConfig);
}

function readRelationTo(
  literal: ObjectLiteralExpression,
): string | string[] | undefined {
  const prop = literal.getProperty("relationTo");
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) return undefined;
  const init = (prop).getInitializer();
  if (!init) return undefined;
  if (init.isKind(SyntaxKind.StringLiteral)) {
    return init.getLiteralValue();
  }
  if (init.isKind(SyntaxKind.ArrayLiteralExpression)) {
    const strings: string[] = [];
    for (const el of init.getElements()) {
      if (el.isKind(SyntaxKind.StringLiteral)) {
        strings.push(el.getLiteralValue());
      }
    }
    return strings.length > 0 ? strings : undefined;
  }
  return undefined;
}
