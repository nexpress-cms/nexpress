import {
  Project,
  SyntaxKind,
  type ArrayLiteralExpression,
  type Node,
  type ObjectLiteralExpression,
} from "ts-morph";

/**
 * F.8 — AST unpatcher: removes named fields from an existing
 * `defineCollection({ ..., fields: [...] })` call.
 *
 * Mirrors `patch-collection.ts`'s safety invariants:
 *
 * - **Remove-only.** Existing fields not in the removal list are
 *   left untouched. Computed / spread / non-literal fields are
 *   never matched (we only remove fields whose `name` is a
 *   string literal we recognize).
 * - **Idempotent.** A field already absent is a silent skip,
 *   not an error — re-running uninstall on a partially-cleaned
 *   collection works.
 * - **Atomic per file.** All matched fields removed in one pass
 *   followed by a single save. A thrown error before save
 *   leaves the file untouched.
 * - **Conflict detection.** If we can't find a `fields` array
 *   to unpatch (file uses a different shape, e.g. `fields` is
 *   computed from a function), we throw — the runner aborts so
 *   the operator's file isn't half-modified.
 *
 * Containerized fields (`row` / `collapsible`) are walked
 * recursively to reach inner field names — same rule as the
 * patcher's `walkFieldNames`. A removal targeting a field nested
 * inside a `row` removes ONLY that field, not the row itself
 * (the row is operator-authored layout; we don't make
 * assumptions about its other children).
 */

export interface UnpatchResult {
  filePath: string;
  /** Field names that were removed this run. */
  removed: string[];
  /** Field names that weren't found (idempotent skip). */
  skipped: string[];
}

export class CollectionUnpatchError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
  ) {
    super(message);
    this.name = "CollectionUnpatchError";
  }
}

export function unpatchCollectionFile(
  filePath: string,
  fieldNamesToRemove: string[],
): UnpatchResult {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false, noEmit: true },
  });
  const source = project.addSourceFileAtPath(filePath);

  let fieldsArray: ArrayLiteralExpression | undefined;
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "defineCollection") continue;
    fieldsArray = getDefineCollectionFieldsArray(call.getArguments()[0]);
    if (fieldsArray) break;
  }
  if (!fieldsArray) {
    throw new CollectionUnpatchError(
      `Couldn't find a defineCollection({ fields: [...] }) array in ${filePath}. ` +
        `If your collection computes fields dynamically, remove them manually.`,
      filePath,
    );
  }

  const removeSet = new Set(fieldNamesToRemove);
  const removed: string[] = [];
  removeAllMatching(fieldsArray, removeSet, removed);

  const skipped = fieldNamesToRemove.filter((n) => !removed.includes(n));

  if (removed.length > 0) {
    source.saveSync();
  }
  return { filePath, removed, skipped };
}

/**
 * Walk an array of field literals top-down. Direct hits drop
 * the element from the array. `row` / `collapsible` containers
 * recurse into their nested `fields` arrays — a field declared
 * inside a row still gets removed, but the row itself stays
 * (we don't second-guess operator's layout choices).
 */
function removeAllMatching(
  arr: ArrayLiteralExpression,
  removeSet: Set<string>,
  removed: string[],
): void {
  // Iterate by index in reverse so `removeElement` doesn't
  // shift unprocessed indices.
  for (let i = arr.getElements().length - 1; i >= 0; i -= 1) {
    const el = arr.getElements()[i];
    if (!el || !el.isKind(SyntaxKind.ObjectLiteralExpression)) continue;

    const typeValue = readStringProp(el, "type");
    if (typeValue === "row" || typeValue === "collapsible") {
      const innerArr = readArrayProp(el, "fields");
      if (innerArr) {
        removeAllMatching(innerArr, removeSet, removed);
      }
      continue;
    }

    const name = readStringProp(el, "name");
    if (name !== undefined && removeSet.has(name)) {
      arr.removeElement(i);
      removed.push(name);
    }
  }
}

function getDefineCollectionFieldsArray(
  arg: Node | undefined,
): ArrayLiteralExpression | undefined {
  if (!arg || !arg.isKind(SyntaxKind.ObjectLiteralExpression)) return undefined;
  const fieldsProp = arg.getProperty("fields");
  if (!fieldsProp || !fieldsProp.isKind(SyntaxKind.PropertyAssignment))
    return undefined;
  const init = fieldsProp.getInitializer();
  if (!init || !init.isKind(SyntaxKind.ArrayLiteralExpression)) return undefined;
  return init;
}

function readStringProp(
  literal: ObjectLiteralExpression,
  key: string,
): string | undefined {
  const prop = literal.getProperty(key);
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) return undefined;
  const init = prop.getInitializer();
  if (!init || !init.isKind(SyntaxKind.StringLiteral)) return undefined;
  return init.getLiteralValue();
}

function readArrayProp(
  literal: ObjectLiteralExpression,
  key: string,
): ArrayLiteralExpression | undefined {
  const prop = literal.getProperty(key);
  if (!prop || !prop.isKind(SyntaxKind.PropertyAssignment)) return undefined;
  const init = prop.getInitializer();
  if (!init || !init.isKind(SyntaxKind.ArrayLiteralExpression)) return undefined;
  return init;
}
