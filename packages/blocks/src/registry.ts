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
import type { NxBlockDefinition, NxBlockRegistry } from "./types.js";

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
] satisfies NxBlockDefinition[];

export const createBlockRegistry = (): NxBlockRegistry => {
  const definitions = new Map<string, NxBlockDefinition>();

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

export const getDefaultBlocks = (): NxBlockDefinition[] => [...defaultBlocks];
