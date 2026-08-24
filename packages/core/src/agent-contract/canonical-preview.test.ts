import { describe, expect, it } from "vitest";
import {
  npAgentPreviewContractCanonicalExcludedKeysV1,
  npAgentPreviewContractCanonicalIncludedKeysV1,
  npAgentPreviewRouteCanonicalIncludedKeysV1,
  npAgentPreviewRoutesCanonicalExcludedKeysV1,
  npAgentPreviewRoutesCanonicalIncludedKeysV1,
  npAnalyzeAgentPreviewContractCanonical,
  npAnalyzeAgentPreviewRoutesCanonical,
  npBuildAgentPreviewContractCanonicalBytes,
  npBuildAgentPreviewRoutesCanonicalBytes,
  npDigestAgentPreviewContractCanonical,
  npDigestAgentPreviewRoutesCanonical,
  npRequireAgentPreviewContractCanonical,
  npRequireAgentPreviewRoutesCanonical,
} from "./canonical-preview.js";
import {
  npAgentCanonicalBodyMaxBytesV1,
  type NpAgentContractResult,
  type NpAgentPreviewContractCanonicalV1,
  type NpAgentPreviewRouteCanonicalV1,
  type NpAgentPreviewRoutesCanonicalV1,
} from "./types.js";

const decoder = new TextDecoder();
const changeSetId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const previewId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const planHash = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const previewContractGoldenDigest = "cj1:sha256:O_M_cuc93tC2D5GOh5RvdYeDuYf8TzK7AgshQbiiXkY";
const previewRoutesGoldenDigest = "cj1:sha256:txYck2AlvNFs4E1D5F4maBYIptjesc_sjkmakgiTulU";

function previewContract(
  overrides: Partial<NpAgentPreviewContractCanonicalV1> = {},
): NpAgentPreviewContractCanonicalV1 {
  return {
    schemaVersion: "np.agent-preview-contract.v1",
    overlayResolverVersion: 2,
    rendererId: "next-overlay",
    rendererVersion: 3,
    rendererFingerprint: "sha256:next-overlay-v3",
    screenshotAdapterId: "playwright",
    screenshotAdapterVersion: 1,
    screenshotAdapterFingerprint: "sha256:playwright-v1",
    routeParserVersion: 2,
    checkRegistryVersion: 4,
    linkAllowlistVersion: 1,
    linkAllowlistOrigins: ["https://assets.example.com", "https://docs.example.com:8443"],
    networkPolicyVersion: 3,
    artifactLimitsVersion: 1,
    reportSchemaVersion: 2,
    responseHeaderBuilderVersion: 1,
    cspBuilderVersion: 5,
    ...overrides,
  };
}

function route(
  path: string,
  locale: string | null,
  overrides: Partial<NpAgentPreviewRouteCanonicalV1> = {},
): NpAgentPreviewRouteCanonicalV1 {
  return { route: path, locale, audience: "public", ...overrides };
}

function previewRoutes(
  overrides: Partial<NpAgentPreviewRoutesCanonicalV1> = {},
): NpAgentPreviewRoutesCanonicalV1 {
  return {
    schemaVersion: "np.agent-preview-routes.v1",
    siteId: "docs-site",
    changeSetId,
    previewId,
    generation: 3,
    planHash,
    routes: [
      route("/", null),
      route("/about", null),
      route("/about", "en-US"),
      route("/문서", "ko-KR"),
    ],
    ...overrides,
  };
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code, path })]));
}

