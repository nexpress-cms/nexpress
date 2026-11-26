import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { npLockSiteQuotasWithBudgetV1 } from "../../../packages/core/src/sites/quota-lock.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentGuardianObservationServiceV1,
  npIsAgentGuardianAuthenticatedRequestSourceV1,
  type NpAgentGuardianObservationOptionsV1,
  type NpAgentGuardianObservationV1,
  type NpAgentGuardianObservationServiceV1,
} from "../../../packages/core/src/agent/guardian-observation-service.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentGuardianControlsV1 } from "../../../packages/core/src/agent/guardian-controls.js";
import { NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1 } from "../../../packages/core/src/agent-contract/guardian-controls-contract.js";
import {
  npAgentGuardianSourceDeliveryKeyDigestV1,
  npAgentGuardianSourceNamespaceDigestV1,
} from "../../../packages/core/src/agent-contract/guardian-retention-contract.js";
import { npAgentGuardianSourceClosureKeyV1 } from "../../../packages/core/src/agent/guardian-source-closure.js";
import {
  createAgentGuardianRetentionServiceV1,
  npGuardianRetentionAuditOwnerDigestV1,
} from "../../../packages/core/src/agent/guardian-retention-service.js";
import { npCollectAgentHealthSummaryV1 } from "../../../packages/core/src/agent/contract-diagnostics.js";
import { npRequireAgentSourceReleaseRecordV1 } from "../../../packages/core/src/agent/source-release-read.js";
import { npReadAgentEventRowEvidenceV1 } from "../../../packages/core/src/agent/event-evidence.js";
import {
  npAgentEvents,
  npAgentSignals,
  npAgentIncidents,
  npAgentRuns,
  npAgentSourceReleases,
  npAgentSourceReleaseEdges,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { npLockSiteQuotas } from "../../../packages/core/src/sites/quotas.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const action = "agent.guardian_request.source",
  day = 86_400_000;
function runtimePool(value: unknown): value is Pick<Pool, "connect"> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof Reflect.get(value, "connect") === "function"
  );
}
async function setup() {
  const f = await fixture();
  const state = { clock: new Date("2026-10-17T10:01:00.000Z"), allowed: true };
  const now = () => new Date(state.clock);
  const never = () =>
    Promise.reject(new Error("Request source cannot activate Runtime or providers"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "signed-request-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: never,
    now,
  });
  const options: NpAgentGuardianObservationOptionsV1 = {
    actorKey: { id: "request-actor-1", bytes: new Uint8Array(32).fill(97) },
    receiptKey: { id: "request-receipt-1", bytes: new Uint8Array(32).fill(98) },
    isInstalledSite: (id) => Promise.resolve(id === siteId),
    authorize: () =>
      state.allowed ? Promise.resolve() : Promise.reject(new Error("Source authority unavailable")),
    events,
    now,
  };
  const source = createAgentGuardianObservationServiceV1(options);
  function input(
    kind: "login-failed" | "rate-limited" = "login-failed",
    network = "192.0.2.61",
  ): NpAgentGuardianObservationV1 {
    const base = {
      siteId,
      observationId: randomUUID(),
      occurredAt: now().toISOString(),
      networkAddress: network,
    };
    return kind === "login-failed"
      ? { ...base, kind, audience: "staff", loginIdentifier: "private-source@example.test" }
      : { ...base, kind, routeFamily: "staff-auth" };
  }
  async function observe(owner: NpAgentGuardianObservationServiceV1, value = input()) {
    const result = await owner.observe(value);
    state.clock = new Date(state.clock.getTime() + 1);
    return result;
  }
  async function cohort(
    owner: NpAgentGuardianObservationServiceV1 = source,
    kind: "login-failed" | "rate-limited" = "login-failed",
  ) {
    const inputs: NpAgentGuardianObservationV1[] = [];
    let incidentId: string | null = null;
    for (let n = 0; n < 5; n++) {
      const value = input(kind);
      inputs.push(value);
      incidentId = (await observe(owner, value)).incidentId;
    }
    if (!incidentId) throw new Error("Missing actual request Incident");
    return { inputs, incidentId };
  }
  const audits = () => f.db.select().from(npAuditEvents).where(eq(npAuditEvents.action, action));
  const retentionNow = new Date(state.clock.getTime() + 100 * day);
  function retention(owner = source) {
    return createAgentGuardianRetentionServiceV1({
      policy: { version: 1, eventDays: 1, receiptDays: 1, signalDays: 1, historyDays: 1 },
      authorize: ({ siteId: requested }) =>
        requested === siteId ? Promise.resolve() : Promise.reject(new Error("Wrong fixture site")),
      proofOwners: [
        { family: "requests", verifyEvent: owner.verifyEvent, verifySignal: owner.verifySignal },
      ],
      now: () => new Date(retentionNow),
    });
  }
  async function terminal(incidentId: string) {
    // Synthetic lifecycle/age only. Canonical source, signed receipts and the
    // original threshold/Signal graph remain actual owner-written evidence.
    await f.db
      .update(npAgentIncidents)
      .set({ status: "dismissed", resolvedAt: now(), resolutionCode: "FIXTURE_TERMINAL" })
      .where(eq(npAgentIncidents.id, incidentId));
  }
  async function drain() {
    const results = [],
      owner = retention();
    for (let pass = 0; pass < 3; pass++) {
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const result = await owner.prune({ siteId, cursor, limit: 25 });
        results.push(result);
        cursor = result.nextCursor;
        if (cursor === null) break;
      }
    }
    return results;
  }
  return {
    ...f,
    source,
    events,
    options,
    state,
    now,
    input,
    observe,
    cohort,
    audits,
    terminal,
    drain,
    retentionNow,
  };
}
describe.skipIf(skipIfNoTestDb())("authenticated request source receipts", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("keeps the fused quota budget transaction-local through commit, SQL timeout and exact client reuse", async () => {
    const f = await setup(),
      pool: unknown = Reflect.get(f.db, "$client");
    if (!runtimePool(pool)) throw new Error("Expected actual harness pool");
    const client = await pool.connect(),
      db = drizzle(client);
    const settings = async () =>
      (
        await client.query<{ lock: string; statement: string; pid: number }>(
          "select current_setting('lock_timeout') as lock,current_setting('statement_timeout') as statement,pg_backend_pid() as pid",
        )
      ).rows[0];
    const original = await settings();
    try {
      await client.query(
        "select set_config('lock_timeout','3s',false),set_config('statement_timeout','4s',false)",
      );
      const baseline = await settings();
      await client.query("BEGIN");
      await npLockSiteQuotasWithBudgetV1(db, siteId, { lockMs: 100, statementMs: 500 });
      expect(await settings()).toEqual({ lock: "100ms", statement: "500ms", pid: baseline.pid });
      await client.query("COMMIT");
      expect(await settings()).toEqual(baseline);
      await client.query("BEGIN");
      await npLockSiteQuotasWithBudgetV1(db, siteId, { lockMs: 100, statementMs: 500 });
      await expect(db.execute(sql`select pg_sleep(1)`)).rejects.toMatchObject({
        cause: { code: "57014" },
      });
      await client.query("ROLLBACK");
      expect(await settings()).toEqual(baseline);
      await client.query("BEGIN");
      await npLockSiteQuotas(db as unknown as Parameters<typeof npLockSiteQuotas>[0], siteId);
      await client.query("COMMIT");
      const execute = vi.fn(() => Promise.resolve(undefined));
      await expect(
        npLockSiteQuotasWithBudgetV1({ execute }, "../invalid", { lockMs: 100, statementMs: 500 }),
      ).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await client.query("ROLLBACK");
      await client.query(
        "select set_config('lock_timeout',$1,false),set_config('statement_timeout',$2,false)",
        [original.lock, original.statement],
      );
      client.release();
    }
  });

  it("bounds a real quota wait and reads newly committed controls in the separate post-lock snapshot", async () => {
    const f = await setup();
    const controls = createAgentGuardianControlsV1({
      deploymentActorFingerprint: `cj1:sha256:${"A".repeat(43)}`,
      registration: () =>
        Promise.resolve({
          sourceCount: 1,
          ready: true,
          fingerprint: `cj1:sha256:${"B".repeat(43)}`,
        }),
      now: f.now,
    });
    await controls.disable({ siteId, reason: "Synthetic current control generation" });
    const [disabled] = await f.db
      .select()
      .from(npSettings)
      .where(eq(npSettings.key, NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1));
    await f.db
      .delete(npSettings)
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, disabled.key)));
    const pool: unknown = Reflect.get(f.db, "$client");
    if (!runtimePool(pool)) throw new Error("Expected actual harness pool");
    const holder = await pool.connect(),
      contender = await pool.connect();
    const holderDb = drizzle(holder),
      contenderDb = drizzle(contender);
    const authorize = vi.fn((input: Parameters<typeof f.options.authorize>[0]) =>
      f.options.authorize(input),
    );
    const source = createAgentGuardianObservationServiceV1({ ...f.options, authorize });
    let completion: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      await npLockSiteQuotas(holderDb as unknown as Parameters<typeof npLockSiteQuotas>[0], siteId);
      await contender.query("BEGIN");
      await contender.query(
        "select set_config('lock_timeout','0',true),set_config('statement_timeout','0',true)",
      );
      await expect(
        npLockSiteQuotasWithBudgetV1(contenderDb, siteId, { lockMs: 100, statementMs: 500 }),
      ).rejects.toMatchObject({ cause: { code: "55P03" } });
      expect((await holder.query("select 1 as held")).rows).toEqual([{ held: 1 }]);
      await contender.query("ROLLBACK");
      await holderDb.insert(npSettings).values(disabled);
      completion = source.observe(f.input()).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      let waiting = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const result = await holder.query(
          "select 1 from pg_locks where locktype='advisory' and not granted and database=(select oid from pg_database where datname=current_database())",
        );
        if (result.rows.length) {
          waiting = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
      }
      expect(waiting).toBe(true);
      await holder.query("COMMIT");
      expect(await completion).toMatchObject({ result: { disposition: "disabled" } });
      expect(authorize).not.toHaveBeenCalled();
    } finally {
      await holder.query("ROLLBACK");
      await contender.query("ROLLBACK");
      await completion;
      holder.release();
      contender.release();
    }
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
    expect(await f.audits()).toHaveLength(0);
  });

  it.each(["authorize", "record"] as const)(
    "rolls back a stalled %s callback, releases its exact client and rejects late prepared writes",
    async (phase) => {
      const f = await setup();
      const deferred = <T>() => {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>((complete) => (resolve = complete));
        return { promise, resolve };
      };
      const unpin = deferred<void>(),
        held = [deferred<void>(), deferred<void>()],
        entered = deferred<void>(),
        release = deferred<void>(),
        completed = deferred<unknown>();
      const pins = held.map((ready) =>
        f.db.transaction(async (tx) => {
          await tx.execute(sql`select 1`);
          ready.resolve();
          await unpin.promise;
        }),
      );
      await Promise.all(held.map((ready) => ready.promise));
      let sourcePid: number | undefined;
      const key = `guardian.requests.late-${phase}`;
      const stall = async (db: typeof f.db) => {
        const result = await db.execute(sql`select pg_backend_pid() as pid`);
        sourcePid = Number(result.rows[0].pid);
        const prepared = db
          .insert(npSettings)
          .values({ siteId, key, value: true })
          .prepare(`guardian_request_${randomUUID().replaceAll("-", "")}`);
        entered.resolve();
        await release.promise;
        try {
          await prepared.execute();
          completed.resolve(null);
        } catch (error) {
          completed.resolve(error);
          throw error;
        }
      };
      const source = createAgentGuardianObservationServiceV1({
        ...f.options,
        authorize: phase === "authorize" ? ({ db }) => stall(db) : f.options.authorize,
        events:
          phase === "record"
            ? {
                record: async (input) => {
                  if (!input.db) throw new Error("Expected actual owning transaction");
                  const result = await f.events.record(input);
                  await stall(input.db);
                  return result;
                },
              }
            : f.events,
      });
      try {
        const rejected = expect(source.observe(f.input())).rejects.toMatchObject({
          code: "GUARDIAN_OBSERVATION_UNAVAILABLE",
        });
        await entered.promise;
        await rejected;
        await f.db.transaction(async (borrower) => {
          const result = await borrower.execute(sql`select pg_backend_pid() as pid`);
          expect(Number(result.rows[0].pid)).toBe(sourcePid);
          await borrower.execute(sql`select set_config('lock_timeout','100ms',true)`);
          await npLockSiteQuotas(
            borrower as unknown as Parameters<typeof npLockSiteQuotas>[0],
            siteId,
          );
          release.resolve();
          expect(await completed.promise).toBeInstanceOf(Error);
          expect(
            await borrower.select().from(npSettings).where(eq(npSettings.key, key)),
          ).toHaveLength(0);
          expect(await borrower.select().from(npAgentEvents)).toHaveLength(0);
          expect(await borrower.select().from(npAgentSignals)).toHaveLength(0);
          expect(
            await borrower.select().from(npAuditEvents).where(eq(npAuditEvents.action, action)),
          ).toHaveLength(0);
        });
      } finally {
        release.resolve();
        unpin.resolve();
        await Promise.all(pins);
      }
      const controls = createAgentGuardianControlsV1({
        deploymentActorFingerprint: `cj1:sha256:${"A".repeat(43)}`,
        registration: async () => ({
          sourceCount: 1,
          ready: true,
          fingerprint: `cj1:sha256:${"B".repeat(43)}`,
        }),
        now: f.now,
      });
      expect(
        await controls.disable({ siteId, reason: "Synthetic recovery after timeout" }),
      ).toMatchObject({ outcome: "disabled" });
      expect(await f.source.observe(f.input())).toMatchObject({ disposition: "disabled" });
    },
  );

  it("uses fresh persisted controls before source authority and preserves the actual local enable ceremony", async () => {
    const f = await setup(),
      authorize = vi.fn(f.options.authorize.bind(f.options)),
      source = createAgentGuardianObservationServiceV1({ ...f.options, authorize }),
      controls = createAgentGuardianControlsV1({
        deploymentActorFingerprint: `cj1:sha256:${"A".repeat(43)}`,
        registration: () =>
          Promise.resolve({
            sourceCount: 1,
            ready: true,
            fingerprint: `cj1:sha256:${"B".repeat(43)}`,
          }),
        now: f.now,
      }),
      whereControl = and(
        eq(npSettings.siteId, siteId),
        eq(npSettings.key, NP_AGENT_GUARDIAN_CONTROL_SETTING_KEY_V1),
      );
    await expect(source.observe(f.input())).resolves.toMatchObject({ disposition: "recorded" });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(await controls.disable({ siteId, reason: "Fixture capture containment" })).toMatchObject(
      {
        outcome: "disabled",
      },
    );
    const [disabled] = await f.db.select().from(npSettings).where(whereControl);
    await expect(source.observe(f.input())).resolves.toEqual({
      disposition: "disabled",
      eventId: null,
      incidentId: null,
    });
    expect(authorize).toHaveBeenCalledTimes(1);
    // Persist JSON null as a present setting; SQL NULL would test the table constraint instead.
    await f.db
      .update(npSettings)
      .set({ value: sql`'null'::jsonb` })
      .where(whereControl);
    await expect(source.observe(f.input())).rejects.toMatchObject({
      code: "GUARDIAN_STATE_INVALID",
    });
    await f.db
      .update(npSettings)
      .set({ value: { enabled: false } })
      .where(whereControl);
    await expect(source.observe(f.input())).rejects.toMatchObject({
      code: "GUARDIAN_STATE_INVALID",
    });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(await f.audits()).toHaveLength(1);
    await f.db.update(npSettings).set({ value: disabled.value }).where(whereControl);
    const planned = await controls.prepareEnable({ siteId });
    if (!planned.plan) throw new Error("Missing actual persisted Guardian enable plan");
    expect(
      await controls.enable({ siteId, plan: planned.plan, approval: planned.plan.id }),
    ).toMatchObject({
      outcome: "enabled",
    });
    f.state.allowed = false;
    await expect(source.observe(f.input())).rejects.toThrow("Source authority unavailable");
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(await f.audits()).toHaveLength(1);
    f.state.allowed = true;
    const resumed = await source.observe(f.input());
    expect(resumed.disposition).toBe("recorded");
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(await f.audits()).toHaveLength(2);
    if (!resumed.eventId) throw new Error("Missing actual resumed source Event");
    await expect(
      source.verifyEvent({ db: f.db, siteId, eventId: resumed.eventId }),
    ).resolves.toMatchObject({
      source: "requests",
      eventId: resumed.eventId,
    });
  });

  it("checks fresh exact closure rows before callbacks without treating present null or another site as absent", async () => {
    const f = await setup(),
      authorize = vi.fn(f.options.authorize.bind(f.options)),
      source = createAgentGuardianObservationServiceV1({ ...f.options, authorize }),
      key = npAgentGuardianSourceClosureKeyV1("requests"),
      value = {
        schemaVersion: "np.agent-guardian-source-closure.v1",
        siteId,
        family: "requests",
        namespaceDigest: await npAgentGuardianSourceNamespaceDigestV1("requests"),
        closedBefore: "2026-10-17T10:10:00.000Z",
        closedAt: "2026-10-17T10:11:00.000Z",
        revision: 1,
        retentionPolicyDigest: `cj1:sha256:${"A".repeat(43)}`,
      },
      whereClosure = and(eq(npSettings.siteId, siteId), eq(npSettings.key, key));
    await f.db.insert(npSettings).values({ siteId, key, value: sql`'null'::jsonb` });
    await expect(source.observe(f.input())).rejects.toThrow();
    await f.db
      .update(npSettings)
      .set({ value: { ...value, siteId: "other-site" } })
      .where(whereClosure);
    await expect(source.observe(f.input())).rejects.toMatchObject({
      code: "GUARDIAN_SOURCE_CLOSURE_INVALID",
    });
    await f.db.update(npSettings).set({ value }).where(whereClosure);
    await expect(source.observe(f.input())).resolves.toEqual({
      disposition: "closed",
      eventId: null,
      incidentId: null,
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(await f.audits()).toEqual([]);
    // Removing the closure is fixture-only: a subsequent call must reread storage,
    // rather than retaining the prior closed outcome in a process cache.
    await f.db.delete(npSettings).where(whereClosure);
    const recorded = await source.observe(f.input());
    expect(recorded.disposition).toBe("recorded");
    expect(authorize).toHaveBeenCalledOnce();
    expect(await f.audits()).toHaveLength(1);
  });

  it.each(["login-failed", "rate-limited"] as const)(
    "authenticates exact %s Events and the original five-fact rule without exposing buckets or activating Runtime",
    async (kind) => {
      const f = await setup();
      await f.cohort(f.source, kind);
      expect(npIsAgentGuardianAuthenticatedRequestSourceV1(f.source)).toBe(true);
      const rows = await f.db.select().from(npAgentEvents),
        audits = await f.audits();
      expect(rows).toHaveLength(5);
      expect(audits).toHaveLength(5);
      for (const row of rows) {
        const meta = await f.source.verifyEvent({ db: f.db, siteId, eventId: row.id });
        expect(meta).toEqual({
          schemaVersion: "np.agent-guardian-verified-event.v1",
          eventId: row.id,
          source: "requests",
          observedAt: row.occurredAt.toISOString(),
          sourceDigest: row.eventHash,
          detectorId: null,
        });
        expect(JSON.stringify(meta)).not.toMatch(
          /bucket|keyId|sourceMac|192\.0\.2|private-source/u,
        );
        const audit = audits.find((a) => a.targetId === row.id);
        expect(audit).toMatchObject({
          actorKind: "system",
          actorUserId: null,
          actorMemberId: null,
          siteId,
          createdAt: row.recordedAt,
          payload: {
            receiptId: audit?.id,
            eventId: row.id,
            eventHash: row.eventHash,
            recordedAt: row.recordedAt.toISOString(),
          },
        });
        expect((await npReadAgentEventRowEvidenceV1(row)).correlationId).toBeNull();
      }
      const [signal] = await f.db.select().from(npAgentSignals);
      expect(await f.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(true);
      expect(await f.db.select().from(npAgentRuns)).toEqual([]);
      await expect(
        f.source.verifyEvent({ db: f.db, siteId: "draft-other", eventId: rows[0].id }),
      ).rejects.toThrow();
    },
  );

  it("keeps exact replay byte-identical, copies keys and resolves only the retained receipt key after rotation", async () => {
    const f = await setup(),
      value = f.input();
    // The source copied this key at installation; changing the caller's buffer
    // cannot change source proof or make a rotated key silently replace it.
    f.options.receiptKey!.bytes.fill(0);
    const first = await f.observe(f.source, value);
    const [row] = await f.db.select().from(npAgentEvents),
      before = await f.audits();
    const rotated = createAgentGuardianObservationServiceV1({
      ...f.options,
      receiptKey: { id: "request-receipt-2", bytes: new Uint8Array(32).fill(99) },
      resolveReceiptKey: (id) => (id === "request-receipt-1" ? new Uint8Array(32).fill(98) : null),
    });
    await expect(rotated.observe(value)).resolves.toMatchObject({
      disposition: "replayed",
      eventId: first.eventId,
    });
    await expect(rotated.verifyEvent({ db: f.db, siteId, eventId: row.id })).resolves.toMatchObject(
      { sourceDigest: row.eventHash },
    );
    expect(await f.db.select().from(npAgentEvents)).toEqual([row]);
    expect(await f.audits()).toEqual(before);
    const missing = createAgentGuardianObservationServiceV1({
      ...f.options,
      receiptKey: { id: "request-receipt-2", bytes: new Uint8Array(32).fill(99) },
    });
    await expect(missing.observe(value)).rejects.toThrow();
    await expect(missing.verifyEvent({ db: f.db, siteId, eventId: row.id })).rejects.toThrow();
    const stalled = createAgentGuardianObservationServiceV1({
      ...f.options,
      receiptKey: { id: "request-receipt-2", bytes: new Uint8Array(32).fill(99) },
      resolveReceiptKey: () => new Promise(() => {}),
    });
    await expect(stalled.verifyEvent({ db: f.db, siteId, eventId: row.id })).rejects.toMatchObject({
      code: "GUARDIAN_SOURCE_READ_TIMEOUT",
    });
  });

  it("rejects changed, duplicate and deleted source receipts on proof and configured replay", async () => {
    const f = await setup(),
      graph = await f.cohort(),
      [audit] = await f.audits();
    const [signal] = await f.db.select().from(npAgentSignals);
    await f.db
      .update(npAuditEvents)
      .set({ payload: { ...audit.payload, sourceMac: `hmac-sha256:${"A".repeat(43)}` } })
      .where(eq(npAuditEvents.id, audit.id));
    expect(await f.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(false);
    await expect(f.source.observe(graph.inputs[0])).rejects.toThrow();
    await f.db
      .update(npAuditEvents)
      .set({ payload: audit.payload })
      .where(eq(npAuditEvents.id, audit.id));
    const duplicateId = randomUUID();
    await f.db.insert(npAuditEvents).values({ ...audit, id: duplicateId });
    await expect(
      f.source.verifyEvent({ db: f.db, siteId, eventId: audit.targetId! }),
    ).rejects.toThrow();
    await expect(f.source.observe(graph.inputs[0])).rejects.toThrow();
    await f.db.delete(npAuditEvents).where(eq(npAuditEvents.id, duplicateId));
    await f.db.delete(npAuditEvents).where(eq(npAuditEvents.id, audit.id));
    await expect(f.source.observe(graph.inputs[0])).rejects.toThrow();
    expect(await f.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(false);
  });

  it("preserves no-key manual observations and legacy replay without authenticating or backfilling them", async () => {
    const f = await setup(),
      legacy = createAgentGuardianObservationServiceV1({ ...f.options, receiptKey: undefined });
    const graph = await f.cohort(legacy);
    expect(npIsAgentGuardianAuthenticatedRequestSourceV1(legacy)).toBe(false);
    await expect(legacy.observe(graph.inputs[0])).resolves.toMatchObject({
      disposition: "replayed",
    });
    await expect(f.source.observe(graph.inputs[0])).rejects.toThrow();
    expect(await f.audits()).toEqual([]);
    const [event] = await f.db.select().from(npAgentEvents),
      [signal] = await f.db.select().from(npAgentSignals);
    await expect(f.source.verifyEvent({ db: f.db, siteId, eventId: event.id })).rejects.toThrow();
    expect(await f.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(false);
    await f.terminal(graph.incidentId);
    const results = await f.drain();
    expect(results.reduce((sum, r) => sum + r.eventsPruned, 0)).toBe(0);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(5);
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(1);
    expect(
      results.some((r) =>
        r.skipped.some((s) => ["PROOF_UNAVAILABLE", "COHORT_PINNED"].includes(s.reason)),
      ),
    ).toBe(true);
  });

  it("rolls Event, receipt and Signal effects back together when the actual receipt insert fails", async () => {
    const f = await setup();
    await f.db.execute(
      sql`create function public.np_guardian_request_test_abort() returns trigger language plpgsql as $$begin if NEW.action='agent.guardian_request.source' then raise exception 'Injected request receipt insert failure'; end if; return NEW; end$$`,
    );
    await f.db.execute(
      sql`create trigger np_guardian_request_test_abort before insert on np_audit_events for each row execute function public.np_guardian_request_test_abort()`,
    );
    try {
      await expect(f.source.observe(f.input())).rejects.toThrow();
      expect(await f.db.select().from(npAgentEvents)).toEqual([]);
      expect(await f.audits()).toEqual([]);
      expect(await f.db.select().from(npAgentSignals)).toEqual([]);
    } finally {
      await f.db.execute(sql`drop trigger np_guardian_request_test_abort on np_audit_events`);
      await f.db.execute(sql`drop function public.np_guardian_request_test_abort()`);
    }
  });

  it("keeps first-five sampling and the existing per-window100 cap without creating receipts for capped work", async () => {
    const f = await setup();
    await f.cohort();
    await expect(f.source.observe(f.input())).resolves.toMatchObject({
      disposition: "capped",
      eventId: null,
    });
    for (let index = 5; index < 100; index++)
      await f.observe(f.source, f.input("login-failed", `198.51.100.${index}`));
    await expect(f.source.observe(f.input("login-failed", "203.0.113.99"))).resolves.toMatchObject({
      disposition: "capped",
      eventId: null,
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(100);
    expect(await f.audits()).toHaveLength(100);
    f.state.allowed = false;
    await expect(f.source.observe(f.input("rate-limited"))).rejects.toThrow(
      "Source authority unavailable",
    );
    expect(await f.audits()).toHaveLength(100);
  });

  it("keeps staff/member and route-family cohorts separate while matching the same network in the thin window", async () => {
    const f = await setup();
    const base = {
      siteId,
      observationId: randomUUID(),
      occurredAt: f.now().toISOString(),
      networkAddress: "192.0.2.77",
    };
    const cohorts: NpAgentGuardianObservationV1[] = [
      { ...base, kind: "login-failed", audience: "staff", loginIdentifier: "staff@example.test" },
      { ...base, kind: "login-failed", audience: "member", loginIdentifier: "member@example.test" },
      { ...base, kind: "rate-limited", routeFamily: "staff-auth" },
      { ...base, kind: "rate-limited", routeFamily: "member-auth" },
    ];
    const observe = (value: NpAgentGuardianObservationV1) =>
      f.observe(f.source, {
        ...value,
        observationId: randomUUID(),
        occurredAt: f.now().toISOString(),
      });
    for (let round = 0; round < 4; round++) for (const value of cohorts) await observe(value);
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
    for (const value of cohorts) {
      await expect(observe(value)).resolves.toMatchObject({ disposition: "recorded" });
      await expect(observe(value)).resolves.toMatchObject({ disposition: "capped" });
    }
    const signals = await f.db.select().from(npAgentSignals);
    expect(signals).toHaveLength(4);
    for (const signal of signals)
      expect(await f.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(true);
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(20);
    expect(await f.audits()).toHaveLength(20);
  });

  it("releases an actually signed closed cohort, retains exact immutable audit edges and passes Doctor without reopening consumed delivery keys", async () => {
    const f = await setup(),
      graph = await f.cohort(),
      audits = await f.audits();
    const [signal] = await f.db.select().from(npAgentSignals);
    const [originalEventRow] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.deduplicationKey, graph.inputs[0].observationId));
    const originalEvent = await npReadAgentEventRowEvidenceV1(originalEventRow);
    expect(await f.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(true);
    await f.terminal(graph.incidentId);
    const results = await f.drain();
    expect(
      results.reduce((sum, r) => sum + r.eventsPruned, 0),
      JSON.stringify(
        results.map(({ eventsPruned, historyPruned, skipped }) => ({
          eventsPruned,
          historyPruned,
          skipped,
        })),
      ),
    ).toBe(5);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
    expect(await f.db.select().from(npAgentIncidents)).toEqual([]);
    const releases = await f.db.select().from(npAgentSourceReleases),
      edges = await f.db.select().from(npAgentSourceReleaseEdges);
    expect(releases).toHaveLength(5);
    expect(edges).toHaveLength(10);
    for (const release of releases)
      await expect(npRequireAgentSourceReleaseRecordV1(release)).resolves.toMatchObject({
        kind: "guardian-event",
        family: "requests",
      });
    for (const audit of audits) {
      expect(edges).toContainEqual(
        expect.objectContaining({
          ownerKind: "guardian-audit",
          ownerId: audit.id,
          ownerEvidenceDigest: npGuardianRetentionAuditOwnerDigestV1(audit),
        }),
      );
      await expect(
        f.db.delete(npAuditEvents).where(eq(npAuditEvents.id, audit.id)),
      ).rejects.toThrow();
    }
    expect((await npCollectAgentHealthSummaryV1({ now: f.retentionNow })).issues).toEqual([]);
    const sourceEdge = edges.find((edge) => edge.ownerKind === "guardian-audit");
    if (!sourceEdge) throw new Error("Missing actual retained request source edge");
    const pool: unknown = Reflect.get(f.db, "$client");
    if (!runtimePool(pool)) throw new Error("Missing actual integration database pool");
    const rawClient = await pool.connect();
    try {
      await rawClient.query("BEGIN");
      const constraints = await rawClient.query<{ deferred: boolean; initially: boolean }>(
        `select tgdeferrable as deferred,tginitdeferred as initially from pg_trigger
         where tgrelid='public.np_agent_source_release_edges'::regclass
           and tgname='np_agent_reference_receipt_delete_v1'`,
      );
      expect(constraints.rows).toEqual([{ deferred: true, initially: true }]);
      // Keep the real deferred deletion guard intact. Doctor must observe the
      // missing mandatory request source edge on this same uncommitted client.
      const removed = await rawClient.query<{ id: string }>(
        `delete from public.np_agent_source_release_edges
         where site_id=$1 and id=$2::uuid and owner_kind='guardian-audit' returning id`,
        [siteId, sourceEdge.id],
      );
      expect(removed.rows).toEqual([{ id: sourceEdge.id }]);
      const summary = await npCollectAgentHealthSummaryV1({
        client: rawClient,
        now: f.retentionNow,
      });
      expect(summary.state).toBe("error");
      expect(summary.issues).toContainEqual(
        expect.objectContaining({ code: "AGENT_RELATION_ORPHANED" }),
      );
    } finally {
      try {
        await rawClient.query("ROLLBACK");
      } finally {
        rawClient.release();
      }
    }
    expect(
      await f.db
        .select({ id: npAgentSourceReleaseEdges.id })
        .from(npAgentSourceReleaseEdges)
        .where(eq(npAgentSourceReleaseEdges.id, sourceEdge.id)),
    ).toEqual([{ id: sourceEdge.id }]);
    await expect(f.source.observe(graph.inputs[0])).resolves.toMatchObject({
      disposition: "closed",
      eventId: null,
    });
    f.state.clock = new Date(f.retentionNow);
    await expect(
      f.source.observe({ ...graph.inputs[0], occurredAt: f.now().toISOString() }),
    ).rejects.toMatchObject({ code: "GUARDIAN_SOURCE_ALREADY_RELEASED" });
    expect(await f.audits()).toHaveLength(5);
    // Existing release proof is immutable. A separately inserted corrupt record
    // exercises damaged stored history without weakening that production fence.
    await expect(
      f.db
        .update(npAgentSourceReleases)
        .set({ evidenceDigest: `cj1:sha256:${"Z".repeat(43)}` })
        .where(eq(npAgentSourceReleases.id, releases[0].id)),
    ).rejects.toThrow();
    const invalidInput = {
      ...graph.inputs[0],
      observationId: randomUUID(),
      occurredAt: f.now().toISOString(),
    };
    const deliveryKeyDigest = await npAgentGuardianSourceDeliveryKeyDigestV1({
      ...originalEvent,
      deduplicationKey: invalidInput.observationId,
    });
    const sourceId = randomUUID(),
      template = releases[0];
    const evidenceBody = await npRequireAgentSourceReleaseRecordV1(template);
    if (evidenceBody.kind !== "guardian-event")
      throw new Error("Expected actual Guardian release template");
    await f.db.insert(npAgentSourceReleases).values({
      ...template,
      id: randomUUID(),
      sourceId,
      evidenceBody: { ...evidenceBody, sourceId, deliveryKeyDigest },
      evidenceDigest: `cj1:sha256:${"Z".repeat(43)}`,
    });
    await expect(f.source.observe(invalidInput)).rejects.toMatchObject({
      code: "RUNTIME_RELEASE_INVALID",
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
    expect(await f.audits()).toHaveLength(5);
  });
});
