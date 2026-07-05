import type { NpBlockMetadata } from "@nexpress/blocks";

export const DEFAULT_RECOMMENDED_STARTER_TYPES = [
  "hero",
  "rich-text",
  "section-header",
  "feature-grid",
] as const;

export interface PickRecommendedStarterBlocksOptions {
  definitions: ReadonlyMap<string, NpBlockMetadata>;
  availableBlocks: readonly NpBlockMetadata[];
  preferredTypes?: readonly string[];
  limit?: number;
}

/**
 * Shared empty-state starter picker for the row-card Page builder
 * and Document view. Preferred blocks are registered-type aware;
 * fallback choices skip containers so an empty page does not start
 * with a layout shell that still needs a child before it renders usefully.
 */
export function pickRecommendedStarterBlocks({
  definitions,
  availableBlocks,
  preferredTypes = DEFAULT_RECOMMENDED_STARTER_TYPES,
  limit = 4,
}: PickRecommendedStarterBlocksOptions): NpBlockMetadata[] {
  const starters: NpBlockMetadata[] = [];

  const pushIfNew = (definition: NpBlockMetadata): void => {
    if (starters.some((starter) => starter.type === definition.type)) return;
    starters.push(definition);
  };

  for (const type of preferredTypes) {
    const definition = definitions.get(type);
    if (definition) pushIfNew(definition);
    if (starters.length >= limit) return starters;
  }

  for (const definition of availableBlocks) {
    if (definition.acceptsChildren) continue;
    pushIfNew(definition);
    if (starters.length >= limit) return starters;
  }

  return starters;
}
