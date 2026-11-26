import {
  setSpamAdapter,
  resetSpamAdapter,
} from "../../../packages/core/src/community/spam-adapter.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentAutomaticQuarantineAuthorityV1,
  createAgentAutomaticQuarantineExpiryProcessorV1,
} from "../../../packages/core/src/agent/automatic-quarantine-service.js";
import { createAgentModerationServiceV1 } from "../../../packages/core/src/agent/moderation-service.js";
import { createAgentIncidentWriteServiceV1 } from "../../../packages/core/src/agent/incident-write-service.js";
import { npExtractAgentModeratorDomainHashesV1 } from "../../../packages/core/src/agent/moderator-detector.js";
import type { NpAgentAutomaticQuarantineDeploymentV1 } from "../../../packages/core/src/agent-contract/automatic-quarantine-contract.js";
import {
  npAgentActions,
  npAgentApprovals,
  npAgentContainments,
  npAgentInvocations,
  npAgentIncidentTimeline,
} from "../../../packages/core/src/db/schema/agent.js";
import { npComments, npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { updateComment } from "../../../packages/core/src/community/comments.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { moderatorRecipeFixture } from "./agent-moderator-recipe-fixture.js";
import { runtimeBudget } from "./agent-runtime-service-fixture.js";
import { npResolveAgentBudgetV1 } from "../../../packages/core/src/agent-contract/runtime-budget.js";
import { principalFixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

async function automaticFixture(
  options: {
    install?: boolean;
    qualified?: boolean;
    trusted?: boolean;
    wrongDomain?: boolean;
    locale?: string;
    cap?: number;
    itemCount?: number;
    pending?: boolean;
  } = {},
) {
  if (options.pending)
    setSpamAdapter({ check: () => ({ kind: "flag", reason: "Fixture requires staff review" }) });
  const f = await moderatorRecipeFixture({ itemCount: options.itemCount });
  const principal = await principalFixture(
    f,
    false,
    { now: f.options.now },
    ["incident:read", "moderation:execute"],
    "approved-execute",
  );
  const candidate = (await f.read()).candidates[0]!;
  const time = f.options.now();
  const deployment: NpAgentAutomaticQuarantineDeploymentV1 = {
    schemaVersion: "np.agent-automatic-quarantine-deployment.v1",
    policyId: "reviewed-spam",
    policyVersion: 1,
    siteId,
    locale: "ko",
    principalIds: [principal.authentication.principal.id],
    collectionSlugs: ["discussions"],
    rule: {
      kind: "reviewed-blocked-domain.v1",
      domainHash: options.wrongDomain
        ? "a".repeat(64)
        : npExtractAgentModeratorDomainHashesV1("https://offer.example")[0]!,
      minimumItems: 5,
      minimumIndependentAccounts: 3,
      maximumEvidenceAgeSeconds: 3600,
    },
    limits: { containmentSeconds: 60, actionsPerHour: options.cap ?? 10, activeContainments: 10 },
    qualification: {
      source: "production-human-review",
      policyVersion: 1,
      locale: "ko",
      reviewArtifactDigest: `cj1:sha256:${"A".repeat(43)}`,
      reviewedPredictedPositives: 1000,
      reviewedTruePositives: 1000,
      reviewedLegitimateHardNegatives: options.qualified === false ? 999 : 1000,
      shadowArtifactDigest: `cj1:sha256:${"B".repeat(43)}`,
      shadowStartedAt: new Date(time.getTime() - 15 * 86400000).toISOString(),
      shadowEndedAt: new Date(time.getTime() - 3600000).toISOString(),
      compensationTestArtifactDigest: `cj1:sha256:${"C".repeat(43)}`,
    },
    issuedAt: new Date(time.getTime() - 1000).toISOString(),
    expiresAt: new Date(time.getTime() + 86400000).toISOString(),
  };
  let trusted = options.trusted !== false;
  let compensationAllowed = true;
  let canRead = true;
  let failAfterMutation = false;
  let checks = 0;
  const authority = createAgentAutomaticQuarantineAuthorityV1({
    deployment,
    verifyDeployment: ({ purpose }) => {
      checks++;
      return Promise.resolve(
        purpose === "compensate"
          ? compensationAllowed
          : trusted && !(failAfterMutation && checks >= 2),
      );
    },
    resolveLocale: () => Promise.resolve(options.locale ?? "ko"),
  });
  const rules = structuredClone(f.rules);
  rules.capabilityModes = [
    { capabilityId: "moderation.quarantine", mode: "guarded" },
    { capabilityId: "moderation.restore", mode: "guarded" },
  ];
  rules.risk.automaticActionMaximum = "reversible";
  rules.risk.requirePreviewAtOrAbove = "destructive";
  rules.risk.requireRecentAuthAtOrAbove = "destructive";
  rules.automation.moderationAutoQuarantineMinBasisPoints = 9950;
  const incidents = createAgentIncidentWriteServiceV1({
    resolveEvidence: () => false,
    now: f.options.now,
  });
  const service = createAgentModerationServiceV1({
    admission: principal.admission,
    resolveApprovals: () => f.approvals,
    resolveTransportAudience: principal.gateway.getTransportAudience,
    resolveBudget: () => Promise.resolve(npResolveAgentBudgetV1(runtimeBudget())),
    resolvePolicy: () =>
      Promise.resolve({
        autonomy: "guarded",
        capabilityModes: rules.capabilityModes,
        layers: [rules],
      }),
    resolveStaffPolicy: () => {
      const staffRules = structuredClone(rules);
      staffRules.capabilityModes = [
        { capabilityId: "moderation.quarantine", mode: "approved" },
        { capabilityId: "moderation.restore", mode: "approved" },
      ];
      return Promise.resolve({
        autonomy: "approved",
        capabilityModes: staffRules.capabilityModes,
        layers: [staffRules],
      });
    },
    canReadIncident: () => Promise.resolve(canRead),
    incidents,
    ...(options.install === false ? {} : { automaticQuarantine: authority }),
    now: f.options.now,
  });
  const request = {
    authentication: principal.authentication,
    idempotencyKey: randomUUID(),
    mode: "quarantine" as const,
    signalId: candidate.signalId,
    proposal: candidate.proposal,
  };
  return {
    ...f,
    principal,
    candidate,
    authority,
    rules,
    automatic: service.automatic,
    service,
    request,
    revoke: () => {
      trusted = false;
    },
    denyRead: () => {
      canRead = false;
    },
    revokeCompensation: () => {
      compensationAllowed = false;
    },
    revokeAfterEffect: () => {
      failAfterMutation = true;
      checks = -1;
    },
  };
}

describe.skipIf(skipIfNoTestDb())("explicit host-installed automatic quarantine", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterEach(() => {
    resetSpamAdapter();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  afterAll(closeTestDb);
  it("uses exact reviewed host rule evidence without a fabricated human approval, replays, then compensates expired pending content", async () => {
    const f = await automaticFixture({ pending: true });
    try {
      const first = await f.automatic.invoke(f.request);
      expect(first.output.state).toBe("succeeded");
      expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
      const [containment] = await f.db.select().from(npAgentContainments);
      const [action] = await f.db
        .select()
        .from(npAgentActions)
        .where(eq(npAgentActions.id, (first.output as { actionId: string }).actionId));
      expect(action.approvalId).toBeNull();
      const reviewed = await withCurrentSite(siteId, () =>
        f.service.staff.review({
          db: f.db,
          siteId,
          actor: f.actor.actor,
          actionId: action.id,
        }),
      );
      expect(reviewed.facts.target).toEqual(f.candidate.proposal.target);
      expect(reviewed.row.approvalId).toBeNull();
      expect(action.inputRedacted.automaticAuthorization).toMatchObject({
        schemaVersion: "np.agent-automatic-quarantine-authorization.v1",
        policyId: "reviewed-spam",
        itemCount: 5,
        independentAccountCount: 3,
      });
      expect(containment.expiresAt).toEqual(new Date(f.options.now().getTime() + 60000));
      expect(
        (
          await f.db
            .select()
            .from(npComments)
            .where(eq(npComments.id, f.candidate.proposal.target.id))
        )[0]!.status,
      ).toBe("hidden");
      expect(await f.automatic.invoke(f.request)).toEqual(first);
      expect(await f.db.select().from(npAgentContainments)).toHaveLength(1);
      expect(f.providerInvoke).not.toHaveBeenCalled();
      const restore = {
        authentication: f.principal.authentication,
        idempotencyKey: randomUUID(),
        mode: "restore_expired" as const,
        containmentId: containment.id,
      };
      await expect(f.automatic.invoke(restore)).rejects.toMatchObject({
        code: "MODERATION_CONFLICT",
      });
      f.advance(61);
      f.revoke(); // Revocation blocks new quarantine but does not silently revoke exact compensation.
      const restored = await f.automatic.invoke(restore);
      expect(restored.output.state).toBe("compensated");
      expect(
        (
          await f.db
            .select()
            .from(npComments)
            .where(eq(npComments.id, f.candidate.proposal.target.id))
        )[0]!.status,
      ).toBe("pending");
      expect((await f.db.select().from(npAgentContainments))[0]!.state).toBe("restored");
      expect(await f.automatic.invoke(restore)).toEqual(restored);
      expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
      expect(
        (await f.db.select().from(npAuditEvents)).some(
          (row) => row.action === "agents.moderation.automatic_compensate",
        ),
      ).toBe(true);
      expect((await f.db.select().from(npAgentIncidentTimeline)).length).toBeGreaterThan(1);
    } finally {
      await f.dispose();
    }
  });
  it.each([
    "absent",
    "unqualified",
    "untrusted",
    "domain",
    "locale",
    "revoked",
    "acl",
    "source",
    "policy",
    "preview",
    "recent-auth",
    "quiet",
    "compensation-policy",
    "compensation-mode",
    "compensation-host",
  ] as const)("blocks %s without content or approval effects", async (reason) => {
    const f = await automaticFixture({
      install: reason !== "absent",
      qualified: reason !== "unqualified",
      trusted: reason !== "untrusted",
      wrongDomain: reason === "domain",
      locale: reason === "locale" ? "en" : "ko",
    });
    try {
      if (reason === "revoked") f.revoke();
      if (reason === "acl") f.denyRead();
      if (reason === "policy") f.rules.capabilityModes[0]!.mode = "approved";
      if (reason === "preview") f.rules.risk.requirePreviewAtOrAbove = "reversible";
      if (reason === "recent-auth") f.rules.risk.requireRecentAuthAtOrAbove = "reversible";
      if (reason === "compensation-policy") f.rules.risk.requireRecentAuthAtOrAbove = "sensitive";
      if (reason === "compensation-mode") f.rules.capabilityModes[1]!.mode = "approved";
      if (reason === "compensation-host") f.revokeCompensation();
      if (reason === "quiet")
        f.rules.automation.quietHoursUtc = [{ startMinute: 0, endMinute: 1440 }];
      if (reason === "source") {
        const other = f.comments.find((row) => row.id !== f.candidate.proposal.target.id)!;
        await withCurrentSite(siteId, () =>
          updateComment({
            commentId: other.id,
            memberId: other.memberId,
            bodyMd: "Current content no longer matches the blocked domain",
          }),
        );
      }
      await expect(f.automatic.invoke(f.request)).rejects.toBeDefined();
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
      expect(await f.db.select().from(npAgentApprovals)).toEqual([]);
      expect((await f.db.select().from(npComments)).every((row) => row.status !== "hidden")).toBe(
        true,
      );
      expect(f.providerInvoke).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("re-evaluates current supporting targets after one quarantine without counting that hidden source", async () => {
    const f = await automaticFixture({ itemCount: 7 });
    try {
      const candidates = (await f.read()).candidates;
      const first = await f.automatic.invoke(f.request);
      const other = candidates.find(
        (candidate) => candidate.proposal.target.id !== f.candidate.proposal.target.id,
      )!;
      const second = await f.automatic.invoke({
        ...f.request,
        idempotencyKey: randomUUID(),
        proposal: other.proposal,
      });
      expect(first.output.state).toBe("succeeded");
      expect(second.output.state).toBe("succeeded");
      const actions = await f.db.select().from(npAgentActions);
      expect(actions).toHaveLength(2);
      const evidence = actions[1]!.inputRedacted.automaticAuthorization;
      expect(evidence).toMatchObject({ itemCount: 6, independentAccountCount: 3 });
      expect(await f.db.select().from(npAgentContainments)).toHaveLength(2);
    } finally {
      await f.dispose();
    }
  });
  it("binds idempotency to the exact target and rejects an altered retry", async () => {
    const f = await automaticFixture();
    try {
      await f.automatic.invoke(f.request);
      await expect(
        f.automatic.invoke({ ...f.request, signalId: randomUUID() }),
      ).rejects.toMatchObject({ code: "MODERATION_CONFLICT" });
      expect(await f.db.select().from(npAgentContainments)).toHaveLength(1);
      expect(
        (await f.db.select().from(npAgentInvocations)).filter(
          (row) => row.operationId === "moderation.quarantine",
        ),
      ).toHaveLength(1);
    } finally {
      await f.dispose();
    }
  });
  it.each(["edited", "host-denied"] as const)(
    "preserves rollback evidence when expired compensation is %s",
    async (reason) => {
      const f = await automaticFixture();
      try {
        await f.automatic.invoke(f.request);
        const [containment] = await f.db.select().from(npAgentContainments);
        f.advance(61);
        if (reason === "edited") {
          const comment = f.comments.find((row) => row.id === f.candidate.proposal.target.id)!;
          await withCurrentSite(siteId, () =>
            updateComment({
              commentId: comment.id,
              memberId: comment.memberId,
              bodyMd: "A newer legitimate author edit must survive compensation",
            }),
          );
        } else f.revokeCompensation();
        await expect(
          f.automatic.invoke({
            authentication: f.principal.authentication,
            idempotencyKey: randomUUID(),
            mode: "restore_expired",
            containmentId: containment.id,
          }),
        ).rejects.toBeDefined();
        expect((await f.db.select().from(npAgentContainments))[0]).toMatchObject({
          id: containment.id,
          state: "active",
          originalState: containment.originalState,
          sourceActionId: containment.sourceActionId,
          restoreActionId: null,
        });
        const actions = await f.db.select().from(npAgentActions);
        expect(actions).toHaveLength(1);
        expect(actions[0]!.verificationState).toBe("passed");
        expect(
          (await f.db.select().from(npAuditEvents)).some(
            (row) => row.action === "agents.moderation.automatic_compensate",
          ),
        ).toBe(false);
      } finally {
        await f.dispose();
      }
    },
  );
  it("processes expired automatic containments in bounded explicitly registered site jobs", async () => {
    const f = await automaticFixture({ itemCount: 7 });
    try {
      const candidates = (await f.read()).candidates;
      await f.automatic.invoke(f.request);
      const other = candidates.find(
        (candidate) => candidate.proposal.target.id !== f.candidate.proposal.target.id,
      )!;
      await f.automatic.invoke({
        ...f.request,
        idempotencyKey: randomUUID(),
        proposal: other.proposal,
      });
      f.advance(61);
      const resolveAuthentication = vi.fn(() => Promise.resolve(f.principal.authentication));
      const processor = createAgentAutomaticQuarantineExpiryProcessorV1({
        moderation: f.service,
        resolveAuthentication,
      });
      expect(processor.resolveSiteId({ siteId, limit: 1 })).toBe(siteId);
      const first = await processor.process({ siteId, limit: 1 });
      expect(first.items).toHaveLength(1);
      expect(first.items[0]!.state).toBe("restored");
      expect(first.nextCursor).not.toBeNull();
      const second = await processor.process({ siteId, limit: 1, cursor: first.nextCursor });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]!.state).toBe("restored");
      expect(second.nextCursor).toBeNull();
      expect((await processor.process({ siteId })).items).toEqual([]);
      await expect(processor.process({ limit: 1 })).rejects.toMatchObject({
        code: "AUTOMATIC_QUARANTINE_BLOCKED",
      });
      await expect(processor.process({ siteId: "other-site" })).rejects.toMatchObject({
        code: "AUTOMATIC_QUARANTINE_BLOCKED",
      });
      expect(
        (await f.db.select().from(npAgentContainments)).every((row) => row.state === "restored"),
      ).toBe(true);
      expect(f.providerInvoke).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("serializes concurrent duplicate attempts and retains only one effect", async () => {
    const f = await automaticFixture();
    try {
      const results = await Promise.allSettled([
        f.automatic.invoke(f.request),
        f.automatic.invoke(f.request),
      ]);
      expect(results.some((result) => result.status === "fulfilled")).toBe(true);
      const replay = await f.automatic.invoke(f.request);
      expect(replay.output.state).toBe("succeeded");
      expect(await f.db.select().from(npAgentContainments)).toHaveLength(1);
      expect(await f.db.select().from(npAgentActions)).toHaveLength(1);
    } finally {
      await f.dispose();
    }
  });
  it("enforces a site action cap even while the remaining current targets still match", async () => {
    const f = await automaticFixture({ itemCount: 7, cap: 1 });
    try {
      const candidates = (await f.read()).candidates;
      await f.automatic.invoke(f.request);
      const other = candidates.find(
        (candidate) => candidate.proposal.target.id !== f.candidate.proposal.target.id,
      )!;
      await expect(
        f.automatic.invoke({
          ...f.request,
          idempotencyKey: randomUUID(),
          proposal: other.proposal,
        }),
      ).rejects.toBeDefined();
      expect(await f.db.select().from(npAgentContainments)).toHaveLength(1);
    } finally {
      await f.dispose();
    }
  });
  it("rolls back quarantine and its evidence if host approval is revoked during execution", async () => {
    const f = await automaticFixture();
    try {
      f.revokeAfterEffect();
      await expect(f.automatic.invoke(f.request)).rejects.toBeDefined();
      expect(await f.db.select().from(npAgentContainments)).toEqual([]);
      expect(await f.db.select().from(npAgentActions)).toEqual([]);
      expect((await f.db.select().from(npComments)).every((row) => row.status !== "hidden")).toBe(
        true,
      );
    } finally {
      await f.dispose();
    }
  });
});
