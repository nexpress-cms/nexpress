import { z } from "zod";
import { npAuthUuidPattern } from "../auth-contract/contract.js";
import { npAnalyzeNavigationItems, npAnalyzeNavigationLocation } from "../navigation/contract.js";
import type { NpNavigationItems } from "../navigation/types.js";
import { requireArtifact } from "./artifact.js";
import { compareUtf8, fileDigest, under, unique } from "./primitives.js";
import { buildSeedDocumentSchema, canonicalOrder } from "./schemas.js";
import type { NpAgentBlueprintNavigation, NpAgentBlueprintSeedPlan } from "./types.js";

/** Comparison data commits the exact separately staged synthetic dataset bytes. */
export interface NpAgentBuildRenderFixtureRefV1 {
  schemaVersion: "np.agent-build-render-fixture-ref.v1";
  stagedArtifactPath: string;
  digest: string;
  pageDocumentId: string;
}
export interface NpAgentBuildRenderFixtureV1 {
  schemaVersion: "np.agent-build-render-fixture.v1";
  documents: NpAgentBlueprintSeedPlan["documents"];
  navigation: NpAgentBlueprintNavigation[];
}

const referenceSchema: z.ZodType<NpAgentBuildRenderFixtureRefV1> = z.strictObject({
  schemaVersion: z.literal("np.agent-build-render-fixture-ref.v1"),
  stagedArtifactPath: under(".nexpress/site/fixtures").refine((path) => path.endsWith(".json")),
  digest: fileDigest,
  pageDocumentId: z.string().regex(new RegExp(npAuthUuidPattern, "u")),
});
const schema: z.ZodType<NpAgentBuildRenderFixtureV1> = z
  .strictObject({
    schemaVersion: z.literal("np.agent-build-render-fixture.v1"),
    documents: unique(buildSeedDocumentSchema, 1000, (document) => document.documentId).min(1),
    navigation: unique(
      z.strictObject({
        location: z.string().refine((value) => npAnalyzeNavigationLocation(value).length === 0),
        items: z.custom<NpNavigationItems>((value) => npAnalyzeNavigationItems(value).length === 0),
      }),
      32,
      (item) => item.location,
    ),
  })
  .superRefine((value, ctx) => {
    if (
      !canonicalOrder(
        value.documents,
        (document) => document.documentId,
        (document) => document.dependsOnDocumentIds,
        (left, right) =>
          compareUtf8(left.collection, right.collection) ||
          compareUtf8(left.documentId, right.documentId),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "fixture documents require a complete acyclic canonical dependency order",
      });
    if (
      value.navigation.some(
        (entry, i) => i > 0 && compareUtf8(value.navigation[i - 1].location, entry.location) >= 0,
      )
    )
      ctx.addIssue({ code: "custom", message: "fixture navigation requires UTF-8 location order" });
  });

/** Scope is fixture structure, never privacy attestation, file authenticity or permission to seed. */
export function npRequireAgentBuildRenderFixtureRefV1(
  value: unknown,
): NpAgentBuildRenderFixtureRefV1 {
  return requireArtifact(value, referenceSchema, { bytes: 4096, depth: 1 });
}
export function npRequireAgentBuildRenderFixtureV1(value: unknown): NpAgentBuildRenderFixtureV1 {
  return requireArtifact(value, schema, { bytes: 4 * 1024 * 1024, depth: 16 });
}
