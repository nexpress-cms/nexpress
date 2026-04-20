import type { NxCollectionConfig } from "../config/types.js";

import { NxNotFoundError } from "../errors.js";

export interface CollectionRegistration {
  config: NxCollectionConfig;
  table: unknown;
  childTables?: Record<string, unknown>;
  joinTables?: Record<string, unknown>;
}

const registry = new Map<string, CollectionRegistration>();

export function registerCollection(
  slug: string,
  table: unknown,
  config: NxCollectionConfig,
  opts?: { childTables?: Record<string, unknown>; joinTables?: Record<string, unknown> },
): void {
  registry.set(slug, {
    config,
    table,
    childTables: opts?.childTables,
    joinTables: opts?.joinTables,
  });
}

export function getCollectionConfig(slug: string): NxCollectionConfig {
  return getCollectionRegistration(slug).config;
}

export function getCollectionTable(slug: string): unknown {
  return getCollectionRegistration(slug).table;
}

export function getCollectionRegistration(slug: string): CollectionRegistration {
  const registration = registry.get(slug);

  if (!registration) {
    throw new NxNotFoundError("collection", slug);
  }

  return registration;
}

export function getAllCollectionSlugs(): string[] {
  return [...registry.keys()];
}
