import { npI18nContractLimits, npRequireLocale } from "../i18n-contract/index.js";
import { npRequireAgentContractResult } from "./contract.js";
import {
  analyzeCanonicalBody,
  canonicalBodyArray,
  canonicalBodyEnum,
  canonicalBodyInteger,
  canonicalBodyRecord,
  canonicalBodySha256Digest,
  canonicalBodySiteId,
  canonicalBodyUtc,
  canonicalBodyUuid,
  failCanonicalBody,
  type CanonicalBodyInspectionState,
} from "./canonical-body-validation.js";
import { digestAgentCanonicalSha256 } from "./canonical-digest.js";
import { buildAgentCanonicalFoundationBytes } from "./canonical-foundation.js";
import {
  npAgentPreviewArtifactKinds,
  npAgentPreviewArtifactMimes,
  type NpAgentCanonicalBodyBytesV1,
  type NpAgentContractResult,
  type NpAgentPreviewArtifactManifestEntryV1,
  type NpAgentPreviewArtifactManifestV1,
  type NpAgentPreviewArtifactMime,
  type NpAgentPreviewArtifactViewportV1,
} from "./types.js";

const PURPOSE = "np.agent-artifact.v1" as const;
const SCHEMA_VERSION = "np.agent-preview-artifact-manifest.v1" as const;
const SIGNED_32_BIT_MAXIMUM = 2_147_483_647;
const MAXIMUM_ARTIFACTS = 24;
const MAXIMUM_SCREENSHOTS = 20;
const MAXIMUM_REPORTS = 4;
const MAXIMUM_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const MAXIMUM_REPORT_BYTES = 512 * 1024;
const CONTENT_DIGEST_PATTERN = /^ac1:sha256:[A-Za-z0-9_-]{43}$/u;
const ARTIFACT_KINDS = new Set<string>(npAgentPreviewArtifactKinds);
const ARTIFACT_MIMES = new Set<string>(npAgentPreviewArtifactMimes);
const SCREENSHOT_MIMES = new Set<string>(["image/png", "image/webp"]);
const VIEWPORT_NAMES = new Set<string>(["desktop", "mobile"]);
const DEVICE_SCALE_FACTORS = new Set<number>([1, 2]);

export const npAgentPreviewArtifactManifestCanonicalIncludedKeysV1 = [
  "schemaVersion",
  "siteId",
  "changeSetId",
  "previewId",
  "generation",
  "planHash",
  "previewContractFingerprint",
  "artifacts",
] as const satisfies readonly (keyof NpAgentPreviewArtifactManifestV1)[];

export const npAgentPreviewArtifactManifestCanonicalExcludedKeysV1 = [
  "digest",
  "resourceUri",
  "interactiveLaunch",
  "objectState",
  "storageKey",
  "storageAdapterId",
  "storageAdapterContractVersion",
  "storageAdapterFingerprint",
  "objectExpiresAt",
  "metadataPruneAt",
  "deleteAttempt",
  "deleteStatus",
  "deleteReceipt",
  "deleteReceiptDigest",
  "deleteErrorCode",
  "deletedAt",
  "rowVersion",
  "uploadRequestDigest",
  "uploadState",
  "uploadLeaseUntil",
  "uploadCallDeadlineAt",
] as const;

export const npAgentPreviewArtifactManifestEntryCanonicalIncludedKeysV1 = [
  "ordinal",
  "artifactId",
  "kind",
  "route",
  "locale",
  "viewport",
  "reportPart",
  "reportTotalParts",
  "contentDigest",
  "mime",
  "bytes",
  "createdAt",
  "expiresAt",
] as const satisfies readonly (keyof NpAgentPreviewArtifactManifestEntryV1)[];

export const npAgentPreviewArtifactManifestEntryCanonicalExcludedKeysV1 = [
  "resourceUri",
  "digest",
  "objectState",
  "storageKey",
  "storageAdapterId",
  "storageAdapterContractVersion",
  "storageAdapterFingerprint",
  "deleteReceipt",
  "deleteReceiptDigest",
  "deletedAt",
] as const;

export const npAgentPreviewArtifactManifestScreenshotIncludedKeysV1 = [
  ...npAgentPreviewArtifactManifestEntryCanonicalIncludedKeysV1,
] as const;

export const npAgentPreviewArtifactManifestReportIncludedKeysV1 = [
  ...npAgentPreviewArtifactManifestEntryCanonicalIncludedKeysV1,
] as const;

