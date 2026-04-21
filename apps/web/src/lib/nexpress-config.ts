import type { NxConfig } from "@nexpress/core";

import nexpressConfig from "@/nexpress.config";
import * as generatedSchema from "@/db/generated/collections";

export const config: NxConfig = nexpressConfig;

export const collections = config.collections;
export const plugins = config.plugins ?? [];

function toCamelCase(slug: string): string {
  return slug.replace(/[-_](.)/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Looks up the generated Drizzle table for a collection by slug.
 * `generate-schema.ts` emits tables named `${camelCase(slug)}Table` into
 * `@/db/generated/collections` — this resolver converts the slug back and
 * pulls the matching export, so consumers don't need a hand-maintained map.
 */
export function getGeneratedTable(slug: string): unknown {
  const identifier = `${toCamelCase(slug)}Table`;
  const exportsMap = generatedSchema as Record<string, unknown>;
  const table = exportsMap[identifier];

  if (!table) {
    throw new Error(
      `Collection "${slug}" has no matching generated Drizzle table. ` +
        `Expected export \`${identifier}\` from @/db/generated/collections. ` +
        `Did you run \`pnpm db:generate\` after adding the collection?`,
    );
  }

  return table;
}
