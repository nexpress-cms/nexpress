import { requireArtifact, analyzeArtifact as analyze } from "./artifact.js";
import {
  npRequireAgentBuildCommandRegistryV1,
  type NpAgentBuildCommandRegistryV1,
} from "./command-registry.js";
import {
  npRequireAgentBuildRenderEnvironmentV1,
  type NpAgentBuildRenderEnvironmentV1,
} from "./render-environment.js";
import {
  npRequireAgentBuildVerificationResultBodyV1,
  npRequireAgentBuildVerificationResultV1,
  npRequireAgentBuildVerificationObservationV1,
  type NpAgentBuildVerificationResultBodyV1,
  type NpAgentBuildVerificationResultV1,
  type NpAgentBuildVerificationObservationV1,
} from "./verification-result.js";
import {
  npRequireAgentBuildDirectionRendererV1,
  type NpAgentBuildDirectionRendererV1,
} from "./renderer-inventory.js";
import {
  npRequireAgentBuildCollectionDefinitionV1,
  type NpAgentBuildCollectionDefinitionV1,
} from "./collection-definition.js";
import type { NpAgentContractResult } from "../agent-contract/types.js";
import {
  briefSchema,
  blueprintSchema,
  promptSchema,
  outputSchema,
  sourceTreeSchema,
  buildNavigationSchema,
  buildSeedPlanSchema,
} from "./schemas.js";
import { encoder, fail, inspectJson, npParseBuildJsonV1, serializeJson } from "./primitives.js";
import type {
  NpAgentSiteBriefV1,
  NpAgentSiteBlueprintV1,
  NpAgentGeneratedMediaPromptV1,
  NpAgentBuildSourceTreeV1,
  NpAgentBuildCommandOutputV1,
  NpAgentBlueprintSeedPlan,
  NpAgentBlueprintNavigation,
} from "./types.js";
import type {
  NpAgentDesignComparisonInputsV1,
  NpAgentDesignDirectionProjectionV1,
  NpAgentDesignDirectionV1,
  NpAgentDesignDirectionSetV1,
  NpAgentDirectionRenderSourceV1,
  NpAgentDirectionRenderReceiptBodyV1,
} from "./direction-types.js";
import {
  comparisonSchema,
  projectionSchema,
  directionSchema,
  directionSetSchema,
  draftSetSchema,
  draftDirectionSchema,
  renderSourceSchema,
  renderReceiptSchema,
  renderReceiptRecordSchema,
} from "./direction-schemas.js";

export const npBuildCanonicalPurposes = Object.freeze([
  "np.build-site-brief.v1",
  "np.build-design-comparison-inputs.v1",
  "np.build-design-direction-projection.v1",
  "np.build-design-direction.v1",
  "np.build-design-direction-set.v1",
  "np.build-site-blueprint.v1",
  "np.build-collection-definition.v1",
  "np.build-generated-media-prompt.v1",
  "np.build-command-registry.v1",
  "np.build-direction-renderer.v1",
  "np.build-render-environment.v1",
  "np.build-direction-render-source.v1",
  "np.build-direction-render-receipt.v1",
  "np.build-command-output.v1",
  "np.build-verification-result.v1",
  "np.build-source-tree.v1",
] as const);
export type NpBuildCanonicalPurposeV1 = (typeof npBuildCanonicalPurposes)[number];
export const npBuildFilePurposes = Object.freeze([
  "np.build-source-file.v1",
  "np.build-staged-artifact.v1",
  "np.build-preview-artifact.v1",
  "np.build-verification-artifact.v1",
] as const);
export type NpBuildFilePurposeV1 = (typeof npBuildFilePurposes)[number];

