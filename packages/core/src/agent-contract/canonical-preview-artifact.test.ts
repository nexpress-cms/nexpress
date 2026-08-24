import { describe, expect, it } from "vitest";
import {
  npAgentPreviewArtifactCanonicalDiscriminatorCasesV1,
  npAgentPreviewArtifactManifestCanonicalExcludedKeysV1,
  npAgentPreviewArtifactManifestCanonicalIncludedKeysV1,
  npAgentPreviewArtifactManifestEntryCanonicalExcludedKeysV1,
  npAgentPreviewArtifactManifestEntryCanonicalIncludedKeysV1,
  npAgentPreviewArtifactManifestReportIncludedKeysV1,
  npAgentPreviewArtifactManifestScreenshotIncludedKeysV1,
  npAgentPreviewArtifactViewportCanonicalIncludedKeysV1,
  npAnalyzeAgentPreviewArtifactManifestCanonical,
  npBuildAgentPreviewArtifactManifestCanonicalBytes,
  npDigestAgentPreviewArtifactManifestCanonical,
  npRequireAgentPreviewArtifactManifestCanonical,
} from "./canonical-preview-artifact.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentPreviewArtifactKinds,
  npAgentPreviewArtifactMimes,
  type NpAgentContractResult,
  type NpAgentPreviewArtifactManifestEntryV1,
  type NpAgentPreviewArtifactManifestV1,
} from "./types.js";

const decoder = new TextDecoder();
const changeSetId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const previewId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const planHash = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const previewContractFingerprint = "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const contentDigestA = "ac1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const contentDigestB = "ac1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const goldenDigest = "cj1:sha256:Gb15Xz-BgF2_d3C6J31pR7OR3xY2iGLdKSQNumr8qrY";
const expiresAt = "2026-08-31T00:00:00.000Z";

function artifactId(index: number): string {
  return `018f0f30-cd7b-7cc2-8b16-${index.toString(16).padStart(12, "0")}`;
}

function screenshot(
  ordinal: number,
  overrides: Partial<NpAgentPreviewArtifactManifestEntryV1> = {},
): NpAgentPreviewArtifactManifestEntryV1 {
  return {
    ordinal,
    artifactId: artifactId(ordinal + 10),
    kind: "screenshot",
    route: `/articles/${ordinal.toString()}`,
    locale: ordinal % 2 === 0 ? null : "ko-KR",
    viewport: {
      name: ordinal % 2 === 0 ? "mobile" : "desktop",
      width: ordinal % 2 === 0 ? 390 : 1_440,
      height: ordinal % 2 === 0 ? 844 : 900,
      deviceScaleFactor: ordinal % 2 === 0 ? 2 : 1,
    },
    reportPart: null,
    reportTotalParts: null,
    contentDigest: ordinal % 2 === 0 ? contentDigestB : contentDigestA,
    mime: ordinal % 2 === 0 ? "image/webp" : "image/png",
    bytes: 1_024 + ordinal,
    createdAt: "2026-08-24T00:00:00.000Z",
    expiresAt,
    ...overrides,
  };
}

function report(
  ordinal: number,
  part: number,
  totalParts: number,
  overrides: Partial<NpAgentPreviewArtifactManifestEntryV1> = {},
): NpAgentPreviewArtifactManifestEntryV1 {
  return {
    ordinal,
    artifactId: artifactId(ordinal + 100),
    kind: "report",
    route: null,
    locale: null,
    viewport: null,
    reportPart: part,
    reportTotalParts: totalParts,
    contentDigest: part % 2 === 0 ? contentDigestB : contentDigestA,
    mime: "application/json",
    bytes: 2_048 + part,
    createdAt: "2026-08-24T00:01:00.000Z",
    expiresAt,
    ...overrides,
  };
}

function manifest(
  overrides: Partial<NpAgentPreviewArtifactManifestV1> = {},
): NpAgentPreviewArtifactManifestV1 {
  return {
    schemaVersion: "np.agent-preview-artifact-manifest.v1",
    siteId: "docs-site",
    changeSetId,
    previewId,
    generation: 3,
    planHash,
    previewContractFingerprint,
    artifacts: [screenshot(1), screenshot(2), report(3, 1, 2), report(4, 2, 2)],
    ...overrides,
  };
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code, path })]));
}

