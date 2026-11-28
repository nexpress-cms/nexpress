import { createHmac } from "node:crypto";
import { npSessions } from "@nexpress/core";
import {
  createAgentApprovalServiceV1,
  createAgentIncidentEvidenceServiceV1,
  createAgentIncidentNotificationsServiceV1,
  createAgentIncidentResponseServiceV1,
  createAgentIncidentServiceV1,
  createAgentIncidentStudioServiceV1,
  createAgentIncidentWriteServiceV1,
  createAgentModerationServiceV1,
  createAgentModeratorCombinedCommentCollectorV1,
  createAgentModeratorCommentObserverV1,
  createAgentModeratorCommentReportObserverV1,
  createAgentRuntimeEventServiceV1,
  createAgentStudioServerRuntimeV1,
  npResolveAgentModeratorCombinedCommentEvidenceV1,
  type NpAgentApprovalServiceV1,
  type NpAgentIncidentEvidenceServiceV1,
} from "@nexpress/core/agents";
import {
  npAgentBudgetDimensionKeysV1,
  npCreateDisabledAgentRuntimeSettingsV1,
  npCreateInheritedAgentBudgetV1,
  npResolveAgentBudgetV1,
} from "@nexpress/core/agent-contract";
import {
  setCommunityCommentReportObserverV1,
  setCommunityModerationObserverV1,
} from "@nexpress/core/bootstrap";
import type { NpDb } from "@nexpress/next";
import { and, desc, eq, gt } from "drizzle-orm";
import { createCommunityPilotModerationSchedule } from "@/lib/community-operations-moderation-schedule";

