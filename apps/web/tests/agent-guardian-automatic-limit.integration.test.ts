import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  npAgentActions,
  npAgentActorRestrictions,
  npAgentApprovals,
  npAgentEvents,
  npAgentIncidentTimeline,
  npAgentIncidents,
  npAgentInvocations,
  npAgentRestrictionEnforcements,
  npAgentRuns,
  npAgentSignals,
} from "../../../packages/core/src/db/schema/agent.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { revokeSiteMembership } from "../../../packages/core/src/sites/memberships.js";
import { createAgentGuardianObservationServiceV1 } from "../../../packages/core/src/agent/guardian-observation-service.js";
import { createAgentGuardianRetentionServiceV1 } from "../../../packages/core/src/agent/guardian-retention-service.js";
import { npRequireAgentGuardianAutomaticResponseActionV1 } from "../../../packages/core/src/agent-contract/guardian-response-contract.js";
import { NP_AGENT_GUARDIAN_AUTOMATIC_RESPONSE_PROFILE_V1 } from "../../../packages/core/src/agent/guardian-response-capability.js";
import { guardianAutomaticLimitFixture } from "./agent-guardian-automatic-limit-fixture.js";
import { siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

type Fixture = Awaited<ReturnType<typeof guardianAutomaticLimitFixture>>;
async function automaticActions(f: Fixture) {
  return f.db
    .select()
    .from(npAgentActions)
    .where(eq(npAgentActions.effectProfileId, NP_AGENT_GUARDIAN_AUTOMATIC_RESPONSE_PROFILE_V1));
}
const execute = (f: Fixture) =>
  f.service.automatic.limit({ ...f.command, authentication: f.p.authentication });
async function restriction(f: Fixture) {
  const [row] = await f.db
    .select()
    .from(npAgentActorRestrictions)
    .where(eq(npAgentActorRestrictions.siteId, siteId));
  if (!row) throw new Error("Expected actual staged restriction");
  return row;
}
// Synthetic host qualification callback only. No production shadow, human security approval,
// NAT-impact acceptance or enablement qualification is asserted by these local no-network cases.
describe.skipIf(skipIfNoTestDb())(
  "Guardian automatic limit actual signed-source lifecycle with synthetic qualification",
  () => {
    beforeAll(ensureMigrated);
    beforeEach(async () => {
      await truncateAll();
      registerTestCollections();
    });
    afterAll(closeTestDb);
    it("uses actual signed five-source proof, independent staff escalation, current principal admission and shared exact-scope adapter", async () => {
      const f = await guardianAutomaticLimitFixture();
      const [signal] = await f.db.select().from(npAgentSignals);
      expect(signal).toMatchObject({ severity: "medium", confidenceBasis: "exact-rule" });
      expect((await f.incident()).severity).toBe("high");
      expect(await f.source.verifySignal({ db: f.db, siteId, signalId: signal.id })).toBe(true);
      expect(f.service.automatic.installed).toBe(true);
      const result = await execute(f),
        row = await restriction(f);
      expect(row).toMatchObject({
        state: "active",
        sourceActionId: result.resourceId,
        rowVersion: 2,
      });
      expect(row.descriptor).toMatchObject({
        reasonCode: "GUARDIAN_POLICY_AUTH_LIMIT",
        actionScopes: ["auth.staff"],
      });
      expect(row.expiresAt.getTime() - Date.parse(row.descriptor.startsAt)).toBe(120000);
      expect(await f.check()).toMatchObject({ decision: "deny" });
      expect(await f.check("auth.member")).toMatchObject({ decision: "allow" });
      expect(await f.check("auth.staff", "draft-other")).toMatchObject({ decision: "allow" });
      const [action] = await automaticActions(f);
      expect(action).toMatchObject({
        state: "succeeded",
        risk: "reversible",
        approvalId: null,
        runId: null,
        verificationState: "passed",
      });
      const [invocation] = await f.db
        .select()
        .from(npAgentInvocations)
        .where(eq(npAgentInvocations.id, action.invocationId!));
      const proof = npRequireAgentGuardianAutomaticResponseActionV1(invocation.requestBody.input);
      expect(proof.authorization).toMatchObject({
        sourceBaselineSeverity: "medium",
        incidentSeverity: "high",
        observedCount: 5,
        countBasis: "at-least",
        actionScopes: ["auth.staff"],
      });
      expect(proof.authorization.sourceEventIds).toHaveLength(5);
      expect(
        (await f.db.select().from(npAgentIncidentTimeline)).some(
          (entry) =>
            entry.id === proof.authorization.staffEscalation.timelineEntryId &&
            entry.kind === "human_note" &&
            entry.sourceKind === "staff",
        ),
      ).toBe(true);
      expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
      expect(await f.db.select().from(npAgentRuns)).toEqual([]);
      const publicView = await f.service.get(f.staffInput);
      expect(publicView.plans).toEqual([]);
      expect(JSON.stringify(publicView)).not.toMatch(
        /192\.0\.2\.144|private-automatic|"bucket"|sourceFactsDigest|staffEscalation/,
      );
      expect(await execute(f)).toEqual({ ...result, replayed: true });
      expect(await automaticActions(f)).toHaveLength(1);
      expect((await restriction(f)).descriptor).toEqual(row.descriptor);
    });
    it.each([
      "source-medium",
      "qualification",
      "current-policy",
      "incident-acl",
      "current-user-role",
      "disabled",
    ] as const)("blocks new execution for %s without staging a limit", async (reason) => {
      const f = await guardianAutomaticLimitFixture({ escalate: reason !== "source-medium" });
      if (reason === "qualification") f.state.qualified = false;
      if (reason === "current-policy") f.state.policyAllowed = false;
      if (reason === "incident-acl") f.state.allowRead = false;
      if (reason === "current-user-role") await revokeSiteMembership(siteId, f.actor.actor.user.id);
      if (reason === "disabled")
        await f.controls.disable({ siteId, reason: "Actual persisted test disable" });
      await expect(execute(f)).rejects.toThrow();
      expect(await automaticActions(f)).toEqual([]);
      expect(await f.db.select().from(npAgentActorRestrictions)).toEqual([]);
      expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
    });
    it("rejects unsigned factory/legacy claims and unavailable historical source keys", async () => {
      const f = await guardianAutomaticLimitFixture();
      const unsigned = createAgentGuardianObservationServiceV1(f.sourceOptions);
      expect(() => f.authority(unsigned)).toThrow();
      const rotated = createAgentGuardianObservationServiceV1({
        ...f.sourceOptions,
        receiptKey: { id: "new-key-no-old-key", bytes: new Uint8Array(32).fill(108) },
        resolveReceiptKey: () => null,
      });
      const rotatedResponse = f.response(true, f.authority(rotated));
      await expect(
        rotatedResponse.automatic.limit({ ...f.command, authentication: f.p.authentication }),
      ).rejects.toThrow();
      expect(await automaticActions(f)).toEqual([]);
      expect(await f.db.select().from(npAgentActorRestrictions)).toEqual([]);
    });
    it("keeps original expiry and compensates through frozen history after disable, source-key loss and qualification withdrawal", async () => {
      const f = await guardianAutomaticLimitFixture();
      const result = await execute(f),
        row = await restriction(f),
        checks = f.state.qualificationChecks;
      f.state.qualified = false;
      f.state.policyAllowed = false;
      await f.controls.disable({ siteId, reason: "Withdraw all future effects" });
      // No live authority/source is installed in this replacement owner; retained adapter/history suffice.
      const cleanup = f.response(false);
      expect(cleanup.automatic.installed).toBe(false);
      f.state.clock = new Date(row.expiresAt);
      expect(await f.check()).toMatchObject({ decision: "allow" });
      expect(await cleanup.reconcile({ siteId })).toEqual({ checked: 1, resolved: 1 });
      expect(await restriction(f)).toMatchObject({ state: "expired", expiresAt: row.expiresAt });
      expect((await automaticActions(f))[0]).toMatchObject({
        id: result.resourceId,
        state: "compensated",
        compensatorId: "guardian.limit.remove.v1",
      });
      expect(f.state.qualificationChecks).toBe(checks);
      expect(await cleanup.reconcile({ siteId })).toEqual({ checked: 0, resolved: 0 });
    });
    it("does not invent success after lost install receipt and later verifies only the actual persisted effect", async () => {
      let calls = 0,
        lose = true;
      const f = await guardianAutomaticLimitFixture({
        wrapAdapter: (adapter) => ({
          ...adapter,
          install: async (d, c) => {
            calls++;
            const result = await adapter.install(d, c);
            if (lose) throw new Error("Actual install committed, receipt lost");
            return result;
          },
        }),
      });
      const result = await execute(f),
        row = await restriction(f);
      expect(row).toMatchObject({
        state: "pending",
        lastErrorCode: "GUARDIAN_ENFORCEMENT_UNAVAILABLE",
      });
      expect((await automaticActions(f))[0]).toMatchObject({
        state: "executing",
        verificationState: "unknown",
      });
      expect(await f.check()).toMatchObject({ decision: "deny" });
      lose = false;
      f.state.qualified = false;
      expect(await execute(f)).toEqual({ ...result, replayed: true });
      expect(calls).toBe(1); // Historical replay verifies, never re-dispatches.
      expect(await restriction(f)).toMatchObject({ state: "active", expiresAt: row.expiresAt });
      expect((await automaticActions(f))[0]).toMatchObject({
        state: "succeeded",
        verificationState: "passed",
      });
    });
    it("bounds duplicate and fresh replay without a second restriction or renewed timer", async () => {
      const f = await guardianAutomaticLimitFixture({ actionsPerHour: 1, activeRestrictions: 1 });
      const result = await execute(f),
        row = await restriction(f);
      f.state.clock = new Date(f.now().getTime() + 1000);
      expect(await execute(f)).toEqual({ ...result, replayed: true });
      await expect(
        f.service.automatic.limit({
          ...f.command,
          idempotencyKey: randomUUID(),
          authentication: f.p.authentication,
        }),
      ).rejects.toThrow();
      expect(await automaticActions(f)).toHaveLength(1);
      expect(await f.db.select().from(npAgentActorRestrictions)).toHaveLength(1);
      expect((await restriction(f)).descriptor).toEqual(row.descriptor);
    });
    it("enforces the site active cap across distinct actual Incidents and subjects with hourly budget available", async () => {
      const f = await guardianAutomaticLimitFixture({ actionsPerHour: 5, activeRestrictions: 1 });
      await execute(f);
      const next = await f.additionalCohort("192.0.2.145"),
        firstIncident = await f.incident(),
        checks = f.state.qualificationChecks;
      expect(next.incident.id).not.toBe(firstIncident.id);
      expect(next.incident.primarySubject).not.toEqual(firstIncident.primarySubject);
      expect(
        await f.source.verifySignal({ db: f.db, siteId, signalId: next.command.signalId }),
      ).toBe(true);
      expect(await automaticActions(f)).toHaveLength(1);
      expect(f.deployment.limits.actionsPerHour).toBeGreaterThan(1);
      expect(await restriction(f)).toMatchObject({ state: "active" });
      await expect(
        f.service.automatic.limit({ ...next.command, authentication: f.p.authentication }),
      ).rejects.toMatchObject({
        code: "GUARDIAN_RESPONSE_UNAVAILABLE",
      });
      expect(f.state.qualificationChecks).toBeGreaterThan(checks);
      expect(await automaticActions(f)).toHaveLength(1);
      expect(await f.db.select().from(npAgentActorRestrictions)).toHaveLength(1);
      expect(await f.db.select().from(npAgentRestrictionEnforcements)).toHaveLength(1);
    });
    it.each(["qualification", "policy"] as const)(
      "rolls back staged automatic work when final %s stalls and closes saved queries and savepoints",
      async (phase) => {
        const f = await guardianAutomaticLimitFixture(),
          late: (() => Promise<unknown>)[] = [];
        let calls = 0,
          stagedAtStall = 0;
        const stall = async (
          db: Parameters<Fixture["authorized"]["assertCurrent"]>[0]["db"],
        ): Promise<never> => {
          stagedAtStall = (
            await db
              .select()
              .from(npAgentActions)
              .where(
                eq(npAgentActions.effectProfileId, NP_AGENT_GUARDIAN_AUTOMATIC_RESPONSE_PROFILE_V1),
              )
          ).length;
          const value = {
            siteId,
            actorKind: "system" as const,
            action: `test.guardian_automatic.late_${phase}`,
            targetType: "guardian-test",
            targetId: null,
            payload: {},
            createdAt: f.now(),
          };
          const insert = db.insert(npAuditEvents).values(value),
            prepared = db.insert(npAuditEvents).values(value).prepare(`late_auto_${phase}`);
          late.push(
            () => insert.execute(),
            () => prepared.execute(),
            () => db.transaction((nested) => nested.insert(npAuditEvents).values(value)),
            () => db.execute(sql`select 1`),
          );
          return new Promise<never>(() => {});
        };
        const authority = f.authority(
          f.source,
          phase === "qualification"
            ? { verifyDeployment: async ({ db }) => (++calls >= 3 ? stall(db) : true) }
            : { resolvePolicy: async ({ db }) => (++calls >= 3 ? stall(db) : f.policy) },
        );
        const service = f.response(true, authority),
          started = performance.now();
        await expect(
          service.automatic.limit({ ...f.command, authentication: f.p.authentication }),
        ).rejects.toThrow();
        // Work is bounded at1000ms; one already-running <=500ms SQL statement may drain.
        expect(performance.now() - started).toBeLessThan(3000);
        expect(stagedAtStall).toBe(1);
        expect(late).toHaveLength(4);
        expect(await automaticActions(f)).toEqual([]);
        expect(
          await f.db
            .select()
            .from(npAgentInvocations)
            .where(eq(npAgentInvocations.operationId, "security.limitActor")),
        ).toEqual([]);
        expect(await f.db.select().from(npAgentActorRestrictions)).toEqual([]);
        expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
        expect(
          await f.db
            .select()
            .from(npAuditEvents)
            .where(eq(npAuditEvents.action, "agents.guardian_response.automatic_limit")),
        ).toEqual([]);
        for (const query of late) await expect(Promise.resolve().then(query)).rejects.toThrow();
        expect(
          await f.db
            .select()
            .from(npAuditEvents)
            .where(eq(npAuditEvents.action, `test.guardian_automatic.late_${phase}`)),
        ).toEqual([]);
        expect(await f.controls.status({ siteId })).toMatchObject({ outcome: "status" });
      },
    );
    it("bounds the actual post-mutate gateway exposure callback and rolls back before releasing the caller", async () => {
      const f = await guardianAutomaticLimitFixture();
      let reads = 0,
        release: (() => void) | undefined;
      const admission = await f.gatewayAdmission(() => {
        if (++reads !== 2) return f.p.gatewaySettings;
        return new Promise<typeof f.p.gatewaySettings>((resolve) => {
          release = () => resolve(f.p.gatewaySettings);
        });
      });
      const service = f.response(true, f.authorized, admission),
        started = performance.now();
      await expect(
        service.automatic.limit({ ...f.command, authentication: f.p.authentication }),
      ).rejects.toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
        status: 503,
      });
      expect(performance.now() - started).toBeLessThan(3000);
      expect(reads).toBe(2);
      expect(f.state.qualificationChecks).toBeGreaterThanOrEqual(4);
      expect(await automaticActions(f)).toEqual([]);
      expect(await f.db.select().from(npAgentActorRestrictions)).toEqual([]);
      expect(
        await f.db
          .select()
          .from(npAgentInvocations)
          .where(eq(npAgentInvocations.operationId, "security.limitActor")),
      ).toEqual([]);
      expect(
        await f.db
          .select()
          .from(npAuditEvents)
          .where(eq(npAuditEvents.action, "agents.guardian_response.automatic_limit")),
      ).toEqual([]);
      if (!release) throw new Error("Expected an actual stalled post-mutate exposure callback");
      release();
      expect(await f.controls.status({ siteId })).toMatchObject({ outcome: "status" });
      expect(await automaticActions(f)).toEqual([]);
    });
    it("bounds installation transport prework and ignores its late audience without dispatching an effect", async () => {
      const f = await guardianAutomaticLimitFixture();
      let release: (() => void) | undefined;
      const service = f.response(
        true,
        f.authorized,
        f.p.admission,
        (...args) =>
          new Promise<string>((resolve) => {
            release = () => {
              void f.p.gateway.getTransportAudience(...args).then(resolve);
            };
          }),
      );
      const started = performance.now();
      const result = await service.automatic.limit({
        ...f.command,
        authentication: f.p.authentication,
      });
      expect(performance.now() - started).toBeLessThan(3000);
      expect(await restriction(f)).toMatchObject({
        state: "pending",
        lastErrorCode: "GUARDIAN_ENFORCEMENT_UNAVAILABLE",
      });
      expect((await automaticActions(f))[0]).toMatchObject({
        id: result.resourceId,
        state: "executing",
        verificationState: "unknown",
      });
      expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
      if (!release) throw new Error("Expected actual installation transport lookup");
      release();
      expect(await f.controls.status({ siteId })).toMatchObject({ outcome: "status" });
      expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
    });
    it("rechecks trusted current qualification after committed staging before any adapter installation", async () => {
      const owner: { current?: Fixture } = {};
      const f = await guardianAutomaticLimitFixture({
        wrapAdapter: (adapter) => ({
          ...adapter,
          healthCheck: async () => {
            const health = await adapter.healthCheck();
            const current = owner.current;
            if (current && (await current.db.select().from(npAgentActorRestrictions)).length)
              current.state.qualified = false;
            return health;
          },
        }),
      });
      owner.current = f;
      await execute(f);
      const row = await restriction(f);
      expect(row).toMatchObject({
        state: "pending",
        lastErrorCode: "GUARDIAN_ENFORCEMENT_UNAVAILABLE",
      });
      expect(await f.db.select().from(npAgentRestrictionEnforcements)).toEqual([]);
      expect((await automaticActions(f))[0]).toMatchObject({
        state: "executing",
        verificationState: "unknown",
      });
      f.state.clock = new Date(row.expiresAt);
      expect(await f.response(false).reconcile({ siteId })).toEqual({ checked: 1, resolved: 1 });
      expect((await automaticActions(f))[0]).toMatchObject({
        state: "failed",
        errorCode: "GUARDIAN_ACTIVATION_UNVERIFIED",
      });
    });
    it("enforces the hourly cap after expiry when the active restriction no longer masks it", async () => {
      const f = await guardianAutomaticLimitFixture({ actionsPerHour: 1, activeRestrictions: 5 });
      await execute(f);
      f.state.clock = new Date((await restriction(f)).expiresAt);
      await f.service.reconcile({ siteId });
      const current = await f.incident();
      await expect(
        f.service.automatic.limit({
          ...f.command,
          expectedVersion: current.versionNumber,
          idempotencyKey: randomUUID(),
          authentication: f.p.authentication,
        }),
      ).rejects.toMatchObject({ code: "GUARDIAN_RESPONSE_UNAVAILABLE" });
      expect(await automaticActions(f)).toHaveLength(1);
      expect(await f.db.select().from(npAgentActorRestrictions)).toHaveLength(1);
    });
    it("serializes duplicate admissions to one actual effect and then permits exact historical replay", async () => {
      const f = await guardianAutomaticLimitFixture();
      const results = await Promise.allSettled([execute(f), execute(f)]);
      expect(results.some((result) => result.status === "fulfilled")).toBe(true);
      const actions = await automaticActions(f);
      expect(actions).toHaveLength(1);
      expect(await f.db.select().from(npAgentActorRestrictions)).toHaveLength(1);
      expect(await f.db.select().from(npAgentRestrictionEnforcements)).toHaveLength(1);
      expect(await execute(f)).toEqual({ resourceId: actions[0].id, replayed: true });
    });
    it("rejects tampered frozen invocation evidence for cleanup while hard TTL still restores access", async () => {
      const f = await guardianAutomaticLimitFixture();
      await execute(f);
      const [action] = await automaticActions(f),
        row = await restriction(f);
      await f.db
        .update(npAgentInvocations)
        .set({
          requestBody: sql`jsonb_set(${npAgentInvocations.requestBody},'{input,authorization,sourceFactsDigest}',to_jsonb(${`cj1:sha256:${"B".repeat(43)}`}::text))`,
        })
        .where(eq(npAgentInvocations.id, action.invocationId!));
      f.state.clock = new Date(row.expiresAt);
      expect(await f.check()).toMatchObject({ decision: "allow" });
      await expect(f.response(false).reconcile({ siteId })).rejects.toThrow();
      expect(await restriction(f)).toMatchObject({
        state: "active",
      });
      expect((await automaticActions(f))[0]).toMatchObject({
        state: "succeeded",
        compensationResultDigest: null,
      });
    });
    it("retains the terminal automatic Action, Invocation, staff history and signed source graph after compensation and Incident closure", async () => {
      const f = await guardianAutomaticLimitFixture();
      await execute(f);
      f.state.clock = new Date((await restriction(f)).expiresAt);
      expect(await f.response(false).reconcile({ siteId })).toEqual({ checked: 1, resolved: 1 });
      expect(await restriction(f)).toMatchObject({ state: "expired" });
      const [action] = await automaticActions(f);
      expect(action).toMatchObject({
        state: "compensated",
        compensatorId: "guardian.limit.remove.v1",
      });
      if (!action.invocationId || !action.auditEventId)
        throw new Error("Missing actual automatic references");
      const current = await f.incident(),
        workflow = await f.workflow.get(f.staffInput);
      await f.workflow.transition({
        ...f.staffInput,
        command: {
          schemaVersion: "np.agent-incident-transition-input.v1",
          expectedVersion: current.versionNumber,
          transition: "resolved",
          resolutionCode: "NO_FURTHER_ACTION",
          note: "Staff closed the Incident after actual expiry compensation.",
          containmentReviewHash: workflow.containment.reviewHash,
          containmentDisposition: "acknowledge",
          idempotencyKey: randomUUID(),
        },
      });
      expect((await f.incident()).status).toBe("resolved");
      const [invocation] = await f.db
          .select()
          .from(npAgentInvocations)
          .where(eq(npAgentInvocations.id, action.invocationId)),
        sources = await f.db.select().from(npAgentEvents).where(eq(npAgentEvents.siteId, siteId)),
        history = await f.db
          .select()
          .from(npAgentIncidentTimeline)
          .where(eq(npAgentIncidentTimeline.incidentId, f.command.incidentId)),
        retained = npRequireAgentGuardianAutomaticResponseActionV1(invocation.requestBody.input);
      expect(invocation.auditEventId).toBe(action.auditEventId);
      expect(retained.authorization.sourceEventIds).toEqual(sources.map((row) => row.id).sort());
      const escalation = history.find(
        (entry) => entry.id === retained.authorization.staffEscalation.timelineEntryId,
      );
      expect(escalation).toMatchObject({ sourceKind: "staff", kind: "human_note" });
      if (!escalation?.auditEventId) throw new Error("Missing actual staff escalation audit");
      const sourceAudits = await f.db
        .select()
        .from(npAuditEvents)
        .where(
          and(
            eq(npAuditEvents.siteId, siteId),
            eq(npAuditEvents.action, "agent.guardian_request.source"),
            inArray(
              npAuditEvents.targetId,
              sources.map((row) => row.id),
            ),
          ),
        );
      expect(sourceAudits).toHaveLength(5);
      const auditIds = [
          action.auditEventId,
          escalation.auditEventId,
          ...sourceAudits.map((audit) => audit.id),
        ],
        audits = await f.db.select().from(npAuditEvents).where(inArray(npAuditEvents.id, auditIds));
      expect(audits).toHaveLength(auditIds.length);
      expect(audits.find((audit) => audit.id === action.auditEventId)?.payload).toMatchObject({
        invocationId: action.invocationId,
        actionId: action.id,
      });
      const owner = createAgentGuardianRetentionServiceV1({
        policy: { version: 1, eventDays: 1, receiptDays: 1, signalDays: 1, historyDays: 1 },
        authorize: async () => {},
        proofOwners: [
          {
            family: "requests",
            verifyEvent: f.source.verifyEvent,
            verifySignal: f.source.verifySignal,
          },
        ],
        now: () => new Date(f.now().getTime() + 100 * 86400000),
      });
      let cursor: string | null | undefined;
      let pinned = 0,
        pruned = 0;
      for (let batch = 0; batch < 20; batch++) {
        const result = await owner.prune({ siteId, cursor, limit: 25 });
        pinned += result.skipped
          .filter((skip) => ["REFERENCE_PINNED", "COHORT_PINNED"].includes(skip.reason))
          .reduce((sum, skip) => sum + skip.count, 0);
        pruned += result.eventsPruned;
        cursor = result.nextCursor;
        if (!cursor) break;
        if (batch === 19) throw new Error("Retention pagination did not finish");
      }
      expect(pruned).toBe(0);
      expect(pinned).toBeGreaterThan(0);
      expect(
        await f.db.select().from(npAgentEvents).where(eq(npAgentEvents.siteId, siteId)),
      ).toHaveLength(5);
      expect(await f.source.verifySignal({ db: f.db, siteId, signalId: f.command.signalId })).toBe(
        true,
      );
      expect(await automaticActions(f)).toHaveLength(1);
      expect((await automaticActions(f))[0]).toEqual(action);
      expect(
        await f.db
          .select()
          .from(npAgentInvocations)
          .where(eq(npAgentInvocations.id, invocation.id)),
      ).toEqual([invocation]);
      expect(
        await f.db
          .select()
          .from(npAgentIncidentTimeline)
          .where(eq(npAgentIncidentTimeline.incidentId, f.command.incidentId)),
      ).toEqual(history);
      expect(
        await f.db.select().from(npAuditEvents).where(inArray(npAuditEvents.id, auditIds)),
      ).toEqual(audits);
      expect(
        await f.db
          .select()
          .from(npAgentIncidents)
          .where(eq(npAgentIncidents.id, f.command.incidentId)),
      ).toHaveLength(1);
    });
  },
  60000,
);
