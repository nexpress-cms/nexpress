import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyAscii,
  canonicalBodyEnum,
  canonicalBodyIdentifier,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import {
  canonicalBodyPreviewLocale,
  canonicalBodyPreviewRoute,
  canonicalBodyQuerylessHttpsOrigin,
  compareUnicodeCodePoints,
} from "./canonical-preview-values.js";
import type {
  NpAgentCanonicalBodyBytesV1,
  NpAgentContractResult,
  NpAgentPreviewContractCanonicalV1,
  NpAgentPreviewRouteCanonicalV1,
  NpAgentPreviewRoutesCanonicalV1,
} from "./types.js";

const PREVIEW_CONTRACT_PURPOSE = "np.agent-preview-contract.v1" as const;
const PREVIEW_ROUTES_PURPOSE = "np.agent-preview-routes.v1" as const;
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const MAXIMUM_ALLOWLIST_ORIGINS = 64 * 1024;
const MAXIMUM_PREVIEW_ROUTES = 256 * 1024;
const PUBLIC_AUDIENCES = new Set<string>(["public"]);

export const npAgentPreviewContractCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "overlayResolverVersion",
  "rendererId",
  "rendererVersion",
  "rendererFingerprint",
  "screenshotAdapterId",
  "screenshotAdapterVersion",
  "screenshotAdapterFingerprint",
  "routeParserVersion",
  "checkRegistryVersion",
  "linkAllowlistVersion",
  "linkAllowlistOrigins",
  "networkPolicyVersion",
  "artifactLimitsVersion",
  "reportSchemaVersion",
  "responseHeaderBuilderVersion",
  "cspBuilderVersion",
] as const satisfies readonly (keyof NpAgentPreviewContractCanonicalV1)[];

export const npAgentPreviewContractCanonicalExcludedKeysV1 = [
  "previewContractFingerprint",
  "registeredAt",
  "rendererImplementation",
  "screenshotAdapterImplementation",
  "routeParserImplementation",
  "checkRegistryImplementation",
] as const;

export const npAgentPreviewRoutesCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "changeSetId",
  "previewId",
  "generation",
  "planHash",
  "routes",
] as const satisfies readonly (keyof NpAgentPreviewRoutesCanonicalV1)[];

export const npAgentPreviewRoutesCanonicalExcludedKeysV1 = [
  "allowedRoutesDigest",
  "resourceUri",
  "viewerToken",
  "renderToken",
  "launchId",
  "launchGeneration",
  "createdAt",
  "expiresAt",
] as const;

export const npAgentPreviewRouteCanonicalIncludedKeysV1 = [
  "route",
  "locale",
  "audience",
] as const satisfies readonly (keyof NpAgentPreviewRouteCanonicalV1)[];

function parseSortedUniqueOrigins(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): string[] {
  const entries = canonicalBodyArray(value, path, MAXIMUM_ALLOWLIST_ORIGINS, state);
  const result: string[] = [];
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    const current = canonicalBodyQuerylessHttpsOrigin(entry, `${path}[${index.toString()}]`);
    const order = previous === null ? 1 : compareUnicodeCodePoints(current, previous);
    if (previous !== null && order <= 0) {
      failCanonicalBody(
        order === 0 ? "duplicate" : "order",
        `${path}[${index.toString()}]`,
        "must be sorted unique by Unicode code point",
      );
    }
    result.push(current);
    previous = current;
  });
  return result;
}

