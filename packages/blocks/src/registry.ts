import {
  contactFormBlock,
  ctaBlock,
  faqBlock,
  featureGridBlock,
  gridBlock,
  heroBlock,
  imageGalleryBlock,
  pricingBlock,
  richTextBlock,
} from "./blocks/index.js";
import type { NpBlockDefinition, NpBlockMetadata, NpBlockRegistry } from "./types.js";

const defaultBlocks = [
  // Layout containers first — operators looking to compose a page
  // typically reach for these before any leaf block.
  gridBlock,
  heroBlock,
  featureGridBlock,
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
