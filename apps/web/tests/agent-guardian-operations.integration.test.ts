import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentGuardianOperationsServiceV1 } from "../../../packages/core/src/agent/guardian-operations-service.js";
import { createAgentGuardianExternalObservationServiceV1 } from "../../../packages/core/src/agent/guardian-external-observation.js";
import { createAgentGuardianSecurityObservationServiceV1 } from "../../../packages/core/src/agent/guardian-security-observation.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import { createAgentIncidentServiceV1 } from "../../../packages/core/src/agent/incident-service.js";
import { createAgentIncidentStudioServiceV1 } from "../../../packages/core/src/agent/incident-studio-service.js";
import type { NpAgentGuardianOperationsSourceV1 } from "../../../packages/core/src/agent/guardian-operations-service.js";
import { NpAgentGatewayError } from "../../../packages/core/src/agent/admin-admission.js";
import {
  npAgentEvents,
  npAgentIncidents,
  npAgentRuns,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { grantSiteMembership } from "../../../packages/core/src/sites/memberships.js";
import {
  resetSiteAuthorityObserverV1,
  setSiteAuthorityObserverV1,
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
  const f = await fixture(),
    clock = new Date(Date.now() + 1000),
    now = () => new Date(clock);
  const state = {
    canRead: true,
    diagnosticsAllowed: true,
    readiness: "enabled" as "enabled" | "disabled" | "unavailable",
    withdrawOnSecondRead: false,
    reads: 0,
  };
  const never = () =>
    Promise.reject(new Error("Operations must not activate Runtime or providers"));
  const events = createAgentRuntimeEventServiceV1({
    admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
    deploymentAuthority: {
      policyId: "operations-fixture",
      fingerprint: `cj1:sha256:${"A".repeat(43)}`,
      scopes: [],
    },
    enqueueRun: never,
    now,
  });
  const upstream = new Uint8Array(32).fill(121),
    receipt = new Uint8Array(32).fill(122),
    installationId = "00000000-0000-4000-8000-000000000093";
  const source = createAgentGuardianExternalObservationServiceV1({
    binding: {
      id: "00000000-0000-4000-8000-000000000094",
      siteId,
      installationId,
      projectId: "1234",
    },
    signatureKeys: [{ id: "sentry-1", bytes: upstream }],
    receiptKey: { id: "receipt-1", bytes: receipt },
    isInstalledSite: (id) => Promise.resolve(id === siteId),
    authorize: async () => {},
    events,
    now,
  });
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey: new Uint8Array(32).fill(123),
    now,
    canReadIncident: () => false,
    canReadStaffIncident: async ({ incident, context }) => {
      if (!state.canRead) return false;
      try {
        await source.evidence({ db: f.db, siteId: context.siteId, incident });
        return true;
      } catch {
        return false;
      }
    },
  });
  const studio = createAgentIncidentStudioServiceV1({
    reads: reads.staff,
    guardianExternalObservations: source,
    cursorHmacKey: new Uint8Array(32).fill(124),
    now,
  });
  const registration: NpAgentGuardianOperationsSourceV1 = {
    id: "sentry",
    readiness: () => Promise.resolve(state.readiness),
    verifyEvent: source.verifyEvent.bind(source),
  };
  const authorizeDiagnostics = async (
    input: Parameters<
      Parameters<typeof createAgentGuardianOperationsServiceV1>[0]["authorizeDiagnostics"]
    >[0],
  ) => {
    if (!state.diagnosticsAllowed)
      throw new NpAgentGatewayError("INCIDENT_FORBIDDEN", 403, "Incident permission is required.");
    await reads.staff.authorize({
      siteId: input.siteId,
      actor: input.actor,
      transaction: input.db,
    });
  };
  const operations = createAgentGuardianOperationsServiceV1({
    studio: {
      get: async (input) => {
        state.reads++;
        if (state.withdrawOnSecondRead && state.reads === 2) state.canRead = false;
        return studio.get(input);
      },
    },
    authorizeDiagnostics,
    sources: [registration],
    now,
  });
  const staff = { siteId, actor: f.actor.actor };
  async function ingest() {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        action: "created",
        installation: { uuid: installationId },
        data: {
          issue: {
            id: "123456",
            project: { id: "1234" },
            issueCategory: "error",
            firstSeen: new Date(clock.getTime() - 2000).toISOString(),
            title: "private-provider-prose-marker",
            url: "https://private.invalid/credential",
          },
        },
      }),
    );
    return source.ingest({
      rawBody,
      signature: createHmac("sha256", upstream).update(rawBody).digest("hex"),
      resource: "issue",
      signal: new AbortController().signal,
    });
  }
  async function current() {
    const [row] = await f.db
      .select()
      .from(npAgentIncidents)
      .where(eq(npAgentIncidents.siteId, siteId))
      .limit(1);
    if (!row) throw new Error("Expected source Incident");
    return { ...staff, incidentId: row.id, expectedVersion: row.versionNumber };
  }
  return {
    ...f,
    state,
    source,
    events,
    operations,
    studio,
    registration,
    authorizeDiagnostics,
    staff,
    ingest,
    current,
    now,
  };
}

