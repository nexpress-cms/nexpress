import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import type { npAgentActions, npAgentRuns } from "../db/schema/agent.js";
import { npAgentRuntimeReceipts } from "../db/schema/guardian-runtime.js";
import { createAgentGuardianRuntimeObservationServiceV1 } from "./guardian-runtime-observation.js";
import {
  npCreateAgentRuntimeTerminalObservationV1,
  npReadAgentRuntimeTerminalObservationV1,
  npMarkAgentRuntimeScopeDeniedV1,
  npReadAgentRuntimeScopeDeniedV1,
  npObserveAgentRuntimeActionV1,
  npObserveAgentRuntimeFactV1,
  npRequireAgentRuntimeCostSourceFactV1,
  setAgentGuardianRuntimeObserverV1,
  resetAgentGuardianRuntimeObserverV1,
  type NpAgentGuardianRuntimeObservationV1,
} from "./guardian-runtime-observer.js";

const mocks = vi.hoisted(() => ({ integrity: vi.fn(), admission: vi.fn(), runtime: vi.fn() }));
vi.mock("./runtime-execution-store.js", () => ({
  npRequireAgentRuntimeExecutionIntegrityV1: mocks.integrity,
}));
vi.mock("./guardian-capture-admission.js", () => ({
  npReadAgentGuardianCaptureAdmissionV1: mocks.admission,
}));
vi.mock("./runtime-controls.js", () => ({ npWithAgentRuntimeControlTransactionV1: mocks.runtime }));
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = `cj1:sha256:${"A".repeat(43)}`;
function fixture() {
  mocks.integrity.mockResolvedValue(undefined);
  mocks.admission.mockResolvedValue({ state: "enabled-by-registration" });
  const rows: Record<string, unknown>[] = [];
  const returning = vi.fn(() => Promise.resolve([{ id: id(99) }]));
  const values = vi.fn((row: Record<string, unknown>) => {
    rows.push(row);
    return { onConflictDoUpdate: vi.fn(() => ({ returning })) };
  });
  const insert = vi.fn(() => ({ values }));
  const execute = vi.fn((_query: SQL) =>
    Promise.resolve({
      rows: [
        {
          statement_original: "250ms",
          statement_milliseconds: 250,
          lock_original: "25ms",
          lock_milliseconds: 25,
        },
      ],
    }),
  );
  const db = { insert, execute } as unknown as NpAgentGuardianRuntimeObservationV1["db"];
  // These source-component units intentionally stub canonical Run authentication.
  // Full actual admission/source proof is covered only by the PostgreSQL suite.
  const run = {
    id: id(1),
    siteId: "default",
    origin: "runtime",
    agentId: id(2),
    agentVersionId: id(3),
    principalId: id(4),
    admissionFingerprint: hash,
  } as typeof npAgentRuns.$inferSelect;
  const input: NpAgentGuardianRuntimeObservationV1 = {
    db,
    run,
    occurredAt: new Date("2026-10-18T00:01:00.000Z"),
    fact: {
      kind: "action-admitted",
      actionId: id(5),
      sequence: 1,
      capabilityId: "content.query",
      actionDigest: hash,
    },
  };
  const authorize = vi.fn(async () => {}),
    record =
      vi.fn<
        Parameters<typeof createAgentGuardianRuntimeObservationServiceV1>[0]["events"]["record"]
      >();
  const resolveReceiptKey = vi.fn(() => new Uint8Array(32).fill(2)),
    now = vi.fn(() => new Date("2026-10-18T00:02:00.000Z"));
  const options = {
    receiptKey: { id: "local:runtime:v1", bytes: new Uint8Array(32).fill(1) },
    installedSiteIds: ["default"],
    authorize,
    events: { record },
    resolveReceiptKey,
    now,
  };
  return {
    input,
    options,
    source: createAgentGuardianRuntimeObservationServiceV1(options),
    rows,
    insert,
    execute,
    returning,
    authorize,
    record,
    resolveReceiptKey,
    now,
  };
}
afterEach(() => {
  resetAgentGuardianRuntimeObserverV1();
  vi.clearAllMocks();
});

