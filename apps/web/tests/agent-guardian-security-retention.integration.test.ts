import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as memberMeDelete } from "@/app/api/members/me/route";
import { replaceStaffPasswordAndInvalidateSessions } from "../../../packages/core/src/auth/session.js";
import {
  createMemberSession,
  replaceMemberPasswordAndInvalidateSessions,
} from "../../../packages/core/src/auth/member-session.js";
import { hashPassword } from "../../../packages/core/src/auth/password.js";
import { createAgentGuardianSecurityObservationServiceV1 } from "../../../packages/core/src/agent/guardian-security-observation.js";
import {
  resetGuardianSensitiveObserverV1,
  setGuardianSensitiveObserverV1,
} from "../../../packages/core/src/agent/guardian-sensitive-observer.js";
import { createAgentRuntimeEventServiceV1 } from "../../../packages/core/src/agent/runtime-event-service.js";
import {
  createAgentGuardianRetentionServiceV1,
  npGuardianRetentionAuditOwnerDigestV1,
} from "../../../packages/core/src/agent/guardian-retention-service.js";
import { npRequireAgentSourceReleaseRecordV1 } from "../../../packages/core/src/agent/source-release-read.js";
import { npCollectAgentHealthSummaryV1 } from "../../../packages/core/src/agent/contract-diagnostics.js";
import {
  npAgentEvents,
  npAgentSignals,
  npAgentIncidents,
  npAgentSourceReleases,
  npAgentSourceReleaseEdges,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents, npMembers } from "../../../packages/core/src/db/schema/community.js";
