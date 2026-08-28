import { describe, expect, it } from "vitest";

import {
  npAgentActionProjectionExcludedKeysV1,
  npAgentConnectionWireExcludedKeysV1,
  npAgentPrincipalWireExcludedKeysV1,
  npAgentServiceTokenWireExcludedKeysV1,
  npAgentWireContractRegistryV1,
  npAgentWireContractSchemaVersionsV1,
  npAgentWireContractsV1,
  npAnalyzeAgentActionProjectionV1,
  npAnalyzeAgentActionStateV1,
  npAnalyzeAgentBudgetV1,
  npAnalyzeAgentConnectionV1,
  npAnalyzeAgentCursorPageV1,
  npAnalyzeAgentGatewaySettings,
  npAnalyzeAgentPrincipalV1,
  npAnalyzeAgentServiceTokenV1,
  npAnalyzeAgentRunLimitsCanonical,
  npAnalyzeAgentRunStateV1,
  npAnalyzeAgentRunV1,
  npAnalyzeAgentScopesV1,
  npAnalyzeAgentWireContractV1,
  npDigestAgentWireContractRegistryV1,
  npDigestAgentWireContractV1,
  npRequireAgentActionProjectionV1,
  npRequireAgentBudgetV1,
  npRequireAgentConnectionV1,
  npRequireAgentCursorPageV1,
  npRequireAgentPrincipalV1,
  npRequireAgentServiceTokenV1,
  npRequireAgentRunV1,
  type NpAgentActionProjectionV1,
  type NpAgentBudgetV1,
  type NpAgentConnectionV1,
  type NpAgentGatewaySettingsV1,
  type NpAgentPrincipalV1,
  type NpAgentServiceTokenV1,
  type NpAgentRunLimitsV1,
  type NpAgentRunV1,
  type NpAgentWireContractBodyMapV1,
  type NpAgentWireContractSchemaVersionV1,
} from "./index.js";

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const UUID_4 = "44444444-4444-4444-8444-444444444444";
const UUID_5 = "55555555-5555-4555-8555-555555555555";
const DIGEST_A = `cj1:sha256:${"A".repeat(43)}`;
const DIGEST_B = `cj1:sha256:${"B".repeat(43)}`;
const PRICING_CATALOG = `pc1:sha256:${"C".repeat(43)}`;

function principal(): NpAgentPrincipalV1 {
  return {
    schemaVersion: "np.agent-principal.v1",
    id: UUID_1,
    siteId: "docs-site",
    kind: "external",
    name: "Editorial MCP",
    description: "Read and propose access",
    status: "active",
    scopes: ["content:read", "site:read"],
    authority: {
      kind: "user",
      userId: UUID_2,
      fingerprint: DIGEST_A,
      deletedAt: null,
    },
    rowVersion: 1,
    tokenVersion: 1,
    autonomy: null,
    gatewayExposureCeiling: "propose",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:01:00.000Z",
    revokedAt: null,
  };
}

function serviceToken(): NpAgentServiceTokenV1 {
  return {
    schemaVersion: "np.agent-service-token.v1",
    id: UUID_5,
    siteId: "docs-site",
    principalId: UUID_1,
    name: "Editorial CLI",
    prefix: `npst1_${UUID_5}`,
    status: "active_head",
    scopes: ["content:read", "site:read"],
    transport: "stdio",
    exposureMode: "read",
    audience: "urn:nexpress:agent-gateway:stdio",
    rowVersion: 1,
    expiresAt: "2026-09-27T00:00:00.000Z",
    lastUsedAt: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    overlapExpiresAt: null,
    revokedAt: null,
  };
}

function budget(): NpAgentBudgetV1 {
  return {
    schemaVersion: "np.agent-budget.v1",
    costCurrency: "USD",
    maxConcurrentRuns: null,
    maxConcurrentProviderCalls: null,
    runsPerHour: null,
    providerCallsPerHour: null,
    providerCallsPerRun: null,
    inputTokensPerRun: null,
    outputTokensPerRun: null,
    inputTokensPerDay: null,
    outputTokensPerDay: null,
    inputTokensPerMonth: null,
    outputTokensPerMonth: null,
    costMicrosPerDay: null,
    costMicrosPerMonth: null,
    attemptsPerRun: null,
    capabilityCallsPerRun: null,
    incidentAnalysesPerFingerprintPerDay: null,
    incidentAnalysisCooldownSeconds: null,
    directActionsPerHour: null,
    directActionsPerSubjectPerHour: null,
    warningBasisPoints: 8_000,
  };
}

