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
  NpPatternDefinition,
  NpPattern,
  NpPatternSource,
} from "./types.js";
export {
  isNpBlockContent,
  npValidateBlockContent,
  type NpBlockContent,
  type NpBlockContentValidationResult,
} from "@nexpress/core/fields";
export {
  npAnalyzeBlockDefinitions,
  npBlockPropFieldTypes,
  npValidateBlockDefinition,
} from "./block-contract.js";
export {
  npAnalyzeBlockContent,
  npAnalyzeBlockProps,
  npValidateBlockContentAgainstDefinitions,
  type NpBlockContentContractResult,
  type NpBlockContentIssue,
  type NpBlockContentIssueCode,
  type NpBlockContentIssueSeverity,
} from "./content-contract.js";
export {
  npAnalyzePatternDefinitions,
  npValidatePattern,
  npValidatePatternDefinition,
} from "./pattern-contract.js";
export type {
  NpPatternDefinitionAnalysisOptions,
  NpPatternDefinitionIssue,
  NpPatternDefinitionIssueCode,
  NpPatternDefinitionValidationResult,
} from "./pattern-contract.js";
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
