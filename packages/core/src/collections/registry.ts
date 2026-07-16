import type { NpCollectionConfig } from "../config/types.js";
import { NpCollectionContractError } from "../collection-contract/contract.js";

import { NpNotFoundError } from "../errors.js";

export interface CollectionRegistration {
  config: NpCollectionConfig;
  table: unknown;
  childTables?: Record<string, unknown>;
  joinTables?: Record<string, unknown>;
}

const registry = new Map<string, CollectionRegistration>();

export function registerCollection(
  slug: string,
  table: unknown,
  config: NpCollectionConfig,
  opts?: { childTables?: Record<string, unknown>; joinTables?: Record<string, unknown> },
): void {
  const existing = registry.get(slug);
  const related = validateRelatedTables(config, {
    childTables: opts?.childTables ?? existing?.childTables,
    joinTables: opts?.joinTables ?? existing?.joinTables,
  });
  registry.set(slug, {
    config,
    table,
    childTables: related.childTables,
    joinTables: related.joinTables,
  });
}

function validateRelatedTables(
  config: NpCollectionConfig,
  supplied: {
    childTables?: Record<string, unknown>;
    joinTables?: Record<string, unknown>;
  },
): { childTables: Record<string, unknown>; joinTables: Record<string, unknown> } {
  const expectedChildren = new Set<string>();
  const expectedJoins = new Set<string>();
  const collect = (fields: NpCollectionConfig["fields"], prefix: string[]): void => {
    for (const field of fields) {
      if (field.type === "row" || field.type === "collapsible") {
        collect(field.fields, prefix);
      } else if (field.type === "group") {
        collect(field.fields, [...prefix, field.name]);
      } else if (field.type === "array") {
        expectedChildren.add([...prefix, field.name].join("."));
      } else if (field.type === "relationship" && field.hasMany) {
        expectedJoins.add([...prefix, field.name].join("."));
      }
    }
  };
  collect(config.fields, []);
  const childTables = supplied.childTables ?? {};
  const joinTables = supplied.joinTables ?? {};
  const issues = [
    ...relatedTableIssues(expectedChildren, childTables, "childTables"),
    ...relatedTableIssues(expectedJoins, joinTables, "joinTables"),
  ];
  if (issues.length > 0)
    throw new NpCollectionContractError("Invalid collection registration", issues);
  return { childTables, joinTables };
}

function relatedTableIssues(
  expected: ReadonlySet<string>,
  supplied: Readonly<Record<string, unknown>>,
  kind: "childTables" | "joinTables",
): Array<{ code: "invariant" | "unknown-field"; path: string; message: string }> {
  const issues: Array<{
    code: "invariant" | "unknown-field";
    path: string;
    message: string;
  }> = [];
  for (const field of expected) {
    if (
      !Object.hasOwn(supplied, field) ||
      supplied[field] === null ||
      supplied[field] === undefined
    ) {
      issues.push({
        code: "invariant",
        path: `collection.${kind}.${field}`,
        message: "is required.",
      });
    }
  }
  for (const field of Object.keys(supplied)) {
    if (!expected.has(field)) {
      issues.push({
        code: "unknown-field",
        path: `collection.${kind}.${field}`,
        message: "is not declared.",
      });
    }
  }
  return issues;
}

export function getCollectionConfig(slug: string): NpCollectionConfig {
  return getCollectionRegistration(slug).config;
}

export function getCollectionTable(slug: string): unknown {
  return getCollectionRegistration(slug).table;
}

export function getCollectionRegistration(slug: string): CollectionRegistration {
  const registration = registry.get(slug);

  if (!registration) {
    throw new NpNotFoundError("collection", slug);
  }

  return registration;
}

export function getAllCollectionSlugs(): string[] {
  return [...registry.keys()];
}

/** Framework-host lifecycle cleanup. Application code should not call this. */
export function resetCollections(): void {
  registry.clear();
}