function connection(): NpAgentConnectionV1 {
  return {
    schemaVersion: "np.agent-connection.v1",
    id: UUID_2,
    siteId: "docs-site",
    kind: "model",
    provider: "openai",
    adapterId: "openai.responses",
    adapterContractVersion: 1,
    adapterFingerprint: DIGEST_A,
    name: "Editorial model",
    authKind: "api_key",
    safeConfig: { model: "gpt-5", region: "us" },
    configVersion: 3,
    configHash: DIGEST_B,
    pricingCatalogFingerprint: PRICING_CATALOG,
    dataProcessingCeiling: "internal-redacted",
    status: "ready",
    credential: { state: "stored", version: 2 },
    verification: {
      verifiedAt: "2026-08-27T00:02:00.000Z",
      configVersion: 3,
      credentialVersion: 2,
      resultDigest: DIGEST_A,
    },
    lastErrorCode: null,
    dependentAgentCount: 1,
    createdBy: UUID_3,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:02:00.000Z",
  };
}

function runLimits(): NpAgentRunLimitsV1 {
  return {
    schemaVersion: "np.agent-run-limits.v1",
    maxAttempts: 2,
    maxProviderCalls: 4,
    maxCapabilityCalls: 8,
    maxInputTokens: 10_000,
    maxOutputTokens: 2_000,
    maxCostMicros: 500_000,
    maxWallClockSeconds: 300,
  };
}

function run(): NpAgentRunV1 {
  return {
    schemaVersion: "np.agent-run.v1",
    id: UUID_3,
    siteId: "docs-site",
    origin: "runtime",
    agent: { id: UUID_4, versionId: UUID_5 },
    principalId: UUID_1,
    rootRunId: UUID_3,
    parentRunId: null,
    causalDepth: 0,
    state: "succeeded",
    goal: "Review the editorial queue",
    runLimits: runLimits(),
    usage: {
      providerCalls: 1,
      capabilityCalls: 2,
      inputTokens: 120,
      cachedInputTokens: 20,
      outputTokens: 40,
      costMicros: 100,
    },
    attempt: 1,
    errorCode: null,
    errorMessage: null,
    queuedAt: "2026-08-27T00:00:00.000Z",
    deadlineAt: "2026-08-27T00:05:00.000Z",
    startedAt: "2026-08-27T00:00:01.000Z",
    finishedAt: "2026-08-27T00:00:02.000Z",
  };
}

function action(): NpAgentActionProjectionV1 {
  return {
    schemaVersion: "np.agent-action-projection.v1",
    id: UUID_4,
    siteId: "docs-site",
    runId: UUID_3,
    sequence: 1,
    capabilityId: "content.query",
    capabilityContractVersion: 1,
    capabilityFingerprint: DIGEST_A,
    effectProfile: { id: "content.query.read", contractVersion: 1 },
    risk: "read",
    state: "succeeded",
    inputRedacted: { collection: "posts" },
    outputRedacted: { count: 2 },
    requiredScopes: ["content:read"],
    targetRefs: [{ kind: "document", collection: "posts", documentId: "welcome" }],
    proposalHash: DIGEST_B,
    approvalId: null,
    verificationState: null,
    errorCode: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    startedAt: "2026-08-27T00:00:01.000Z",
    finishedAt: "2026-08-27T00:00:02.000Z",
  };
}

const gateway: NpAgentGatewaySettingsV1 = {
  schemaVersion: "np.agent-gateway-settings.v1",
  stdio: "read",
  mcpHttp: "disabled",
  agentHttp: "disabled",
};

