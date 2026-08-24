import { describe, expect, it, vi } from "vitest";

import {
  npAgentBudgetSnapshotCanonicalExcludedKeysV1,
  npAgentBudgetSnapshotCanonicalIncludedKeysV1,
  npAgentBudgetSnapshotCountersIncludedKeysV1,
  npAgentBudgetSnapshotRecipeIncludedKeysV1,
  npAgentBudgetSnapshotReservationIncludedKeysV1,
  npAgentBudgetSnapshotSourceRefIncludedKeysV1,
  npAgentBudgetSnapshotWindowsIncludedKeysV1,
  npAgentBudgetSourceKinds,
  npAgentCanonicalBodyMaxBytesV1,
  npAnalyzeAgentBudgetSnapshotCanonical,
  npBuildAgentBudgetSnapshotCanonicalBytes,
  npDigestAgentBudgetSnapshotCanonical,
  npRequireAgentBudgetSnapshotCanonical,
  type NpAgentBudgetSnapshotCanonicalV1,
  type NpAgentBudgetSnapshotSourceRefV1,
  type NpAgentContractResult,
} from "./index.js";
import { serializeAgentCanonicalJson } from "./canonical-foundation.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const digestB = "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const digestC = "cj1:sha256:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const goldenDigest = "cj1:sha256:Wml3S233WaFeQ_Ttxqy6AfnXWEcx-KXPjQvK3ujLCS4";
const principalId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const agentId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";