export const npAgentPreviewArtifactViewportCanonicalIncludedKeysV1 = [
  "name",
  "width",
  "height",
  "deviceScaleFactor",
] as const satisfies readonly (keyof NpAgentPreviewArtifactViewportV1)[];

export const npAgentPreviewArtifactCanonicalDiscriminatorCasesV1 = [
  {
    caseId: "np.agent-artifact.v1.artifacts[].screenshot",
    concreteDiscriminatorPath: "/artifacts/*/kind",
    acceptedValue: "screenshot",
  },
  {
    caseId: "np.agent-artifact.v1.artifacts[].report",
    concreteDiscriminatorPath: "/artifacts/*/kind",
    acceptedValue: "report",
  },
] as const;

function hasUnsafeRouteCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (
      code === undefined ||
      code <= 0x20 ||
      code === 0x7f ||
      character === "\\" ||
      character === "?" ||
      character === "#"
    ) {
      return true;
    }
  }
  return false;
}

function canonicalBodyPreviewRoute(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > npI18nContractLimits.pathnameLength ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    hasUnsafeRouteCharacter(value)
  ) {
    failCanonicalBody(
      "invalid-field",
      path,
      "must be one bounded absolute site-relative path without origin, query, or fragment",
    );
  }
  if (value !== "/" && (value.endsWith("/") || value.includes("//"))) {
    failCanonicalBody("invalid-field", path, "must not contain empty or trailing path segments");
  }
  const segments = value === "/" ? [] : value.slice(1).split("/");
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      failCanonicalBody("invalid-field", path, "must contain valid path encoding");
    }
    if (
      decoded.length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      failCanonicalBody("invalid-field", path, "must not contain empty or dot path segments");
    }
  }
  return value;
}

function canonicalBodyLocale(value: unknown, path: string): string {
  try {
    return npRequireLocale(value, path);
  } catch {
    failCanonicalBody("invalid-field", path, "must be a canonical BCP 47 locale");
  }
}

function canonicalBodyContentDigest(value: unknown, path: string): string {
  if (typeof value !== "string" || !CONTENT_DIGEST_PATTERN.test(value)) {
    failCanonicalBody(
      "invalid-field",
      path,
      "must be one domain-separated Agent artifact-content SHA-256 digest",
    );
  }
  return value;
}

function parseViewport(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentPreviewArtifactViewportV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentPreviewArtifactViewportCanonicalIncludedKeysV1,
    npAgentPreviewArtifactViewportCanonicalIncludedKeysV1,
    state,
  );
  const deviceScaleFactor = canonicalBodyInteger(
    record.deviceScaleFactor,
    `${path}.deviceScaleFactor`,
    1,
    2,
  );
  if (!DEVICE_SCALE_FACTORS.has(deviceScaleFactor)) {
    failCanonicalBody(
      "invalid-field",
      `${path}.deviceScaleFactor`,
      "must be the exact value 1 or 2",
    );
  }
  return {
    name: canonicalBodyEnum<"desktop" | "mobile">(record.name, `${path}.name`, VIEWPORT_NAMES),
    width: canonicalBodyInteger(record.width, `${path}.width`, 1, SIGNED_32_BIT_MAXIMUM),
    height: canonicalBodyInteger(record.height, `${path}.height`, 1, SIGNED_32_BIT_MAXIMUM),
    deviceScaleFactor: deviceScaleFactor as 1 | 2,
  };
}

