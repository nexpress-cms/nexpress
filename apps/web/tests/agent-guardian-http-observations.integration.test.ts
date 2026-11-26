import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentGuardianHttpObservationServiceV1,
  type NpAgentGuardianHttpObservationOptionsV1,
} from "../../../packages/core/src/agent/guardian-http-observation.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentGuardianControlsV1 } from "../../../packages/core/src/agent/guardian-controls.js";
import { npReadAgentEventRowEvidenceV1 } from "../../../packages/core/src/agent/event-evidence.js";
import { npReadAgentIncidentSignalEvidenceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1 } from "../../../packages/core/src/agent-contract/guardian-controls-contract.js";
import {
  npDigestAgentSignalEvidenceCanonical,
  npRequireAgentSignalEvidenceCanonical,
} from "../../../packages/core/src/agent-contract/canonical-events.js";
import { npAgentGuardianSourceNamespaceDigestV1 } from "../../../packages/core/src/agent-contract/guardian-retention-contract.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentRuns,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => (resolve = complete));
  return { promise, resolve };
}

/** The harness pool has three clients. Hold two so the next borrower must reuse
 * the exact source client after rollback, rather than passing on another client. */
async function pinOtherClients(db: Awaited<ReturnType<typeof setup>>["db"]) {
  const release = deferred<void>();
  const entered = [deferred<void>(), deferred<void>()];
  const transactions = entered.map((ready) =>
    db.transaction(async (transaction) => {
      await transaction.execute(sql`select 1`);
      ready.resolve();
      await release.promise;
    }),
  );
  await Promise.all(entered.map((ready) => ready.promise));
  return async () => {
    release.resolve();
    await Promise.all(transactions);
  };
}

async function setup() {
  const f = await fixture();
  const state = {
    clock: new Date(Math.floor(Date.now() / 600_000) * 600_000 + 601_000),
    installed: true,
    allowed: true,
    failAfterRecord: false,
  };
  const now = () => new Date(state.clock);
  const never = () =>
    Promise.reject(new Error("HTTP observations cannot dispatch Runtime or providers"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "guardian-http-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: never,
    now,
  });
  const actorKey = new Uint8Array(32).fill(151),
    receiptKey = new Uint8Array(32).fill(152);
  const options: NpAgentGuardianHttpObservationOptionsV1 = {
    actorKey: { id: "http-actor-1", bytes: actorKey },
    receiptKey: { id: "http-receipt-1", bytes: receiptKey },
    isInstalledSite: async (requested) => state.installed && requested === siteId,
    authorize: async ({ siteId: requested }) => {
      if (!state.allowed || requested !== siteId) throw new Error("private-http-policy-marker");
    },
    events: {
      record: async (input) => {
        const result = await events.record(input);
        if (state.failAfterRecord) throw new Error("synthetic HTTP receipt rollback");
        return result;
      },
    },
    now,
  };
  const source = createAgentGuardianHttpObservationServiceV1(options);
  const input = (patch: Partial<Parameters<typeof source.observe>[0]> = {}) => ({
    siteId,
    observationId: randomUUID(),
    occurredAt: now().toISOString(),
    status: 404 as const,
    routeFamily: "admin" as const,
    networkAddress: "192.0.2.151",
    ...patch,
  });
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(153),
    now,
    canReadIncident: () => false,
    canReadStaffIncident: async ({ incident, context }) => {
      try {
        await source.evidence({ db: f.db, siteId: context.siteId, incident });
        return true;
      } catch {
        return false;
      }
    },
  });
  async function incident() {
    const [row] = await f.db
      .select()
      .from(npAgentIncidents)
      .where(eq(npAgentIncidents.siteId, siteId));
    if (!row) throw new Error("Expected HTTP Incident");
    return (await reads.staff.get({ incidentId: row.id }, { siteId, actor: f.actor.actor }))
      .incident;
  }
  return { ...f, state, now, options, source, input, incident, actorKey, receiptKey };
}

