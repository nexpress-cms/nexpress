import type { NpThemeFieldRequirement } from "@nexpress/core";
import {
  Project,
  SyntaxKind,
  type ObjectLiteralExpression,
  type PropertyAssignment,
} from "ts-morph";

import { renderFieldLiteral } from "./generate-collection.js";

/**
 * Phase F.8-B — AST patcher that adds missing fields to an
 * existing `defineCollection({ ..., fields: [...] })` call.
 *
 * Safety invariants:
 * - **Add-only.** Existing fields are never modified or
 *   removed. Type conflicts on existing fields surface as
 *   blockers in the planner BEFORE the patcher is invoked.
 * - **Idempotent.** A field whose `name` already appears in
 *   the array is skipped — re-running the CLI on the same
 *   spec is a no-op.
 * - **Atomic per file.** Either all requested fields land in
 *   the file or none do (we save once at the end after every
 *   mutation; a thrown error before save leaves the file
 *   untouched).
 * - **Conflict detection.** If we can't find a `fields` array
 *   to patch (file uses a different shape, e.g. `fields` is
 *   computed from a function), we throw and the runner aborts
 *   the whole apply — operator's file won't be partially
 *   modified.
 */

export interface PatchResult {
  filePath: string;
  /** Field names that were appended this run. Empty when the
   *  patch was idempotent or all-fields-already-present. */
  added: string[];
  /** Field names that were already present (idempotent skip). */
  skipped: string[];
}

export interface FieldToPatch {
  name: string;
  requirement: NpThemeFieldRequirement;
}

export class CollectionPatchError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
  ) {
    super(message);
    this.name = "CollectionPatchError";
  }
}

export function patchCollectionFile(
  filePath: string,
  fieldsToAdd: FieldToPatch[],
): PatchResult {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false, noEmit: true },
  });
  const source = project.addSourceFileAtPath(filePath);

  // Locate defineCollection({...}) call's `fields` array.
  let fieldsArray: ReturnType<
    typeof getDefineCollectionFieldsArray
  > = undefined;
  for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "defineCollection") continue;
    fieldsArray = getDefineCollectionFieldsArray(call.getArguments()[0]);
    if (fieldsArray) break;
  }
  if (!fieldsArray) {
    throw new CollectionPatchError(
      `Couldn't find a defineCollection({ fields: [...] }) array in ${filePath}. ` +
        `If your collection computes fields dynamically, add them manually.`,
      filePath,
    );
  }

  const existingNames = collectExistingFieldNames(fieldsArray);
  const added: string[] = [];
  const skipped: string[] = [];
  for (const f of fieldsToAdd) {
    if (existingNames.has(f.name)) {
      // Idempotent: a re-run with the same spec is a no-op
      // for already-present fields. F.1's checkThemeRequirements
      // wouldn't surface these in `missingFields` anyway, but
      // we double-guard at the patcher.
      skipped.push(f.name);
      continue;
    }
    fieldsArray.addElement(renderFieldLiteral(f.name, f.requirement));
    added.push(f.name);
  }

  if (added.length > 0) {
    source.saveSync();
  }
  return { filePath, added, skipped };
}

function getDefineCollectionFieldsArray(
  arg: import("ts-morph").Node | undefined,
): import("ts-morph").ArrayLiteralExpression | undefined {
  if (!arg || !arg.isKind(SyntaxKind.ObjectLiteralExpression)) return undefined;
  const obj = arg as ObjectLiteralExpression;
  const fieldsProp = obj.getProperty("fields");
  if (!fieldsProp || !fieldsProp.isKind(SyntaxKind.PropertyAssignment))
    return undefined;
  const init = (fieldsProp as PropertyAssignment).getInitializer();
  if (!init || !init.isKind(SyntaxKind.ArrayLiteralExpression)) return undefined;
  return init;
}

function collectExistingFieldNames(
  arr: import("ts-morph").ArrayLiteralExpression,
): Set<string> {
  const names = new Set<string>();
  for (const el of arr.getElements()) {
    if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
    walkFieldNames(el, names);
  }
  return names;
}

function walkFieldNames(
  literal: ObjectLiteralExpression,
  out: Set<string>,
): void {
  const typeProp = literal.getProperty("type");
  let typeValue: string | undefined;
  if (typeProp && typeProp.isKind(SyntaxKind.PropertyAssignment)) {
    const init = (typeProp as PropertyAssignment).getInitializer();
    if (init && init.isKind(SyntaxKind.StringLiteral)) {
      typeValue = init.getLiteralValue();
    }
  }

  if (typeValue === "row" || typeValue === "collapsible") {
    const inner = literal.getProperty("fields");
    if (inner && inner.isKind(SyntaxKind.PropertyAssignment)) {
      const init = (inner as PropertyAssignment).getInitializer();
      if (init && init.isKind(SyntaxKind.ArrayLiteralExpression)) {
        for (const el of init.getElements()) {
          if (el.isKind(SyntaxKind.ObjectLiteralExpression)) {
            walkFieldNames(el, out);
          }
        }
      }
    }
    return;
  }

  const nameProp = literal.getProperty("name");
  if (nameProp && nameProp.isKind(SyntaxKind.PropertyAssignment)) {
    const init = (nameProp as PropertyAssignment).getInitializer();
    if (init && init.isKind(SyntaxKind.StringLiteral)) {
      out.add(init.getLiteralValue());
    }
  }
}
