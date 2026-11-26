import { z } from "zod";
import { requireArtifact } from "./artifact.js";
import { compareUtf8, digest, fileDigest, id, under, unique } from "./primitives.js";
import { collisionFree } from "./schemas.js";

export interface NpAgentBuildVerificationResultBodyV1 {
  schemaVersion: "np.agent-build-verification-result.v1";
  blueprintHash: string;
  commandRegistryFingerprint: string;
  renderEnvironmentFingerprint: string;
  baselineTreeDigest: string;
  finalSourceDigest: string;
  commandResults: Array<{ commandId: string; exitCode: number }>;
  artifacts: Array<
    | {
        kind: "screenshot";
        path: string;
        digest: string;
        bytes: number;
        mime: "image/png" | "image/webp";
        pageId: string;
        viewport: "desktop" | "mobile";
      }
    | {
        kind: "report";
        path: string;
        digest: string;
        bytes: number;
        mime: "application/json";
        pageId: null;
        viewport: null;
      }
  >;
}
export interface NpAgentBuildVerificationResultV1 extends NpAgentBuildVerificationResultBodyV1 {
  manifestDigest: string;
}
/** Actual volatile execution facts live outside the reproducible result body. */
export interface NpAgentBuildVerificationObservationV1 {
  schemaVersion: "np.agent-build-verification-observation.v1";
  manifestDigest: string;
  commandResults: Array<{
    commandId: string;
    exitCode: number;
    outputDigest: string;
    durationMs: number;
    outputArtifactPath: string;
  }>;
  startedAt: string;
  finishedAt: string;
}

const exitCode = z.number().int().min(-1).max(255);
const commonArtifact = {
  path: under(".nexpress/site/review/final"),
  digest: fileDigest,
  bytes: z
    .number()
    .int()
    .min(1)
    .max(64 * 1024 * 1024),
};
const bodyFields = {
  schemaVersion: z.literal("np.agent-build-verification-result.v1"),
  blueprintHash: digest,
  commandRegistryFingerprint: digest,
  renderEnvironmentFingerprint: digest,
  baselineTreeDigest: digest,
  finalSourceDigest: digest,
  commandResults: unique(
    z.strictObject({ commandId: id, exitCode }),
    32,
    (command) => command.commandId,
  ).min(1),
  artifacts: unique(
    z.discriminatedUnion("kind", [
      z.strictObject({
        ...commonArtifact,
        kind: z.literal("screenshot"),
        mime: z.enum(["image/png", "image/webp"]),
        pageId: id,
        viewport: z.enum(["desktop", "mobile"]),
      }),
      z.strictObject({
        ...commonArtifact,
        kind: z.literal("report"),
        mime: z.literal("application/json"),
        pageId: z.null(),
        viewport: z.null(),
      }),
    ]),
    401,
    (artifact) => artifact.path,
  ).min(1),
};
function checkBody(value: NpAgentBuildVerificationResultBodyV1, ctx: z.RefinementCtx): void {
  if (
    !collisionFree(value.artifacts.map((artifact) => artifact.path)) ||
    value.artifacts.some(
      (artifact, i) => i > 0 && compareUtf8(value.artifacts[i - 1].path, artifact.path) >= 0,
    ) ||
    value.artifacts.filter((artifact) => artifact.kind === "report").length !== 1 ||
    value.artifacts.some(
      (artifact) =>
        !artifact.path.endsWith(
          artifact.mime === "image/png"
            ? ".png"
            : artifact.mime === "image/webp"
              ? ".webp"
              : ".json",
        ),
    )
  )
    ctx.addIssue({
      code: "custom",
      message: "artifacts require collision-free UTF-8 order, matching extensions and one report",
    });
  const pages = new Map<string, Set<string>>();
  for (const artifact of value.artifacts) {
    if (artifact.kind !== "screenshot") continue;
    const viewports = pages.get(artifact.pageId) ?? new Set<string>();
    if (viewports.has(artifact.viewport))
      ctx.addIssue({ code: "custom", message: "duplicate page viewport" });
    viewports.add(artifact.viewport);
    pages.set(artifact.pageId, viewports);
  }
  if (!pages.size || [...pages.values()].some((viewports) => viewports.size !== 2))
    ctx.addIssue({ code: "custom", message: "every page requires desktop and mobile screenshots" });
}
const bodySchema: z.ZodType<NpAgentBuildVerificationResultBodyV1> = z
  .strictObject(bodyFields)
  .superRefine(checkBody);
const resultSchema: z.ZodType<NpAgentBuildVerificationResultV1> = z
  .strictObject({ ...bodyFields, manifestDigest: digest })
  .superRefine(checkBody);
const observationSchema: z.ZodType<NpAgentBuildVerificationObservationV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-build-verification-observation.v1"),
    manifestDigest: digest,
    commandResults: unique(
      z.strictObject({
        commandId: id,
        exitCode,
        outputDigest: digest,
        durationMs: z.number().int().min(0).max(3_600_000),
        outputArtifactPath: under(".nexpress/site/audit"),
      }),
      32,
      (command) => command.commandId,
    ).min(1),
    startedAt: z.iso.datetime({ precision: 3 }),
    finishedAt: z.iso.datetime({ precision: 3 }),
  })
  .superRefine((value, ctx) => {
    if (
      value.finishedAt < value.startedAt ||
      !collisionFree(value.commandResults.map((command) => command.outputArtifactPath))
    )
      ctx.addIssue({
        code: "custom",
        message: "observation requires ordered timestamps and separate output paths",
      });
  });
const limits = { bytes: 2 * 1024 * 1024, depth: 4 };
/** Parsing does not prove execution, output provenance or any on-disk artifact. */
export const npRequireAgentBuildVerificationResultBodyV1 = (
  value: unknown,
): NpAgentBuildVerificationResultBodyV1 => requireArtifact(value, bodySchema, limits);
export const npRequireAgentBuildVerificationResultV1 = (
  value: unknown,
): NpAgentBuildVerificationResultV1 => requireArtifact(value, resultSchema, limits);
export const npRequireAgentBuildVerificationObservationV1 = (
  value: unknown,
): NpAgentBuildVerificationObservationV1 => requireArtifact(value, observationSchema, limits);
