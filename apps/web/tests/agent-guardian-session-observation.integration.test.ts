import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npSessions } from "../../../packages/core/src/db/schema/system.js";
import { npMemberSessions } from "../../../packages/core/src/db/schema/community.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentRuns,
} from "../../../packages/core/src/db/schema/agent.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentGuardianObservationServiceV1 } from "../../../packages/core/src/agent/guardian-observation-service.js";
import {
  createAgentGuardianSessionObservationServiceV1,
  npReadGuardianSessionIncidentEvidenceV1,
} from "../../../packages/core/src/agent/guardian-session-observation.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

async function setup(audience: "staff" | "member" = "staff") {
  const f = await fixture();
  const email = "trusted-session@example.test";
  const principalId =
    audience === "staff"
      ? (await seedUser({ email })).userId
      : (await seedActiveMember({ email })).memberId;
  const [session] =
    audience === "staff"
      ? await f.db
          .select({ id: npSessions.id, createdAt: npSessions.createdAt })
          .from(npSessions)
          .where(eq(npSessions.userId, principalId))
      : await f.db
          .select({ id: npMemberSessions.id, createdAt: npMemberSessions.createdAt })
          .from(npMemberSessions)
          .where(eq(npMemberSessions.memberId, principalId));
  let clock = new Date(session.createdAt.getTime() + 10);
  const now = () => new Date(clock);
  const key = { id: "session-observation-fixture", bytes: new Uint8Array(32).fill(23) };
  const never = () => Promise.reject(new Error("Observation must not activate Runtime/providers"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "session-observation-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: never,
    now,
  });
  const options = {
    actorKey: key,
    isInstalledSite: async () => true,
    authorize: async () => {},
    events,
    now,
  };
  const failures = createAgentGuardianObservationServiceV1(options);
  const collector = createAgentGuardianSessionObservationServiceV1(options);
  const source = () => ({
    siteId,
    observationId: randomUUID(),
    occurredAt: now().toISOString(),
    networkAddress: "192.0.2.67",
    audience,
    principalId,
    sessionFamilyId: session.id,
  });
  const cohort = async (
    changes: {
      email?: string;
      networkAddress?: string;
      audience?: "staff" | "member";
      siteId?: string;
    } = {},
  ) => {
    for (let i = 0; i < 5; i++)
      await failures.observe({
        siteId: changes.siteId ?? siteId,
        observationId: randomUUID(),
        occurredAt: new Date(session.createdAt.getTime() - 5000 + i).toISOString(),
        networkAddress: changes.networkAddress ?? "192.0.2.67",
        audience: changes.audience ?? audience,
        kind: "login-failed",
        loginIdentifier: changes.email ?? email,
      });
  };
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: key.bytes,
    now,
    canReadIncident: () => false,
    canReadStaffIncident: async ({ incident, context }) => {
      await npReadGuardianSessionIncidentEvidenceV1({ db: f.db, siteId: context.siteId, incident });
      return true;
    },
  }).staff;
  return {
    ...f,
    principalId,
    session,
    email,
    audience,
    source,
    collector,
    cohort,
    reads,
    now,
    setTime: (time: Date) => {
      clock = time;
    },
  };
}

describe.skipIf(skipIfNoTestDb())("Guardian trusted session observation", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  for (const audience of ["staff", "member"] as const)
    it(`binds exact ${audience} session creation and retained source evidence without Runtime or raw secrets`, async () => {
      const f = await setup(audience);
      await f.cohort();
      const input = f.source();
      const result = await f.collector.observe(input);
      expect(result.incidentId).toBeTypeOf("string");
      const incident = (
        await f.reads.get({ incidentId: result.incidentId! }, { siteId, actor: f.actor.actor })
      ).incident;
      expect(incident).toMatchObject({
        category: "authentication",
        eventCount: 6,
        primarySubject: { kind: "session", actorKind: audience, sessionFamilyId: f.session.id },
      });
      const proof = await npReadGuardianSessionIncidentEvidenceV1({ db: f.db, siteId, incident });
      expect(await f.collector.observe({ ...input, observationId: randomUUID() })).toMatchObject({
        disposition: "replayed",
        eventId: result.eventId,
        incidentId: result.incidentId,
      });
      expect(proof).toEqual({
        actorKind: audience,
        principalId: f.principalId,
        sessionFamilyId: f.session.id,
        createdAt: f.session.createdAt.toISOString(),
        sourceDigest: expect.stringMatching(/^cj1:sha256:/u),
      });
      const events = await f.db.select().from(npAgentEvents);
      expect(events).toHaveLength(6);
      expect(JSON.stringify(events)).not.toMatch(
        /192\.0\.2\.67|trusted-session@example\.test|refreshToken|accessToken/u,
      );
      expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
      if (audience === "staff")
        await f.db.delete(npSessions).where(eq(npSessions.id, f.session.id));
      else await f.db.delete(npMemberSessions).where(eq(npMemberSessions.id, f.session.id));
      expect(await npReadGuardianSessionIncidentEvidenceV1({ db: f.db, siteId, incident })).toEqual(
        proof,
      );
      f.setTime(new Date(f.now().getTime() + 120_000));
      expect(await f.collector.observe(input)).toMatchObject({
        disposition: "replayed",
        eventId: result.eventId,
        incidentId: result.incidentId,
      });
    });

  for (const mismatch of ["email", "network", "audience", "site"] as const)
    it(`does not infer a session target from a mismatched ${mismatch}`, async () => {
      const f = await setup();
      await f.cohort(
        mismatch === "email"
          ? { email: "other-person@example.test" }
          : mismatch === "network"
            ? { networkAddress: "198.51.100.67" }
            : mismatch === "audience"
              ? { audience: "member" }
              : { siteId: "draft-other" },
      );
      expect((await f.collector.observe(f.source())).incidentId).toBeNull();
      const incidents = await f.db.select().from(npAgentIncidents);
      expect(incidents).toHaveLength(1);
      expect(incidents[0].primarySubject?.kind).toBe("actor-bucket");
    });

  it("rejects wrong owners, stale family sources, duplicate-id retargeting and altered source rows", async () => {
    const f = await setup();
    await expect(
      f.collector.observe({ ...f.source(), principalId: randomUUID() }),
    ).rejects.toThrow();
    f.setTime(new Date(f.now().getTime() + 61_000));
    await expect(f.collector.observe(f.source())).rejects.toThrow();
    f.setTime(new Date(f.session.createdAt.getTime() + 10));
    await f.cohort();
    const source = f.source();
    const result = await f.collector.observe(source);
    await expect(
      f.collector.observe({ ...source, sessionFamilyId: randomUUID() }),
    ).rejects.toThrow();
    const incident = (
      await f.reads.get({ incidentId: result.incidentId! }, { siteId, actor: f.actor.actor })
    ).incident;
    const [success] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.id, result.eventId!));
    if (success.payload.kind !== "auth.login.succeeded")
      throw new Error("Expected trusted success source");
    await f.db
      .update(npAgentEvents)
      .set({ payload: { ...success.payload, reasonCode: "ALTERED" } })
      .where(eq(npAgentEvents.id, success.id));
    await expect(
      npReadGuardianSessionIncidentEvidenceV1({ db: f.db, siteId, incident }),
    ).rejects.toThrow();
  });
});