function parseArtifact(
  value: unknown,
  path: string,
  state: CanonicalBodyInspectionState,
): NpAgentPreviewArtifactManifestEntryV1 {
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentPreviewArtifactManifestEntryCanonicalIncludedKeysV1,
    npAgentPreviewArtifactManifestEntryCanonicalIncludedKeysV1,
    state,
  );
  const kind = canonicalBodyEnum<NpAgentPreviewArtifactManifestEntryV1["kind"]>(
    record.kind,
    `${path}.kind`,
    ARTIFACT_KINDS,
  );
  const route =
    record.route === null ? null : canonicalBodyPreviewRoute(record.route, `${path}.route`);
  const locale =
    record.locale === null ? null : canonicalBodyLocale(record.locale, `${path}.locale`);
  const viewport =
    record.viewport === null ? null : parseViewport(record.viewport, `${path}.viewport`, state);
  const reportPart =
    record.reportPart === null
      ? null
      : canonicalBodyInteger(record.reportPart, `${path}.reportPart`, 1, MAXIMUM_REPORTS);
  const reportTotalParts =
    record.reportTotalParts === null
      ? null
      : canonicalBodyInteger(
          record.reportTotalParts,
          `${path}.reportTotalParts`,
          1,
          MAXIMUM_REPORTS,
        );
  const mime = canonicalBodyEnum<NpAgentPreviewArtifactMime>(
    record.mime,
    `${path}.mime`,
    ARTIFACT_MIMES,
  );

  if (kind === "screenshot") {
    if (route === null) {
      failCanonicalBody("invalid-field", `${path}.route`, "must be non-null for a screenshot");
    }
    if (viewport === null) {
      failCanonicalBody("invalid-field", `${path}.viewport`, "must be non-null for a screenshot");
    }
    if (reportPart !== null || reportTotalParts !== null) {
      failCanonicalBody(
        "invalid-field",
        reportPart !== null ? `${path}.reportPart` : `${path}.reportTotalParts`,
        "must be null for a screenshot",
      );
    }
    if (!SCREENSHOT_MIMES.has(mime)) {
      failCanonicalBody("invalid-field", `${path}.mime`, "must be image/png or image/webp");
    }
  } else {
    if (route !== null || locale !== null || viewport !== null) {
      failCanonicalBody(
        "invalid-field",
        route !== null ? `${path}.route` : locale !== null ? `${path}.locale` : `${path}.viewport`,
        "must be null for a report",
      );
    }
    if (reportPart === null || reportTotalParts === null) {
      failCanonicalBody(
        "invalid-field",
        reportPart === null ? `${path}.reportPart` : `${path}.reportTotalParts`,
        "must be non-null for a report",
      );
    }
    if (mime !== "application/json") {
      failCanonicalBody("invalid-field", `${path}.mime`, "must be application/json for a report");
    }
  }

  const createdAt = canonicalBodyUtc(record.createdAt, `${path}.createdAt`);
  const expiresAt = canonicalBodyUtc(record.expiresAt, `${path}.expiresAt`);
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    failCanonicalBody("invalid-field", `${path}.expiresAt`, "must be later than createdAt");
  }

  return {
    ordinal: canonicalBodyInteger(record.ordinal, `${path}.ordinal`, 1, SIGNED_32_BIT_MAXIMUM),
    artifactId: canonicalBodyUuid(record.artifactId, `${path}.artifactId`),
    kind,
    route,
    locale,
    viewport,
    reportPart,
    reportTotalParts,
    contentDigest: canonicalBodyContentDigest(record.contentDigest, `${path}.contentDigest`),
    mime,
    bytes: canonicalBodyInteger(
      record.bytes,
      `${path}.bytes`,
      0,
      kind === "screenshot" ? MAXIMUM_SCREENSHOT_BYTES : MAXIMUM_REPORT_BYTES,
    ),
    createdAt,
    expiresAt,
  };
}

