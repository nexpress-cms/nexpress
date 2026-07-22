import {
  contactFormBlock,
  ctaBlock,
  faqBlock,
  featureGridBlock,
  gridBlock,
  heroBlock,
  imageGalleryBlock,
  logosCloudBlock,
  pricingBlock,
  richTextBlock,
  sectionHeaderBlock,
  statsGridBlock,
  tabsBlock,
  testimonialsBlock,
} from "./blocks/index.js";
import { npValidateBlockDefinition } from "./block-contract.js";
import { npAnalyzeBlockContent } from "./content-contract.js";
import { npAnalyzePatternDefinitions, npValidatePattern } from "./pattern-contract.js";
import type { NpBlockDefinition, NpBlockMetadata, NpBlockRegistry, NpPattern } from "./types.js";

const defaultBlocks = [
  // Layout containers first — operators looking to compose a page
  // typically reach for these before any leaf block.
  gridBlock,
  // Section primitives — the building-block intros and trust strips
  // most landing pages reach for next.
  sectionHeaderBlock,
  heroBlock,
  featureGridBlock,
  testimonialsBlock,
  statsGridBlock,
  logosCloudBlock,
  tabsBlock,
  faqBlock,
  pricingBlock,
  ctaBlock,
  richTextBlock,
  contactFormBlock,
  imageGalleryBlock,
] satisfies NpBlockDefinition[];

function assertValidBlockDefinition(definition: unknown): asserts definition is NpBlockDefinition {
  const validation = npValidateBlockDefinition(definition);
  if (!validation.ok) throw new Error(`Invalid block definition: ${validation.message}`);
}

for (const block of defaultBlocks) assertValidBlockDefinition(block);

export const createBlockRegistry = (): NpBlockRegistry => {
  const definitions = new Map<string, NpBlockDefinition>();

  return {
    register(definition) {
      assertValidBlockDefinition(definition);
      if (definitions.has(definition.type)) {
        throw new Error(`Block type "${definition.type}" is already registered.`);
      }

      definitions.set(definition.type, definition);
    },
    get(type) {
      return definitions.get(type);
    },
    getAll() {
      return Array.from(definitions.values());
    },
    has(type) {
      return definitions.has(type);
    },
  };
};

export const getDefaultBlocks = (): NpBlockDefinition[] => [...defaultBlocks];

// Module-scoped singleton registry shared by `renderBlocks` (server)
// and the admin's block picker (client). Seeded with the built-in
// defaults; plugins push more via `registerBlock` at boot time
// (see bootstrap.ts in @nexpress/next). The shared registry's
// `register` keeps registration-order candidates per contributor while its
// legacy global view remains last-loaded-wins. The candidate history lets a
// site where the last owner is inactive fall back to an earlier active owner.
const sharedDefinitions = new Map<string, NpBlockDefinition>();
const sharedDefinitionCandidates = new Map<string, NpBlockDefinition[]>();

function blockSourceKey(definition: NpBlockDefinition): string {
  return definition.source ?? "core";
}

function storeSharedDefinition(definition: NpBlockDefinition): void {
  const candidates = sharedDefinitionCandidates.get(definition.type) ?? [];
  const sourceKey = blockSourceKey(definition);
  const existingIndex = candidates.findIndex(
    (candidate) => blockSourceKey(candidate) === sourceKey,
  );
  if (existingIndex !== -1) candidates.splice(existingIndex, 1);
  candidates.push(definition);
  sharedDefinitionCandidates.set(definition.type, candidates);
  sharedDefinitions.set(definition.type, candidates[candidates.length - 1]);
}

for (const block of defaultBlocks) storeSharedDefinition(block);

const sharedRegistry: NpBlockRegistry = {
  register(definition) {
    assertValidBlockDefinition(definition);
    detectAndWarnBlockCollision(sharedDefinitions.get(definition.type), definition);
    storeSharedDefinition(definition);
  },
  get(type) {
    return sharedDefinitions.get(type);
  },
  getAll() {
    return Array.from(sharedDefinitions.values());
  },
  has(type) {
    return sharedDefinitions.has(type);
  },
};