describe("Guardian Runtime source-only capture component", () => {
  it("requires explicit key/catalog and performs no initialization", () => {
    const f = fixture();
    for (const receiptKey of [
      { id: "bad key", bytes: new Uint8Array(32) },
      { id: "short", bytes: new Uint8Array(31) },
    ])
      expect(() =>
        createAgentGuardianRuntimeObservationServiceV1({ ...f.options, receiptKey }),
      ).toThrow();
    expect(() =>
      createAgentGuardianRuntimeObservationServiceV1({
        ...f.options,
        installedSiteIds: ["WrongSite"],
      }),
    ).toThrow();
    expect(f.insert).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("signs one source receipt in the supplied transaction with a separately namespaced deterministic identity", async () => {
    const f = fixture();
    await f.source.observer.record(f.input);
    expect(f.insert).toHaveBeenCalledExactlyOnceWith(npAgentRuntimeReceipts);
    expect(f.rows).toHaveLength(1);
    const row = f.rows[0];
    expect(row).toMatchObject({
      siteId: "default",
      agentId: id(2),
      agentVersionId: id(3),
      runId: id(1),
      principalId: id(4),
      state: "pending",
      body: { fact: f.input.fact, runAdmissionDigest: hash },
    });
    expect([id(1), id(2), id(3), id(4), id(5)]).not.toContain(row.id);
    const bodyHash = `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(row.body)).digest("base64url")}`;
    expect(row.bodyHash).toBe(bodyHash);
    expect(row.sourceMac).toBe(
      `hmac-sha256:${createHmac("sha256", new Uint8Array(32).fill(1))
        .update("np.agent-guardian-runtime-source.v1\0")
        .update(
          serializeAgentCanonicalJson({
            receiptId: row.id,
            siteId: "default",
            keyId: "local:runtime:v1",
            bodyHash,
            body: row.body,
          }),
        )
        .digest("base64url")}`,
    );
    await f.source.observer.record(f.input);
    expect(f.rows[1].id).toBe(row.id);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
    expect(f.resolveReceiptKey).not.toHaveBeenCalled();
    expect(f.now).not.toHaveBeenCalled();
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("copies key/catalog options and restores stricter inherited statement/lock budgets", async () => {
    const f = fixture();
    f.options.receiptKey.bytes.fill(9);
    f.options.installedSiteIds.length = 0;
    await f.source.observer.record(f.input);
    expect(f.rows).toHaveLength(1);
    const dialect = new PgDialect();
    const queries = f.execute.mock.calls.map((call) => dialect.sqlToQuery(call[0]));
    expect(queries[1].params).toEqual(["250ms", "25ms"]);
    expect(queries.at(-1)?.params).toEqual(["250ms", "25ms"]);
    expect(f.rows[0].sourceMac).not.toBe(`hmac-sha256:${"A".repeat(43)}`);
  });
  it("skips disabled/uninstalled capture and rejects invalid dates, raw arguments or forged canonical Runs before insert", async () => {
    const f = fixture();
    mocks.admission.mockResolvedValue({ state: "disabled" });
    await f.source.observer.record(f.input);
    expect(f.rows).toHaveLength(0);
    mocks.admission.mockResolvedValue({ state: "enabled-by-registration" });
    await f.source.observer.record({ ...f.input, run: { ...f.input.run, siteId: "other" } });
    expect(f.rows).toHaveLength(0);
    await expect(
      f.source.observer.record({ ...f.input, occurredAt: new Date(NaN) }),
    ).rejects.toThrow();
    await expect(
      f.source.observer.record({
        ...f.input,
        fact: {
          ...f.input.fact,
          input: "private",
        } as unknown as NpAgentGuardianRuntimeObservationV1["fact"],
      }),
    ).rejects.toThrow();
    mocks.integrity.mockRejectedValueOnce(new Error("Invalid canonical Run"));
    await expect(f.source.observer.record(f.input)).rejects.toThrow();
    expect(f.rows).toHaveLength(0);
  });
  it("fails closed on a conflicting source identity while restoring inherited budgets", async () => {
    const f = fixture();
    f.returning.mockResolvedValueOnce([]);
    await expect(f.source.observer.record(f.input)).rejects.toThrow();
    expect(f.execute).toHaveBeenCalledTimes(3);
    expect(f.record).not.toHaveBeenCalled();
  });
});

describe("Guardian Runtime owning observer seam", () => {
  it("does no work while absent and keeps installed callback failures visible to the owning transaction", async () => {
    resetAgentGuardianRuntimeObserverV1();
    const f = fixture();
    await npObserveAgentRuntimeActionV1({
      db: f.input.db,
      run: {} as typeof npAgentRuns.$inferSelect,
      action: {} as typeof npAgentActions.$inferSelect,
    });
    expect(f.execute).not.toHaveBeenCalled();
    const record = vi.fn(() => Promise.reject(new Error("atomic source failure")));
    setAgentGuardianRuntimeObserverV1({ record });
    await expect(npObserveAgentRuntimeFactV1(f.input)).rejects.toMatchObject({
      code: "GUARDIAN_RUNTIME_SOURCE_INVALID",
    });
    expect(record).toHaveBeenCalledWith(f.input);
  });
  it("binds only real Runtime Action rows and captures the installed observer once", async () => {
    const f = fixture(),
      record = vi.fn(() => {
        resetAgentGuardianRuntimeObserverV1();
        return Promise.resolve();
      });
    setAgentGuardianRuntimeObserverV1({ record });
    const action = {
      id: id(5),
      siteId: "default",
      runId: id(1),
      runFingerprint: hash,
      sequence: 1,
      capabilityId: "content.query",
      inputHash: hash,
      createdAt: f.input.occurredAt,
    };
    await npObserveAgentRuntimeActionV1({ db: f.input.db, run: f.input.run, action });
    expect(record).toHaveBeenCalledExactlyOnceWith(f.input);
    setAgentGuardianRuntimeObserverV1({ record });
    await expect(
      npObserveAgentRuntimeActionV1({
        db: f.input.db,
        run: f.input.run,
        action: { ...action, runId: id(99) },
      }),
    ).rejects.toThrow();
  });
  it("uses opaque terminal proof carriers and exact missing-scope marks without changing public errors", () => {
    setAgentGuardianRuntimeObserverV1({ record: async () => {} });
    const fact = {
      kind: "scope-denied" as const,
      capabilityId: "content.query" as const,
      missingScopes: ["content:read" as const],
      response: { providerCallId: id(6), sequence: 1, responseDigest: hash },
    };
    const carrier = npCreateAgentRuntimeTerminalObservationV1(fact);
    if (!carrier) throw new Error("Expected carrier");
    fact.missingScopes.length = 0;
    expect(npReadAgentRuntimeTerminalObservationV1(carrier).kind).toBe("scope-denied");
    expect(() => npReadAgentRuntimeTerminalObservationV1({ ...carrier })).toThrow();
    const error = new Error("unchanged");
    expect(
      npMarkAgentRuntimeScopeDeniedV1(error, {
        capabilityId: "content.query",
        missingScopes: ["content:read", "content:read"],
      }),
    ).toBe(error);
    expect(npReadAgentRuntimeScopeDeniedV1(error)).toEqual({
      capabilityId: "content.query",
      missingScopes: ["content:read"],
    });
    expect(npReadAgentRuntimeScopeDeniedV1(new Error("CAPABILITY_UNAVAILABLE"))).toBeNull();
  });
  it("derives cost facts from actual accounting snapshots, keeping unknown charges distinct and rejecting phase spoofing", () => {
    const f = fixture();
    const base = {
      run: f.input.run,
      call: {
        siteId: "default",
        runId: id(1),
        id: id(6),
        state: "ambiguous",
        usageReservationId: id(7),
        sequence: 1,
        requestDigest: hash,
      } as unknown as NonNullable<NpAgentGuardianRuntimeObservationV1["accountingSource"]>["call"],
      reservation: {
        siteId: "default",
        runId: id(1),
        agentId: id(2),
        id: id(7),
        state: "reserved",
        actualCostMicros: null,
        actualCostSource: null,
        budgetChargeCostMicros: null,
        reservedCostMicros: 900_000,
      } as NonNullable<NpAgentGuardianRuntimeObservationV1["accountingSource"]>["reservation"],
      phase: "ambiguous" as const,
      responseDigest: null,
    };
    expect(npRequireAgentRuntimeCostSourceFactV1(base).accounting).toEqual({
      state: "unknown",
      costSource: "unknown",
      costMicros: null,
      budgetChargeCostMicros: 900_000,
    });
    expect(() => npRequireAgentRuntimeCostSourceFactV1({ ...base, phase: "reconciled" })).toThrow();
    const settled = {
      ...base,
      phase: "late-reconciled" as const,
      reservation: {
        ...base.reservation,
        state: "reconciled",
        actualCostSource: "provider",
        actualCostMicros: 100_000,
        budgetChargeCostMicros: 100_000,
      },
    };
    expect(npRequireAgentRuntimeCostSourceFactV1(settled).accounting).toMatchObject({
      state: "settled",
      costSource: "provider",
      costMicros: 100_000,
    });
    expect(() =>
      npRequireAgentRuntimeCostSourceFactV1({
        ...settled,
        reservation: { ...settled.reservation, budgetChargeCostMicros: 100_001 },
      }),
    ).toThrow();
  });
});