export interface NpBuildCanonicalBodiesV1 {
  "np.build-site-brief.v1": NpAgentSiteBriefV1;
  "np.build-design-comparison-inputs.v1": NpAgentDesignComparisonInputsV1;
  "np.build-design-direction-projection.v1": NpAgentDesignDirectionProjectionV1;
  "np.build-design-direction.v1": NpAgentDesignDirectionV1;
  "np.build-design-direction-set.v1": NpAgentDesignDirectionSetV1;
  "np.build-direction-render-source.v1": NpAgentDirectionRenderSourceV1;
  "np.build-direction-render-receipt.v1": NpAgentDirectionRenderReceiptBodyV1;
  "np.build-site-blueprint.v1": NpAgentSiteBlueprintV1;
  "np.build-collection-definition.v1": NpAgentBuildCollectionDefinitionV1;
  "np.build-direction-renderer.v1": NpAgentBuildDirectionRendererV1;
  "np.build-command-registry.v1": NpAgentBuildCommandRegistryV1;
  "np.build-render-environment.v1": NpAgentBuildRenderEnvironmentV1;
  "np.build-verification-result.v1": NpAgentBuildVerificationResultBodyV1;
  "np.build-generated-media-prompt.v1": NpAgentGeneratedMediaPromptV1;
  "np.build-command-output.v1": NpAgentBuildCommandOutputV1;
  "np.build-source-tree.v1": NpAgentBuildSourceTreeV1;
}
export type NpBuildImplementedCanonicalPurposeV1 = keyof NpBuildCanonicalBodiesV1;

export const npBuildContractLimitsV1 = Object.freeze({
  brief: Object.freeze({ bytes: 512 * 1024, depth: 8 }),
  blueprint: Object.freeze({ bytes: 4 * 1024 * 1024, depth: 16 }),
  prompt: Object.freeze({ bytes: 64 * 1024, depth: 4 }),
  output: Object.freeze({ bytes: 704 * 1024, depth: 3 }),
  sourceTree: Object.freeze({ bytes: 4 * 1024 * 1024, depth: 4 }),
});
export const npBuildDirectionLimitsV1 = Object.freeze({
  comparison: Object.freeze({ bytes: 1024 * 1024, depth: 16 }),
  direction: Object.freeze({ bytes: 1024 * 1024, depth: 20 }),
  set: Object.freeze({ bytes: 4 * 1024 * 1024, depth: 22 }),
  source: Object.freeze({ bytes: 2 * 1024 * 1024, depth: 22 }),
  receipt: Object.freeze({ bytes: 32 * 1024, depth: 5 }),
});
/** Structure only: even a sealed-set parser does not authenticate a renderer or observe files. */
export const npRequireAgentDesignComparisonInputsV1 = (value: unknown) =>
  requireArtifact(value, comparisonSchema, npBuildDirectionLimitsV1.comparison);
export const npRequireAgentDesignDirectionProjectionV1 = (value: unknown) =>
  requireArtifact(value, projectionSchema, npBuildDirectionLimitsV1.direction);
export const npRequireAgentDesignDirectionV1 = (value: unknown) =>
  requireArtifact(value, directionSchema, npBuildDirectionLimitsV1.direction);
export const npRequireAgentDesignDirectionDraftV1 = (value: unknown) =>
  requireArtifact(value, draftDirectionSchema, npBuildDirectionLimitsV1.direction);
export const npRequireAgentDesignDirectionSetV1 = (value: unknown) =>
  requireArtifact(value, directionSetSchema, npBuildDirectionLimitsV1.set);
export const npRequireAgentDesignDirectionDraftSetV1 = (value: unknown) =>
  requireArtifact(value, draftSetSchema, npBuildDirectionLimitsV1.set);
export const npRequireAgentDirectionRenderSourceV1 = (value: unknown) =>
  requireArtifact(value, renderSourceSchema, npBuildDirectionLimitsV1.source);
export const npRequireAgentDirectionRenderReceiptBodyV1 = (value: unknown) =>
  requireArtifact(value, renderReceiptSchema, npBuildDirectionLimitsV1.receipt);
export const npRequireAgentDirectionRenderReceiptRecordV1 = (value: unknown) =>
  requireArtifact(value, renderReceiptRecordSchema, npBuildDirectionLimitsV1.receipt);

export const npRequireAgentSiteBriefV1 = (value: unknown): NpAgentSiteBriefV1 =>
  requireArtifact(value, briefSchema, npBuildContractLimitsV1.brief);