const fixtures: { [K in NpAgentWireContractSchemaVersionV1]: NpAgentWireContractBodyMapV1[K] } = {
  "np.agent-gateway-settings.v1": gateway,
  "np.agent-principal.v1": principal(),
  "np.agent-service-token.v1": serviceToken(),
  "np.agent-budget.v1": budget(),
  "np.agent-connection.v1": connection(),
  "np.agent-run-limits.v1": runLimits(),
  "np.agent-run.v1": run(),
  "np.agent-action-projection.v1": action(),
};

describe("Agent client-safe wire contract v1", () => {
  it("locks the exhaustive schema registry and reuses canonical run-limit ownership", () => {
    expect(npAgentWireContractSchemaVersionsV1).toEqual([
      "np.agent-gateway-settings.v1",
      "np.agent-principal.v1",
      "np.agent-service-token.v1",
      "np.agent-budget.v1",
      "np.agent-connection.v1",
      "np.agent-run-limits.v1",
      "np.agent-run.v1",
      "np.agent-action-projection.v1",
    ]);
    expect(npAgentWireContractRegistryV1.map(({ schemaVersion }) => schemaVersion)).toEqual(
      npAgentWireContractSchemaVersionsV1,
    );
    expect(Object.keys(npAgentWireContractsV1)).toEqual(npAgentWireContractSchemaVersionsV1);
    expect(Object.isFrozen(npAgentWireContractSchemaVersionsV1)).toBe(true);
    expect(Object.isFrozen(npAgentWireContractRegistryV1)).toBe(true);
    expect(Object.isFrozen(npAgentWireContractRegistryV1[0])).toBe(true);
    expect(npAgentWireContractsV1["np.agent-run-limits.v1"].canonicalPurpose).toBe(
      "np.agent-run-limits.v1",
    );
    expect(
      npAgentWireContractRegistryV1.every(({ sensitivity }) => sensitivity === "client-safe"),
    ).toBe(true);
  });

  it("dispatches every registered schema through one context-free boundary", () => {
    for (const schemaVersion of npAgentWireContractSchemaVersionsV1) {
      const result = npAnalyzeAgentWireContractV1(schemaVersion, fixtures[schemaVersion]);
      expect(result, schemaVersion).toMatchObject({ ok: true });
      if (result.ok) expect(result.value).not.toBe(fixtures[schemaVersion]);
    }

    expect(
      npAnalyzeAgentWireContractV1(
        "np.agent-not-registered.v1" as NpAgentWireContractSchemaVersionV1,
        {},
      ),
    ).toEqual({
      ok: false,
      issues: [
        {
          code: "invalid-field",
          path: "agent.wire.schemaVersion",
          message: "is not a registered Agent wire contract",
        },
      ],
    });
  });

  it("validates sorted scopes and closed run/action states", () => {
    expect(npAnalyzeAgentScopesV1(["content:read", "site:read"])).toEqual({
      ok: true,
      value: ["content:read", "site:read"],
    });
    expect(npAnalyzeAgentScopesV1(["site:read", "content:read"])).toMatchObject({
      ok: false,
      issues: [{ code: "order" }],
    });
    expect(npAnalyzeAgentScopesV1(["site:read", "site:read"])).toMatchObject({
      ok: false,
      issues: [{ code: "duplicate" }],
    });
    expect(npAnalyzeAgentRunStateV1("waiting_approval")).toEqual({
      ok: true,
      value: "waiting_approval",
    });
    expect(npAnalyzeAgentActionStateV1("approval_pending")).toEqual({
      ok: true,
      value: "approval_pending",
    });
    expect(npAnalyzeAgentRunStateV1("complete")).toMatchObject({ ok: false });
    expect(npAnalyzeAgentActionStateV1("cancelled")).toMatchObject({ ok: false });
  });

  it("keeps public principals free of credential and grant identifiers", () => {
    expect(npRequireAgentPrincipalV1(principal())).toEqual(principal());
    expect(npAgentPrincipalWireExcludedKeysV1).toEqual([
      "credentialId",
      "oauthGrantId",
      "clientId",
      "serviceTokenId",
      "tokenHash",
      "refreshFamilyId",
    ]);
    for (const key of npAgentPrincipalWireExcludedKeysV1) {
      expect(
        npAnalyzeAgentPrincipalV1({ ...principal(), [key]: "secret-or-locator" }),
      ).toMatchObject({
        ok: false,
        issues: [{ code: "unknown-field", path: `agent.wire.principal.${key}` }],
      });
    }

    expect(npAnalyzeAgentPrincipalV1({ ...principal(), scopes: ["content:read"] })).toMatchObject({
      ok: false,
      issues: [{ path: "agent.wire.principal.scopes" }],
    });
    expect(
      npAnalyzeAgentPrincipalV1({
        ...principal(),
        kind: "runtime",
        autonomy: "observe",
        gatewayExposureCeiling: "read",
      }),
    ).toMatchObject({ ok: false });
    expect(
      npAnalyzeAgentPrincipalV1({
        ...principal(),
        status: "revoked",
        revokedAt: null,
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.wire.principal.revokedAt" }] });
    expect(
      npAnalyzeAgentPrincipalV1({
        ...principal(),
        authority: {
          ...principal().authority,
          userId: null,
          deletedAt: "2026-08-27T00:00:30.000Z",
        },
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.wire.principal.authority.userId" }] });
  });

  it("returns service-token metadata without verifier or rotation lineage", () => {
    expect(npRequireAgentServiceTokenV1(serviceToken())).toEqual(serviceToken());
    for (const key of npAgentServiceTokenWireExcludedKeysV1) {
      expect(npAnalyzeAgentServiceTokenV1({ ...serviceToken(), [key]: "forbidden" })).toMatchObject(
        {
          ok: false,
          issues: [{ code: "unknown-field", path: `agent.wire.serviceToken.${key}` }],
        },
      );
    }
    expect(
      npAnalyzeAgentServiceTokenV1({ ...serviceToken(), prefix: `npst1_${UUID_4}` }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.wire.serviceToken.prefix" }] });
    expect(
      npAnalyzeAgentServiceTokenV1({
        ...serviceToken(),
        status: "overlap",
        overlapExpiresAt: null,
      }),
    ).toMatchObject({ ok: false });
  });

  it("implements inheritable and concrete budget bounds without treating null as unlimited", () => {
    expect(npRequireAgentBudgetV1(budget())).toEqual(budget());
    expect(npAnalyzeAgentBudgetV1(budget(), { requireConcrete: true })).toMatchObject({
      ok: false,
      issues: [{ path: "agent.wire.budget.maxConcurrentRuns" }],
    });
    const concrete = Object.fromEntries(
      Object.entries(budget()).map(([key, value]) => [key, value === null ? 0 : value]),
    );
    expect(npAnalyzeAgentBudgetV1(concrete, { requireConcrete: true })).toMatchObject({ ok: true });
    expect(npAnalyzeAgentBudgetV1({ ...budget(), inputTokensPerRun: 2_147_483_648 })).toMatchObject(
      { ok: false, issues: [{ code: "limit" }] },
    );
    expect(
      npAnalyzeAgentBudgetV1({ ...budget(), costMicrosPerDay: Number.MAX_SAFE_INTEGER }),
    ).toMatchObject({ ok: true });
    expect(
      npAnalyzeAgentBudgetV1({ ...budget(), incidentAnalysisCooldownSeconds: 86_401 }),
    ).toMatchObject({ ok: false, issues: [{ code: "limit" }] });
    expect(npAnalyzeAgentBudgetV1({ ...budget(), warningBasisPoints: 10_001 })).toMatchObject({
      ok: false,
      issues: [{ code: "limit" }],
    });
  });

  it("redacts connection secret ownership and enforces the status/probe matrix", () => {
    expect(npRequireAgentConnectionV1(connection())).toEqual(connection());
    expect(npAgentConnectionWireExcludedKeysV1).toContain("activeSecretVersionId");
    expect(npAgentConnectionWireExcludedKeysV1).toContain("activeAccountSubjectDigest");
    expect(npAgentConnectionWireExcludedKeysV1).toContain("secretRef");
    for (const key of npAgentConnectionWireExcludedKeysV1) {
      expect(npAnalyzeAgentConnectionV1({ ...connection(), [key]: "forbidden" })).toMatchObject({
        ok: false,
        issues: [{ code: "unknown-field", path: `agent.wire.connection.${key}` }],
      });
    }
    expect(
      npAnalyzeAgentConnectionV1({
        ...connection(),
        safeConfig: { apiKey: "sk-secret" },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "unknown-field", path: "agent.wire.connection.safeConfig.apiKey" }],
    });
    expect(
      npAnalyzeAgentConnectionV1({
        ...connection(),
        safeConfig: { nested: [[{ refreshToken: "secret" }]] },
      }),
    ).toMatchObject({
      ok: false,
      issues: [
        {
          code: "unknown-field",
          path: "agent.wire.connection.safeConfig.nested[0][0].refreshToken",
        },
      ],
    });
    expect(
      npAnalyzeAgentConnectionV1({
        ...connection(),
        verification: { ...connection().verification!, configVersion: 2 },
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.wire.connection.verification" }] });
    expect(
      npAnalyzeAgentConnectionV1({
        ...connection(),
        status: "error",
        lastErrorCode: null,
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.wire.connection.lastErrorCode" }] });
    expect(
      npAnalyzeAgentConnectionV1({
        ...connection(),
        status: "error",
        credential: { state: "absent" },
        lastErrorCode: "PROBE_FAILED",
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.wire.connection.verification" }] });
  });

  it("reuses the canonical run-limit analyzer inside the safe run projection", () => {
    expect(npRequireAgentRunV1(run())).toEqual(run());
    expect(npAnalyzeAgentRunLimitsCanonical(runLimits())).toMatchObject({ ok: true });
    expect(npAnalyzeAgentWireContractV1("np.agent-run-limits.v1", runLimits())).toEqual(
      npAnalyzeAgentRunLimitsCanonical(runLimits()),
    );
    const invalidLimits = { ...runLimits(), maxAttempts: 0 };
    expect(npAnalyzeAgentRunV1({ ...run(), runLimits: invalidLimits })).toMatchObject({
      ok: false,
      issues: [{ path: "agent.wire.run.runLimits.maxAttempts" }],
    });
    expect(npAnalyzeAgentRunV1({ ...run(), origin: "gateway" })).toMatchObject({
      ok: false,
      issues: [{ path: "agent.wire.run.agent" }],
    });
    expect(npAnalyzeAgentRunV1({ ...run(), state: "running", finishedAt: null })).toMatchObject({
      ok: true,
    });
    expect(npAnalyzeAgentRunV1({ ...run(), state: "failed", errorCode: null })).toMatchObject({
      ok: false,
    });
    expect(
      npAnalyzeAgentRunV1({
        ...run(),
        usage: { ...run().usage, providerCalls: runLimits().maxProviderCalls + 1 },
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "limit", path: "agent.wire.run.usage" }] });
    expect(npAnalyzeAgentRunV1({ ...run(), rootRunId: UUID_2 })).toMatchObject({
      ok: false,
      issues: [{ path: "agent.wire.run.parentRunId" }],
    });
  });

  it("keeps action input canonical and opaque recovery evidence off the activity wire", () => {
    expect(npRequireAgentActionProjectionV1(action())).toEqual(action());
    expect(npAgentActionProjectionExcludedKeysV1).toContain("inputCanonical");
    expect(npAgentActionProjectionExcludedKeysV1).toContain("undoRef");
    for (const key of npAgentActionProjectionExcludedKeysV1) {
      expect(npAnalyzeAgentActionProjectionV1({ ...action(), [key]: {} })).toMatchObject({
        ok: false,
        issues: [{ code: "unknown-field", path: `agent.wire.action.${key}` }],
      });
    }
    expect(
      npAnalyzeAgentActionProjectionV1({
        ...action(),
        inputRedacted: { credential: "should-not-render" },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ path: "agent.wire.action.inputRedacted.credential" }],
    });
    expect(
      npAnalyzeAgentActionProjectionV1({
        ...action(),
        targetRefs: [
          { kind: "setting", key: "site.title" },
          { kind: "document", collection: "posts", documentId: "welcome" },
        ],
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "order" }] });
    expect(
      npAnalyzeAgentActionProjectionV1({
        ...action(),
        state: "executing",
        outputRedacted: null,
        finishedAt: null,
      }),
    ).toMatchObject({ ok: true });
    expect(
      npAnalyzeAgentActionProjectionV1({
        ...action(),
        state: "approval_pending",
        outputRedacted: null,
        approvalId: null,
        startedAt: null,
        finishedAt: null,
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.wire.action.approvalId" }] });
  });

  it("provides one exact bounded cursor-page analyzer with nested issue paths", () => {
    const page = {
      schemaVersion: "np.agent-principal-list.v1",
      items: [principal()],
      nextCursor: "cursor-v1",
    };
    const options = {
      schemaVersion: "np.agent-principal-list.v1",
      analyzeItem: npAnalyzeAgentPrincipalV1,
      itemIssueRoot: "agent.wire.principal",
    } as const;
    const parsed = npRequireAgentCursorPageV1(page, options);
    expect(parsed).toEqual(page);
    expect(parsed).not.toBe(page);
    expect(parsed.items[0]).not.toBe(page.items[0]);

    expect(
      npAnalyzeAgentCursorPageV1(
        { ...page, items: [{ ...principal(), status: "unknown" }] },
        options,
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ path: "agent.wire.page.items[0].status" }],
    });
    expect(
      npAnalyzeAgentCursorPageV1({ ...page, nextCursor: "x".repeat(2_049) }, options),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.wire.page.nextCursor" }] });
    expect(
      npAnalyzeAgentCursorPageV1(
        { ...page, items: Array.from({ length: 101 }, () => principal()) },
        options,
      ),
    ).toMatchObject({ ok: false, issues: [{ code: "limit", path: "agent.wire.page.items" }] });
  });

  it("fails hostile prototypes, accessors, symbols, cycles, shared references, and unknown fields", () => {
    const inherited = Object.create({ schemaVersion: "np.agent-principal.v1" });
    Object.assign(inherited, principal());
    expect(npAnalyzeAgentPrincipalV1(inherited)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    const accessor = principal();
    Object.defineProperty(accessor, "name", { enumerable: true, get: () => "unsafe" });
    expect(npAnalyzeAgentPrincipalV1(accessor)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    const symbolic = principal();
    Object.defineProperty(symbolic, Symbol("unsafe"), { enumerable: true, value: true });
    expect(npAnalyzeAgentPrincipalV1(symbolic)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    const cyclic = connection();
    (cyclic.safeConfig as Record<string, unknown>).self = cyclic.safeConfig;
    expect(npAnalyzeAgentConnectionV1(cyclic)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });

    const shared = { safe: true };
    expect(
      npAnalyzeAgentActionProjectionV1({
        ...action(),
        inputRedacted: { first: shared, second: shared },
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "shape" }] });

    expect(npAnalyzeAgentBudgetV1({ ...budget(), unlimited: true })).toMatchObject({
      ok: false,
      issues: [{ code: "unknown-field", path: "agent.wire.budget.unlimited" }],
    });
  });

  it("retains existing gateway behavior through the shared registry", () => {
    expect(npAnalyzeAgentWireContractV1("np.agent-gateway-settings.v1", gateway)).toEqual(
      npAnalyzeAgentGatewaySettings(gateway),
    );
    expect(
      npAnalyzeAgentWireContractV1("np.agent-gateway-settings.v1", {
        ...gateway,
        mcpHttp: "public",
      }),
    ).toMatchObject({ ok: false, issues: [{ path: "agent.gatewaySettings.mcpHttp" }] });
  });

  it("binds per-body and aggregate registry golden fingerprints", async () => {
    await expect(npDigestAgentWireContractV1("np.agent-principal.v1", principal())).resolves.toBe(
      "cj1:sha256:sZAIDeEqc9pyNmGhhHRQbViem9Mp1l4jpzm1Sl6peTA",
    );
    await expect(npDigestAgentWireContractV1("np.agent-connection.v1", connection())).resolves.toBe(
      "cj1:sha256:iW184AUouf0KtJsonVSmfzJ1x3AQZffdd8XLdP7UweE",
    );
    await expect(npDigestAgentWireContractRegistryV1()).resolves.toBe(
      "cj1:sha256:P7QR7hbwpBwmjBYUX-SLAuUkilUmiEpDNwBKfKfg3UQ",
    );
  });
});
