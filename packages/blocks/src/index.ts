export type {
  NpBlockDefinition,
  NpBlockMetadata,
  NpBlockPropField,
  NpBlockInstance,
  NpBlockRegistration,
  NpBlockRegistry,
  NpBlockRenderContext,
  NpPageBlocks,
  NpDataBinding,
  NpPattern,
} from "./types.js";
export {
  npAnalyzeBlockDefinitions,
  npBlockPropFieldTypes,
  npValidateBlockDefinition,
} from "./block-contract.js";
export type {
  NpBlockDefinitionIssue,
  NpBlockDefinitionIssueCode,
  NpBlockDefinitionValidationResult,
  NpBlockPropFieldType,
} from "./block-contract.js";
export {
  createBlockRegistry,
  getDefaultBlocks,
  getRegisteredBlockMetadata,
  getRegisteredBlocks,
  getRegisteredPatterns,
  getSharedRegistry,
  registerBlock,
  registerPattern,
  resetSharedBlockRegistry,
  resetSharedPatternRegistry,
} from "./registry.js";
export { renderBlocks } from "./render-blocks.js";
export type { NpRenderBlocksOptions } from "./render-blocks.js";

export {
  parseBlockSource,
  isBlockSourceActive,
  getRegisteredBlocksForActiveSources,
  getRegisteredBlockMetadataForActiveSources,
  getRegisteredPatternsForActiveSources,
  type NpBlockSource,
  type NpActiveSourceContext,
} from "./source.js";
