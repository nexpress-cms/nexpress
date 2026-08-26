import { describe, expect, it, vi } from "vitest";

import {
  buildAgentCanonicalFoundationBytes,
  serializeAgentCanonicalJson,
} from "./canonical-foundation.js";
import {
  NpAgentContractError,
  npAgentCanonicalBodyMaxBytesV1,
  npAgentSiteDeletionExternalTargetCanonicalIncludedKeysV1,
  npAgentSiteDeletionExternalTargetKinds,
  npAgentSiteDeletionPlanCanonicalExcludedKeysV1,
  npAgentSiteDeletionPlanCanonicalIncludedKeysV1,
  npAgentSiteDeletionRowInventoryCanonicalIncludedKeysV1,
  npAnalyzeAgentSiteDeletionPlanCanonical,
  npBuildAgentSiteDeletionPlanCanonicalBytes,
  npDigestAgentSiteDeletionPlanCanonical,
  npRequireAgentSiteDeletionPlanCanonical,
  type NpAgentContractResult,
  type NpAgentSiteDeletionExternalTargetCanonicalV1,
  type NpAgentSiteDeletionExternalTargetKind,
  type NpAgentSiteDeletionPlanCanonicalV1,
} from "./index.js";

const decoder = new TextDecoder();
const sagaId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const targetIds = [
  "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
  "018f0f30-cd7b-7cc2-8b16-8c052c259bd3",
  "018f0f30-cd7b-7cc2-8b16-8c052c259bd4",
  "018f0f30-cd7b-7cc2-8b16-8c052c259bd5",
  "018f0f30-cd7b-7cc2-8b16-8c052c259bd6",
] as const;
const siteVersionDigest = `sdsv1:sha256:${"A".repeat(43)}`;
const rowIdentityDigestA = `sdri1:sha256:${"B".repeat(42)}A`;
const rowIdentityDigestB = `sdri1:sha256:${"C".repeat(42)}A`;
const requestDigest = `cj1:sha256:${"D".repeat(43)}`;
const goldenDigest = "cj1:sha256:URlBkeG1KsH9JloArdYq9vU0MQs6moHpfkzgoQfaFNk";

function externalTarget(
  kind: NpAgentSiteDeletionExternalTargetKind,
  targetId: string,
): NpAgentSiteDeletionExternalTargetCanonicalV1 {
  return {
    kind,
    targetId,
    requestDigest,
    adapterId: "cleanup.adapter",
    adapterContractVersion: 3,
    adapterFingerprint: "adapter:sha256:frozen-build-3",
    idempotencyKey: `site-delete:${targetId}`,
  };
}

function allExternalTargets(): NpAgentSiteDeletionExternalTargetCanonicalV1[] {
  return [
    externalTarget("connection-operation", targetIds[0]),
    externalTarget("preview-artifact-delete", targetIds[1]),
    externalTarget("preview-artifact-upload", targetIds[2]),
    externalTarget("restriction", targetIds[3]),
    externalTarget("vault-operation", targetIds[4]),
  ];
}