function parsePreviewContractCanonical(value: unknown): NpAgentPreviewContractCanonicalV1 {
  const path = "agent.canonical.previewContract";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentPreviewContractCanonicalIncludedKeysV1,
    npAgentPreviewContractCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== PREVIEW_CONTRACT_PURPOSE) {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      `must be ${PREVIEW_CONTRACT_PURPOSE}`,
    );
  }

  const screenshotAdapterId =
    record.screenshotAdapterId === null
      ? null
      : canonicalBodyIdentifier(record.screenshotAdapterId, `${path}.screenshotAdapterId`);
  const screenshotAdapterVersion =
    record.screenshotAdapterVersion === null
      ? null
      : canonicalBodyInteger(
          record.screenshotAdapterVersion,
          `${path}.screenshotAdapterVersion`,
          1,
          SIGNED_32_BIT_MAXIMUM,
        );
  const screenshotAdapterFingerprint =
    record.screenshotAdapterFingerprint === null
      ? null
      : canonicalBodyAscii(
          record.screenshotAdapterFingerprint,
          `${path}.screenshotAdapterFingerprint`,
          256,
        );
  const adapterValues = [
    screenshotAdapterId,
    screenshotAdapterVersion,
    screenshotAdapterFingerprint,
  ];
  const allAdapterValuesNull = adapterValues.every((entry) => entry === null);
  const allAdapterValuesNonNull = adapterValues.every((entry) => entry !== null);
  if (!allAdapterValuesNull && !allAdapterValuesNonNull) {
    failCanonicalBody(
      "invalid-field",
      `${path}.screenshotAdapterId`,
      "screenshot adapter id, version, and fingerprint must be all null or all non-null",
    );
  }

  const result: NpAgentPreviewContractCanonicalV1 = {
    schemaVersion: PREVIEW_CONTRACT_PURPOSE,
    overlayResolverVersion: canonicalBodyInteger(
      record.overlayResolverVersion,
      `${path}.overlayResolverVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    rendererId: canonicalBodyIdentifier(record.rendererId, `${path}.rendererId`),
    rendererVersion: canonicalBodyInteger(
      record.rendererVersion,
      `${path}.rendererVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    rendererFingerprint: canonicalBodyAscii(
      record.rendererFingerprint,
      `${path}.rendererFingerprint`,
      256,
    ),
    screenshotAdapterId,
    screenshotAdapterVersion,
    screenshotAdapterFingerprint,
    routeParserVersion: canonicalBodyInteger(
      record.routeParserVersion,
      `${path}.routeParserVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    checkRegistryVersion: canonicalBodyInteger(
      record.checkRegistryVersion,
      `${path}.checkRegistryVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    linkAllowlistVersion: canonicalBodyInteger(
      record.linkAllowlistVersion,
      `${path}.linkAllowlistVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    linkAllowlistOrigins: parseSortedUniqueOrigins(
      record.linkAllowlistOrigins,
      `${path}.linkAllowlistOrigins`,
      state,
    ),
    networkPolicyVersion: canonicalBodyInteger(
      record.networkPolicyVersion,
      `${path}.networkPolicyVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    artifactLimitsVersion: canonicalBodyInteger(
      record.artifactLimitsVersion,
      `${path}.artifactLimitsVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    reportSchemaVersion: canonicalBodyInteger(
      record.reportSchemaVersion,
      `${path}.reportSchemaVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    responseHeaderBuilderVersion: canonicalBodyInteger(
      record.responseHeaderBuilderVersion,
      `${path}.responseHeaderBuilderVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    cspBuilderVersion: canonicalBodyInteger(
      record.cspBuilderVersion,
      `${path}.cspBuilderVersion`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
  };
  buildAgentCanonicalFoundationBytes(PREVIEW_CONTRACT_PURPOSE, result);
  return result;
}

function parsePreviewRoute(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentPreviewRouteCanonicalV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentPreviewRouteCanonicalIncludedKeysV1,
    npAgentPreviewRouteCanonicalIncludedKeysV1,
    state,
  );
  return {
    route: canonicalBodyPreviewRoute(record.route, `${path}.route`),
    locale:
      record.locale === null ? null : canonicalBodyPreviewLocale(record.locale, `${path}.locale`),
    audience: canonicalBodyEnum<"public">(record.audience, `${path}.audience`, PUBLIC_AUDIENCES),
  };
}

function comparePreviewRoutes(
  left: NpAgentPreviewRouteCanonicalV1,
  right: NpAgentPreviewRouteCanonicalV1,
): number {
  const routeOrder = compareUnicodeCodePoints(left.route, right.route);
  if (routeOrder !== 0) return routeOrder;
  const localeOrder = compareUnicodeCodePoints(left.locale ?? "", right.locale ?? "");
  if (localeOrder !== 0) return localeOrder;
  return compareUnicodeCodePoints(left.audience, right.audience);
}

function parsePreviewRoutesCanonical(value: unknown): NpAgentPreviewRoutesCanonicalV1 {
  const path = "agent.canonical.previewRoutes";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentPreviewRoutesCanonicalIncludedKeysV1,
    npAgentPreviewRoutesCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== PREVIEW_ROUTES_PURPOSE) {
    failCanonicalBody(
      "invalid-field",
      `${path}.schemaVersion`,
      `must be ${PREVIEW_ROUTES_PURPOSE}`,
    );
  }
  const routeValues = canonicalBodyArray(
    record.routes,
    `${path}.routes`,
    MAXIMUM_PREVIEW_ROUTES,
    state,
  );
  const routes: NpAgentPreviewRouteCanonicalV1[] = [];
  let previous: NpAgentPreviewRouteCanonicalV1 | null = null;
  routeValues.forEach((entry, index) => {
    const entryPath = `${path}.routes[${index.toString()}]`;
    const current = parsePreviewRoute(entry, entryPath, state);
    const order = previous === null ? 1 : comparePreviewRoutes(current, previous);
    if (previous !== null && order <= 0) {
      failCanonicalBody(
        order === 0 ? "duplicate" : "order",
        entryPath,
        "must be sorted unique by route, locale-or-empty, and audience",
      );
    }
    routes.push(current);
    previous = current;
  });

  const result: NpAgentPreviewRoutesCanonicalV1 = {
    schemaVersion: PREVIEW_ROUTES_PURPOSE,
    siteId: canonicalBodySiteId(record.siteId, `${path}.siteId`),
    changeSetId: canonicalBodyUuid(record.changeSetId, `${path}.changeSetId`),
    previewId: canonicalBodyUuid(record.previewId, `${path}.previewId`),
    generation: canonicalBodyInteger(
      record.generation,
      `${path}.generation`,
      1,
      SIGNED_32_BIT_MAXIMUM,
    ),
    planHash: canonicalBodySha256Digest(record.planHash, `${path}.planHash`),
    routes,
  };
  buildAgentCanonicalFoundationBytes(PREVIEW_ROUTES_PURPOSE, result);
  return result;
}

export function npAnalyzeAgentPreviewContractCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentPreviewContractCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.previewContract", () =>
    parsePreviewContractCanonical(value),
  );
}

export function npRequireAgentPreviewContractCanonical(
  value: unknown,
): NpAgentPreviewContractCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentPreviewContractCanonical(value),
    "Invalid Agent preview-contract canonical body",
  );
}

export function npAnalyzeAgentPreviewRoutesCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentPreviewRoutesCanonicalV1> {
  return analyzeCanonicalBody("agent.canonical.previewRoutes", () =>
    parsePreviewRoutesCanonical(value),
  );
}

export function npRequireAgentPreviewRoutesCanonical(
  value: unknown,
): NpAgentPreviewRoutesCanonicalV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentPreviewRoutesCanonical(value),
    "Invalid Agent preview-routes canonical body",
  );
}

export function npBuildAgentPreviewContractCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-preview-contract.v1", NpAgentPreviewContractCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    PREVIEW_CONTRACT_PURPOSE,
    npRequireAgentPreviewContractCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-preview-contract.v1",
    NpAgentPreviewContractCanonicalV1
  >;
}

export function npBuildAgentPreviewRoutesCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-preview-routes.v1", NpAgentPreviewRoutesCanonicalV1> {
  return buildAgentCanonicalFoundationBytes(
    PREVIEW_ROUTES_PURPOSE,
    npRequireAgentPreviewRoutesCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-preview-routes.v1",
    NpAgentPreviewRoutesCanonicalV1
  >;
}

export async function npDigestAgentPreviewContractCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentPreviewContractCanonicalBytes(value).domainSeparatedUtf8,
  );
}

export async function npDigestAgentPreviewRoutesCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentPreviewRoutesCanonicalBytes(value).domainSeparatedUtf8,
  );
}
