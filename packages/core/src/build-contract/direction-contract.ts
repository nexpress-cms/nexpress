import {
  encoder,
  fail,
  parseBuildJsonWithLimits,
  serializeJson,
  inspectJson,
} from "./primitives.js";
import {
  npBuildCanonicalDigest,
  npRequireBuildReadyBriefV1,
  npRequireAgentDesignDirectionProjectionV1,
  npRequireAgentDesignDirectionDraftV1,
  npRequireAgentDesignDirectionV1,
  npBuildDirectionLimitsV1,
  npRequireAgentDesignDirectionSetV1,
  npRequireAgentDesignDirectionDraftSetV1,
  npRequireAgentDirectionRenderSourceV1,
  npRequireAgentDirectionRenderReceiptRecordV1,
} from "./contract.js";
import type {
  NpAgentDesignDirectionDraftV1,
  NpAgentDesignDirectionProjectionV1,
  NpAgentDesignDirectionV1,
} from "./direction-types.js";

export const npParseAgentDesignDirectionDraftSetV1 = (raw: string) =>
  npRequireAgentDesignDirectionDraftSetV1(
    parseBuildJsonWithLimits(
      raw,
      npBuildDirectionLimitsV1.set.bytes,
      npBuildDirectionLimitsV1.set.depth,
    ),
  );
export const npParseAgentDesignDirectionSetV1 = (raw: string) =>
  npRequireAgentDesignDirectionSetV1(
    parseBuildJsonWithLimits(
      raw,
      npBuildDirectionLimitsV1.set.bytes,
      npBuildDirectionLimitsV1.set.depth,
    ),
  );

/** Stable draft transport bytes only; drafts have no sealed-direction-set digest. */
export function npBuildDesignDirectionDraftSetBytesV1(value: unknown): Uint8Array {
  const draft = npRequireAgentDesignDirectionDraftSetV1(value);
  return encoder.encode(
    serializeJson(
      inspectJson(draft, npBuildDirectionLimitsV1.set.bytes, npBuildDirectionLimitsV1.set.depth),
    ),
  );
}

export function npBuildDirectionProjectionV1(
  direction: NpAgentDesignDirectionDraftV1 | NpAgentDesignDirectionV1,
): NpAgentDesignDirectionProjectionV1 {
  const safe = inspectJson(
    direction,
    npBuildDirectionLimitsV1.direction.bytes,
    npBuildDirectionLimitsV1.direction.depth,
  );
  const parsed =
    safe !== null &&
    typeof safe === "object" &&
    !Array.isArray(safe) &&
    safe.schemaVersion === "np.agent-design-direction-draft.v1"
      ? npRequireAgentDesignDirectionDraftV1(safe)
      : npRequireAgentDesignDirectionV1(safe);
  // Copy the closed projection inventory: never hash a caller-supplied opaque projection object.
  return npRequireAgentDesignDirectionProjectionV1({
    schemaVersion: "np.agent-design-direction.v1",
    id: parsed.id,
    name: parsed.name,
    rationale: parsed.rationale,
    themeBase: parsed.themeBase,
    tokens: parsed.tokens,
    typography: parsed.typography,
    layout: parsed.layout,
    pageBindings: parsed.pageBindings,
    tradeoffs: parsed.tradeoffs,
    comparisonInputsDigest: parsed.comparisonInputsDigest,
    discoveryFingerprint: parsed.discoveryFingerprint,
  });
}

function equal(left: unknown, right: unknown): boolean {
  return (
    serializeJson(inspectJson(left, 4 * 1024 * 1024, 16)) ===
    serializeJson(inspectJson(right, 4 * 1024 * 1024, 16))
  );
}

/** Proposal binding only. Catalog resolution, privacy review, image I/O and trusted rerender remain mandatory. */
export async function npRequireBuildDirectionSetForBriefV1(
  briefValue: unknown,
  setValue: unknown,
  kind: "draft",
): Promise<ReturnType<typeof npRequireAgentDesignDirectionDraftSetV1>>;
export async function npRequireBuildDirectionSetForBriefV1(
  briefValue: unknown,
  setValue: unknown,
  kind: "sealed",
): Promise<ReturnType<typeof npRequireAgentDesignDirectionSetV1>>;
export async function npRequireBuildDirectionSetForBriefV1(
  briefValue: unknown,
  setValue: unknown,
  kind: "draft" | "sealed",
) {
  if (kind !== "draft" && kind !== "sealed") fail("build.direction.kind", "unknown proposal kind");
  const brief = npRequireBuildReadyBriefV1(briefValue);
  const set =
    kind === "draft"
      ? npRequireAgentDesignDirectionDraftSetV1(setValue)
      : npRequireAgentDesignDirectionSetV1(setValue);
  if (set.briefHash !== (await npBuildCanonicalDigest("np.build-site-brief.v1", brief)))
    fail("build.direction.briefHash", "must bind the exact resolved brief");
  if (
    set.comparisonInputsDigest !==
    (await npBuildCanonicalDigest("np.build-design-comparison-inputs.v1", set.comparisonInputs))
  )
    fail("build.direction.comparisonInputsDigest", "must bind complete comparison inputs");
  for (const page of set.comparisonInputs.informationArchitecture) {
    if (page.locale !== null && !brief.locales.includes(page.locale))
      fail("build.direction.locale", "must belong to brief locale inventory");
  }
  for (const direction of set.directions) {
    if (!("previewArtifact" in direction)) continue;
    const projection = npBuildDirectionProjectionV1(direction);
    if (
      direction.projectionDigest !==
      (await npBuildCanonicalDigest("np.build-design-direction-projection.v1", projection))
    )
      fail("build.direction.projectionDigest", "must bind exact projection fields");
  }
  return set;
}

/** Matches a cache record structurally; this never establishes trusted rendering or file provenance. */
export async function npRequireBuildRenderReceiptBindingsV1(
  sourceValue: unknown,
  recordValue: unknown,
) {
  const source = npRequireAgentDirectionRenderSourceV1(sourceValue);
  const record = npRequireAgentDirectionRenderReceiptRecordV1(recordValue);
  const body = record.body;
  if (
    source.directionProjectionDigest !==
    (await npBuildCanonicalDigest(
      "np.build-design-direction-projection.v1",
      source.directionProjection,
    ))
  )
    fail("build.render.projection", "must bind the exact projection");
  if (
    body.renderSourceDigest !==
      (await npBuildCanonicalDigest("np.build-direction-render-source.v1", source)) ||
    record.digest !== (await npBuildCanonicalDigest("np.build-direction-render-receipt.v1", body))
  )
    fail("build.render.receipt", "must bind the complete source and receipt");
  for (const key of [
    "comparisonInputsDigest",
    "directionId",
    "directionProjectionDigest",
    "viewportName",
    "viewport",
    "orderedPageIds",
    "sourceTreeDigest",
    "rendererFingerprint",
    "renderEnvironmentFingerprint",
  ] as const) {
    if (!equal(body[key], source[key]))
      fail("build.render.receipt", "receipt must describe its exact source");
  }
  return record;
}
