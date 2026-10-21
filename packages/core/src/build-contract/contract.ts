import type { z } from "zod";
import { NpAgentContractError } from "../agent-contract/contract.js";
import type { NpAgentContractResult } from "../agent-contract/types.js";
import {
  briefSchema,
  blueprintSchema,
  promptSchema,
  outputSchema,
  sourceTreeSchema,
} from "./schemas.js";
import { encoder, fail, inspectJson, npParseBuildJsonV1, serializeJson } from "./primitives.js";
import type {
  NpAgentSiteBriefV1,
  NpAgentSiteBlueprintV1,
  NpAgentGeneratedMediaPromptV1,
  NpAgentBuildSourceTreeV1,
  NpAgentBuildCommandOutputV1,
} from "./types.js";

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
  "np.build-site-blueprint.v1": NpAgentSiteBlueprintV1;
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

function requireArtifact<T>(
  value: unknown,
  schema: z.ZodType<T>,
  limits: { bytes: number; depth: number },
): T {
  const inspected = inspectJson(value, limits.bytes, limits.depth);
  const parsed = schema.safeParse(inspected);
  if (!parsed.success)
    throw new NpAgentContractError(
      "Invalid Build artifact",
      parsed.error.issues.slice(0, 20).map((issue) => ({
        code: "invalid-field",
        path: `build.${issue.path.map(String).join(".")}`,
        message:
          issue.code === "unrecognized_keys"
            ? "contains unknown fields"
            : "does not satisfy the exact Build artifact contract",
      })),
    );
  return parsed.data;
}
function analyze<T>(parser: () => T): NpAgentContractResult<T> {
  try {
    return { ok: true, value: parser() };
  } catch (error) {
    return {
      ok: false,
      issues:
        error instanceof NpAgentContractError
          ? error.contractIssues
          : [{ code: "unsafe-value", path: "build", message: "could not be inspected safely" }],
    };
  }
}
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

/** Reserved purposes deliberately fail closed until their owning artifact contract ships. */
export const npBuildCanonicalBodyValidatorsV1 = Object.freeze({
  "np.build-site-brief.v1": npRequireAgentSiteBriefV1,
  "np.build-design-comparison-inputs.v1": null,
  "np.build-design-direction-projection.v1": null,
  "np.build-design-direction.v1": null,
  "np.build-design-direction-set.v1": null,
  "np.build-site-blueprint.v1": npRequireAgentSiteBlueprintV1,
  "np.build-collection-definition.v1": null,
  "np.build-generated-media-prompt.v1": npRequireAgentGeneratedMediaPromptV1,
  "np.build-command-registry.v1": null,
  "np.build-direction-renderer.v1": null,
  "np.build-render-environment.v1": null,
  "np.build-direction-render-source.v1": null,
  "np.build-direction-render-receipt.v1": null,
  "np.build-command-output.v1": npRequireAgentBuildCommandOutputV1,
  "np.build-verification-result.v1": null,
  "np.build-source-tree.v1": npRequireAgentBuildSourceTreeV1,
} satisfies Record<NpBuildCanonicalPurposeV1, ((value: unknown) => object) | null>);

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
  const json = serializeJson(inspectJson(body, 4 * 1024 * 1024, 16));
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
  for (const media of blueprint.seed.media)
    if (
      media.kind === "generated" &&
      media.promptDigest !==
        (await npBuildCanonicalDigest("np.build-generated-media-prompt.v1", media.generationPrompt))
    )
      fail("build.blueprint.seed.media.promptDigest", "must bind the exact prompt envelope");
  return blueprint;
}