/** This conservatively requires all questions resolved; prose cannot establish model readiness. */
export function npRequireBuildReadyBriefV1(value: unknown): NpAgentSiteBriefV1 {
  const brief = npRequireAgentSiteBriefV1(value);
  if (brief.unresolved.length)
    fail("build.brief.unresolved", "resolve outstanding questions before blueprint generation");
  return brief;
}
export const npAnalyzeAgentSiteBriefV1 = (
  value: unknown,
): NpAgentContractResult<NpAgentSiteBriefV1> => analyze(() => npRequireAgentSiteBriefV1(value));
/** Format/graph validation only. Live discovery, source bytes and renderer validation belong to the CLI. */
export const npRequireAgentSiteBlueprintV1 = (value: unknown): NpAgentSiteBlueprintV1 =>
  requireArtifact(value, blueprintSchema, npBuildContractLimitsV1.blueprint);
/** Existing blueprint fragments for ordinary repository seed artifacts. No execution authority. */
export const npRequireAgentBuildSeedPlanV1 = (value: unknown): NpAgentBlueprintSeedPlan =>
  requireArtifact(value, buildSeedPlanSchema, npBuildContractLimitsV1.blueprint);
export const npRequireAgentBuildNavigationV1 = (value: unknown): NpAgentBlueprintNavigation =>
  requireArtifact(value, buildNavigationSchema, npBuildContractLimitsV1.blueprint);
export const npAnalyzeAgentSiteBlueprintV1 = (
  value: unknown,
): NpAgentContractResult<NpAgentSiteBlueprintV1> =>
  analyze(() => npRequireAgentSiteBlueprintV1(value));
export const npRequireAgentGeneratedMediaPromptV1 = (
  value: unknown,
): NpAgentGeneratedMediaPromptV1 =>
  requireArtifact(value, promptSchema, npBuildContractLimitsV1.prompt);
export const npRequireAgentBuildCommandOutputV1 = (value: unknown): NpAgentBuildCommandOutputV1 =>
  requireArtifact(value, outputSchema, npBuildContractLimitsV1.output);
/** A parsed manifest is not evidence that a filesystem reader observed regular, stable files. */
export const npRequireAgentBuildSourceTreeV1 = (value: unknown): NpAgentBuildSourceTreeV1 =>
  requireArtifact(value, sourceTreeSchema, npBuildContractLimitsV1.sourceTree);
export const npParseAgentSiteBriefV1 = (raw: string): NpAgentSiteBriefV1 =>
  npRequireAgentSiteBriefV1(npParseBuildJsonV1(raw));
export const npParseAgentSiteBlueprintV1 = (raw: string): NpAgentSiteBlueprintV1 =>
  npRequireAgentSiteBlueprintV1(npParseBuildJsonV1(raw));

/** Every purpose dispatches to its exact owning artifact contract. */
export const npBuildCanonicalBodyValidatorsV1 = Object.freeze({
  "np.build-site-brief.v1": npRequireAgentSiteBriefV1,
  "np.build-design-comparison-inputs.v1": npRequireAgentDesignComparisonInputsV1,
  "np.build-design-direction-projection.v1": npRequireAgentDesignDirectionProjectionV1,
  "np.build-design-direction.v1": npRequireAgentDesignDirectionV1,
  "np.build-design-direction-set.v1": npRequireAgentDesignDirectionSetV1,
  "np.build-site-blueprint.v1": npRequireAgentSiteBlueprintV1,
  "np.build-collection-definition.v1": npRequireAgentBuildCollectionDefinitionV1,
  "np.build-generated-media-prompt.v1": npRequireAgentGeneratedMediaPromptV1,
  "np.build-command-registry.v1": npRequireAgentBuildCommandRegistryV1,
  "np.build-direction-renderer.v1": npRequireAgentBuildDirectionRendererV1,
  "np.build-render-environment.v1": npRequireAgentBuildRenderEnvironmentV1,
  "np.build-direction-render-source.v1": npRequireAgentDirectionRenderSourceV1,
  "np.build-direction-render-receipt.v1": npRequireAgentDirectionRenderReceiptBodyV1,
  "np.build-command-output.v1": npRequireAgentBuildCommandOutputV1,
  "np.build-verification-result.v1": npRequireAgentBuildVerificationResultBodyV1,
  "np.build-source-tree.v1": npRequireAgentBuildSourceTreeV1,
} satisfies Record<NpBuildCanonicalPurposeV1, (value: unknown) => object>);

