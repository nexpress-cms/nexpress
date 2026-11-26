import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentGuardianSecurityObservationServiceV1,
  type NpAgentGuardianSecurityObservationOptionsV1,
} from "../../../packages/core/src/agent/guardian-security-observation.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { npReadAgentEventRowEvidenceV1 } from "../../../packages/core/src/agent/event-evidence.js";
import {
  npDigestAgentEventCanonical,
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import { npRequireAgentSecurityTransitionPayloadV1 } from "../../../packages/core/src/agent-contract/guardian-security-contract.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentRuns,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import {
  npSiteMemberships,
  npSites,
  npUsers,
} from "../../../packages/core/src/db/schema/system.js";
import {
  grantSiteMembership,
  setSuperAdmin,
} from "../../../packages/core/src/sites/memberships.js";
import {
  resetSiteAuthorityObserverV1,
  setSiteAuthorityObserverV1,
  type NpSiteAuthorityObservationV1,
} from "../../../packages/core/src/sites/authority-observer.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

async function setup() {
  const f = await fixture();
  const target = await seedUser({ role: "viewer" });
  await grantSiteMembership(siteId, target.userId, "viewer");
  const key = new Uint8Array(32).fill(83);
  const state = { failAfterSource: false };
  const now = () => new Date(Date.now() + 1000);
  const never = () => Promise.reject(new Error("Security sources must not activate Runtime"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "security-source-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: never,
    now,
  });
  const options: NpAgentGuardianSecurityObservationOptionsV1 = {
    actorKey: { id: "security-source-key-1", bytes: key },
    isInstalledSite: async (id) => [siteId, "draft-other"].includes(id),
    authorize: async () => {},
    events,
    now,
  };
  const source = createAgentGuardianSecurityObservationServiceV1(options);
  const observations: NpSiteAuthorityObservationV1[] = [];
  setSiteAuthorityObserverV1({
    prepare: (input) => source.authorityObserver.prepare(input),
    record: async (input) => {
      observations.push(input);
      await source.authorityObserver.record(input);
      if (state.failAfterSource) throw new Error("Injected source rollback");
    },
  });
  const context = { actor: { kind: "staff" as const, userId: f.actor.actor.user.id } };
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(84),
    now,
    canReadIncident: () => false,
    canReadStaffIncident: async ({ incident, context: readContext }) => {
      try {
        await source.evidence({ db: f.db, siteId: readContext.siteId, incident });
        return true;
      } catch {
        return false;
      }
    },
  });
  async function incident(id?: string) {
    const [row] = await f.db
      .select()
      .from(npAgentIncidents)
      .where(
        and(
          eq(npAgentIncidents.siteId, siteId),
          id === undefined ? undefined : eq(npAgentIncidents.id, id),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Expected security Incident");
    return (await reads.staff.get({ incidentId: row.id }, { siteId, actor: f.actor.actor }))
      .incident;
  }
  return {
    ...f,
    target,
    key,
    state,
    options,
    events,
    source,
    observations,
    context,
    incident,
    reads,
  };
}

describe.skipIf(skipIfNoTestDb())("Guardian committed security transitions", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    resetSiteAuthorityObserverV1();
    await truncateAll();
    registerTestCollections();
  });
  afterAll(async () => {
    resetSiteAuthorityObserverV1();
    await closeTestDb();
  });
  it.each([
    { statement: "1200ms", lock: "800ms" },
    { statement: "50ms", lock: "40ms" },
  ])(
    "restores parent domain budgets around prepare and record ($statement / $lock)",
    async (limits) => {
      const f = await setup();
      let prepared = 0,
        recorded = 0;
      async function settings(db: NpSiteAuthorityObservationV1["db"]) {
        const result = await db.execute(
          sql`select extract(epoch from current_setting('statement_timeout')::interval)*1000 as statement_ms,extract(epoch from current_setting('lock_timeout')::interval)*1000 as lock_ms`,
        );
        expect(Number(result.rows[0]?.statement_ms)).toBe(
          Number(limits.statement.replace("ms", "")),
        );
        expect(Number(result.rows[0]?.lock_ms)).toBe(Number(limits.lock.replace("ms", "")));
      }
      setSiteAuthorityObserverV1({
        prepare: async (input) => {
          await input.db.execute(
            sql`select set_config('statement_timeout',${limits.statement},true),set_config('lock_timeout',${limits.lock},true)`,
          );
          await f.source.authorityObserver.prepare(input);
          await settings(input.db);
          prepared++;
        },
        record: async (input) => {
          await settings(input.db);
          await f.source.authorityObserver.record(input);
          await settings(input.db);
          recorded++;
        },
      });
      await grantSiteMembership(siteId, f.target.userId, "admin", f.context);
      expect({ prepared, recorded }).toEqual({ prepared: 1, recorded: 1 });
      expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    },
  );

  it("observes actual same-site role increases, skips no-ops and retains demotion truth without inventing an attack", async () => {
    const f = await setup();
    await grantSiteMembership(siteId, f.target.userId, "admin", f.context);
    await grantSiteMembership(siteId, f.target.userId, "admin", f.context);
    expect(f.observations).toHaveLength(1);
    const incident = await f.incident();
    const evidence = await f.source.evidence({ db: f.db, siteId, incident });
    expect(evidence).toEqual([
      expect.objectContaining({
        detectorId: "guardian.authority-escalated",
        targetKind: "site-role",
        basis: "committed-transition",
        impact: expect.objectContaining({ scope: "site", affectedSiteCount: 1 }),
      }),
    ]);
    expect(incident).toMatchObject({
      category: "authorization",
      severity: "medium",
      eventCount: 1,
      signalIds: [evidence[0].signalId],
    });
    expect(incident.primarySubject).toMatchObject({
      kind: "actor-bucket",
      purpose: "staff-principal",
    });
    expect(JSON.stringify(evidence)).not.toContain(f.target.userId);
    expect(JSON.stringify(evidence)).not.toMatch(
      /previousRole|currentRole|sourceMac|invocationId|actorUserId/u,
    );
    expect(incident.summary).toContain("does not establish malicious intent");
    await grantSiteMembership(siteId, f.target.userId, "viewer", f.context);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(2);
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
    expect(await f.source.evidence({ db: f.db, siteId, incident })).toEqual(evidence);
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
  });

  it("rolls the actual authority write, source receipt, Event and Incident back together", async () => {
    const f = await setup();
    f.state.failAfterSource = true;
    await expect(grantSiteMembership(siteId, f.target.userId, "admin", f.context)).rejects.toThrow(
      "Injected source rollback",
    );
    const [membership] = await f.db
      .select()
      .from(npSiteMemberships)
      .where(
        and(eq(npSiteMemberships.siteId, siteId), eq(npSiteMemberships.userId, f.target.userId)),
      );
    expect(membership.role).toBe("viewer");
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(0);
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agent.guardian_security.source")),
    ).toHaveLength(0);
  });

  it("projects verified read-only Studio evidence, preserves unavailable proof and rechecks current item access", async () => {
    const f = await setup();
    await grantSiteMembership(siteId, f.target.userId, "admin", f.context);
    const incident = await f.incident();
    const input = { siteId, actor: f.actor.actor, incidentId: incident.id };
    const studio = createAgentIncidentStudioServiceV1({
      reads: f.reads.staff,
      cursorHmacKey: new Uint8Array(32).fill(85),
      guardianSecurityObservations: f.source,
    });
    const detail = await studio.get(input);
    expect(detail.guardianSecurityEvidence).toEqual(
      await f.source.evidence({ db: f.db, siteId, incident }),
    );
    expect(detail.feedbackAvailable).toBe(false);
    expect(detail.response).toBeNull();
    const unavailable = createAgentIncidentStudioServiceV1({
      reads: f.reads.staff,
      cursorHmacKey: new Uint8Array(32).fill(85),
    });
    expect((await unavailable.get(input)).guardianSecurityEvidence).toBeNull();
    let visible = true;
    const reads = createAgentIncidentServiceV1({
      cursorHmacKey: new Uint8Array(32).fill(86),
      canReadIncident: () => false,
      canReadStaffIncident: () => visible,
    });
    const racing = createAgentIncidentStudioServiceV1({
      reads: reads.staff,
      cursorHmacKey: new Uint8Array(32).fill(87),
      guardianSecurityObservations: {
        evidence: async (request) => {
          const result = await f.source.evidence(request);
          visible = false;
          return result;
        },
      },
    });
    await expect(racing.get(input)).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
  });

  it("coalesces repeated increases for the same private target within the fixed window", async () => {
    const f = await setup();
    const fixed = new Date((Math.floor(Date.now() / 600_000) + 1) * 600_000 + 300_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fixed);
    try {
      await grantSiteMembership(siteId, f.target.userId, "editor", f.context);
      await grantSiteMembership(siteId, f.target.userId, "viewer", f.context);
      await grantSiteMembership(siteId, f.target.userId, "admin", f.context);
      const incidents = await f.db.select().from(npAgentIncidents);
      expect(incidents).toHaveLength(1);
      expect(incidents[0]).toMatchObject({ signalCount: 2, eventCount: 2 });
      const incident = await f.incident();
      expect(await f.source.evidence({ db: f.db, siteId, incident })).toHaveLength(2);
      expect(await f.db.select().from(npAgentEvents)).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replays only the exact committed transition and rejects a changed fact under its identity", async () => {
    const f = await setup();
    await grantSiteMembership(siteId, f.target.userId, "admin", f.context);
    const captured = f.observations[0];
    await f.db.transaction(async (db) => {
      await f.source.authorityObserver.prepare({ db, scope: captured.scope });
      await f.source.authorityObserver.record({ ...captured, db });
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agent.guardian_security.source")),
    ).toHaveLength(1);
    await expect(
      f.db.transaction(async (db) => {
        await f.source.authorityObserver.prepare({ db, scope: captured.scope });
        await f.source.authorityObserver.record({
          ...captured,
          db,
          transition: {
            kind: "site-role",
            userId: f.target.userId,
            previousRole: "author",
            currentRole: "admin",
          },
        });
      }),
    ).rejects.toThrow();
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(1);
  });

  it("keeps historical proofs after role loss and key rotation, requiring the exact old copied key", async () => {
    const f = await setup();
    f.key.fill(0); // installation copied the key; callers cannot mutate retained signing material
    await grantSiteMembership(siteId, f.target.userId, "admin", f.context);
    const incident = await f.incident();
    const first = await f.source.evidence({ db: f.db, siteId, incident });
    await grantSiteMembership(siteId, f.target.userId, "viewer", f.context);
    const rotated = createAgentGuardianSecurityObservationServiceV1({
      ...f.options,
      actorKey: { id: "security-source-key-2", bytes: new Uint8Array(32).fill(85) },
      resolveActorKey: (id) =>
        id === "security-source-key-1" ? new Uint8Array(32).fill(83) : null,
    });
    expect(await rotated.evidence({ db: f.db, siteId, incident })).toEqual(first);
    const missing = createAgentGuardianSecurityObservationServiceV1({
      ...f.options,
      actorKey: { id: "security-source-key-2", bytes: new Uint8Array(32).fill(85) },
    });
    await expect(missing.evidence({ db: f.db, siteId, incident })).rejects.toThrow();
    const wrong = createAgentGuardianSecurityObservationServiceV1({
      ...f.options,
      actorKey: { id: "security-source-key-2", bytes: new Uint8Array(32).fill(85) },
      resolveActorKey: () => new Uint8Array(32).fill(86),
    });
    await expect(wrong.evidence({ db: f.db, siteId, incident })).rejects.toThrow();
  });

  it("requires the mandatory immutable source receipt even when Event and Signal hashes are recomputed", async () => {
    const f = await setup();
    await grantSiteMembership(siteId, f.target.userId, "admin", f.context);
    const incident = await f.incident();
    const [row] = await f.db.select().from(npAgentEvents);
    const [signal] = await f.db.select().from(npAgentSignals);
    const event = await npReadAgentEventRowEvidenceV1(row);
    const payload = npRequireAgentSecurityTransitionPayloadV1(event.payload);
    const forged = { ...event, payload: { ...payload, sourceReceiptId: randomUUID() } };
    const eventHash = await npDigestAgentEventCanonical(forged);
    const evidence = [
      {
        kind: "event" as const,
        eventId: row.id,
        eventKind: event.kind,
        observedAt: row.occurredAt.toISOString(),
        digest: Buffer.from(eventHash.slice("cj1:sha256:".length), "base64url").toString("hex"),
        excerpt: null,
      },
    ];
    const canonical = npRequireAgentSignalEvidenceCanonical({
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId,
      detectorId: signal.detectorId,
      detectorVersion: signal.detectorVersion,
      category: signal.category,
      subject: signal.subject,
      window: {
        startedAt: signal.windowStartedAt.toISOString(),
        endedAt: signal.windowEndedAt.toISOString(),
      },
      evidence,
    });
    await f.db
      .update(npAgentEvents)
      .set({ payload: forged.payload, eventHash })
      .where(eq(npAgentEvents.id, row.id));
    await f.db
      .update(npAgentSignals)
      .set({ evidence, evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonical) })
      .where(eq(npAgentSignals.id, signal.id));
    await expect(f.source.evidence({ db: f.db, siteId, incident })).rejects.toThrow();
  });

  it("rejects altered audit authentication and cross-site evidence without returning a partial projection", async () => {
    const f = await setup();
    await grantSiteMembership(siteId, f.target.userId, "admin", f.context);
    const incident = await f.incident();
    await expect(
      f.source.evidence({ db: f.db, siteId: "draft-other", incident }),
    ).rejects.toThrow();
    const [receipt] = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agent.guardian_security.source"));
    await f.db
      .update(npAuditEvents)
      .set({ payload: { ...receipt.payload, sourceMac: `hmac-sha256:${"A".repeat(43)}` } })
      .where(eq(npAuditEvents.id, receipt.id));
    await expect(f.source.evidence({ db: f.db, siteId, incident })).rejects.toThrow();
  });

  it("records deployment impact over the complete catalog while observing only explicitly installed sites", async () => {
    const f = await setup();
    const catalog = await f.db.select({ id: npSites.id }).from(npSites);
    await setSuperAdmin(f.target.userId, true, f.context);
    const events = await f.db.select().from(npAgentEvents);
    expect(events.map((event) => event.siteId).sort()).toEqual([siteId, "draft-other"].sort());
    const payloads = events.map((event) =>
      npRequireAgentSecurityTransitionPayloadV1(event.payload),
    );
    expect(new Set(payloads.map((payload) => payload.transitionId)).size).toBe(1);
    expect(new Set(payloads.map((payload) => payload.impact.siteCatalogDigest)).size).toBe(1);
    expect(
      payloads.every(
        (payload) =>
          payload.impact.scope === "deployment" &&
          payload.impact.affectedSiteCount === catalog.length,
      ),
    ).toBe(true);
    expect(new Set(events.map((event) => JSON.stringify(event.subject))).size).toBe(2);
    expect(
      (await f.db.select().from(npAgentIncidents)).every(
        (incident) => incident.severity === "high",
      ),
    ).toBe(true);
    const incident = await f.incident();
    expect(await f.source.evidence({ db: f.db, siteId, incident })).toEqual([
      expect.objectContaining({
        targetKind: "super-admin",
        impact: expect.objectContaining({ scope: "deployment", affectedSiteCount: catalog.length }),
      }),
    ]);
    await setSuperAdmin(f.target.userId, true, f.context);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(2);
  });

  it("fails closed before the authority mutation when the complete deployment catalog cannot be fenced", async () => {
    const f = await setup();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = f.db.transaction(async (db) => {
      await db.execute(sql`lock table np_sites in row exclusive mode`);
      entered?.();
      await held;
    });
    await ready;
    try {
      await expect(setSuperAdmin(f.target.userId, true, f.context)).rejects.toThrow();
    } finally {
      release?.();
      await blocker;
    }
    const [target] = await f.db.select().from(npUsers).where(eq(npUsers.id, f.target.userId));
    expect(target.isSuperAdmin).toBe(false);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
  });
});
