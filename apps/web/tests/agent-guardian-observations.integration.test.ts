import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAgentGuardianObservationServiceV1,
  npReadAgentGuardianIncidentEvidenceV1,
  type NpAgentGuardianObservationV1,
} from "../../../packages/core/src/agent/guardian-observation-service.js";
import { npWithAgentRuntimeControlTransactionV1 } from "../../../packages/core/src/agent/runtime-controls.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentRuns,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const key = new Uint8Array(32).fill(91);
async function setup() {
  const f = await fixture();
  let clock = new Date("2026-10-17T00:01:00.000Z");
  const now = () => clock;
  const deploymentAuthority = {
    policyId: "guardian-fixture",
    fingerprint: `cj1:sha256:${"A".repeat(43)}`,
    scopes: [],
  };
  const never = () =>
    Promise.reject(new Error("Observation must not admit, dispatch or activate Runtime"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, withCurrentRun: never, withRunAuthority: never, retry: never },
    deploymentAuthority,
    now,
    enqueueRun: never,
  });
  const guardian = createAgentGuardianObservationServiceV1({
    actorKey: { id: "guardian-fixture-1", bytes: key },
    isInstalledSite: async (id) => [siteId, "draft-other"].includes(id),
    authorize: async () => {},
    events,
    now,
  });
  const reader = createAgentIncidentServiceV1({
    cursorHmacKey: key,
    now,
    canReadIncident: () => false,
    canReadStaffIncident: async ({ incident, context }) => {
      try {
        await npReadAgentGuardianIncidentEvidenceV1({ db: f.db, siteId: context.siteId, incident });
        return true;
      } catch {
        return false;
      }
    },
  });
  const studio = createAgentIncidentStudioServiceV1({
    reads: reader.staff,
    cursorHmacKey: key,
    now,
  });
  const observation = (
    change: Partial<NpAgentGuardianObservationV1> = {},
  ): NpAgentGuardianObservationV1 =>
    ({
      kind: "login-failed",
      siteId,
      observationId: randomUUID(),
      occurredAt: now().toISOString(),
      networkAddress: "192.0.2.41",
      loginIdentifier: "private@example.test",
      audience: "staff",
      ...change,
    }) as NpAgentGuardianObservationV1;
  async function observe(input = observation()) {
    const result = await guardian.observe(input);
    clock = new Date(clock.getTime() + 1);
    return result;
  }
  async function cohort(change: Partial<NpAgentGuardianObservationV1> = {}) {
    let result = await observe(observation(change));
    for (let index = 1; index < 5; index++) result = await observe(observation(change));
    if (!result.incidentId) throw new Error("Expected Guardian threshold Incident");
    return result.incidentId;
  }
  return {
    ...f,
    guardian,
    events,
    reader,
    studio,
    observe,
    observation,
    cohort,
    now,
    setTime: (date: Date) => {
      clock = date;
    },
  };
}