/**
 * Warn when a block registration overwrites an existing entry
 * from a DIFFERENT contributor.
 *
 * Allowed (no warning):
 *   - First registration (no existing entry)
 *   - Same source registering same type again (HMR / re-boot)
 *   - Built-in default getting overridden (intentional override
 *     by theme/plugin; existing source is undefined or "core" /
 *     "built-in")
 *
 * Warned (collision):
 *   - Two different non-default sources register the same type.
 *     Last-loaded still wins (registry's append-only contract);
 *     warning fires once per type per process so dev consoles
 *     don't spam.
 */
const warnedBlockTypes = new Set<string>();

/** Test hook — resets the per-process dedup set. */
export function __resetBlockCollisionWarnings(): void {
  warnedBlockTypes.clear();
}

function isBuiltInSource(source: NpBlockDefinition["source"]): boolean {
  return !source || source === "core" || source === "built-in";
}

function detectAndWarnBlockCollision(
  existing: NpBlockDefinition | undefined,
  incoming: NpBlockDefinition,
): void {
  if (!existing) return;
  if (existing.source === incoming.source) return;
  if (isBuiltInSource(existing.source)) return;
  if (warnedBlockTypes.has(incoming.type)) return;
  warnedBlockTypes.add(incoming.type);

  console.warn(
    `[nexpress/blocks] block type "${incoming.type}" registered by ` +
      `"${incoming.source ?? "(no source)"}" is overwriting an earlier ` +
      `registration from "${existing.source ?? "(no source)"}". Last-loaded ` +
      `wins; consider namespacing block types with the contributor id ` +
      `(e.g. "magazine.hero" instead of "hero") to avoid the conflict.`,
  );
}

/**
 * Adds a block to the shared registry. Plugins call this (via the
 * bootstrap, not directly) so their blocks appear in the admin
 * Add-block popover and resolve correctly during server render.
 * Retains duplicate cross-source candidates — see comment on
 * sharedDefinitions. The legacy global registry still resolves the last one.
 */
export const registerBlock = (definition: NpBlockDefinition): void => {
  sharedRegistry.register(definition);
};

/**
 * Resets the shared block registry to the built-in defaults
 * (issue #477). Called by the bootstrap's `reloadPlugins()` so
 * removed plugins don't leave their block definitions lingering in the
 * registry. Site activation itself is applied at read/render time and does
 * not require a reload.
 *
 * Safe to call repeatedly — the bootstrap re-registers every
 * configured plugin's blocks immediately after, so the registry settles on
 * `defaults + configured plugin contributions`.
 */
export const resetSharedBlockRegistry = (): void => {
  sharedDefinitions.clear();
  sharedDefinitionCandidates.clear();
  for (const block of defaultBlocks) storeSharedDefinition(block);
};

/** Internal activation view: registration-order candidates for each block type. */
export const getSharedBlockCandidates = (): ReadonlyMap<string, readonly NpBlockDefinition[]> =>
  sharedDefinitionCandidates;

/** Returns every block in the shared registry — defaults + plugin contributions. */
export const getRegisteredBlocks = (): NpBlockDefinition[] => sharedRegistry.getAll();

/**
 * Serializable metadata for every block in the shared registry —
 * `NpBlockDefinition` minus the `render` function. The admin
 * fetches this server-side and threads it through to the (client-
 * side) page-builder editor; functions can't cross the boundary,
 * and the editor never invokes `render` anyway.
 */
export const getRegisteredBlockMetadata = (): NpBlockMetadata[] =>
  sharedRegistry.getAll().map((definition) => {
    const { render: _render, ...metadata } = definition;
    void _render;
    return metadata;
  });

/** Internal: returns the shared registry. Used by `renderBlocks`. */
export const getSharedRegistry = (): NpBlockRegistry => sharedRegistry;

// ----------------------------------------------------------------
// Pattern registry — sister to the block registry. Plugins / themes
// register pre-shaped subtrees (`NpPattern`) at boot via the next.js
// bootstrap, and the admin reads them through the registry-context
// alongside block metadata. Operator-saved patterns
// (localStorage / np_settings) bypass this registry — they're
// scoped per browser / site, not per process.
// ----------------------------------------------------------------

const sharedPatterns = new Map<string, NpPattern>();
const sharedPatternCandidates = new Map<string, NpPattern[]>();