/** Explicit host composition for a disposable, password-only community pilot. */
export function createCommunityOperationsPilot(getDb: () => NpDb) {
  const origin = new URL(process.env.SITE_URL ?? "");
  const database = new URL(process.env.DATABASE_URL ?? "");
  const secret = process.env.NP_SECRET;
  const staffUserId = process.env.NP_COMMUNITY_PILOT_STAFF_ID;
  if (
    process.env.NP_COMMUNITY_OPERATIONS_PILOT !== "1" ||
    origin.origin !== `http://127.0.0.1:${origin.port}` ||
    origin.href !== `${origin.origin}/` ||
    !origin.port ||
    database.protocol !== "postgres:" ||
    database.hostname !== "127.0.0.1" ||
    !database.port ||
    database.port === "5432" ||
    database.pathname !== "/developer_community" ||
    database.search ||
    !secret ||
    secret.length < 32 ||
    !staffUserId
  ) {
    throw new Error("The community pilot requires its explicit loopback app and database.");
  }

  const siteId = "default";
  const scheduledSite = process.env.NP_COMMUNITY_PILOT_MODERATION_SITE;
  if (scheduledSite && scheduledSite !== siteId) {
    throw new Error("Scheduled pilot moderation requires the explicit default site.");
  }
  const key = (purpose: string) => createHmac("sha256", secret).update(purpose).digest();
  const cursorHmacKey = key("community-pilot:cursor");
  const reauthentication = {
    // The pilot creates staff sessions through password login. Refresh
    // preserves createdAt, so it cannot extend the primary-auth window.
    async verify(input: { siteId: string; sessionId: string; userId: string; now: Date }) {
      if (input.siteId !== siteId) return false as const;
      const [session] = await getDb()
        .select({ createdAt: npSessions.createdAt })
        .from(npSessions)
        .where(
          and(
            eq(npSessions.id, input.sessionId),
            eq(npSessions.userId, input.userId),
            gt(npSessions.accessExpiresAt, input.now),
          ),
        )
        .limit(1);
      if (!session) return false as const;
      const reauthenticatedAt = session.createdAt.toISOString();
      const fact = JSON.stringify([siteId, input.userId, input.sessionId, reauthenticatedAt]);
      return {
        reauthenticatedAt,
        sessionFactFingerprint: `cj1:sha256:${key(fact).toString("base64url")}`,
      };
    },
  };
  const unavailable = async (): Promise<never> => {
    throw new Error("The community pilot installs staff moderation only.");
  };
  const events = createAgentRuntimeEventServiceV1({
    admission: {
      admit: unavailable,
      retry: unavailable,
      withCurrentRun: unavailable,
      withRunAuthority: unavailable,
    },
    deploymentAuthority: {
      policyId: "community-pilot",
      fingerprint: `cj1:sha256:${key("community-pilot:observation").toString("base64url")}`,
      scopes: ["site:read"],
    },
    enqueueRun: unavailable,
  });

  let evidence: NpAgentIncidentEvidenceServiceV1;
  const reads = createAgentIncidentServiceV1({
    cursorHmacKey,
    canReadIncident: () => false,
    canReadStaffIncident: (input) => evidence.canReadStaffIncident(input),
  }).staff;
  evidence = createAgentIncidentEvidenceServiceV1({ reads, cursorHmacKey });
  const notifications = createAgentIncidentNotificationsServiceV1({ reads, cursorHmacKey });
  const writer = createAgentIncidentWriteServiceV1({
    notifications,
    resolveEvidence: ({ db, candidate }) =>
      npResolveAgentModeratorCombinedCommentEvidenceV1({ db, candidate, staffUserId }),
  });

  const rules = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  rules.resources.collections = ["forum-posts"];
  rules.resources.incidentCategories = ["spam"];
  rules.capabilityModes = [
    { capabilityId: "moderation.quarantine", mode: "approved" },
    { capabilityId: "moderation.restore", mode: "approved" },
  ];
  rules.risk.requirePreviewAtOrAbove = null;
  rules.automation.moderationTargetsPerRun = 1;
  const budget = npCreateInheritedAgentBudgetV1();
  for (const dimension of npAgentBudgetDimensionKeysV1) {
    budget[dimension] = /provider|token|cost|cooldown/iu.test(dimension) ? 0 : 100;
  }
  let approvals: NpAgentApprovalServiceV1;
  const moderation = createAgentModerationServiceV1({
    admission: { withCurrentAuthority: unavailable, withStoredAuthority: unavailable },
    resolveApprovals: () => approvals,
    resolvePolicy: unavailable,
    resolveTransportAudience: unavailable,
    resolveBudget: async (input) => {
      if (input.siteId !== siteId) return unavailable();
      return npResolveAgentBudgetV1(budget);
    },
    resolveStaffPolicy: async (input) => {
      if (input.siteId !== siteId) return unavailable();
      return { autonomy: "approved", capabilityModes: rules.capabilityModes, layers: [rules] };
    },
    canReadIncident: async ({ db, siteId: requestedSite, incidentId, user }) => {
      if (requestedSite !== siteId) return false;
      const [session] = await db
        .select({ id: npSessions.id })
        .from(npSessions)
        .where(and(eq(npSessions.userId, user.id), gt(npSessions.accessExpiresAt, new Date())))
        .orderBy(desc(npSessions.createdAt))
        .limit(1);
      if (!session) return false;
      await reads.get(
        { incidentId },
        { siteId, actor: { user, sessionId: session.id }, transaction: db },
      );
      return true;
    },
    incidents: writer,
  });
  approvals = createAgentApprovalServiceV1({
    targets: moderation.approvalTargets,
    cursorKey: cursorHmacKey,
    integrityKeys: {
      active: { owner: "approval-integrity", id: "pilot-integrity", bytes: key("pilot-integrity") },
    },
    challengeKeys: { active: { id: "pilot-challenge", key: key("pilot-challenge") } },
    secretRequestDigestKey: { id: "pilot-request", key: key("pilot-request") },
    reauthentication,
  });

  const response = createAgentIncidentResponseServiceV1({
    reads,
    moderation,
    approvals,
    resolveTargets: evidence.resolveTargets,
    admission: { reauthentication },
  });
  const incidents = createAgentIncidentStudioServiceV1({
    reads,
    evidence,
    notifications,
    response,
    approvals,
    cursorHmacKey,
  });
  const collector = createAgentModeratorCombinedCommentCollectorV1({
    staffUserId,
    incidents: writer,
  });

  setCommunityModerationObserverV1(createAgentModeratorCommentObserverV1({ events }));
  setCommunityCommentReportObserverV1(createAgentModeratorCommentReportObserverV1({ events }));

  const collect = (windowStartedAt: string) =>
    collector.collect({
      siteId,
      windowStartedAt,
      settings: {
        recipeId: "moderator.repeated-link-spam",
        recipeVersion: 1,
        collectionSlugs: ["forum-posts"],
        windowSeconds: 600,
        minIndependentAccounts: 3,
        minItems: 5,
        automaticConfidenceBasisPoints: 9950,
      },
    });

  return {
    studio: createAgentStudioServerRuntimeV1({ incidents, approvals }),
    collect,
    moderationSchedule: scheduledSite
      ? createCommunityPilotModerationSchedule({ siteId, getDb, collect })
      : undefined,
  };
}