function siteDeletionPlan(
  overrides: Partial<NpAgentSiteDeletionPlanCanonicalV1> = {},
): NpAgentSiteDeletionPlanCanonicalV1 {
  return {
    schemaVersion: "np.agent-site-deletion-plan.v1",
    inventoryVersion: 1,
    sagaId,
    siteId: "docs-site",
    siteVersionDigest,
    preparedAt: "2026-08-26T01:02:03.004Z",
    rowInventory: [
      { table: "np_agent_actions", count: 2, identityDigest: rowIdentityDigestA },
      { table: "np_agent_runs", count: 7, identityDigest: rowIdentityDigestB },
    ],
    externalTargets: allExternalTargets(),
    ...overrides,
  };
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

describe("Agent site-deletion-plan canonical body", () => {
  it("publishes the closed target inventory and exact field fixtures", () => {
    expect(npAgentSiteDeletionExternalTargetKinds).toEqual([
      "restriction",
      "vault-operation",
      "connection-operation",
      "preview-artifact-upload",
      "preview-artifact-delete",
    ]);
    expect(npAgentSiteDeletionPlanCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "inventoryVersion",
      "sagaId",
      "siteId",
      "siteVersionDigest",
      "preparedAt",
      "rowInventory",
      "externalTargets",
    ]);
    expect(npAgentSiteDeletionPlanCanonicalExcludedKeysV1).toEqual([
      "planHash",
      "state",
      "cursor",
      "requestedByUserId",
      "requesterFingerprint",
      "lastErrorCode",
      "leaseUntil",
      "updatedAt",
      "cleanupCompletedAt",
      "attempt",
      "result",
      "receipt",
    ]);
    expect(npAgentSiteDeletionRowInventoryCanonicalIncludedKeysV1).toEqual([
      "table",
      "count",
      "identityDigest",
    ]);
    expect(npAgentSiteDeletionExternalTargetCanonicalIncludedKeysV1).toEqual([
      "kind",
      "targetId",
      "requestDigest",
      "adapterId",
      "adapterContractVersion",
      "adapterFingerprint",
      "idempotencyKey",
    ]);
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-site-deletion-plan.v1"]).toBe(16 * 1024 * 1024);
  });

  it("rebuilds an independent exact plan across every external target kind", () => {
    const plan = siteDeletionPlan();
    const parsed = npRequireAgentSiteDeletionPlanCanonical(plan);
    expect(parsed).toEqual(plan);
    expect(parsed).not.toBe(plan);
    expect(parsed.rowInventory).not.toBe(plan.rowInventory);
    expect(parsed.rowInventory[0]).not.toBe(plan.rowInventory[0]);
    expect(parsed.externalTargets).not.toBe(plan.externalTargets);
    expect(parsed.externalTargets[0]).not.toBe(plan.externalTargets[0]);

    expect(
      npAnalyzeAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({ rowInventory: [], externalTargets: [] }),
      ).ok,
    ).toBe(true);
  });

  it("enforces version, identity, time, digest, and row bounds", () => {
    expect(
      npAnalyzeAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({
          rowInventory: [
            {
              table: `np_agent_${"a".repeat(119)}`,
              count: Number.MAX_SAFE_INTEGER,
              identityDigest: rowIdentityDigestA,
            },
          ],
        }),
      ).ok,
    ).toBe(true);

    const invalid = [
      { ...siteDeletionPlan(), schemaVersion: "np.agent-site-deletion-plan.v2" },
      { ...siteDeletionPlan(), inventoryVersion: 2 },
      siteDeletionPlan({ sagaId: "not-a-uuid" }),
      siteDeletionPlan({ siteId: "Docs Site" }),
      siteDeletionPlan({ siteVersionDigest: siteVersionDigest.replace("sdsv1", "sdri1") }),
      siteDeletionPlan({ siteVersionDigest: `${siteVersionDigest.slice(0, -1)}B` }),
      siteDeletionPlan({ preparedAt: "2026-08-26T01:02:03Z" }),
      siteDeletionPlan({
        rowInventory: [{ table: "agent_runs", count: 1, identityDigest: rowIdentityDigestA }],
      }),
      siteDeletionPlan({
        rowInventory: [
          {
            table: "np_agent_site_deletion_sagas",
            count: 1,
            identityDigest: rowIdentityDigestA,
          },
        ],
      }),
      siteDeletionPlan({
        rowInventory: [{ table: "np_agent_runs", count: -1, identityDigest: rowIdentityDigestA }],
      }),
      siteDeletionPlan({
        rowInventory: [
          {
            table: "np_agent_runs",
            count: Number.MAX_SAFE_INTEGER + 1,
            identityDigest: rowIdentityDigestA,
          },
        ],
      }),
      siteDeletionPlan({
        rowInventory: [
          {
            table: "np_agent_runs",
            count: 1,
            identityDigest: `${rowIdentityDigestA.slice(0, -1)}B`,
          },
        ],
      }),
    ];
    for (const value of invalid)
      expect(npAnalyzeAgentSiteDeletionPlanCanonical(value).ok).toBe(false);
  });

  it("enforces complete bounded facts for all external target branches", () => {
    const first = allExternalTargets()[0];
    expect(
      npAnalyzeAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({
          externalTargets: [
            {
              ...first,
              requestDigest: "r".repeat(128),
              adapterContractVersion: 2_147_483_647,
              adapterFingerprint: "f".repeat(256),
              idempotencyKey: "i".repeat(256),
            },
          ],
        }),
      ).ok,
    ).toBe(true);

    const invalidTargets = [
      { ...first, kind: "artifact" },
      { ...first, targetId: "not-a-uuid" },
      { ...first, requestDigest: "r".repeat(129) },
      { ...first, requestDigest: "unsafe/value" },
      { ...first, adapterId: "INVALID ADAPTER" },
      { ...first, adapterContractVersion: 0 },
      { ...first, adapterContractVersion: 2_147_483_648 },
      { ...first, adapterFingerprint: "" },
      { ...first, adapterFingerprint: "f".repeat(257) },
      { ...first, idempotencyKey: "contains space" },
      { ...first, idempotencyKey: "i".repeat(257) },
    ];
    for (const target of invalidTargets) {
      expect(
        npAnalyzeAgentSiteDeletionPlanCanonical(
          siteDeletionPlan({
            externalTargets: [target as NpAgentSiteDeletionExternalTargetCanonicalV1],
          }),
        ).ok,
      ).toBe(false);
    }
  });

  it("requires rows and targets to be sorted unique by their exact tuples", () => {
    expectIssue(
      npAnalyzeAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({
          rowInventory: [
            { table: "np_agent_runs", count: 7, identityDigest: rowIdentityDigestB },
            { table: "np_agent_actions", count: 2, identityDigest: rowIdentityDigestA },
          ],
        }),
      ),
      "order",
      "agent.canonical.siteDeletionPlan.rowInventory[1].table",
    );
    expectIssue(
      npAnalyzeAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({
          rowInventory: [
            { table: "np_agent_runs", count: 7, identityDigest: rowIdentityDigestB },
            { table: "np_agent_runs", count: 8, identityDigest: rowIdentityDigestA },
          ],
        }),
      ),
      "duplicate",
      "agent.canonical.siteDeletionPlan.rowInventory[1].table",
    );

    const targets = allExternalTargets();
    expectIssue(
      npAnalyzeAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({ externalTargets: [targets[1], targets[0]] }),
      ),
      "order",
      "agent.canonical.siteDeletionPlan.externalTargets[1]",
    );
    expectIssue(
      npAnalyzeAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({
          externalTargets: [
            externalTarget("restriction", targetIds[3]),
            externalTarget("restriction", targetIds[3]),
          ],
        }),
      ),
      "duplicate",
      "agent.canonical.siteDeletionPlan.externalTargets[1]",
    );
    expectIssue(
      npAnalyzeAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({
          externalTargets: [
            externalTarget("restriction", targetIds[4]),
            externalTarget("restriction", targetIds[3]),
          ],
        }),
      ),
      "order",
      "agent.canonical.siteDeletionPlan.externalTargets[1]",
    );
  });

  it("rejects excluded, unknown, missing, shared, sparse, accessor, and hostile inputs", () => {
    expectIssue(
      npAnalyzeAgentSiteDeletionPlanCanonical({ ...siteDeletionPlan(), planHash: "forbidden" }),
      "unknown-field",
      "agent.canonical.siteDeletionPlan.planHash",
    );
    expect(
      npAnalyzeAgentSiteDeletionPlanCanonical({
        ...siteDeletionPlan(),
        rowInventory: [{ ...siteDeletionPlan().rowInventory[0], cursor: "forbidden" }],
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentSiteDeletionPlanCanonical({
        ...siteDeletionPlan(),
        externalTargets: [{ ...allExternalTargets()[0], receipt: "forbidden" }],
      }).ok,
    ).toBe(false);
    const missing = { ...siteDeletionPlan() } as Partial<NpAgentSiteDeletionPlanCanonicalV1>;
    delete missing.preparedAt;
    expect(npAnalyzeAgentSiteDeletionPlanCanonical(missing).ok).toBe(false);

    const sharedRow = siteDeletionPlan().rowInventory[0];
    expect(
      npAnalyzeAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({ rowInventory: [sharedRow, sharedRow] }),
      ).ok,
    ).toBe(false);

    const sparse = siteDeletionPlan();
    sparse.externalTargets = new Array<NpAgentSiteDeletionExternalTargetCanonicalV1>(1);
    expect(npAnalyzeAgentSiteDeletionPlanCanonical(sparse).ok).toBe(false);

    const getter = vi.fn(() => requestDigest);
    const accessorTarget = allExternalTargets()[0];
    Object.defineProperty(accessorTarget, "requestDigest", { enumerable: true, get: getter });
    expect(
      npAnalyzeAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({ externalTargets: [accessorTarget] }),
      ).ok,
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();

    const cyclic = siteDeletionPlan() as unknown as Record<string, unknown>;
    cyclic.rowInventory = [cyclic];
    expect(npAnalyzeAgentSiteDeletionPlanCanonical(cyclic).ok).toBe(false);

    const hostile = new Proxy(siteDeletionPlan(), {
      getPrototypeOf() {
        throw new Error("contained");
      },
    });
    expect(npAnalyzeAgentSiteDeletionPlanCanonical(hostile)).toMatchObject({
      ok: false,
      issues: [{ code: "unsafe-value" }],
    });
  });

  it("locks the exact 16 MiB purpose ceiling before hashing", () => {
    const maximum = npAgentCanonicalBodyMaxBytesV1["np.agent-site-deletion-plan.v1"];
    const exact = buildAgentCanonicalFoundationBytes("np.agent-site-deletion-plan.v1", {
      x: "a".repeat(maximum - 8),
    });
    expect(exact.canonicalJsonUtf8).toHaveLength(maximum);
    expect(() =>
      buildAgentCanonicalFoundationBytes("np.agent-site-deletion-plan.v1", {
        x: "a".repeat(maximum - 7),
      }),
    ).toThrow(NpAgentContractError);
  });

  it("locks source-key independence, domain separation, and the golden digest", async () => {
    const body = siteDeletionPlan();
    const reordered = {
      externalTargets: body.externalTargets.map((target) => ({
        idempotencyKey: target.idempotencyKey,
        adapterFingerprint: target.adapterFingerprint,
        adapterContractVersion: target.adapterContractVersion,
        adapterId: target.adapterId,
        requestDigest: target.requestDigest,
        targetId: target.targetId,
        kind: target.kind,
      })),
      rowInventory: body.rowInventory.map((row) => ({
        identityDigest: row.identityDigest,
        count: row.count,
        table: row.table,
      })),
      preparedAt: body.preparedAt,
      siteVersionDigest: body.siteVersionDigest,
      siteId: body.siteId,
      sagaId: body.sagaId,
      inventoryVersion: body.inventoryVersion,
      schemaVersion: body.schemaVersion,
    };
    expect(serializeAgentCanonicalJson(reordered)).toBe(serializeAgentCanonicalJson(body));
    const built = npBuildAgentSiteDeletionPlanCanonicalBytes(body);
    expect(built.body).toEqual(body);
    expect(built.body).not.toBe(body);
    expect(decoder.decode(built.domainSeparatedUtf8)).toBe(
      `np.agent-canonical-json.v1\0np.agent-site-deletion-plan.v1\0${decoder.decode(built.canonicalJsonUtf8)}`,
    );
    expect(await npDigestAgentSiteDeletionPlanCanonical(body)).toBe(goldenDigest);
    expect(await npDigestAgentSiteDeletionPlanCanonical(reordered)).toBe(goldenDigest);
    expect(
      await npDigestAgentSiteDeletionPlanCanonical(
        siteDeletionPlan({ preparedAt: "2026-08-26T01:02:03.005Z" }),
      ),
    ).not.toBe(goldenDigest);
  });
});
