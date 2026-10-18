import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "../db/runtime.js";
import type { npAgentEvents } from "../db/schema/agent.js";
import type { npAuditEvents } from "../db/schema/community.js";
import {
  npDigestAgentEventCanonical,
  npRequireAgentEventCanonical,
} from "../agent-contract/canonical-events.js";
import {
  npAgentGuardianSourceNamespaceDigestV1,
  npDigestAgentGuardianRetentionValueV1,
  npRequireAgentGuardianSourceClosureV1,
  type NpAgentGuardianSourceClosureV1,
} from "../agent-contract/guardian-retention-contract.js";
import { npRequireAgentSourceReleaseV1 } from "../agent-contract/source-release-contract.js";
import type { NpAgentGuardianVerifiedEventV1 } from "../agent-contract/guardian-operations-contract.js";
import {
  createAgentGuardianRetentionServiceV1,
  npGuardianRetentionAuditOwnerDigestV1,
  npGuardianRetentionSourceProofDigestV1,
  type NpAgentGuardianRetentionOptionsV1,
} from "./guardian-retention-service.js";

const mocks = vi.hoisted(() => ({
  budget: vi.fn(),
  fence: vi.fn(),
  readClosure: vi.fn(),
  pruneHistory: vi.fn(),
}));
vi.mock("./runtime-retention-budget.js", () => ({
  npWithAgentRuntimeRetentionBudgetV1: mocks.budget,
}));
vi.mock("./runtime-controls.js", () => ({
  npWithAgentRuntimeControlTransactionV1: (_siteId: string, work: () => Promise<unknown>) => work(),
}));
vi.mock("./source-release.js", () => ({ npLockAgentSourceReleaseFenceV1: mocks.fence }));
vi.mock("./guardian-source-closure.js", () => ({
  npReadAgentGuardianSourceClosureV1: mocks.readClosure,
  npAgentGuardianSourceClosureKeyV1: (family: string) => `guardian.closure.${family}`,
}));
vi.mock("./incident-retention.js", () => ({ npPruneAgentIncidentRetentionV1: mocks.pruneHistory }));

type Db = ReturnType<typeof getDb>;
const id = "00000000-0000-4000-8000-000000000001",
  receiptId = "00000000-0000-4000-8000-000000000002",
  day = 86400000;
const at = new Date("2026-10-18T00:00:00.000Z"),
  occurred = new Date(at.getTime() - 100 * day);
