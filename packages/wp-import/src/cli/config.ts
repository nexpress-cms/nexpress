import { readFileSync } from "node:fs";

import type { CollectionMapping } from "../apply/index.js";

/**
 * Phase 21.9 — parse + validate a wp-import config file.
 *
 * The config is a small JSON document. Example:
 *
 *   {
 *     "mappings": [
 *       { "wpType": "product", "collection": "products" },
 *       {
 *         "wpType": "event",
 *         "collection": "events",
 *         "fieldOverrides": { "_event_date": "eventDate" }
 *       }
 *     ]
 *   }
 *
 * Unknown keys at the top level are ignored so future sub-phases
 * (resume markers, plugin-supplied overrides) can extend the file
 * without breaking older importers.
 */

export interface WpImportConfig {
  collectionMappings: Record<string, CollectionMapping>;
}

export class WpImportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WpImportConfigError";
  }
}

export function loadConfigFromPath(path: string): WpImportConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new WpImportConfigError(
      `cannot read config ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseConfig(raw, path);
}

export function parseConfig(source: string, displayPath = "<inline>"): WpImportConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw new WpImportConfigError(
      `${displayPath}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WpImportConfigError(`${displayPath}: top-level value must be a JSON object`);
  }
  const root = parsed as Record<string, unknown>;
  const mappings = root.mappings;
  const collectionMappings: Record<string, CollectionMapping> = {};
  if (mappings !== undefined) {
    if (!Array.isArray(mappings)) {
      throw new WpImportConfigError(`${displayPath}: "mappings" must be an array`);
    }
    for (const [i, entry] of mappings.entries()) {
      const mapping = parseMapping(entry, `${displayPath}#mappings[${i}]`);
      if (collectionMappings[mapping.wpType]) {
        throw new WpImportConfigError(
          `${displayPath}: duplicate mapping for wpType "${mapping.wpType}"`,
        );
      }
      collectionMappings[mapping.wpType] = {
        collection: mapping.collection,
        fieldOverrides: mapping.fieldOverrides,
      };
    }
  }
  return { collectionMappings };
}

interface ParsedMapping extends CollectionMapping {
  wpType: string;
}

function parseMapping(value: unknown, displayPath: string): ParsedMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WpImportConfigError(`${displayPath}: each mapping must be an object`);
  }
  const row = value as Record<string, unknown>;
  const wpType = row.wpType ?? row.wp_type;
  const collection = row.collection;
  if (typeof wpType !== "string" || wpType.length === 0) {
    throw new WpImportConfigError(
      `${displayPath}: "wpType" is required and must be a non-empty string`,
    );
  }
  if (typeof collection !== "string" || collection.length === 0) {
    throw new WpImportConfigError(
      `${displayPath}: "collection" is required and must be a non-empty string`,
    );
  }
  let fieldOverrides: Record<string, string> | undefined;
  const rawOverrides = row.fieldOverrides ?? row.field_overrides;
  if (rawOverrides !== undefined) {
    if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) {
      throw new WpImportConfigError(`${displayPath}: "fieldOverrides" must be an object`);
    }
    fieldOverrides = {};
    for (const [k, v] of Object.entries(rawOverrides as Record<string, unknown>)) {
      if (typeof v !== "string" || v.length === 0) {
        throw new WpImportConfigError(
          `${displayPath}: fieldOverrides["${k}"] must be a non-empty string`,
        );
      }
      fieldOverrides[k] = v;
    }
  }
  return { wpType, collection, fieldOverrides };
}