describe.skipIf(skipIfNoTestDb())("Guardian read-only operations foundation", () => {
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
  it("exports real verified source evidence through current Studio while creating no new records", async () => {
    const f = await setup();
    await f.ingest();
    const before = await f.db.select({ id: npAuditEvents.id }).from(npAuditEvents);
    const result = await f.operations.exportIncident(await f.current());
    expect(result.sources).toEqual([
      expect.objectContaining({
        source: "sentry",
        observedCount: 1,
        countBasis: "authenticated-external-fact",
      }),
    ]);
    expect(f.state.reads).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(
      /private-provider|private.invalid|sourceMac|receiptKey|primarySubject|approvalId|summary/u,
    );
    expect(await f.db.select({ id: npAuditEvents.id }).from(npAuditEvents)).toEqual(before);
    expect(await f.db.select().from(npAgentRuns)).toHaveLength(0);
  });
  it("rejects stale generation and authority withdrawn during the final real Studio recheck", async () => {
    const f = await setup();
    await f.ingest();
    const input = await f.current();
    await expect(
      f.operations.exportIncident({ ...input, expectedVersion: input.expectedVersion + 1 }),
    ).rejects.toMatchObject({ code: "GUARDIAN_EXPORT_STALE_GENERATION" });
    f.state.reads = 0;
    f.state.withdrawOnSecondRead = true;
    await expect(f.operations.exportIncident(input)).rejects.toMatchObject({
      code: "INCIDENT_NOT_FOUND",
    });
  });
  it("reports actual proof samples and explicit unknown registrations without inventing healthy zeros", async () => {
    const f = await setup();
    await f.ingest();
    const result = await f.operations.diagnostics(f.staff);
    expect(result.coverage).toBe("bounded-sample");
    expect(result.detectors).toHaveLength(15);
    expect(result.sources.find((s) => s.id === "sentry")).toMatchObject({
      state: "verified",
      sampled: 1,
      verified: 1,
      proofUnavailable: 0,
    });
    expect(
      result.sources
        .filter((s) => s.id !== "sentry")
        .every((s) => s.state === "unregistered" && s.sampled === null),
    ).toBe(true);
    expect(result.signals).toEqual({ sampled: 1, invalid: 0, unsupported: 0, truncated: false });
    f.state.readiness = "unavailable";
    expect(
      (await f.operations.diagnostics(f.staff)).sources.find((s) => s.id === "sentry"),
    ).toMatchObject({ state: "unavailable", sampled: null, verified: null });
    f.state.readiness = "disabled";
    expect(
      (await f.operations.diagnostics(f.staff)).sources.find((s) => s.id === "sentry"),
    ).toMatchObject({ state: "disabled", sampled: null });
  });
  it("fails a tampered receipt export and marks the actual source proof unavailable", async () => {
    const f = await setup();
    await f.ingest();
    const [audit] = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agent.guardian_external.source"));
    await f.db
      .update(npAuditEvents)
      .set({ payload: { ...audit.payload, bodyDigest: `sha256:${"0".repeat(64)}` } })
      .where(eq(npAuditEvents.id, audit.id));
    await expect(f.operations.exportIncident(await f.current())).rejects.toMatchObject({
      code: "INCIDENT_NOT_FOUND",
    });
    const result = await f.operations.diagnostics(f.staff);
    expect(result.sources.find((s) => s.id === "sentry")).toMatchObject({
      state: "partial",
      sampled: 1,
      verified: 0,
      proofUnavailable: 1,
    });
  });
  it("reports corrupt canonical Signal evidence independently from source receipt readiness", async () => {
    const f = await setup();
    await f.ingest();
    await f.db
      .update(npAgentSignals)
      .set({ evidenceDigest: `cj1:sha256:${"B".repeat(43)}` })
      .where(eq(npAgentSignals.siteId, siteId));
    const result = await f.operations.diagnostics(f.staff);
    expect(result.signals).toMatchObject({ sampled: 1, invalid: 1 });
    expect(result.sources.find((s) => s.id === "sentry")?.verified).toBe(1);
  });
  it("uses current diagnostics admission, and the read-only transaction rejects mutating callbacks", async () => {
    const f = await setup();
    f.state.diagnosticsAllowed = false;
    await expect(f.operations.diagnostics(f.staff)).rejects.toMatchObject({ status: 403 });
    f.state.diagnosticsAllowed = true;
    const bad = createAgentGuardianOperationsServiceV1({
      studio: f.studio,
      authorizeDiagnostics: async ({ db }) => {
        await db.delete(npAgentSignals).where(eq(npAgentSignals.siteId, siteId));
      },
    });
    await expect(bad.diagnostics(f.staff)).rejects.toMatchObject({
      code: "GUARDIAN_DIAGNOSTICS_UNAVAILABLE",
    });
  });
  it("verifies a committed nondetecting authority fact without requiring a Signal or raw principal export", async () => {
    const f = await setup(),
      target = await seedUser({ role: "viewer" });
    await grantSiteMembership(siteId, target.userId, "admin");
    const source = createAgentGuardianSecurityObservationServiceV1({
      actorKey: { id: "security-1", bytes: new Uint8Array(32).fill(125) },
      isInstalledSite: (id) => Promise.resolve(id === siteId),
      authorize: async () => {},
      events: f.events,
      now: f.now,
    });
    setSiteAuthorityObserverV1(source.authorityObserver);
    await grantSiteMembership(siteId, target.userId, "viewer", {
      actor: { kind: "staff", userId: f.actor.actor.user.id },
    });
    const [event] = await f.db
      .select()
      .from(npAgentEvents)
      .where(eq(npAgentEvents.kind, "security.authority.changed"));
    const proof = await source.verifyEvent({ db: f.db, siteId, eventId: event.id });
    expect(proof.detectorId).toBeNull();
    expect(JSON.stringify(proof)).not.toContain(target.userId);
    expect(await f.db.select().from(npAgentSignals)).toHaveLength(0);
    const operations = createAgentGuardianOperationsServiceV1({
      studio: f.studio,
      authorizeDiagnostics: f.authorizeDiagnostics,
      sources: [
        {
          id: "security-transitions",
          readiness: () => Promise.resolve("enabled"),
          verifyEvent: source.verifyEvent.bind(source),
        },
      ],
      now: f.now,
    });
    expect(
      (await operations.diagnostics(f.staff)).sources.find((s) => s.id === "security-transitions"),
    ).toMatchObject({ state: "verified", sampled: 1, verified: 1 });
    await expect(
      source.verifyEvent({ db: f.db, siteId: "draft-other", eventId: event.id }),
    ).rejects.toMatchObject({ code: "GUARDIAN_SECURITY_EVIDENCE_UNAVAILABLE" });
  });
});