function validateArtifactSet(artifacts: NpAgentPreviewArtifactManifestEntryV1[]): void {
  const path = "agent.canonical.previewArtifactManifest.artifacts";
  const artifactIds = new Set<string>();
  let previousOrdinal: number | null = null;
  let screenshotCount = 0;
  const reports: Array<
    NpAgentPreviewArtifactManifestEntryV1 & {
      kind: "report";
      reportPart: number;
      reportTotalParts: number;
    }
  > = [];
  let commonExpiresAt: string | null = null;

  artifacts.forEach((artifact, index) => {
    const artifactPath = `${path}[${index.toString()}]`;
    if (previousOrdinal !== null && artifact.ordinal <= previousOrdinal) {
      failCanonicalBody(
        artifact.ordinal === previousOrdinal ? "duplicate" : "order",
        `${artifactPath}.ordinal`,
        "must be sorted by unique positive ordinal",
      );
    }
    previousOrdinal = artifact.ordinal;
    if (artifactIds.has(artifact.artifactId)) {
      failCanonicalBody(
        "duplicate",
        `${artifactPath}.artifactId`,
        "must be unique within the manifest",
      );
    }
    artifactIds.add(artifact.artifactId);
    if (commonExpiresAt === null) commonExpiresAt = artifact.expiresAt;
    else if (artifact.expiresAt !== commonExpiresAt) {
      failCanonicalBody(
        "invalid-field",
        `${artifactPath}.expiresAt`,
        "must equal every artifact expiry for the same preview",
      );
    }
    if (artifact.kind === "screenshot") screenshotCount += 1;
    else {
      reports.push(
        artifact as NpAgentPreviewArtifactManifestEntryV1 & {
          kind: "report";
          reportPart: number;
          reportTotalParts: number;
        },
      );
    }
  });

  if (screenshotCount > MAXIMUM_SCREENSHOTS) {
    failCanonicalBody(
      "limit",
      path,
      `may contain at most ${MAXIMUM_SCREENSHOTS.toString()} screenshots`,
    );
  }
  if (reports.length > MAXIMUM_REPORTS) {
    failCanonicalBody("limit", path, `may contain at most ${MAXIMUM_REPORTS.toString()} reports`);
  }
  reports.forEach((report, index) => {
    const expectedPart = index + 1;
    if (report.reportPart !== expectedPart) {
      failCanonicalBody(
        "order",
        `${path}[${artifacts.indexOf(report).toString()}].reportPart`,
        "report parts must be positive and contiguous in artifact order",
      );
    }
    if (report.reportTotalParts !== reports.length) {
      failCanonicalBody(
        "invalid-field",
        `${path}[${artifacts.indexOf(report).toString()}].reportTotalParts`,
        "must byte-equal the complete report-part count",
      );
    }
  });
}

function parsePreviewArtifactManifestCanonical(value: unknown): NpAgentPreviewArtifactManifestV1 {
  const path = "agent.canonical.previewArtifactManifest";
  const state: CanonicalBodyInspectionState = { seen: new WeakSet<object>() };
  const record = canonicalBodyRecord(
    value,
    path,
    npAgentPreviewArtifactManifestCanonicalIncludedKeysV1,
    npAgentPreviewArtifactManifestCanonicalIncludedKeysV1,
    state,
  );
  if (record.schemaVersion !== SCHEMA_VERSION) {
    failCanonicalBody("invalid-field", `${path}.schemaVersion`, `must be ${SCHEMA_VERSION}`);
  }
  const artifactValues = canonicalBodyArray(
    record.artifacts,
    `${path}.artifacts`,
    MAXIMUM_ARTIFACTS,
    state,
  );
  const artifacts = artifactValues.map((artifact, index) =>
    parseArtifact(artifact, `${path}.artifacts[${index.toString()}]`, state),
  );
  validateArtifactSet(artifacts);

  const result: NpAgentPreviewArtifactManifestV1 = {
    schemaVersion: SCHEMA_VERSION,
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
    previewContractFingerprint: canonicalBodySha256Digest(
      record.previewContractFingerprint,
      `${path}.previewContractFingerprint`,
    ),
    artifacts,
  };
  buildAgentCanonicalFoundationBytes(PURPOSE, result);
  return result;
}

export function npAnalyzeAgentPreviewArtifactManifestCanonical(
  value: unknown,
): NpAgentContractResult<NpAgentPreviewArtifactManifestV1> {
  return analyzeCanonicalBody("agent.canonical.previewArtifactManifest", () =>
    parsePreviewArtifactManifestCanonical(value),
  );
}

export function npRequireAgentPreviewArtifactManifestCanonical(
  value: unknown,
): NpAgentPreviewArtifactManifestV1 {
  return npRequireAgentContractResult(
    npAnalyzeAgentPreviewArtifactManifestCanonical(value),
    "Invalid Agent preview-artifact manifest canonical body",
  );
}

export function npBuildAgentPreviewArtifactManifestCanonicalBytes(
  value: unknown,
): NpAgentCanonicalBodyBytesV1<"np.agent-artifact.v1", NpAgentPreviewArtifactManifestV1> {
  return buildAgentCanonicalFoundationBytes(
    PURPOSE,
    npRequireAgentPreviewArtifactManifestCanonical(value),
  ) as unknown as NpAgentCanonicalBodyBytesV1<
    "np.agent-artifact.v1",
    NpAgentPreviewArtifactManifestV1
  >;
}

export async function npDigestAgentPreviewArtifactManifestCanonical(
  value: unknown,
): Promise<`cj1:sha256:${string}`> {
  return digestAgentCanonicalSha256(
    npBuildAgentPreviewArtifactManifestCanonicalBytes(value).domainSeparatedUtf8,
  );
}
