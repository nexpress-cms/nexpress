import type { NpCollectionConfig } from "../config/types.js";

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
  registry.set(slug, {
    config,
    table,
    childTables: opts?.childTables ?? existing?.childTables,
    joinTables: opts?.joinTables ?? existing?.joinTables,
  });
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