export interface NpBuildCanonicalBytesV1<P extends NpBuildImplementedCanonicalPurposeV1> {
  purpose: P;
  body: NpBuildCanonicalBodiesV1[P];
  canonicalJsonUtf8: Uint8Array;
  domainSeparatedUtf8: Uint8Array;
}
function concatenate(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
export function npBuildCanonicalBytes<P extends NpBuildImplementedCanonicalPurposeV1>(
  purpose: P,
  value: unknown,
): NpBuildCanonicalBytesV1<P> {
  if (!Object.hasOwn(npBuildCanonicalBodyValidatorsV1, purpose))
    fail("build.purpose", "unknown canonical purpose");
  const validator = npBuildCanonicalBodyValidatorsV1[purpose];
  if (!validator) fail("build.purpose", "artifact owner not implemented for this reserved purpose");
  // Dispatch owns the body type; callers cannot select a schema or supply arbitrary canonical JSON.
  const body = validator(value) as NpBuildCanonicalBodiesV1[P];
  const depth =
    purpose === "np.build-design-direction-set.v1"
      ? npBuildDirectionLimitsV1.set.depth
      : purpose === "np.build-direction-render-source.v1"
        ? npBuildDirectionLimitsV1.source.depth
        : purpose === "np.build-design-direction.v1" ||
            purpose === "np.build-design-direction-projection.v1"
          ? npBuildDirectionLimitsV1.direction.depth
          : 16;
  const json = serializeJson(inspectJson(body, 4 * 1024 * 1024, depth));
  const canonicalJsonUtf8 = encoder.encode(json);
  return {
    purpose,
    body,
    canonicalJsonUtf8,
    domainSeparatedUtf8: concatenate(
      encoder.encode(`np.build-canonical-json.v1\0${purpose}\0`),
      canonicalJsonUtf8,
    ),
  };
}
async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const crypto = globalThis.crypto?.subtle;
  if (!crypto) throw new Error("Build SHA-256 requires Web Crypto");
  const result = new Uint8Array(await crypto.digest("SHA-256", bytes));
  return btoa(String.fromCharCode(...result))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
/** Local integrity only: a digest grants no execution, approval, renderer or provider authority. */
export async function npBuildCanonicalDigest<P extends NpBuildImplementedCanonicalPurposeV1>(
  purpose: P,
  value: unknown,
): Promise<`nb1:sha256:${string}`> {
  const bytes = npBuildCanonicalBytes(purpose, value);
  return `nb1:sha256:${await sha256(concatenate(bytes.domainSeparatedUtf8))}`;
}
/** Hashes bytes only; the filesystem owner must independently prove file kind, stability and confinement. */
export async function npBuildFileDigest(
  purpose: NpBuildFilePurposeV1,
  bytes: Uint8Array,
): Promise<`nb1:file-sha256:${string}`> {
  if (!(npBuildFilePurposes as readonly string[]).includes(purpose))
    fail("build.filePurpose", "unknown raw-file purpose");
  if (!(bytes instanceof Uint8Array)) fail("build.fileBytes", "must be raw bytes");
  const length = new Uint8Array(8);
  new DataView(length.buffer).setBigUint64(0, BigInt(bytes.byteLength), false);
  return `nb1:file-sha256:${await sha256(concatenate(encoder.encode(`np.build-file.v1\0${purpose}\0`), length, bytes))}`;
}

/** Checks only the supplied proposal pair, not catalog membership or runtime/rendered evidence. */
export async function npRequireBuildBlueprintForBriefV1(
  briefValue: unknown,
  blueprintValue: unknown,
): Promise<NpAgentSiteBlueprintV1> {
  const brief = npRequireBuildReadyBriefV1(briefValue);
  const blueprint = npRequireAgentSiteBlueprintV1(blueprintValue);
  if (blueprint.briefHash !== (await npBuildCanonicalDigest("np.build-site-brief.v1", brief)))
    fail("build.blueprint.briefHash", "must bind this exact confirmed brief");
  if (blueprint.deployment.target !== brief.operations.target)
    fail("build.blueprint.deployment.target", "must match the brief deployment target");
  for (const item of [...blueprint.pages, ...blueprint.seed.documents])
    if (item.locale !== null && !brief.locales.includes(item.locale))
      fail("build.blueprint.locale", "must belong to the brief locale inventory");
  for (const collection of blueprint.collections) {
    const definition = npRequireAgentBuildCollectionDefinitionV1(collection.definition);
    if (
      definition.configuration.slug !== collection.slug ||
      collection.definitionHash !==
        (await npBuildCanonicalDigest("np.build-collection-definition.v1", definition))
    )
      fail(
        "build.blueprint.collection.definitionHash",
        "must bind the exact source-bound collection definition and slug",
      );
  }
  for (const media of blueprint.seed.media)
    if (
      media.kind === "generated" &&
      media.promptDigest !==
        (await npBuildCanonicalDigest("np.build-generated-media-prompt.v1", media.generationPrompt))
    )
      fail("build.blueprint.seed.media.promptDigest", "must bind the exact prompt envelope");
  return blueprint;
}

/** Checks artifact bindings only; filesystem and execution provenance belong to the CLI. */
export async function npRequireBuildVerificationForBlueprintV1(
  blueprintValue: unknown,
  resultValue: unknown,
): Promise<NpAgentBuildVerificationResultV1> {
  const blueprint = npRequireAgentSiteBlueprintV1(blueprintValue);
  const result = npRequireAgentBuildVerificationResultV1(resultValue);
  const { manifestDigest, ...body } = result;
  const preview = blueprint.commands.find((command) => command.template === "preview-render");
  if (
    manifestDigest !== (await npBuildCanonicalDigest("np.build-verification-result.v1", body)) ||
    result.blueprintHash !==
      (await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint)) ||
    result.commandRegistryFingerprint !== blueprint.commandRegistryFingerprint ||
    !preview ||
    result.renderEnvironmentFingerprint !== preview.renderEnvironmentFingerprint
  )
    fail(
      "build.verification.bindings",
      "must bind the exact blueprint, registry, environment and result body",
    );
  if (
    result.commandResults.length !== blueprint.commands.length ||
    result.commandResults.some((command, i) => command.commandId !== blueprint.commands[i].id) ||
    result.artifacts.length !== preview.artifacts.length ||
    result.artifacts.some((artifact) => {
      const declaration = preview.artifacts.find((item) => item.path === artifact.path);
      return (
        !declaration ||
        declaration.kind !== artifact.kind ||
        (declaration.kind === "screenshot" &&
          artifact.kind === "screenshot" &&
          (declaration.pageId !== artifact.pageId || declaration.viewport !== artifact.viewport))
      );
    })
  )
    fail(
      "build.verification.inventory",
      "must describe every declared command and exact preview artifact",
    );
  return result;
}

/** Actual observations may differ between reproducible runs; they must bind the same stable result. */
export async function npRequireBuildVerificationObservationForResultV1(
  resultValue: unknown,
  observationValue: unknown,
): Promise<NpAgentBuildVerificationObservationV1> {
  const result = npRequireAgentBuildVerificationResultV1(resultValue);
  const observation = npRequireAgentBuildVerificationObservationV1(observationValue);
  const { manifestDigest, ...body } = result;
  if (
    manifestDigest !== (await npBuildCanonicalDigest("np.build-verification-result.v1", body)) ||
    observation.manifestDigest !== manifestDigest ||
    observation.commandResults.length !== result.commandResults.length ||
    observation.commandResults.some(
      (command, i) =>
        command.commandId !== result.commandResults[i].commandId ||
        command.exitCode !== result.commandResults[i].exitCode,
    )
  )
    fail(
      "build.verification.observation",
      "must bind the observed commands and exact stable manifest",
    );
  return observation;
}