function patternSourceKey(pattern: NpPattern): string {
  return pattern.source;
}

function storeSharedPattern(pattern: NpPattern): void {
  const candidates = sharedPatternCandidates.get(pattern.id) ?? [];
  const sourceKey = patternSourceKey(pattern);
  const existingIndex = candidates.findIndex(
    (candidate) => patternSourceKey(candidate) === sourceKey,
  );
  if (existingIndex !== -1) candidates.splice(existingIndex, 1);
  candidates.push(pattern);
  sharedPatternCandidates.set(pattern.id, candidates);
  sharedPatterns.set(pattern.id, candidates[candidates.length - 1]);
}

function assertValidPattern(pattern: unknown): asserts pattern is NpPattern {
  const validation = npValidatePattern(pattern);
  if (!validation.ok) throw new Error(`Invalid pattern definition: ${validation.message}`);
  const validPattern = pattern as NpPattern;
  const patternSource = validPattern.source;
  const sourceDefinitions = [...sharedDefinitionCandidates.values()].map(
    (candidates) =>
      [...candidates]
        .reverse()
        .find((definition) => blockSourceKey(definition) === patternSource) ??
      candidates[candidates.length - 1],
  );
  const referenceIssue = npAnalyzePatternDefinitions([pattern], {
    knownBlockTypes: new Set(sourceDefinitions.map((definition) => definition.type)),
  }).find((issue) => issue.code === "unknown-block-type");
  if (referenceIssue) throw new Error(`Invalid pattern definition: ${referenceIssue.message}`);
  const contentIssue = npAnalyzeBlockContent(validPattern.blocks, sourceDefinitions).find(
    (issue) => issue.severity === "error",
  );
  if (contentIssue) throw new Error(`Invalid pattern definition: ${contentIssue.message}`);
}

/**
 * Same collision-warning policy for patterns.
 * Last-loaded still wins; warning fires once per id per process
 * when two different non-default sources register the same id.
 */
const warnedPatternIds = new Set<string>();

/** Test hook — resets the per-process dedup set. */
export function __resetPatternCollisionWarnings(): void {
  warnedPatternIds.clear();
}

function isBuiltInPatternSource(source: NpPattern["source"]): boolean {
  return source === "built-in" || source === "core";
}

function detectAndWarnPatternCollision(existing: NpPattern | undefined, incoming: NpPattern): void {
  if (!existing) return;
  if (existing.source === incoming.source) return;
  if (isBuiltInPatternSource(existing.source)) return;
  if (warnedPatternIds.has(incoming.id)) return;
  warnedPatternIds.add(incoming.id);

  console.warn(
    `[nexpress/blocks] pattern id "${incoming.id}" registered by ` +
      `"${incoming.source}" is overwriting an earlier registration from ` +
      `"${existing.source}". Last-loaded wins; namespace pattern ids by ` +
      `contributor (e.g. "magazine.hero-grid") to avoid the conflict.`,
  );
}

/**
 * Adds a pattern to the shared registry. Plugins / themes call this (via the
 * bootstrap, not directly) so their patterns appear in the page-builder's
 * command-menu pattern picker. Cross-source candidates are retained for
 * site-specific fallback while the legacy global view remains last-loaded.
 */
export const registerPattern = (pattern: NpPattern): void => {
  assertValidPattern(pattern);
  detectAndWarnPatternCollision(sharedPatterns.get(pattern.id), pattern);
  storeSharedPattern(pattern);
};

/**
 * Resets the shared pattern registry. Called by the bootstrap's
 * `reloadPlugins()` so removed/config-changed contributions are rebuilt —
 * same invariant as the block registry reset.
 */
export const resetSharedPatternRegistry = (): void => {
  sharedPatterns.clear();
  sharedPatternCandidates.clear();
};

/** Internal activation view: registration-order candidates for each pattern id. */
export const getSharedPatternCandidates = (): ReadonlyMap<string, readonly NpPattern[]> =>
  sharedPatternCandidates;

/** Returns every pattern in the shared registry — plugin + theme contributions. */
export const getRegisteredPatterns = (): NpPattern[] => Array.from(sharedPatterns.values());