describe.skipIf(skipIfNoTestDb())("Guardian request observations", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("freezes private failures into one exact lower-bound Incident without activating Runtime", async () => {
    const f = await setup();
    const original = f.observation();
    if (original.kind !== "login-failed") throw new Error("Expected login-failure fixture");
    const first = await f.observe(original);
    expect(await f.observe(original)).toMatchObject({
      disposition: "replayed",
      eventId: first.eventId,
    });
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(0);
    for (let i = 1; i < 4; i++)
      await f.observe(f.observation({ loginIdentifier: `private-${i}@example.test` }));
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(0);
    const threshold = await f.observe();
    expect(threshold.incidentId).toBeTypeOf("string");
    expect(await f.observe()).toMatchObject({
      disposition: "capped",
      eventId: null,
      incidentId: threshold.incidentId,
    });
    const detail = await f.studio.get({
      siteId,
      actor: f.actor.actor,
      incidentId: threshold.incidentId!,
    });
    expect(detail.guardianEvidence).toEqual([
      expect.objectContaining({
        detectorId: "guardian.login-failures",
        audience: "staff",
        observedCount: 5,
        threshold: 5,
        countBasis: "at-least",
      }),
    ]);
    expect(detail.incident).toMatchObject({
      category: "authentication",
      eventCount: 5,
      signalIds: [detail.signals[0]!.id],
    });
    expect(detail.feedbackAvailable).toBe(false);
    const events = await f.db.select().from(npAgentEvents);
    expect(events).toHaveLength(5);
    expect(
      events.every(
        (event) =>
          event.dispatchedAt !== null &&
          event.expiresAt.getTime() - event.recordedAt.getTime() === 86_400_000,
      ),
    ).toBe(true);
    expect(JSON.stringify({ events, detail })).not.toMatch(
      /192\.0\.2\.41|private(?:-\d)?@example\.test|password|authorization/i,
    );
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
    await expect(
      f.observe({ ...original, loginIdentifier: "changed@example.test" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(1);
  });

  it("separates sites, audiences and route families and coalesces later windows", async () => {
    const f = await setup();
    const staff = await f.cohort();
    const member = await f.cohort({ audience: "member" });
    const other = await f.cohort({ siteId: "draft-other" });
    const rate = (family: "admin" | "staff-auth") => ({
      kind: "rate-limited" as const,
      siteId,
      networkAddress: "192.0.2.41",
      routeFamily: family,
      observationId: randomUUID(),
      occurredAt: f.now().toISOString(),
    });
    let rateId: string | null = null;
    for (let i = 0; i < 5; i++) rateId = (await f.observe(rate("admin"))).incidentId;
    expect(new Set([staff, member, other, rateId]).size).toBe(4);
    expect((await f.observe(rate("staff-auth"))).incidentId).toBeNull();
    const incidents = await f.db.select().from(npAgentIncidents);
    expect(incidents.find((r) => r.id === staff)!.primarySubject).not.toEqual(
      incidents.find((r) => r.id === other)!.primarySubject,
    );
    await expect(
      f.studio.get({ siteId, actor: f.actor.actor, incidentId: other }),
    ).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    f.setTime(new Date("2026-10-17T00:11:00.000Z"));
    expect(await f.cohort()).toBe(staff);
    const detail = await f.studio.get({ siteId, actor: f.actor.actor, incidentId: staff });
    expect(detail.guardianEvidence).toHaveLength(2);
    expect(detail.incident.eventCount).toBe(10);
    const traffic = await f.studio.get({ siteId, actor: f.actor.actor, incidentId: rateId! });
    expect(traffic.guardianEvidence?.[0]).toMatchObject({
      routeFamily: "admin",
      audience: null,
      observedCount: 5,
    });
  });

  it("retains the site budget under high source cardinality and rejects unavailable or malformed sources", async () => {
    const f = await setup();
    for (let index = 0; index < 100; index++)
      await f.observe(f.observation({ networkAddress: `192.0.2.${index + 1}` }));
    expect(await f.observe(f.observation({ networkAddress: "198.51.100.1" }))).toMatchObject({
      disposition: "capped",
      eventId: null,
      incidentId: null,
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(100);
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(0);
    for (const change of [
      { siteId: "uninstalled" },
      { networkAddress: "unknown" },
      { occurredAt: "2026-10-16T00:00:00.000Z" },
    ])
      await expect(f.observe(f.observation(change))).rejects.toThrow();
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(100);
  });

  it("deduplicates concurrent source retries and canonicalizes equivalent IPv6/login spellings", async () => {
    const f = await setup();
    const input = f.observation({
      networkAddress: "2001:db8::1",
      loginIdentifier: "  Private@Example.Test  ",
    });
    const results = await Promise.all([f.guardian.observe(input), f.guardian.observe(input)]);
    expect(results.map((result) => result.disposition).sort()).toEqual(["recorded", "replayed"]);
    for (let index = 0; index < 4; index++)
      await f.observe(f.observation({ networkAddress: "2001:0db8:0:0:0:0:0:1" }));
    const rows = await f.db.select().from(npAgentEvents);
    expect(new Set(rows.map((row) => JSON.stringify(row.subject))).size).toBe(1);
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(1);
  });

  it("fails current staff evidence closed after source corruption", async () => {
    const f = await setup();
    const id = await f.cohort();
    // Retained suppression rows have an Incident pointer but are not attached evidence.
    // This cheap read fixture exercises their layout without repeating the common owner's 100-window scale gate.
    const [signal] = await f.db.select().from(npAgentSignals);
    await f.db
      .insert(npAgentSignals)
      .values({ ...signal!, id: randomUUID(), status: "suppressed" });
    expect(
      (await f.studio.get({ siteId, actor: f.actor.actor, incidentId: id })).guardianEvidence,
    ).toHaveLength(1);
    const [source] = await f.db.select().from(npAgentEvents).limit(1);
    await f.db
      .update(npAgentEvents)
      .set({
        payload: {
          ...source!.payload,
          ...(source!.payload.kind === "auth.login.failed" ? { audience: "member" as const } : {}),
        },
      })
      .where(eq(npAgentEvents.id, source!.id));
    await expect(
      f.studio.get({ siteId, actor: f.actor.actor, incidentId: id }),
    ).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    const permissiveFixtureReader = createAgentIncidentServiceV1({
      cursorHmacKey: key,
      now: f.now,
      canReadIncident: () => false,
      canReadStaffIncident: () => true,
    });
    const permissiveFixtureStudio = createAgentIncidentStudioServiceV1({
      reads: permissiveFixtureReader.staff,
      cursorHmacKey: key,
      now: f.now,
    });
    expect(
      (await permissiveFixtureStudio.get({ siteId, actor: f.actor.actor, incidentId: id }))
        .guardianEvidence,
    ).toBeNull();
  });

  it("bounds source-lock contention and rolls back a failing source owner", async () => {
    const f = await setup();
    await npWithAgentRuntimeControlTransactionV1(siteId, async () => {
      await expect(f.guardian.observe(f.observation())).rejects.toMatchObject({
        cause: { code: "55P03" },
      });
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
    const failing = createAgentGuardianObservationServiceV1({
      actorKey: { id: "guardian-fixture-1", bytes: key },
      isInstalledSite: () => Promise.resolve(true),
      authorize: () => Promise.resolve(),
      now: f.now,
      events: {
        record: async (input) => {
          await f.events.record(input);
          throw new Error("Source owner failure");
        },
      },
    });
    await expect(failing.observe(f.observation())).rejects.toThrow("Source owner failure");
    const wrongClock = createAgentGuardianObservationServiceV1({
      actorKey: { id: "guardian-fixture-1", bytes: key },
      isInstalledSite: () => Promise.resolve(true),
      authorize: () => Promise.resolve(),
      now: f.now,
      events: {
        record: async (input) => {
          const result = await f.events.record(input);
          await input
            .db!.update(npAgentEvents)
            .set({ recordedAt: new Date("2026-10-16T00:00:00.000Z") })
            .where(eq(npAgentEvents.id, result.eventId));
          return result;
        },
      },
    });
    await expect(wrongClock.observe(f.observation())).rejects.toMatchObject({
      code: "GUARDIAN_OBSERVATION_UNAVAILABLE",
    });
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
    expect(await f.db.select().from(npAgentIncidents)).toHaveLength(0);
  });

  it("defers expired unsigned Guardian samples to proof-owning retention while preserving open Incident evidence", async () => {
    const f = await setup();
    const orphan = await f.observe(f.observation({ networkAddress: "198.51.100.2" }));
    const id = await f.cohort();
    const future = new Date("2026-10-19T00:01:00.000Z");
    const pruned = await pruneAgentRuntimeEventsV1({ siteId, now: future, limit: 100 });
    expect(pruned.pruned).toBe(0);
    const retained = await f.db
      .select()
      .from(npAgentEvents)
      .where(and(eq(npAgentEvents.siteId, siteId), eq(npAgentEvents.id, orphan.eventId!)));
    expect(retained).toHaveLength(1);
    expect(retained[0]!.expiresAt.getTime()).toBeLessThan(future.getTime());
    expect(await f.db.select().from(npAgentEvents)).toHaveLength(6);
    expect(
      (await f.studio.get({ siteId, actor: f.actor.actor, incidentId: id })).guardianEvidence,
    ).toHaveLength(1);
    const db = await getTestDb();
    const settings = await db.execute(
      sql`select value from np_settings where site_id=${siteId} and key='agents.runtime'`,
    );
    expect(settings.rows).toHaveLength(0);
  });
});