const retention = {
  version: 1,
  eventDays: 1,
  receiptDays: 1,
  signalDays: 1,
  historyDays: 1,
} as const;
async function fixture() {
  const event = npRequireAgentEventCanonical({
    version: "np.agent-event.v1",
    siteId: "default",
    kind: "security.error.signal",
    occurredAt: occurred.toISOString(),
    source: { kind: "integration", component: "sentry.issue-created.v1" },
    subject: null,
    actor: { kind: "system", component: "guardian.external" },
    causation: null,
    correlationId: receiptId,
    deduplicationKey: `external:${"a".repeat(64)}`,
    privacy: "sensitive",
    payload: {
      kind: "security.error.signal",
      adapterId: "sentry.issue-created.v1",
      externalSignalId: "a".repeat(64),
      category: "availability",
      severity: "medium",
      count: 1,
    },
  });
  const eventHash = await npDigestAgentEventCanonical(event);
  const row: typeof npAgentEvents.$inferSelect = {
    id,
    siteId: "default",
    kind: event.kind,
    sourceKind: event.source.kind,
    sourceComponent: event.source.component,
    subject: event.subject,
    actor: event.actor,
    causation: null,
    causalRootRunId: null,
    causalRunId: null,
    causalActionId: null,
    causalDepth: null,
    correlationId: event.correlationId,
    deduplicationKey: event.deduplicationKey,
    eventHash,
    privacy: event.privacy,
    payload: event.payload,
    occurredAt: occurred,
    recordedAt: new Date(occurred.getTime() + 1000),
    dispatchedAt: new Date(occurred.getTime() + 1000),
    expiresAt: new Date(occurred.getTime() + 14 * day),
  };
  const audit: typeof npAuditEvents.$inferSelect = {
    id: receiptId,
    siteId: "default",
    actorKind: "system",
    actorUserId: null,
    actorMemberId: null,
    action: "agent.guardian_external.source",
    targetType: "agent-event",
    targetId: id,
    payload: { sourceProof: "private-local-mac" },
    createdAt: row.recordedAt,
  };
  const initialClosure = npRequireAgentGuardianSourceClosureV1({
    schemaVersion: "np.agent-guardian-source-closure.v1",
    siteId: "default",
    family: "sentry",
    namespaceDigest: await npAgentGuardianSourceNamespaceDigestV1("sentry"),
    closedBefore: "2026-10-17T00:00:00.000Z",
    closedAt: at.toISOString(),
    revision: 2,
    retentionPolicyDigest: eventHash,
  });
  const closedAudit: typeof npAuditEvents.$inferSelect = {
    ...audit,
    id: "00000000-0000-4000-8000-000000000003",
    action: "agent.guardian.source_closed",
    targetType: "agent-guardian-source",
    targetId: "sentry",
    createdAt: at,
    payload: {
      closure: initialClosure,
      closureDigest: await npDigestAgentGuardianRetentionValueV1(
        "np.agent-guardian-source-closure.v1",
        initialClosure,
      ),
    },
  };
  const state = {
    events: [row],
    audits: [audit, closedAudit],
    releases: [] as Record<string, unknown>[],
    edges: [] as Record<string, unknown>[],
    closure: initialClosure as NpAgentGuardianSourceClosureV1 | null,
    clear: true,
    roots: [{ id, kinds: ["event"] }],
    signals: [] as Record<string, unknown>[],
    queries: [] as string[],
    failDelete: false,
  };
  const dialect = new PgDialect();
  const execute = vi.fn((query: SQL) => {
    const text = dialect.sqlToQuery(query).sql;
    state.queries.push(text);
    if (text.includes("to_regclass")) return Promise.resolve({ rows: [{ present: false }] });
    if (text.includes("candidate group by id")) return Promise.resolve({ rows: state.roots });
    if (text.endsWith(" as clear")) return Promise.resolve({ rows: [{ clear: state.clear }] });
    return Promise.resolve({ rows: [] });
  });
  const db = {
    execute,
    select() {
      let rows: unknown[] = [];
      const query = {
        from(table: PgTable) {
          const name = getTableName(table);
          rows =
            name === "np_agent_events"
              ? state.events
              : name === "np_audit_events"
                ? state.audits
                : name === "np_agent_signals"
                  ? state.signals
                  : name === "np_agent_source_releases"
                    ? state.releases
                    : [];
          return query;
        },
        where(condition: SQL) {
          const params = dialect.sqlToQuery(condition).params;
          if (params.includes("agent.guardian.source_closed"))
            rows = state.audits.filter(
              (a) =>
                a.action === "agent.guardian.source_closed" &&
                a.payload.closureDigest === params.at(-1),
            );
          else if (rows === state.audits) rows = state.audits.filter((a) => a.id === receiptId);
          return query;
        },
        for() {
          return query;
        },
        limit: () => Promise.resolve(rows),
      };
      return query;
    },
    insert(table: PgTable) {
      return {
        values(value: Record<string, unknown>) {
          const name = getTableName(table);
          const apply = () => {
            if (name === "np_agent_source_releases") state.releases.push(value);
            else if (name === "np_agent_source_release_edges") state.edges.push(value);
            else if (name === "np_audit_events") state.audits.push(value as typeof audit);
            else if (name === "np_settings")
              state.closure = value.value as NpAgentGuardianSourceClosureV1;
          };
          if (name !== "np_settings") apply();
          return Object.assign(Promise.resolve(), {
            onConflictDoUpdate: () => {
              apply();
              return Promise.resolve();
            },
          });
        },
      };
    },
    delete(table: PgTable) {
      return {
        where() {
          return {
            returning: () => {
              if (state.failDelete) return Promise.reject(new Error("private-database-error"));
              if (getTableName(table) === "np_agent_events") {
                state.events = [];
                return Promise.resolve([{ id }]);
              }
              return Promise.resolve([]);
            },
          };
        },
      };
    },
  } as unknown as Db;
  mocks.budget.mockImplementation(
    async (work: (db: Db, before: () => Promise<void>) => Promise<unknown>) => {
      const snapshot = structuredClone({
        events: state.events,
        audits: state.audits,
        releases: state.releases,
        edges: state.edges,
        closure: state.closure,
      });
      try {
        return await work(db, () => Promise.resolve());
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
  );
  mocks.readClosure.mockImplementation(() => Promise.resolve(state.closure));
  const proof: NpAgentGuardianVerifiedEventV1 = {
    schemaVersion: "np.agent-guardian-verified-event.v1",
    eventId: id,
    source: "sentry",
    observedAt: event.occurredAt,
    sourceDigest: eventHash,
    detectorId: "guardian.external-error-created",
  };
  const verifyEvent = vi.fn(() => Promise.resolve(proof)),
    authorize = vi.fn(async () => {});
  const options: NpAgentGuardianRetentionOptionsV1 = {
    policy: retention,
    authorize,
    proofOwners: [{ family: "sentry", verifyEvent }],
    now: () => new Date(at),
  };
  return {
    state,
    db,
    row,
    audit,
    closedAudit,
    proof,
    verifyEvent,
    authorize,
    options,
    service: createAgentGuardianRetentionServiceV1(options),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.pruneHistory.mockResolvedValue({ examined: 1, pruned: 0, nextCursor: null });
});
describe("explicit Guardian proof retention owner", () => {
  it("requires exact bounded policy and unique explicit source owners before reading a database", async () => {
    const f = await fixture();
    expect(() =>
      createAgentGuardianRetentionServiceV1({
        ...f.options,
        policy: { ...retention, eventDays: 15 },
      }),
    ).toThrow();
    expect(() =>
      createAgentGuardianRetentionServiceV1({
        ...f.options,
        proofOwners: [...f.options.proofOwners, ...f.options.proofOwners],
      }),
    ).toThrow();
    await expect(f.service.prune({ siteId: "default", limit: 26 })).rejects.toThrow();
    await expect(
      f.service.prune({ siteId: "default", cursor: "private-invalid" }),
    ).rejects.toThrow();
    expect(mocks.budget).not.toHaveBeenCalled();
  });
  it("commits a compact source release and exact audit edge after actual owner proof and both reference scans", async () => {
    const f = await fixture();
    const result = await f.service.prune({ siteId: "default" });
    expect(result).toMatchObject({
      eventsPruned: 1,
      closuresAdvanced: 0,
      receiptsPruned: 0,
      skipped: [],
      nextCursor: null,
    });
    expect(f.verifyEvent).toHaveBeenCalledWith({ db: f.db, siteId: "default", eventId: id });
    expect(mocks.fence).toHaveBeenCalledOnce();
    expect(f.state.queries.filter((q) => q.endsWith(" as clear"))).toHaveLength(2);
    expect(f.state.events).toEqual([]);
    expect(f.state.audits).toEqual([f.audit, f.closedAudit]);
    const body = npRequireAgentSourceReleaseV1(f.state.releases[0].evidenceBody);
    expect(body).toMatchObject({
      kind: "guardian-event",
      sourceId: id,
      family: "sentry",
      recordedAt: f.row.recordedAt.toISOString(),
    });
    expect(f.state.edges).toEqual([
      expect.objectContaining({
        ownerKind: "guardian-audit",
        ownerId: receiptId,
        edgeCode: "guardian-event",
        ownerEvidenceDigest: npGuardianRetentionAuditOwnerDigestV1(f.audit),
      }),
      expect.objectContaining({
        ownerKind: "guardian-closure-audit",
        ownerId: f.closedAudit.id,
        edgeCode: "guardian-closure",
        ownerEvidenceDigest: npGuardianRetentionAuditOwnerDigestV1(f.closedAudit),
      }),
    ]);
    expect(JSON.stringify(f.state.releases)).not.toContain("private-local-mac");
    expect(f.authorize).toHaveBeenCalledTimes(2);
  });
  it("holds facts when the historical MAC key is missing instead of trusting the canonical Event hash", async () => {
    const f = await fixture();
    f.verifyEvent.mockRejectedValueOnce(new Error("private-key-marker"));
    expect(await f.service.prune({ siteId: "default" })).toMatchObject({
      eventsPruned: 0,
      skipped: [{ reason: "PROOF_UNAVAILABLE", count: 1 }],
    });
    expect(f.state.events).toHaveLength(1);
    expect(f.state.releases).toHaveLength(0);
  });
  it("holds source metadata that does not bind the exact Event and site source family", async () => {
    const f = await fixture();
    f.verifyEvent.mockResolvedValueOnce({ ...f.proof, eventId: receiptId });
    expect(await f.service.prune({ siteId: "default" })).toMatchObject({
      eventsPruned: 0,
      skipped: [{ reason: "PROOF_UNAVAILABLE", count: 1 }],
    });
  });
  it("holds any live or opaque reference and scans all sites, settings, audits and source-owned tables", async () => {
    const f = await fixture();
    f.state.clear = false;
    expect(await f.service.prune({ siteId: "default" })).toMatchObject({
      eventsPruned: 0,
      skipped: [{ reason: "REFERENCE_PINNED", count: 1 }],
    });
    const query = f.state.queries.find((q) => q.endsWith(" as clear")) ?? "";
    expect(query).toContain('"np_agent_signals"');
    expect(query).toContain("np_settings");
    expect(query).toContain("np_audit_events");
    expect(query).not.toContain("dependency.site_id=");
    expect(f.state.releases).toHaveLength(0);
  });
  it("keeps the configured receipt minimum even when Event age permits release", async () => {
    const f = await fixture();
    f.audit.createdAt = new Date(at.getTime() - day / 2);
    expect(await f.service.prune({ siteId: "default" })).toMatchObject({
      eventsPruned: 0,
      skipped: [{ reason: "NOT_ELIGIBLE", count: 1 }],
    });
    expect(f.state.releases).toHaveLength(0);
  });
  it("advances closure monotonically and records an immutable audit without Event identities", async () => {
    const f = await fixture();
    f.state.closure = null;
    f.state.audits = [f.audit];
    f.state.roots = [];
    expect(await f.service.prune({ siteId: "default" })).toMatchObject({
      closuresAdvanced: 1,
      eventsPruned: 0,
    });
    expect(f.state.closure).toMatchObject({
      revision: 1,
      closedBefore: "2026-10-17T00:00:00.000Z",
    });
    const audit = f.state.audits.find((a) => a.action === "agent.guardian.source_closed");
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain(id);
    expect(await f.service.prune({ siteId: "default" })).toMatchObject({ closuresAdvanced: 0 });
  });
  it("rolls back a release, source deletion and closure when final authority changes", async () => {
    const f = await fixture();
    f.state.closure = null;
    f.authorize
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("private-authority-revoked"));
    await expect(f.service.prune({ siteId: "default" })).rejects.toMatchObject({
      code: "GUARDIAN_RETENTION_UNAVAILABLE",
      status: 503,
    });
    expect(f.state.events).toHaveLength(1);
    expect(f.state.releases).toHaveLength(0);
    expect(f.state.edges).toHaveLength(0);
    expect(f.state.closure).toBeNull();
  });
  it("rolls back on an unexpected delete failure and never exposes raw DB text", async () => {
    const f = await fixture();
    f.state.failDelete = true;
    await expect(f.service.prune({ siteId: "default" })).rejects.toThrow(
      "Guardian retained evidence is unavailable.",
    );
    expect(f.state.events).toHaveLength(1);
    expect(f.state.releases).toHaveLength(0);
  });
  it("keeps audit attribution digest stable under profile anonymization while binding source receipt content", async () => {
    const f = await fixture(),
      before = npGuardianRetentionAuditOwnerDigestV1(f.audit);
    expect(
      npGuardianRetentionAuditOwnerDigestV1({
        ...f.audit,
        actorUserId: id,
        actorMemberId: receiptId,
      }),
    ).toBe(before);
    expect(
      npGuardianRetentionAuditOwnerDigestV1({ ...f.audit, payload: { changed: true } }),
    ).not.toBe(before);
    expect(
      await npGuardianRetentionSourceProofDigestV1({
        event: f.proof,
        auditDigest: before,
        receiptDigest: null,
      }),
    ).not.toBe(
      await npGuardianRetentionSourceProofDigestV1({
        event: f.proof,
        auditDigest: null,
        receiptDigest: null,
      }),
    );
  });
  it("holds Guardian history without its actual rule owner even when every Event verifier is installed", async () => {
    const f = await fixture();
    f.state.roots = [{ id, kinds: ["history"] }];
    f.state.signals = [{ id, detectorId: "guardian.external-error-created", detectorVersion: 1 }];
    mocks.pruneHistory.mockImplementation(
      async (input: {
        db: Db;
        siteId: string;
        verifyGuardianSignal: (args: {
          db: Db;
          siteId: string;
          signalId: string;
        }) => Promise<boolean>;
      }) => {
        expect(
          await input.verifyGuardianSignal({ db: input.db, siteId: input.siteId, signalId: id }),
        ).toBe(false);
        return { examined: 1, pruned: 0, nextCursor: null };
      },
    );
    expect(await f.service.prune({ siteId: "default" })).toMatchObject({
      historyPruned: 0,
      skipped: [{ reason: "PROOF_UNAVAILABLE", count: 1 }],
    });
    expect(f.verifyEvent).not.toHaveBeenCalled();
  });
  it("requires retained closure audit metadata before any release and does not invent missing closure evidence", async () => {
    const f = await fixture();
    f.state.audits = [f.audit];
    await expect(f.service.prune({ siteId: "default" })).rejects.toMatchObject({
      code: "GUARDIAN_RETENTION_UNAVAILABLE",
    });
    expect(f.state.events).toHaveLength(1);
    expect(f.state.releases).toHaveLength(0);
  });
});