describe("Agent preview contract and route canonical bodies", () => {
  it("publishes exact included and excluded field fixtures", () => {
    expect(npAgentPreviewContractCanonicalIncludedKeysV1).toEqual([
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
    ]);
    expect(npAgentPreviewContractCanonicalExcludedKeysV1).toEqual([
      "previewContractFingerprint",
      "registeredAt",
      "rendererImplementation",
      "screenshotAdapterImplementation",
      "routeParserImplementation",
      "checkRegistryImplementation",
    ]);
    expect(npAgentPreviewRoutesCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "changeSetId",
      "previewId",
      "generation",
      "planHash",
      "routes",
    ]);
    expect(npAgentPreviewRoutesCanonicalExcludedKeysV1).toEqual([
      "allowedRoutesDigest",
      "resourceUri",
      "viewerToken",
      "renderToken",
      "launchId",
      "launchGeneration",
      "createdAt",
      "expiresAt",
    ]);
    expect(npAgentPreviewRouteCanonicalIncludedKeysV1).toEqual(["route", "locale", "audience"]);
  });

  it("accepts adapter, adapter-free, empty, and Unicode-route bodies as independent copies", () => {
    const contractSource = previewContract();
    const routesSource = previewRoutes();
    const parsedContract = npRequireAgentPreviewContractCanonical(contractSource);
    const parsedRoutes = npRequireAgentPreviewRoutesCanonical(routesSource);
    expect(parsedContract).toEqual(contractSource);
    expect(parsedRoutes).toEqual(routesSource);
    expect(parsedContract).not.toBe(contractSource);
    expect(parsedContract.linkAllowlistOrigins).not.toBe(contractSource.linkAllowlistOrigins);
    expect(parsedRoutes).not.toBe(routesSource);
    expect(parsedRoutes.routes).not.toBe(routesSource.routes);
    expect(parsedRoutes.routes[0]).not.toBe(routesSource.routes[0]);
    expect(
      npRequireAgentPreviewContractCanonical(
        previewContract({
          screenshotAdapterId: null,
          screenshotAdapterVersion: null,
          screenshotAdapterFingerprint: null,
          linkAllowlistOrigins: [],
        }),
      ).screenshotAdapterId,
    ).toBeNull();
    expect(npRequireAgentPreviewRoutesCanonical(previewRoutes({ routes: [] })).routes).toEqual([]);
    expect(
      npAnalyzeAgentPreviewRoutesCanonical(
        previewRoutes({ routes: [route("/\uE000", null), route("/𐀀", null)] }),
      ).ok,
    ).toBe(true);
  });

  it("rejects unknown, excluded, accessor, sparse, and shared-reference values safely", () => {
    expectIssue(
      npAnalyzeAgentPreviewContractCanonical({
        ...previewContract(),
        previewContractFingerprint: planHash,
      }),
      "unknown-field",
      "agent.canonical.previewContract.previewContractFingerprint",
    );
    expectIssue(
      npAnalyzeAgentPreviewRoutesCanonical({
        ...previewRoutes(),
        allowedRoutesDigest: planHash,
      }),
      "unknown-field",
      "agent.canonical.previewRoutes.allowedRoutesDigest",
    );
    expectIssue(
      npAnalyzeAgentPreviewRoutesCanonical(
        previewRoutes({
          routes: [
            { ...route("/", null), resourceUri: "forbidden" } as NpAgentPreviewRouteCanonicalV1,
          ],
        }),
      ),
      "unknown-field",
      "agent.canonical.previewRoutes.routes[0].resourceUri",
    );

    const accessor = previewContract() as NpAgentPreviewContractCanonicalV1 & {
      registeredAt?: string;
    };
    Object.defineProperty(accessor, "registeredAt", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expectIssue(
      npAnalyzeAgentPreviewContractCanonical(accessor),
      "shape",
      "agent.canonical.previewContract.registeredAt",
    );

    const sparse = new Array<NpAgentPreviewRouteCanonicalV1>(1);
    expectIssue(
      npAnalyzeAgentPreviewRoutesCanonical(previewRoutes({ routes: sparse })),
      "shape",
      "agent.canonical.previewRoutes.routes[0]",
    );

    const shared = route("/", null);
    expectIssue(
      npAnalyzeAgentPreviewRoutesCanonical(previewRoutes({ routes: [shared, shared] })),
      "shape",
      "agent.canonical.previewRoutes.routes[1]",
    );
  });

  it("enforces positive versions, identifiers, fingerprints, and the adapter triple", () => {
    const versionFields = [
      "overlayResolverVersion",
      "rendererVersion",
      "screenshotAdapterVersion",
      "routeParserVersion",
      "checkRegistryVersion",
      "linkAllowlistVersion",
      "networkPolicyVersion",
      "artifactLimitsVersion",
      "reportSchemaVersion",
      "responseHeaderBuilderVersion",
      "cspBuilderVersion",
    ] as const;
    for (const field of versionFields) {
      const value = previewContract();
      value[field] = 0;
      expect(npAnalyzeAgentPreviewContractCanonical(value).ok, `expected ${field} to fail`).toBe(
        false,
      );
    }

    const invalidContracts: Array<[NpAgentPreviewContractCanonicalV1, string]> = [
      [
        previewContract({
          schemaVersion: "np.agent-preview-contract.v2" as "np.agent-preview-contract.v1",
        }),
        "schemaVersion",
      ],
      [previewContract({ rendererId: "Invalid Renderer" }), "rendererId"],
      [previewContract({ rendererFingerprint: "contains space" }), "rendererFingerprint"],
      [previewContract({ rendererFingerprint: "a".repeat(257) }), "rendererFingerprint"],
      [previewContract({ screenshotAdapterVersion: null }), "screenshotAdapterId"],
      [previewContract({ screenshotAdapterId: null }), "screenshotAdapterId"],
      [previewContract({ screenshotAdapterFingerprint: null }), "screenshotAdapterId"],
      [previewContract({ cspBuilderVersion: 2_147_483_648 }), "cspBuilderVersion"],
    ];
    for (const [value, field] of invalidContracts) {
      expect(npAnalyzeAgentPreviewContractCanonical(value).ok, `expected ${field} to fail`).toBe(
        false,
      );
    }
  });

  it("enforces canonical sorted unique queryless HTTPS allowlist origins", () => {
    const invalidOrigins = [
      "http://assets.example.com",
      "https://assets.example.com/",
      "https://assets.example.com/path",
      "https://assets.example.com?mode=preview",
      "https://assets.example.com#preview",
      "https://user@assets.example.com",
      "https://ASSETS.example.com",
      "https://assets.example.com:443",
    ];
    for (const origin of invalidOrigins) {
      expectIssue(
        npAnalyzeAgentPreviewContractCanonical(previewContract({ linkAllowlistOrigins: [origin] })),
        "invalid-field",
        "agent.canonical.previewContract.linkAllowlistOrigins[0]",
      );
    }
    expectIssue(
      npAnalyzeAgentPreviewContractCanonical(
        previewContract({
          linkAllowlistOrigins: ["https://docs.example.com", "https://assets.example.com"],
        }),
      ),
      "order",
      "agent.canonical.previewContract.linkAllowlistOrigins[1]",
    );
    expectIssue(
      npAnalyzeAgentPreviewContractCanonical(
        previewContract({
          linkAllowlistOrigins: ["https://assets.example.com", "https://assets.example.com"],
        }),
      ),
      "duplicate",
      "agent.canonical.previewContract.linkAllowlistOrigins[1]",
    );
  });

  it("enforces route identity, branch values, and Unicode tuple ordering", () => {
    const invalidBodies: Array<[NpAgentPreviewRoutesCanonicalV1, string]> = [
      [
        previewRoutes({
          schemaVersion: "np.agent-preview-routes.v2" as "np.agent-preview-routes.v1",
        }),
        "schemaVersion",
      ],
      [previewRoutes({ siteId: "Invalid Site" }), "siteId"],
      [previewRoutes({ changeSetId: "not-a-uuid" }), "changeSetId"],
      [previewRoutes({ previewId: "not-a-uuid" }), "previewId"],
      [previewRoutes({ generation: 0 }), "generation"],
      [
        previewRoutes({ planHash: "ac1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
        "planHash",
      ],
      [previewRoutes({ routes: [route("https://example.com/about", null)] }), "route"],
      [previewRoutes({ routes: [route("/about?draft=1", null)] }), "route"],
      [previewRoutes({ routes: [route("/about/%2e%2e/admin", null)] }), "route"],
      [previewRoutes({ routes: [route("/about", "en-us")] }), "locale"],
      [
        previewRoutes({ routes: [route("/about", null, { audience: "member" as "public" })] }),
        "audience",
      ],
    ];
    for (const [value, field] of invalidBodies) {
      expect(npAnalyzeAgentPreviewRoutesCanonical(value).ok, `expected ${field} to fail`).toBe(
        false,
      );
    }
    expectIssue(
      npAnalyzeAgentPreviewRoutesCanonical(
        previewRoutes({ routes: [route("/about", "en-US"), route("/about", null)] }),
      ),
      "order",
      "agent.canonical.previewRoutes.routes[1]",
    );
    expectIssue(
      npAnalyzeAgentPreviewRoutesCanonical(
        previewRoutes({ routes: [route("/about", null), route("/about", null)] }),
      ),
      "duplicate",
      "agent.canonical.previewRoutes.routes[1]",
    );
    expectIssue(
      npAnalyzeAgentPreviewRoutesCanonical(
        previewRoutes({ routes: [route("/𐀀", null), route("/\uE000", null)] }),
      ),
      "order",
      "agent.canonical.previewRoutes.routes[1]",
    );
  });

  it("locks body ceilings, domain separation, and independent golden digests", async () => {
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-preview-contract.v1"]).toBe(64 * 1024);
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-preview-routes.v1"]).toBe(256 * 1024);
    expect(
      npAnalyzeAgentPreviewContractCanonical(
        previewContract({
          linkAllowlistOrigins: Array.from(
            { length: 3_000 },
            (_, index) => `https://asset-${index.toString().padStart(4, "0")}.example.com`,
          ),
        }),
      ).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentPreviewRoutesCanonical(
        previewRoutes({
          routes: Array.from({ length: 100 }, (_, index) =>
            route(`/${index.toString().padStart(4, "0")}-${"a".repeat(3_000)}`, null),
          ),
        }),
      ).ok,
    ).toBe(false);

    const contractBody = previewContract();
    const routesBody = previewRoutes();
    const contractBytes = npBuildAgentPreviewContractCanonicalBytes(contractBody);
    const routesBytes = npBuildAgentPreviewRoutesCanonicalBytes(routesBody);
    expect(decoder.decode(contractBytes.domainSeparatedUtf8)).toBe(
      `np.agent-canonical-json.v1\0np.agent-preview-contract.v1\0${decoder.decode(contractBytes.canonicalJsonUtf8)}`,
    );
    expect(decoder.decode(routesBytes.domainSeparatedUtf8)).toBe(
      `np.agent-canonical-json.v1\0np.agent-preview-routes.v1\0${decoder.decode(routesBytes.canonicalJsonUtf8)}`,
    );
    expect(await npDigestAgentPreviewContractCanonical(contractBody)).toBe(
      previewContractGoldenDigest,
    );
    expect(await npDigestAgentPreviewRoutesCanonical(routesBody)).toBe(previewRoutesGoldenDigest);
    expect(
      await npDigestAgentPreviewContractCanonical(
        previewContract({ screenshotAdapterId: "chromium" }),
      ),
    ).not.toBe(previewContractGoldenDigest);
    expect(
      await npDigestAgentPreviewRoutesCanonical(previewRoutes({ routes: [route("/", null)] })),
    ).not.toBe(previewRoutesGoldenDigest);
  });
});