describe.skipIf(skipIfNoTestDb())("Guardian final HTTP response observations", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it.each([401, 403, 404] as const)(
    "records five actual %i facts, signed metadata receipts and one low review-only Incident",
    async (status) => {
      const f = await setup();
      for (let index = 0; index < 4; index++) await f.source.observe(f.input({ status }));
      expect(await f.db.select().from(npAgentIncidents)).toHaveLength(0);
      await f.source.observe(f.input({ status }));
      const events = await f.db.select().from(npAgentEvents),
        receipts = await f.db
          .select()
          .from(npAuditEvents)
          .where(eq(npAuditEvents.action, "agent.guardian_http.source"));
      expect(events).toHaveLength(5);
      expect(receipts).toHaveLength(5);
      for (const row of events) {
        const event = await npReadAgentEventRowEvidenceV1(row);
        expect(event).toMatchObject({
          siteId,
          source: { kind: "api", component: "guardian.http.v1" },
          causation: null,
          correlationId: null,
          privacy: "sensitive",
          payload: { kind: "http.response.observed", activity: { status, routeFamily: "admin" } },
        });
        expect(await f.source.verifyEvent({ db: f.db, siteId, eventId: row.id })).toMatchObject({
          source: "http",
          eventId: row.id,
        });
      }
      expect(JSON.stringify(receipts)).not.toContain("networkBucket");
      expect(JSON.stringify(receipts)).not.toContain("192.0.2.151");
      expect(JSON.stringify(receipts)).not.toContain('"activity"');
      const incident = await f.incident();
      expect(incident).toMatchObject({ category: "traffic", severity: "low", status: "open" });
      const evidence = await f.source.evidence({ db: f.db, siteId, incident });
      expect(evidence).toHaveLength(1);
      expect(evidence[0]).toMatchObject({
        status,
        observedCount: 5,
        assessment: "review-only",
        routeFamily: "admin",
      });
      expect(JSON.stringify(evidence)).not.toContain("bucket");
      expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
      const [signal] = await f.db.select().from(npAgentSignals);
      expect(await f.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(true);
    },
  );

  it("replays the exact UUID without new facts, conflicts changed facts and samples after five", async () => {
    const f = await setup(),
      source = f.input();
    const first = await f.source.observe(source);
    expect(await f.source.observe(source)).toMatchObject({
      disposition: "replayed",
      eventId: first.eventId,
    });
    await expect(f.source.observe({ ...source, status: 403 })).rejects.toMatchObject({
      code: "GUARDIAN_HTTP_SOURCE_CONFLICT",
    });
    for (let index = 0; index < 4; index++) await f.source.observe(f.input());
    expect(await f.source.observe(f.input())).toEqual({
      disposition: "capped",
      eventId: null,
      incidentId: null,
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(5);
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
  });

  it("keeps status, family, network and site cohorts separate and bounds one hundred retained responses", async () => {
    const f = await setup();
    for (let index = 0; index < 4; index++) await f.source.observe(f.input());
    await f.source.observe(f.input({ status: 403 }));
    await f.source.observe(f.input({ routeFamily: "mcp" }));
    await f.source.observe(f.input({ networkAddress: "192.0.2.152" }));
    expect((await f.source.observe(f.input({ siteId: "other-site" }))).disposition).toBe(
      "disabled",
    );
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(0);
    for (let index = 7; index < 100; index++)
      await f.source.observe(f.input({ networkAddress: `198.51.100.${index}` }));
    expect(await f.source.observe(f.input({ networkAddress: "198.51.100.101" }))).toMatchObject({
      disposition: "capped",
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(100);
  }, 60_000);

  it("rolls back source Event, audit and Incident together when the record owner fails", async () => {
    const f = await setup();
    f.state.failAfterRecord = true;
    await expect(f.source.observe(f.input())).rejects.toThrow("synthetic HTTP receipt rollback");
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(0);
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agent.guardian_http.source")),
    ).toHaveLength(0);
  });

  it("rejects forged receipt MACs and rehashed Signals whose actual response cohort is not the rule", async () => {
    const f = await setup();
    for (let index = 0; index < 5; index++) await f.source.observe(f.input());
    const [signal] = await f.db.select().from(npAgentSignals),
      [event] = await f.db.select().from(npAgentEvents);
    const altered = npRequireAgentSignalEvidenceCanonical({
      ...(await npReadAgentIncidentSignalEvidenceV1(signal)),
      category: "authentication",
    });
    await f.db
      .update(npAgentSignals)
      .set({
        category: "authentication",
        evidenceDigest: await npDigestAgentSignalEvidenceCanonical(altered),
      })
      .where(eq(npAgentSignals.id, signal.id));
    expect(await f.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(false);
    const [receipt] = await f.db
      .select()
      .from(npAuditEvents)
      .where(
        and(
          eq(npAuditEvents.action, "agent.guardian_http.source"),
          eq(npAuditEvents.targetId, event.id),
        ),
      );
    await f.db
      .update(npAuditEvents)
      .set({ payload: { ...receipt.payload, sourceMac: `hmac-sha256:${"F".repeat(43)}` } })
      .where(eq(npAuditEvents.id, receipt.id));
    await expect(
      f.source.verifyEvent({ db: f.db, siteId, eventId: event.id }),
    ).rejects.toBeDefined();
  });

  it("retains exact historical keys across rotation and never falls back to a current key", async () => {
    const f = await setup(),
      input = f.input(),
      recorded = await f.source.observe(input);
    const rotated = createAgentGuardianHttpObservationServiceV1({
      ...f.options,
      actorKey: { id: "http-actor-2", bytes: new Uint8Array(32).fill(154) },
      receiptKey: { id: "http-receipt-2", bytes: new Uint8Array(32).fill(155) },
      resolveActorKey: async (id) => (id === "http-actor-1" ? f.actorKey : null),
      resolveReceiptKey: async (id) => (id === "http-receipt-1" ? f.receiptKey : null),
    });
    expect(await rotated.observe(input)).toMatchObject({
      disposition: "replayed",
      eventId: recorded.eventId,
    });
    const missing = createAgentGuardianHttpObservationServiceV1({
      ...f.options,
      receiptKey: { id: "http-receipt-2", bytes: new Uint8Array(32).fill(155) },
    });
    await expect(
      missing.verifyEvent({ db: f.db, siteId, eventId: recorded.eventId! }),
    ).rejects.toMatchObject({ code: "GUARDIAN_HTTP_SOURCE_KEY_UNAVAILABLE" });
  });

  it.each(["verifyEvent", "verifySignal", "evidence"] as const)(
    "bounds a stalled historical receipt key in public %s and discards its late result",
    async (facet) => {
      const f = await setup();
      for (let index = 0; index < 5; index++) await f.source.observe(f.input());
      const incident = await f.incident();
      const [event] = await f.db.select().from(npAgentEvents).limit(1);
      const [signal] = await f.db.select().from(npAgentSignals).limit(1);
      if (!event || !signal) throw new Error("Expected a real signed HTTP source cohort");
      const entered = deferred<void>(),
        release = deferred<Uint8Array>();
      let lookups = 0;
      const rotated = createAgentGuardianHttpObservationServiceV1({
        ...f.options,
        receiptKey: { id: "http-receipt-2", bytes: new Uint8Array(32).fill(155) },
        resolveReceiptKey: (id) => {
          if (id !== "http-receipt-1") return null;
          lookups++;
          entered.resolve();
          return release.promise;
        },
      });
      // An unfixed verifier eventually returns a valid result and fails this
      // assertion instead of leaving the test's resolver pending indefinitely.
      const fallback = setTimeout(() => release.resolve(f.receiptKey), 2000);
      try {
        const read =
          facet === "verifyEvent"
            ? rotated.verifyEvent({ db: f.db, siteId, eventId: event.id })
            : facet === "verifySignal"
              ? rotated.verifySignal({ db: f.db, siteId, signalId: signal.id })
              : rotated.evidence({ db: f.db, siteId, incident });
        const assertion =
          facet === "verifySignal"
            ? expect(read).resolves.toBe(false)
            : expect(read).rejects.toMatchObject({
                code: "GUARDIAN_SOURCE_READ_TIMEOUT",
                statusCode: 503,
              });
        await entered.promise;
        await assertion;
        const initialLookups = lookups;
        expect(initialLookups).toBe(facet === "verifyEvent" ? 1 : 5);
        release.resolve(f.receiptKey);
        await Promise.resolve();
        await Promise.resolve();
        expect(lookups).toBe(initialLookups);
        expect(await f.db.select().from(npAgentEvents)).toHaveLength(5);
        expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
        expect(
          await f.db
            .select()
            .from(npAuditEvents)
            .where(eq(npAuditEvents.action, "agent.guardian_http.source")),
        ).toHaveLength(5);
        // The stored source remains valid; only the stalled installation lookup
        // made the public facet unavailable, and no result was cached as proof.
        expect(await rotated.verifyEvent({ db: f.db, siteId, eventId: event.id })).toMatchObject({
          eventId: event.id,
          source: "http",
        });
        expect(await rotated.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(true);
        expect(await rotated.evidence({ db: f.db, siteId, incident })).toHaveLength(1);
      } finally {
        clearTimeout(fallback);
        release.resolve(f.receiptKey);
      }
    },
  );

  it.each(["actor", "receipt"] as const)(
    "rolls back a stalled historical %s key lookup and releases the exact client before late completion",
    async (kind) => {
      const f = await setup(),
        input = f.input();
      await f.source.observe(input);
      const unpin = await pinOtherClients(f.db),
        entered = deferred<void>(),
        release = deferred<Uint8Array>();
      let sourcePid: number | undefined;
      const rotated = createAgentGuardianHttpObservationServiceV1({
        ...f.options,
        actorKey:
          kind === "actor"
            ? { id: "http-actor-2", bytes: new Uint8Array(32).fill(154) }
            : f.options.actorKey,
        receiptKey:
          kind === "receipt"
            ? { id: "http-receipt-2", bytes: new Uint8Array(32).fill(155) }
            : f.options.receiptKey,
        authorize: async (context) => {
          await f.options.authorize(context);
          const result = await context.db.execute(sql`select pg_backend_pid() as pid`);
          sourcePid = Number(result.rows[0].pid);
        },
        resolveActorKey: (id) => {
          if (id !== "http-actor-1") return null;
          if (kind !== "actor") return f.actorKey;
          entered.resolve();
          return release.promise;
        },
        resolveReceiptKey: (id) => {
          if (id !== "http-receipt-1") return null;
          if (kind !== "receipt") return f.receiptKey;
          entered.resolve();
          return release.promise;
        },
      });
      try {
        const rejected = expect(rotated.observe(input)).rejects.toMatchObject({
          code: "GUARDIAN_HTTP_SOURCE_TIMEOUT",
        });
        await entered.promise;
        await rejected;
        await f.db.transaction(async (borrower) => {
          const result = await borrower.execute(sql`select pg_backend_pid() as pid`);
          expect(Number(result.rows[0].pid)).toBe(sourcePid);
          // The same client is now in another transaction and the original site
          // admission lock must have been released by the source rollback.
          await borrower.execute(sql`set local lock_timeout = '250ms'`);
          await borrower.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`np:site-quota:${siteId}`}, 0))`,
          );
          release.resolve(kind === "actor" ? f.actorKey : f.receiptKey);
          await Promise.resolve();
          expect(await borrower.select().from(npAgentEvents)).toHaveLength(1);
          expect(await borrower.select().from(npAgentSignals)).toHaveLength(0);
          expect(
            await borrower
              .select()
              .from(npAuditEvents)
              .where(eq(npAuditEvents.action, "agent.guardian_http.source")),
          ).toHaveLength(1);
        });
      } finally {
        release.resolve(kind === "actor" ? f.actorKey : f.receiptKey);
        await unpin();
      }
    },
  );

  it("rejects a saved prepared query from a late record callback after rollback and exact client reuse", async () => {
    const f = await setup(),
      unpin = await pinOtherClients(f.db),
      entered = deferred<void>(),
      release = deferred<void>(),
      completed = deferred<unknown>();
    let sourcePid: number | undefined;
    const source = createAgentGuardianHttpObservationServiceV1({
      ...f.options,
      events: {
        record: async (input) => {
          if (!input.db) throw new Error("Expected exact owning transaction");
          const result = await input.db.execute(sql`select pg_backend_pid() as pid`);
          sourcePid = Number(result.rows[0].pid);
          const prepared = input.db
            .insert(npSettings)
            .values({ siteId, key: "guardian.http.synthetic-late-write", value: true })
            .prepare(`guardian_http_${randomUUID().replaceAll("-", "")}`);
          entered.resolve();
          await release.promise;
          try {
            await prepared.execute();
            const recorded = await f.options.events.record(input);
            completed.resolve(null);
            return recorded;
          } catch (error) {
            completed.resolve(error);
            throw error;
          }
        },
      },
    });
    try {
      const rejected = expect(source.observe(f.input())).rejects.toMatchObject({
        code: "GUARDIAN_HTTP_SOURCE_TIMEOUT",
      });
      await entered.promise;
      await rejected;
      await f.db.transaction(async (borrower) => {
        const result = await borrower.execute(sql`select pg_backend_pid() as pid`);
        expect(Number(result.rows[0].pid)).toBe(sourcePid);
        release.resolve();
        expect(await completed.promise).toBeInstanceOf(Error);
        expect(
          await borrower
            .select()
            .from(npSettings)
            .where(eq(npSettings.key, "guardian.http.synthetic-late-write")),
        ).toHaveLength(0);
        expect(await borrower.select().from(npAgentEvents)).toHaveLength(0);
        expect(await borrower.select().from(npAgentSignals)).toHaveLength(0);
        expect(
          await borrower
            .select()
            .from(npAuditEvents)
            .where(eq(npAuditEvents.action, "agent.guardian_http.source")),
        ).toHaveLength(0);
      });
    } finally {
      release.resolve();
      await unpin();
    }
  });

  it("skips new capture while disabled, preserves proof reads, and holds late observations below closure", async () => {
    const f = await setup(),
      recorded = await f.source.observe(f.input());
    const controls = createAgentGuardianControlsV1({
      deploymentActorFingerprint: `cj1:sha256:${"A".repeat(43)}`,
      registration: async () => ({
        sourceCount: 1,
        ready: true,
        fingerprint: `cj1:sha256:${"B".repeat(43)}`,
      }),
      now: f.now,
    });
    expect((await controls.disable({ siteId, reason: "Synthetic containment" })).outcome).toBe(
      "disabled",
    );
    expect(await f.source.observe(f.input())).toMatchObject({ disposition: "disabled" });
    expect(
      await f.source.verifyEvent({ db: f.db, siteId, eventId: recorded.eventId! }),
    ).toMatchObject({ eventId: recorded.eventId });
    await f.db
      .delete(npSettings)
      .where(
        and(
          eq(npSettings.siteId, siteId),
          eq(npSettings.key, NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1),
        ),
      );
    const boundary = new Date(
      Math.floor(f.state.clock.getTime() / 600_000) * 600_000,
    ).toISOString();
    await f.db.insert(npSettings).values({
      siteId,
      key: "guardian.closure.http",
      value: {
        schemaVersion: "np.agent-guardian-source-closure.v1",
        siteId,
        family: "http",
        namespaceDigest: await npAgentGuardianSourceNamespaceDigestV1("http"),
        closedBefore: boundary,
        closedAt: f.now().toISOString(),
        revision: 1,
        retentionPolicyDigest: `cj1:sha256:${"C".repeat(43)}`,
      },
    });
    expect(
      await f.source.observe(
        f.input({ occurredAt: new Date(Date.parse(boundary) - 1).toISOString() }),
      ),
    ).toMatchObject({ disposition: "closed" });
  });
});