describe("Agent preview-artifact manifest canonical contract", () => {
  it("publishes the exact top-level, nested, branch, excluded, and discriminator fixtures", () => {
    expect(npAgentPreviewArtifactKinds).toEqual(["screenshot", "report"]);
    expect(npAgentPreviewArtifactMimes).toEqual(["image/png", "image/webp", "application/json"]);
    expect(npAgentPreviewArtifactManifestCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "changeSetId",
      "previewId",
      "generation",
      "planHash",
      "previewContractFingerprint",
      "artifacts",
    ]);
    expect(npAgentPreviewArtifactManifestCanonicalExcludedKeysV1).toEqual([
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
    ]);
    expect(npAgentPreviewArtifactManifestEntryCanonicalIncludedKeysV1).toEqual([
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
    ]);
    expect(npAgentPreviewArtifactManifestEntryCanonicalExcludedKeysV1).toEqual([
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
    ]);
    expect(npAgentPreviewArtifactManifestScreenshotIncludedKeysV1).toEqual(
      npAgentPreviewArtifactManifestEntryCanonicalIncludedKeysV1,
    );
    expect(npAgentPreviewArtifactManifestReportIncludedKeysV1).toEqual(
      npAgentPreviewArtifactManifestEntryCanonicalIncludedKeysV1,
    );
    expect(npAgentPreviewArtifactViewportCanonicalIncludedKeysV1).toEqual([
      "name",
      "width",
      "height",
      "deviceScaleFactor",
    ]);
    expect(npAgentPreviewArtifactCanonicalDiscriminatorCasesV1).toEqual([
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
    ]);
  });

  it("accepts exact screenshot and report branches and returns an independent normalized copy", () => {
    const source = manifest();
    const parsed = npRequireAgentPreviewArtifactManifestCanonical(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed.artifacts).not.toBe(source.artifacts);
    expect(parsed.artifacts[0]).not.toBe(source.artifacts[0]);
    expect(parsed.artifacts[0]?.viewport).not.toBe(source.artifacts[0]?.viewport);
    expect(
      npRequireAgentPreviewArtifactManifestCanonical(manifest({ artifacts: [] })).artifacts,
    ).toEqual([]);
  });

  it("rejects unknown, excluded, accessor, and sparse fields without invoking hostile accessors", () => {
    const invalidTopLevel = [
      { ...manifest(), schemaVersion: "np.agent-preview-artifact-manifest.v2" },
      { ...manifest(), siteId: "Invalid Site" },
      { ...manifest(), changeSetId: "not-a-uuid" },
      { ...manifest(), previewId: "not-a-uuid" },
      { ...manifest(), generation: 0 },
      { ...manifest(), planHash: contentDigestA },
      { ...manifest(), previewContractFingerprint: contentDigestB },
    ];
    for (const value of invalidTopLevel) {
      expect(npAnalyzeAgentPreviewArtifactManifestCanonical(value).ok).toBe(false);
    }
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical({ ...manifest(), digest: planHash }),
      "unknown-field",
      "agent.canonical.previewArtifactManifest.digest",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical({
        ...manifest(),
        artifacts: [{ ...screenshot(1), resourceUri: "nexpress://forbidden" }],
      }),
      "unknown-field",
      "agent.canonical.previewArtifactManifest.artifacts[0].resourceUri",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical({
        ...manifest(),
        artifacts: [
          {
            ...screenshot(1),
            viewport: { ...screenshot(1).viewport, colorScheme: "light" },
          },
        ],
      }),
      "unknown-field",
      "agent.canonical.previewArtifactManifest.artifacts[0].viewport.colorScheme",
    );

    const accessor = manifest() as NpAgentPreviewArtifactManifestV1 & { digest?: string };
    Object.defineProperty(accessor, "digest", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(accessor),
      "shape",
      "agent.canonical.previewArtifactManifest.digest",
    );

    const sparse = new Array<NpAgentPreviewArtifactManifestEntryV1>(1);
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(manifest({ artifacts: sparse })),
      "shape",
      "agent.canonical.previewArtifactManifest.artifacts[0]",
    );
  });

  it("enforces ordinal, identity, report-part, and common-expiry invariants", () => {
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({ artifacts: [screenshot(2), screenshot(1)] }),
      ),
      "order",
      "agent.canonical.previewArtifactManifest.artifacts[1].ordinal",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({ artifacts: [screenshot(1), screenshot(1, { artifactId: artifactId(99) })] }),
      ),
      "duplicate",
      "agent.canonical.previewArtifactManifest.artifacts[1].ordinal",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({
          artifacts: [screenshot(1), screenshot(2, { artifactId: screenshot(1).artifactId })],
        }),
      ),
      "duplicate",
      "agent.canonical.previewArtifactManifest.artifacts[1].artifactId",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({ artifacts: [report(1, 1, 2), report(2, 3, 2)] }),
      ),
      "order",
      "agent.canonical.previewArtifactManifest.artifacts[1].reportPart",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({ artifacts: [report(1, 1, 2), report(2, 2, 1)] }),
      ),
      "invalid-field",
      "agent.canonical.previewArtifactManifest.artifacts[1].reportTotalParts",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({
          artifacts: [screenshot(1), screenshot(2, { expiresAt: "2026-08-30T00:00:00.000Z" })],
        }),
      ),
      "invalid-field",
      "agent.canonical.previewArtifactManifest.artifacts[1].expiresAt",
    );
  });

  it("enforces branch nulls, MIME, route, locale, viewport, digest, and time contracts", () => {
    const invalidCases: Array<[NpAgentPreviewArtifactManifestEntryV1, string]> = [
      [screenshot(1, { route: null }), "route"],
      [screenshot(1, { viewport: null }), "viewport"],
      [screenshot(1, { reportPart: 1 }), "reportPart"],
      [screenshot(1, { reportTotalParts: 1 }), "reportTotalParts"],
      [screenshot(1, { mime: "application/json" }), "mime"],
      [screenshot(1, { route: "/articles/../secret" }), "route"],
      [screenshot(1, { route: "/articles/%2e%2e/secret" }), "route"],
      [screenshot(1, { route: "/articles?draft=1" }), "route"],
      [screenshot(1, { locale: "en-us" }), "locale"],
      [screenshot(1, { contentDigest: planHash }), "contentDigest"],
      [screenshot(1, { expiresAt: "2026-08-24T00:00:00.000Z" }), "expiresAt"],
      [report(1, 1, 1, { route: "/report" }), "route"],
      [report(1, 1, 1, { locale: "ko-KR" }), "locale"],
      [report(1, 1, 1, { viewport: screenshot(1).viewport }), "viewport"],
      [report(1, 1, 1, { reportPart: null }), "reportPart"],
      [report(1, 1, 1, { reportTotalParts: null }), "reportTotalParts"],
      [report(1, 1, 1, { mime: "image/png" }), "mime"],
    ];
    for (const [artifact, field] of invalidCases) {
      expectIssue(
        npAnalyzeAgentPreviewArtifactManifestCanonical(manifest({ artifacts: [artifact] })),
        "invalid-field",
        `agent.canonical.previewArtifactManifest.artifacts[0].${field}`,
      );
    }
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({
          artifacts: [
            screenshot(1, {
              viewport: { name: "desktop", width: 0, height: 900, deviceScaleFactor: 1 },
            }),
          ],
        }),
      ),
      "limit",
      "agent.canonical.previewArtifactManifest.artifacts[0].viewport.width",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({
          artifacts: [
            screenshot(1, {
              viewport: {
                name: "tablet" as "desktop",
                width: 1_024,
                height: 768,
                deviceScaleFactor: 1,
              },
            }),
          ],
        }),
      ),
      "invalid-field",
      "agent.canonical.previewArtifactManifest.artifacts[0].viewport.name",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({
          artifacts: [
            screenshot(1, {
              viewport: {
                name: "desktop",
                width: 1_024,
                height: 768,
                deviceScaleFactor: 3 as 1,
              },
            }),
          ],
        }),
      ),
      "limit",
      "agent.canonical.previewArtifactManifest.artifacts[0].viewport.deviceScaleFactor",
    );
  });

  it("enforces screenshot, report, total, binary-size, and manifest-byte ceilings", () => {
    const maximum = [
      ...Array.from({ length: 20 }, (_, index) => screenshot(index + 1)),
      ...Array.from({ length: 4 }, (_, index) => report(index + 21, index + 1, 4)),
    ];
    expect(
      npAnalyzeAgentPreviewArtifactManifestCanonical(manifest({ artifacts: maximum })).ok,
    ).toBe(true);
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({
          artifacts: Array.from({ length: 21 }, (_, index) => screenshot(index + 1)),
        }),
      ),
      "limit",
      "agent.canonical.previewArtifactManifest.artifacts",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({
          artifacts: [
            report(1, 1, 4),
            report(2, 2, 4),
            report(3, 3, 4),
            report(4, 4, 4),
            report(5, 4, 4),
          ],
        }),
      ),
      "limit",
      "agent.canonical.previewArtifactManifest.artifacts",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({
          artifacts: Array.from({ length: 25 }, (_, index) => screenshot(index + 1)),
        }),
      ),
      "limit",
      "agent.canonical.previewArtifactManifest.artifacts",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({ artifacts: [screenshot(1, { bytes: 2 * 1024 * 1024 + 1 })] }),
      ),
      "limit",
      "agent.canonical.previewArtifactManifest.artifacts[0].bytes",
    );
    expectIssue(
      npAnalyzeAgentPreviewArtifactManifestCanonical(
        manifest({ artifacts: [report(1, 1, 1, { bytes: 512 * 1024 + 1 })] }),
      ),
      "limit",
      "agent.canonical.previewArtifactManifest.artifacts[0].bytes",
    );
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-artifact.v1"]).toBe(256 * 1024);
  });

  it("builds exact domain-separated bytes and a fixed independent manifest digest", async () => {
    const body = manifest();
    const bytes = npBuildAgentPreviewArtifactManifestCanonicalBytes(body);
    expect(bytes.purpose).toBe("np.agent-artifact.v1");
    expect(decoder.decode(bytes.domainSeparatedUtf8)).toBe(
      `np.agent-canonical-json.v1\0np.agent-artifact.v1\0${decoder.decode(bytes.canonicalJsonUtf8)}`,
    );
    expect(decoder.decode(bytes.canonicalJsonUtf8)).not.toContain("resourceUri");
    expect(await npDigestAgentPreviewArtifactManifestCanonical(body)).toBe(goldenDigest);
    expect(
      await npDigestAgentPreviewArtifactManifestCanonical(manifest({ artifacts: [] })),
    ).not.toBe(goldenDigest);
  });
});
