import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentIncidents,
  npAgentSignals,
  npAgentIncidentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npSiteMemberships } from "../../../packages/core/src/db/schema/system.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { npDigestAgentSignalEvidenceCanonical } from "../../../packages/core/src/agent-contract/canonical-events.js";
import type { NpAgentReadCapabilityContextV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const time = new Date("2026-09-27T00:00:00.000Z");
const query = {
  statuses: [],
  categories: [],
  severities: [],
  updatedAfter: null,
  limit: 1,
  cursor: null,
};
type Fixture = Awaited<ReturnType<typeof fixture>>;
function context(f: Fixture): NpAgentReadCapabilityContextV1 {
  return {
    siteId,
    principal: {
      kind: "service",
      principalId: randomUUID(),
      siteId,
      authority: { kind: "user", userId: f.actor.actor.user.id },
      credentialId: randomUUID(),
      gatewayExposureCeiling: "read",
      scopes: ["incident:read"],
    },
    requestedAt: time.toISOString(),
    invocationId: randomUUID(),
    idempotencyKey: null,
    abortSignal: new AbortController().signal,
  };
}
async function incident(f: Fixture, overrides: Partial<typeof npAgentIncidents.$inferInsert> = {}) {
  const [row] = await f.db
    .insert(npAgentIncidents)
    .values({
      siteId,
      category: "availability",
      status: "open",
      severity: "medium",
      fingerprint: randomUUID(),
      title: "Worker lag observed",
      summary: "A bounded synthetic observation.",
      firstObservedAt: time,
      lastObservedAt: time,
      createdAt: time,
      updatedAt: time,
      ...overrides,
    })
    .returning();
  return row;
}
function service(
  canReadIncident: Parameters<typeof createAgentIncidentServiceV1>[0]["canReadIncident"] = () =>
    true,
) {
  return createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(67),
    canReadIncident,
    now: () => time,
  });
}
describe.skipIf(skipIfNoTestDb())("Incident foundation", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("bounds pages, isolates sites, filters hidden rows and binds cursors to authority and query", async () => {
    const f = await fixture();
    const c = context(f);
    const first = await incident(f, { id: "00000000-0000-4000-8000-000000000001" });
    const second = await incident(f, { id: "00000000-0000-4000-8000-000000000002" });
    const foreign = await incident(f, { siteId: "draft-other" });
    const s = service(({ incident: item }) => item.id !== first.id);
    const page = await s.list(query, c);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).not.toBeNull();
    expect((await s.list({ ...query, cursor: page.nextCursor }, c)).items.map((x) => x.id)).toEqual(
      [second.id],
    );
    await expect(s.get({ incidentId: first.id }, c)).rejects.toMatchObject({
      code: "INCIDENT_NOT_FOUND",
    });
    await expect(s.get({ incidentId: foreign.id }, c)).rejects.toMatchObject({
      code: "INCIDENT_NOT_FOUND",
    });
    await expect(s.list({ ...query, limit: 2, cursor: page.nextCursor }, c)).rejects.toMatchObject({
      code: "INCIDENT_CURSOR_INVALID",
    });
    await expect(
      s.list(
        { ...query, cursor: page.nextCursor },
        { ...c, principal: { ...c.principal, principalId: randomUUID() } },
      ),
    ).rejects.toMatchObject({ code: "INCIDENT_CURSOR_INVALID" });
    await f.db
      .update(npSiteMemberships)
      .set({ role: "viewer" })
      .where(eq(npSiteMemberships.userId, f.actor.actor.user.id));
    await expect(s.list({ ...query, cursor: page.nextCursor }, c)).rejects.toMatchObject({
      code: "INCIDENT_CURSOR_INVALID",
    });
    expect((await s.list(query, c)).items).toEqual([]);
  });
  it("verifies retained signal digests and delegates every evidence target before projection", async () => {
    const f = await fixture();
    const c = context(f);
    const row = await incident(f);
    const canonical = {
      schemaVersion: "np.agent-signal-evidence.v1",
      siteId,
      detectorId: "operator.worker",
      detectorVersion: 1,
      category: "availability",
      window: { startedAt: time.toISOString(), endedAt: time.toISOString() },
      subject: { kind: "site", siteId },
      evidence: [
        {
          kind: "ops-check",
          checkId: "jobs.worker",
          observedAt: time.toISOString(),
          digest: "a".repeat(64),
          excerpt: null,
        },
      ],
    };
    const [signal] = await f.db
      .insert(npAgentSignals)
      .values({
        siteId,
        detectorId: "operator.worker",
        detectorVersion: 1,
        category: "availability",
        severity: "medium",
        confidenceBasis: "exact-rule",
        fingerprint: randomUUID(),
        subject: { kind: "site", siteId },
        evidence: [
          {
            kind: "ops-check",
            checkId: "jobs.worker",
            observedAt: time.toISOString(),
            digest: "a".repeat(64),
            excerpt: null,
          },
        ],
        evidenceDigest: await npDigestAgentSignalEvidenceCanonical(canonical),
        status: "attached",
        incidentId: row.id,
        windowStartedAt: time,
        windowEndedAt: time,
        createdAt: time,
        updatedAt: time,
        expiresAt: new Date(time.getTime() + 86400000),
      })
      .returning();
    await f.db
      .insert(npAgentIncidentSignals)
      .values({ siteId, incidentId: row.id, signalId: signal.id });
    const s = service(({ signals }) => {
      expect(signals).toHaveLength(1);
      expect(signals[0].evidence[0].kind).toBe("ops-check");
      return true;
    });
    const output = await s.get({ incidentId: row.id }, c);
    expect(output.incident.signalIds).toEqual([signal.id]);
    expect(output.incident).not.toHaveProperty("evidence");
    await f.db
      .update(npAgentSignals)
      .set({ detectorVersion: 2 })
      .where(eq(npAgentSignals.id, signal.id));
    await expect(s.get({ incidentId: row.id }, c)).rejects.toMatchObject({
      code: "INCIDENT_NOT_FOUND",
    });
    expect((await s.list(query, c)).items).toEqual([]);
  });
  it("enforces same-site references, active fingerprint uniqueness and terminal recurrence", async () => {
    const f = await fixture();
    const row = await incident(f);
    await expect(incident(f, { fingerprint: row.fingerprint })).rejects.toThrow();
    await incident(f, {
      fingerprint: row.fingerprint,
      status: "resolved",
      resolvedAt: time,
      resolutionCode: "VERIFIED",
    });
    await expect(
      f.db
        .insert(npAgentIncidentSignals)
        .values({ siteId: "draft-other", incidentId: row.id, signalId: randomUUID() }),
    ).rejects.toThrow();
    await expect(incident(f, { status: "resolved" })).rejects.toThrow();
  });
  it("enforces Runtime category and collection ceilings on retained subjects and cursor reuse", async () => {
    const f = await fixture();
    const c = context(f);
    const row = await incident(f, {
      primarySubject: { kind: "document", collection: "posts", documentId: randomUUID() },
    });
    await incident(f);
    const runtime: NpAgentReadCapabilityContextV1 = {
      ...c,
      principal: {
        kind: "runtime",
        siteId,
        principalId: c.principal.principalId,
        authority: c.principal.authority,
        scopes: ["incident:read"],
        runId: randomUUID(),
      },
      runtimeResources: {
        collections: ["posts"],
        navigationLocations: null,
        themeIds: null,
        settingKeys: null,
        incidentCategories: ["availability"],
        actorRestrictionScopes: null,
      },
    };
    const s = service();
    expect((await s.get({ incidentId: row.id }, runtime)).incident.id).toBe(row.id);
    await expect(
      s.get(
        { incidentId: row.id },
        { ...runtime, runtimeResources: { ...runtime.runtimeResources!, collections: [] } },
      ),
    ).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    await expect(
      s.get(
        { incidentId: row.id },
        { ...runtime, runtimeResources: { ...runtime.runtimeResources!, incidentCategories: [] } },
      ),
    ).rejects.toMatchObject({ code: "INCIDENT_NOT_FOUND" });
    const page = await s.list(query, runtime);
    await expect(
      s.list(
        { ...query, cursor: page.nextCursor },
        {
          ...runtime,
          runtimeResources: { ...runtime.runtimeResources!, incidentCategories: null },
        },
      ),
    ).rejects.toMatchObject({ code: "INCIDENT_CURSOR_INVALID" });
  });

  it("denies missing scope, cross-site principals, missing Runtime policy and mid-read staff revocation", async () => {
    const f = await fixture();
    const row = await incident(f);
    const c = context(f);
    await expect(
      service().get({ incidentId: row.id }, { ...c, principal: { ...c.principal, scopes: [] } }),
    ).rejects.toMatchObject({ code: "INCIDENT_FORBIDDEN" });
    await expect(
      service().get({ incidentId: row.id }, { ...c, siteId: "draft-other" }),
    ).rejects.toMatchObject({ code: "INCIDENT_FORBIDDEN" });
    await expect(
      service().get(
        { incidentId: row.id },
        {
          ...c,
          principal: {
            kind: "runtime",
            siteId,
            principalId: c.principal.principalId,
            authority: c.principal.authority,
            scopes: ["incident:read"],
            runId: randomUUID(),
          },
        },
      ),
    ).rejects.toMatchObject({ code: "INCIDENT_FORBIDDEN" });
    const s = service(async () => {
      await f.db
        .update(npSiteMemberships)
        .set({ role: "viewer" })
        .where(eq(npSiteMemberships.userId, f.actor.actor.user.id));
      return true;
    });
    await expect(s.get({ incidentId: row.id }, c)).rejects.toMatchObject({
      code: "INCIDENT_NOT_FOUND",
    });
  });
});