function budgetSnapshot(
  overrides: Partial<NpAgentBudgetSnapshotCanonicalV1> = {},
): NpAgentBudgetSnapshotCanonicalV1 {
  return {
    schemaVersion: "np.agent-budget-snapshot.v1",
    siteId: "docs-site",
    principalId,
    agentId,
    recipe: {
      id: "guardian.agent-abuse",
      version: 1,
      fingerprint: digestA,
    },
    capturedAt: "2026-08-24T10:15:30.000Z",
    sourceRefs: [
      { kind: "agent", id: agentId, version: 3, digest: digestA },
      { kind: "deployment", id: null, version: 2, digest: digestB },
      { kind: "recipe", id: "guardian.agent-abuse", version: 1, digest: digestC },
      { kind: "site", id: "docs-site", version: 7, digest: digestA },
    ],
    limits: {
      schemaVersion: "np.agent-run-limits.v1",
      maxAttempts: 3,
      maxProviderCalls: 5,
      maxCapabilityCalls: 8,
      maxInputTokens: 20_000,
      maxOutputTokens: 4_000,
      maxCostMicros: 2_500_000,
      maxWallClockSeconds: 900,
    },
    counters: {
      concurrentRuns: 2,
      concurrentProviderCalls: 1,
      runsRollingHour: 12,
      providerCallsRollingHour: 20,
      inputTokensUtcDay: 120_000,
      outputTokensUtcDay: 18_000,
      inputTokensUtcMonth: 2_000_000,
      outputTokensUtcMonth: 300_000,
      costMicrosUtcDay: 1_250_000,
      costMicrosUtcMonth: 18_750_000,
      incidentAnalysesFingerprintUtcDay: 2,
      directActionsRollingHour: 3,
      directActionsSubjectRollingHour: 1,
    },
    windows: {
      rollingHourStartedAt: "2026-08-24T09:15:30.000Z",
      utcDay: "2026-08-24",
      utcMonth: "2026-08",
    },
    reservation: {
      runs: 1,
      providerCalls: 5,
      inputTokens: 20_000,
      outputTokens: 4_000,
      costMicros: 2_500_000,
    },
    ...overrides,
  };
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

function boundarySourceRef(id: string): NpAgentBudgetSnapshotSourceRefV1 {
  return { kind: "site", id, version: 1, digest: digestA };
}

function canonicalByteLength(body: NpAgentBudgetSnapshotCanonicalV1): number {
  return encoder.encode(serializeAgentCanonicalJson(body)).byteLength;
}

function exactBoundarySnapshot(): NpAgentBudgetSnapshotCanonicalV1 {
  const maximum = npAgentCanonicalBodyMaxBytesV1["np.agent-budget-snapshot.v1"];
  const baseBody = budgetSnapshot({ agentId: null, recipe: null, sourceRefs: [] });
  const tailIds = ["x", "y", "z"];
  const withRefs = (count: number, pads: readonly number[]) =>
    budgetSnapshot({
      agentId: null,
      recipe: null,
      sourceRefs: [
        ...Array.from({ length: count }, (_, index) =>
          boundarySourceRef(`a${index.toString().padStart(6, "0")}`),
        ),
        ...tailIds.map((prefix, index) =>
          boundarySourceRef(`${prefix}${prefix.repeat(pads[index] ?? 0)}`),
        ),
      ],
    });

  const emptyBytes = canonicalByteLength(baseBody);
  const oneEntryBytes = canonicalByteLength(
    budgetSnapshot({
      agentId: null,
      recipe: null,
      sourceRefs: [boundarySourceRef("a000000")],
    }),
  );
  const perEntryBytes = oneEntryBytes - emptyBytes;
  let count = Math.max(0, Math.floor((maximum - emptyBytes) / perEntryBytes) - tailIds.length);
  let candidate = withRefs(count, [0, 0, 0]);
  let remaining = maximum - canonicalByteLength(candidate);
  while (remaining < 0) {
    count -= 1;
    candidate = withRefs(count, [0, 0, 0]);
    remaining = maximum - canonicalByteLength(candidate);
  }
  while (remaining > tailIds.length * 127) {
    count += 1;
    candidate = withRefs(count, [0, 0, 0]);
    remaining = maximum - canonicalByteLength(candidate);
  }

  const pads = [0, 0, 0];
  for (let index = 0; index < pads.length; index += 1) {
    const next = Math.min(127, remaining);
    pads[index] = next;
    remaining -= next;
  }
  expect(remaining).toBe(0);
  return withRefs(count, pads);
}

describe("Agent budget-snapshot canonical body", () => {
  it("publishes the literal included, excluded, and nested field fixtures", () => {
    expect(npAgentBudgetSourceKinds).toEqual(["agent", "deployment", "policy", "recipe", "site"]);
    expect(npAgentBudgetSnapshotCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "principalId",
      "agentId",
      "recipe",
      "capturedAt",
      "sourceRefs",
      "limits",
      "counters",
      "windows",
      "reservation",
    ]);
    expect(npAgentBudgetSnapshotCanonicalExcludedKeysV1).toEqual([
      "snapshotDigest",
      "budgetSnapshotHash",
      "runId",
      "runState",
      "attempt",
      "usage",
      "result",
      "errorCode",
      "leaseUntil",
      "finishedAt",
    ]);
    expect(npAgentBudgetSnapshotRecipeIncludedKeysV1).toEqual(["id", "version", "fingerprint"]);
    expect(npAgentBudgetSnapshotSourceRefIncludedKeysV1).toEqual([
      "kind",
      "id",
      "version",
      "digest",
    ]);
    expect(npAgentBudgetSnapshotCountersIncludedKeysV1).toEqual([
      "concurrentRuns",
      "concurrentProviderCalls",
      "runsRollingHour",
      "providerCallsRollingHour",
      "inputTokensUtcDay",
      "outputTokensUtcDay",
      "inputTokensUtcMonth",
      "outputTokensUtcMonth",
      "costMicrosUtcDay",
      "costMicrosUtcMonth",
      "incidentAnalysesFingerprintUtcDay",
      "directActionsRollingHour",
      "directActionsSubjectRollingHour",
    ]);
    expect(npAgentBudgetSnapshotWindowsIncludedKeysV1).toEqual([
      "rollingHourStartedAt",
      "utcDay",
      "utcMonth",
    ]);
    expect(npAgentBudgetSnapshotReservationIncludedKeysV1).toEqual([
      "runs",
      "providerCalls",
      "inputTokens",
      "outputTokens",
      "costMicros",
    ]);
  });

  it("rebuilds independent runtime, gateway, and deterministic Agent snapshots", () => {
    const runtimeSource = budgetSnapshot();
    const runtime = npRequireAgentBudgetSnapshotCanonical(runtimeSource);
    expect(runtime).toEqual(runtimeSource);
    expect(runtime).not.toBe(runtimeSource);
    expect(runtime.recipe).not.toBe(runtimeSource.recipe);
    expect(runtime.sourceRefs).not.toBe(runtimeSource.sourceRefs);
    expect(runtime.sourceRefs[0]).not.toBe(runtimeSource.sourceRefs[0]);
    expect(runtime.limits).not.toBe(runtimeSource.limits);
    expect(runtime.counters).not.toBe(runtimeSource.counters);
    expect(runtime.windows).not.toBe(runtimeSource.windows);
    expect(runtime.reservation).not.toBe(runtimeSource.reservation);

    const gateway = budgetSnapshot({
      agentId: null,
      recipe: null,
      sourceRefs: [
        { kind: "deployment", id: null, version: 2, digest: digestB },
        { kind: "site", id: "docs-site", version: 7, digest: digestA },
      ],
    });
    expect(npAnalyzeAgentBudgetSnapshotCanonical(gateway).ok).toBe(true);
    expect(npAnalyzeAgentBudgetSnapshotCanonical(budgetSnapshot({ recipe: null })).ok).toBe(true);
    expect(
      npAnalyzeAgentBudgetSnapshotCanonical(
        budgetSnapshot({ agentId: null, recipe: { ...runtimeSource.recipe! } }),
      ).ok,
    ).toBe(false);
  });

  it("enforces exact identities, timestamps, window labels, and nested run limits", () => {
    const invalid: Array<[unknown, string]> = [
      [{ ...budgetSnapshot(), schemaVersion: "np.agent-budget-snapshot.v2" }, "schemaVersion"],
      [{ ...budgetSnapshot(), siteId: "Invalid Site" }, "siteId"],
      [{ ...budgetSnapshot(), principalId: "not-a-uuid" }, "principalId"],
      [{ ...budgetSnapshot(), agentId: "not-a-uuid" }, "agentId"],
      [
        budgetSnapshot({ recipe: { ...budgetSnapshot().recipe!, id: "unknown.recipe" as never } }),
        "recipe.id",
      ],
      [budgetSnapshot({ recipe: { ...budgetSnapshot().recipe!, version: 0 } }), "recipe.version"],
      [
        budgetSnapshot({ recipe: { ...budgetSnapshot().recipe!, fingerprint: "sha256:raw" } }),
        "recipe.fingerprint",
      ],
      [budgetSnapshot({ capturedAt: "2026-08-24T10:15:30Z" }), "capturedAt"],
      [
        budgetSnapshot({ windows: { ...budgetSnapshot().windows, utcDay: "2026-02-29" } }),
        "windows.utcDay",
      ],
      [
        budgetSnapshot({ windows: { ...budgetSnapshot().windows, utcMonth: "2026-13" } }),
        "windows.utcMonth",
      ],
      [
        budgetSnapshot({
          windows: { ...budgetSnapshot().windows, rollingHourStartedAt: "2026-08-24" },
        }),
        "windows.rollingHourStartedAt",
      ],
      [
        budgetSnapshot({ limits: { ...budgetSnapshot().limits, maxProviderCalls: 0 } }),
        "limits.maxProviderCalls",
      ],
    ];
    for (const [value, field] of invalid) {
      expect(npAnalyzeAgentBudgetSnapshotCanonical(value).ok, `expected ${field} to fail`).toBe(
        false,
      );
    }
  });

  it("requires source refs to be canonical sorted unique tuples", () => {
    expectIssue(
      npAnalyzeAgentBudgetSnapshotCanonical(
        budgetSnapshot({
          sourceRefs: [
            { kind: "site", id: "docs-site", version: 1, digest: digestA },
            { kind: "deployment", id: null, version: 1, digest: digestA },
          ],
        }),
      ),
      "order",
      "agent.canonical.budgetSnapshot.sourceRefs[1]",
    );
    const duplicate = { kind: "policy", id: null, version: 1, digest: digestA } as const;
    expectIssue(
      npAnalyzeAgentBudgetSnapshotCanonical(
        budgetSnapshot({ sourceRefs: [duplicate, { ...duplicate }] }),
      ),
      "duplicate",
      "agent.canonical.budgetSnapshot.sourceRefs[1]",
    );
    expect(
      npAnalyzeAgentBudgetSnapshotCanonical(
        budgetSnapshot({
          sourceRefs: [
            { kind: "policy", id: null, version: 1, digest: digestA },
            { kind: "policy", id: null, version: 1, digest: digestB },
            { kind: "policy", id: "policy-1", version: 1, digest: digestA },
            { kind: "policy", id: "policy-1", version: 2, digest: digestA },
          ],
        }),
      ).ok,
    ).toBe(true);
    expect(
      npAnalyzeAgentBudgetSnapshotCanonical(
        budgetSnapshot({
          sourceRefs: [{ kind: "unknown" as never, id: null, version: 1, digest: digestA }],
        }),
      ).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentBudgetSnapshotCanonical(
        budgetSnapshot({
          sourceRefs: [{ kind: "site", id: "contains space", version: 1, digest: digestA }],
        }),
      ).ok,
    ).toBe(false);
  });

  it("enforces non-negative counter/reservation units and their numeric maxima", () => {
    const signedMaximum = 2_147_483_647;
    const safeMaximum = Number.MAX_SAFE_INTEGER;
    expect(
      npAnalyzeAgentBudgetSnapshotCanonical(
        budgetSnapshot({
          counters: {
            ...budgetSnapshot().counters,
            concurrentRuns: signedMaximum,
            costMicrosUtcDay: safeMaximum,
            costMicrosUtcMonth: safeMaximum,
          },
          reservation: {
            runs: signedMaximum,
            providerCalls: signedMaximum,
            inputTokens: signedMaximum,
            outputTokens: signedMaximum,
            costMicros: safeMaximum,
          },
        }),
      ).ok,
    ).toBe(true);

    const invalid = [
      budgetSnapshot({
        counters: { ...budgetSnapshot().counters, concurrentRuns: -1 },
      }),
      budgetSnapshot({
        counters: { ...budgetSnapshot().counters, inputTokensUtcMonth: signedMaximum + 1 },
      }),
      budgetSnapshot({
        counters: { ...budgetSnapshot().counters, costMicrosUtcDay: safeMaximum + 1 },
      }),
      budgetSnapshot({
        reservation: { ...budgetSnapshot().reservation, providerCalls: -1 },
      }),
      budgetSnapshot({
        reservation: { ...budgetSnapshot().reservation, inputTokens: signedMaximum + 1 },
      }),
      budgetSnapshot({
        reservation: { ...budgetSnapshot().reservation, costMicros: safeMaximum + 1 },
      }),
    ];
    for (const value of invalid) {
      expect(npAnalyzeAgentBudgetSnapshotCanonical(value).ok).toBe(false);
    }
  });

  it("rejects unknown fields and hostile object graphs without invoking accessors", () => {
    expect(
      npAnalyzeAgentBudgetSnapshotCanonical({ ...budgetSnapshot(), runId: principalId }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentBudgetSnapshotCanonical(
        budgetSnapshot({ counters: { ...budgetSnapshot().counters, totalTokens: 1 } as never }),
      ).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentBudgetSnapshotCanonical(
        budgetSnapshot({
          sourceRefs: [
            {
              kind: "site",
              id: "docs-site",
              version: 1,
              digest: digestA,
              resolvedAt: "2026-08-24T10:00:00.000Z",
            } as never,
          ],
        }),
      ).ok,
    ).toBe(false);

    const sparse = Array(1) as NpAgentBudgetSnapshotSourceRefV1[];
    expect(npAnalyzeAgentBudgetSnapshotCanonical(budgetSnapshot({ sourceRefs: sparse })).ok).toBe(
      false,
    );

    const shared = { ...budgetSnapshot().counters };
    expect(
      npAnalyzeAgentBudgetSnapshotCanonical(
        budgetSnapshot({ counters: shared, reservation: shared as never }),
      ).ok,
    ).toBe(false);

    const cycle = budgetSnapshot();
    cycle.limits = cycle as never;
    expect(npAnalyzeAgentBudgetSnapshotCanonical(cycle).ok).toBe(false);

    const getter = vi.fn(() => 99);
    const accessorCounters = { ...budgetSnapshot().counters };
    Object.defineProperty(accessorCounters, "concurrentRuns", {
      enumerable: true,
      get: getter,
    });
    expect(
      npAnalyzeAgentBudgetSnapshotCanonical(budgetSnapshot({ counters: accessorCounters })).ok,
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();

    const hostile = new Proxy(budgetSnapshot(), {
      getPrototypeOf() {
        throw new Error("contained");
      },
    });
    expect(npAnalyzeAgentBudgetSnapshotCanonical(hostile)).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-value" }],
    });
  });

  it("enforces the exact 256 KiB body ceiling", () => {
    const maximum = npAgentCanonicalBodyMaxBytesV1["np.agent-budget-snapshot.v1"];
    const exact = exactBoundarySnapshot();
    const built = npBuildAgentBudgetSnapshotCanonicalBytes(exact);
    expect(built.canonicalJsonUtf8).toHaveLength(maximum);

    const sourceRefs = exact.sourceRefs.map((entry) => ({ ...entry }));
    const expandableIndex = sourceRefs.findIndex((entry) => (entry.id?.length ?? 128) < 128);
    expect(expandableIndex).toBeGreaterThanOrEqual(0);
    const expandable = sourceRefs[expandableIndex];
    sourceRefs[expandableIndex] = { ...expandable, id: `${expandable.id}q` };
    expect(npAnalyzeAgentBudgetSnapshotCanonical({ ...exact, sourceRefs }).ok).toBe(false);
  });

  it("locks source-key independence, domain separation, and the golden digest", async () => {
    const body = budgetSnapshot();
    const reordered = {
      reservation: { ...body.reservation },
      windows: { ...body.windows },
      counters: { ...body.counters },
      limits: { ...body.limits },
      sourceRefs: body.sourceRefs.map(({ digest, version, id, kind }) => ({
        digest,
        version,
        id,
        kind,
      })),
      capturedAt: body.capturedAt,
      recipe: body.recipe
        ? {
            fingerprint: body.recipe.fingerprint,
            version: body.recipe.version,
            id: body.recipe.id,
          }
        : null,
      agentId: body.agentId,
      principalId: body.principalId,
      siteId: body.siteId,
      schemaVersion: body.schemaVersion,
    };
    const built = npBuildAgentBudgetSnapshotCanonicalBytes(body);
    expect(decoder.decode(built.domainSeparatedUtf8)).toBe(
      `np.agent-canonical-json.v1\0np.agent-budget-snapshot.v1\0${decoder.decode(built.canonicalJsonUtf8)}`,
    );
    expect(await npDigestAgentBudgetSnapshotCanonical(body)).toBe(goldenDigest);
    expect(await npDigestAgentBudgetSnapshotCanonical(reordered)).toBe(goldenDigest);
    expect(
      await npDigestAgentBudgetSnapshotCanonical(
        budgetSnapshot({
          counters: { ...body.counters, providerCallsRollingHour: 21 },
        }),
      ),
    ).not.toBe(goldenDigest);
  });
});