import { npUsers } from "../../../packages/core/src/db/schema/system.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedActiveMember,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const day = 86_400_000;
describe.skipIf(skipIfNoTestDb())("Security source retained audit lifecycle and Doctor", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    resetGuardianSensitiveObserverV1();
    await truncateAll();
    registerTestCollections();
  });
  afterEach(resetGuardianSensitiveObserverV1);
  afterAll(closeTestDb);

  it("releases actual aged staff/member source facts after real member soft-delete and preserves valid immutable source/closure audit attribution", async () => {
    const f = await fixture(),
      sourceNow = () => new Date(Date.now() + 1000),
      retentionNow = new Date(Date.now() + 100 * day);
    const never = () =>
      Promise.reject(new Error("Security retention must not activate Runtime or providers"));
    const events = createAgentRuntimeEventServiceV1({
      admission: { admit: never, retry: never, withCurrentRun: never, withRunAuthority: never },
      deploymentAuthority: {
        policyId: "security-retention-fixture",
        fingerprint: `cj1:sha256:${"A".repeat(43)}`,
        scopes: [],
      },
      enqueueRun: never,
      now: sourceNow,
    });
    const source = createAgentGuardianSecurityObservationServiceV1({
      actorKey: { id: "synthetic-security-retention-1", bytes: new Uint8Array(32).fill(123) },
      isInstalledSite: (id) => Promise.resolve(id === siteId),
      authorize: () => Promise.resolve(),
      events,
      now: sourceNow,
    });
    setGuardianSensitiveObserverV1(source.sensitiveObserver);
    const [staff] = await f.db.select().from(npUsers).where(eq(npUsers.id, f.actor.actor.user.id));
    expect(
      await replaceStaffPasswordAndInvalidateSessions(
        staff.id,
        staff.password,
        await hashPassword("Synthetic-retained-staff-password"),
        f.db,
        { actor: { kind: "staff", userId: staff.id } },
      ),
    ).toBe(true);
    const member = await seedActiveMember();
    const [beforeMember] = await f.db
      .select()
      .from(npMembers)
      .where(eq(npMembers.id, member.memberId));
    if (!beforeMember.password) throw new Error("Missing synthetic member password");
    expect(
      await replaceMemberPasswordAndInvalidateSessions(
        f.db,
        member.memberId,
        beforeMember.password,
        await hashPassword("Synthetic-retained-member-password"),
        {},
        { actor: { kind: "member", memberId: member.memberId } },
      ),
    ).toBe(true);
    const originalEvents = await f.db.select().from(npAgentEvents);
    const sourceAudits = await f.db
      .select()
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agent.guardian_security.source"));
    expect(originalEvents).toHaveLength(2);
    expect(sourceAudits.map((audit) => audit.actorKind).sort()).toEqual(["member", "staff"]);
    for (const row of originalEvents)
      await expect(
        source.verifyEvent({ db: f.db, siteId, eventId: row.id }),
      ).resolves.toMatchObject({ detectorId: "guardian.credential-changed" });

    const [currentMember] = await f.db
      .select({
        id: npMembers.id,
        email: npMembers.email,
        handle: npMembers.handle,
        displayName: npMembers.displayName,
        status: npMembers.status,
        tokenVersion: npMembers.tokenVersion,
      })
      .from(npMembers)
      .where(eq(npMembers.id, member.memberId));
    const secret = process.env.NP_SECRET;
    if (!secret) throw new Error("Missing synthetic auth fixture secret");
    if (!currentMember || currentMember.status !== "active")
      throw new Error("Expected active synthetic member");
    const session = await createMemberSession(
      { ...currentMember, status: currentMember.status },
      secret,
      f.db,
      { accessExpiration: 7200, refreshExpiration: 604800 },
    );
    const csrf = "synthetic-security-retention-csrf";
    const deleted = await memberMeDelete(
      new NextRequest("http://localhost:3000/api/members/me", {
        method: "DELETE",
        headers: {
          cookie: `np-mb-session=${session.access}; np-mb-csrf=${csrf}`,
          "x-csrf-token": csrf,
        },
      }),
    );
    expect(deleted.status).toBe(200);
    const [erasedProfile] = await f.db
      .select()
      .from(npMembers)
      .where(eq(npMembers.id, member.memberId));
    expect(erasedProfile).toMatchObject({
      id: member.memberId,
      status: "deleted",
      email: `deleted+${member.memberId}@deleted.local`,
      password: null,
    });
    // The real profile owner soft-deletes in place. It does not erase audit FKs;
    // do not invent a permissive null-actor exception for immutable source proof.
    expect(
      await f.db
        .select()
        .from(npAuditEvents)
        .where(eq(npAuditEvents.action, "agent.guardian_security.source")),
    ).toEqual(sourceAudits);
    for (const row of originalEvents)
      await expect(
        source.verifyEvent({ db: f.db, siteId, eventId: row.id }),
      ).resolves.toMatchObject({ eventId: row.id });

    // Only terminal lifecycle/age is synthetic. Events, source MACs, Signals and
    // observation history were written by the actual mutation/source owners.
    const incidents = await f.db.select().from(npAgentIncidents);
    expect(incidents).toHaveLength(2);
    for (const incident of incidents)
      await f.db
        .update(npAgentIncidents)
        .set({
          status: "dismissed",
          resolvedAt: sourceNow(),
          resolutionCode: "FIXTURE_TERMINAL",
        })
        .where(eq(npAgentIncidents.id, incident.id));
    const retention = createAgentGuardianRetentionServiceV1({
      policy: { version: 1, eventDays: 1, receiptDays: 1, signalDays: 1, historyDays: 1 },
      authorize: ({ siteId: requested }) =>
        requested === siteId ? Promise.resolve() : Promise.reject(new Error("Wrong fixture site")),
      proofOwners: [
        {
          family: "security-transitions",
          verifyEvent: source.verifyEvent,
          verifySignal: source.verifySignal,
        },
      ],
      now: () => new Date(retentionNow),
    });
    let pruned = 0;
    for (let pass = 0; pass < 3; pass++) {
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const result = await retention.prune({ siteId, cursor, limit: 25 });
        pruned += result.eventsPruned;
        cursor = result.nextCursor;
        if (cursor === null) break;
      }
    }
    expect(pruned).toBe(2);
    expect(await f.db.select().from(npAgentEvents)).toEqual([]);
    expect(await f.db.select().from(npAgentSignals)).toEqual([]);
    expect(await f.db.select().from(npAgentIncidents)).toEqual([]);
    const releases = await f.db.select().from(npAgentSourceReleases);
    expect(releases).toHaveLength(2);
    for (const release of releases)
      await expect(npRequireAgentSourceReleaseRecordV1(release)).resolves.toMatchObject({
        kind: "guardian-event",
        family: "security-transitions",
      });
    const edges = await f.db.select().from(npAgentSourceReleaseEdges);
    expect(edges).toHaveLength(4);
    for (const audit of sourceAudits) {
      expect(edges).toContainEqual(
        expect.objectContaining({
          ownerKind: "guardian-audit",
          edgeCode: "guardian-event",
          ownerId: audit.id,
          ownerEvidenceDigest: npGuardianRetentionAuditOwnerDigestV1(audit),
        }),
      );
      expect(await f.db.select().from(npAuditEvents).where(eq(npAuditEvents.id, audit.id))).toEqual(
        [audit],
      );
      await expect(
        f.db
          .update(npAuditEvents)
          .set({ payload: { tampered: true } })
          .where(eq(npAuditEvents.id, audit.id)),
      ).rejects.toThrow();
    }
    expect(edges.filter((edge) => edge.ownerKind === "guardian-closure-audit")).toHaveLength(2);
    // Assert actual release first: blocked source proof must never pass as a
    // healthy empty result. Doctor validates retained attribution, not a deleted
    // Event's live MAC or present-day member authority.
    const health = await npCollectAgentHealthSummaryV1({ now: retentionNow });
    expect(health.issues).toEqual([]);
  });
});
