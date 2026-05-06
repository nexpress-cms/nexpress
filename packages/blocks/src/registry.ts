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
import type {
  NpBlockDefinition,
  NpBlockMetadata,
  NpBlockRegistry,
  NpPattern,
} from "./types.js";

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

export const createBlockRegistry = (): NpBlockRegistry => {
  const definitions = new Map<string, NpBlockDefinition>();

  return {
    register(definition) {
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
// `register` overwrites on duplicate `type` instead of throwing —
// loadPlugins runs on every cold boot and HMR refresh, so a strict
// "already registered" error would make the dev loop unusable.
const sharedDefinitions = new Map<string, NpBlockDefinition>();
for (const block of defaultBlocks) sharedDefinitions.set(block.type, block);

const sharedRegistry: NpBlockRegistry = {
  register(definition) {
    sharedDefinitions.set(definition.type, definition);
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
 * Adds a block to the shared registry. Plugins call this (via the
 * bootstrap, not directly) so their blocks appear in the admin
 * Add-block popover and resolve correctly during server render.
 * Overwrites on duplicate `type` — see comment on sharedDefinitions.
 */
export const registerBlock = (definition: NpBlockDefinition): void => {
  sharedRegistry.register(definition);
};

/**
 * Resets the shared block registry to the built-in defaults
 * (issue #477). Called by the bootstrap's `reloadPlugins()` so
 * disabled / removed plugins don't leave their block definitions
 * lingering in the registry — without this, a disabled plugin's
 * block would still appear in the admin's Add-block popover and
 * still resolve during server render after a reload, even though
 * its hooks / routes / actions had been cleared by `resetPlugins()`.
 *
 * Safe to call repeatedly — the bootstrap re-registers every
 * enabled plugin's blocks immediately after, so the registry
 * settles on `defaults + currently-enabled plugin contributions`.
 */
export const resetSharedBlockRegistry = (): void => {
  sharedDefinitions.clear();
  for (const block of defaultBlocks) sharedDefinitions.set(block.type, block);
};

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

/**
 * Adds a pattern to the shared registry. Plugins / themes call
 * this (via the bootstrap, not directly) so their patterns appear
 * in the page-builder's command-menu pattern picker. Overwrites on
 * duplicate `id` so HMR / re-bootstrap don't blow up; the last
 * registration wins, mirroring `registerBlock`.
 */
export const registerPattern = (pattern: NpPattern): void => {
  sharedPatterns.set(pattern.id, pattern);
};

/**
 * Resets the shared pattern registry. Called by the bootstrap's
 * `reloadPlugins()` so disabled / removed plugins don't leave their
 * pattern definitions behind — same invariant as the block registry
 * reset.
 */
export const resetSharedPatternRegistry = (): void => {
  sharedPatterns.clear();
};

/** Returns every pattern in the shared registry — plugin + theme contributions. */
export const getRegisteredPatterns = (): NpPattern[] =>
  Array.from(sharedPatterns.values());
