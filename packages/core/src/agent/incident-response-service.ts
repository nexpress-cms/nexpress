import { npRequireAgentModerationCapabilityInputV1 } from "../agent-contract/moderation-capability-contract.js";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import {
  npAgentActions,
  npAgentContainments,
  npAgentIncidents,
  npAgentApprovals,
} from "../db/schema/agent.js";
import {
  npInspectCommunityContentContainmentV1,
  type NpCommunityContentTargetV1,
} from "../community/content-containment.js";
import { withDeferredPostCommit, type NpTransaction } from "../collections/pipeline.js";
import { withCurrentSite } from "../sites/context.js";
import {
  createAgentAdminAdmissionV1,
  NpAgentGatewayError,
  npResolveAgentStaffSessionAuthorizationV1,
  type NpAgentAdminAdmissionOptionsV1,
} from "./admin-admission.js";
import type {
  NpAgentIncidentStaffContextV1,
  NpAgentIncidentStaffReadServiceV1,
} from "./incident-service.js";
import type { NpAgentIncidentV1 } from "../agent-contract/incident-contract.js";
import {
  npRequireAgentIncidentResponsePlanInputV1,
  npRequireAgentIncidentResponseExecuteInputV1,
  npRequireAgentIncidentResponseV1,
  type NpAgentIncidentResponsePlanInputV1,
  type NpAgentIncidentResponseExecuteInputV1,
  type NpAgentIncidentResponseV1,
} from "../agent-contract/incident-response-contract.js";
import {
  npRequireAgentQuarantineProposalV1,
  npRequireAgentRestoreProposalV1,
} from "../agent-contract/moderator-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import type { NpAgentModerationServiceV1 } from "./moderation-service.js";
import type { NpAgentApprovalServiceV1 } from "./approval-service.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
type Db = ReturnType<typeof getDb>;
type Staff = Omit<NpAgentIncidentStaffContextV1, "transaction">;
type Input = Staff & { incidentId: string };
export interface NpAgentIncidentResponseServiceOptionsV1 {
  reads: NpAgentIncidentStaffReadServiceV1;
  moderation: NpAgentModerationServiceV1;
  approvals: NpAgentApprovalServiceV1;
  /** Explicit evidence owner. Return only selected current domain targets bound to the supplied canonical Incident's Signals/Events; never infer targets from opaque event identifiers. The facade independently checks current domain ACL and versions. */
  resolveTargets(
    input: Input & { db: Db; incident: NpAgentIncidentV1 },
  ): Promise<NpCommunityContentTargetV1[]>;
  admission?: NpAgentAdminAdmissionOptionsV1;
  now?: () => Date;
}
export interface NpAgentIncidentResponseServiceV1 {
  get(input: Input): Promise<NpAgentIncidentResponseV1>;
  responsePlan(
    input: Input & { command: NpAgentIncidentResponsePlanInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  responseExecute(
    input: Input & { command: NpAgentIncidentResponseExecuteInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
  restore(
    input: Input & { command: NpAgentIncidentResponseExecuteInputV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
}
const fail = (): never => {
  throw new NpAgentGatewayError(
    "INCIDENT_RESPONSE_UNAVAILABLE",
    409,
    "Incident response evidence is unavailable. Refresh and prepare a new plan.",
  );
};
const same = (a: unknown, b: unknown) =>
  serializeAgentCanonicalJson(a) === serializeAgentCanonicalJson(b);
export function createAgentIncidentResponseServiceV1(
  options: NpAgentIncidentResponseServiceOptionsV1,
): NpAgentIncidentResponseServiceV1 {
  const now = options.now ?? (() => new Date());
  const admission = createAgentAdminAdmissionV1({ ...options.admission, now });
  async function authorize(db: Db, input: Input) {
    if (!options.moderation.staff.enabled) fail();
    const auth = await npResolveAgentStaffSessionAuthorizationV1(
      db,
      input.siteId,
      input.actor,
      now(),
    );
    if (
      !auth.authority.capabilities.includes("admin.manage") ||
      !auth.authority.capabilities.includes("community.moderate")
    )
      fail();
    return (
      await options.reads.get({ incidentId: input.incidentId }, { ...input, transaction: db })
    ).incident;
  }
  async function choices(db: Db, input: Input, incident: NpAgentIncidentV1) {
    const result: NpAgentIncidentResponseV1["choices"] = [];
    const viewer = await options.moderation.staff.viewer({ ...input, db });
    if (!["resolved", "dismissed"].includes(incident.status)) {
      const targets = await options.resolveTargets({
        ...input,
        db,
        incident: structuredClone(incident),
      });
      if (!Array.isArray(targets) || targets.length > 100) fail();
      const seen = new Set<string>();
      for (const target of targets) {
        const encoded = serializeAgentCanonicalJson(target);
        if (seen.has(encoded)) continue;
        seen.add(encoded);
        const inspected = await npInspectCommunityContentContainmentV1(
          db as unknown as NpTransaction,
          { siteId: input.siteId, target, user: viewer },
        );
        result.push({
          capabilityId: "moderation.quarantine",
          target,
          expectedVersionDigest: inspected.versionDigest,
          containmentId: null,
        });
      }
    }
    const rows = await db
      .select()
      .from(npAgentContainments)
      .where(
        and(
          eq(npAgentContainments.siteId, input.siteId),
          eq(npAgentContainments.incidentId, input.incidentId),
          eq(npAgentContainments.state, "active"),
        ),
      )
      .limit(101);
    if (rows.length > 100) fail();
    for (const c of rows) {
      const { facts } = await options.moderation.staff.review({
        ...input,
        db,
        actionId: c.sourceActionId,
      });
      const inspected = await npInspectCommunityContentContainmentV1(
        db as unknown as NpTransaction,
        { siteId: input.siteId, target: facts.target, user: viewer },
      );
      if (inspected.versionDigest === c.targetVersionDigest)
        result.push({
          capabilityId: "moderation.restore",
          target: facts.target,
          expectedVersionDigest: c.targetVersionDigest,
          containmentId: c.id,
        });
    }
    const available = result.filter(
      (choice) =>
        choice.capabilityId !== "moderation.quarantine" ||
        !rows.some((containment) => same(containment.targetRef, choice.target)),
    );
    if (available.length > 100) fail();
    return available;
  }
  async function get(input: Input): Promise<NpAgentIncidentResponseV1> {
    const db = getDb(),
      incident = await authorize(db, input);
    const available = await choices(db, input, incident);
    const containments = await db
      .select({ id: npAgentContainments.id })
      .from(npAgentContainments)
      .where(
        and(
          eq(npAgentContainments.siteId, input.siteId),
          eq(npAgentContainments.incidentId, input.incidentId),
        ),
      )
      .limit(101);
    if (containments.length > 100) fail();
    const rows = await db
      .select()
      .from(npAgentActions)
      .where(
        and(
          eq(npAgentActions.siteId, input.siteId),
          inArray(npAgentActions.capabilityId, ["moderation.quarantine", "moderation.restore"]),
          or(
            sql`${npAgentActions.inputCanonical}->>'incidentId'=${input.incidentId}`,
            containments.length
              ? inArray(
                  npAgentActions.containmentId,
                  containments.map((c) => c.id),
                )
              : undefined,
          ),
        ),
      )
      .orderBy(desc(npAgentActions.createdAt), desc(npAgentActions.id))
      .limit(51);
    const plans: NpAgentIncidentResponseV1["plans"] = [];
    for (const candidate of rows.slice(0, 50)) {
      try {
        const { row, facts } = await options.moderation.staff.review({
          ...input,
          db,
          actionId: candidate.id,
        });
        if (!row.approvalId) continue;
        await options.approvals.get({ ...input, id: row.approvalId });
        const [approval] = await db
          .select()
          .from(npAgentApprovals)
          .where(
            and(eq(npAgentApprovals.siteId, input.siteId), eq(npAgentApprovals.id, row.approvalId)),
          );
        if (!approval) continue;
        const verified = await options.approvals.verify(approval);
        let canExecute = false;
        if (
          row.state === "approved" &&
          approval.state === "approved" &&
          approval.expiresAt > now()
        ) {
          try {
            canExecute = await options.moderation.staff.canExecute({
              ...input,
              db,
              actionId: row.id,
            });
          } catch {
            /* Current owner must prove executability. */
          }
        }
        const current = await options.moderation.staff.review({ ...input, db, actionId: row.id });
        if (
          row.state !== current.row.state ||
          row.inputHash !== current.row.inputHash ||
          row.approvalId !== current.row.approvalId ||
          row.outputHash !== current.row.outputHash ||
          row.executionInvocationId !== current.row.executionInvocationId
        )
          continue;
        plans.push({
          capabilityId: facts.capabilityId,
          target: facts.target,
          expectedVersionDigest: facts.expectedVersionDigest,
          containmentId: facts.containmentId,
          actionId: row.id,
          proposalHash: row.inputHash,
          state: row.state as NpAgentIncidentResponseV1["plans"][number]["state"],
          approvalId: row.approvalId,
          approvalResource: `/admin/agents/approvals/${row.approvalId}`,
          expiresAt: approval.expiresAt.toISOString(),
          policyHashes: verified.statement.policyHashes,
          reversibility: row.capabilityId === "moderation.quarantine" ? "compensatable" : "none",
          canExecute,
        });
      } catch {
        /* Inaccessible retained actions never grant a link or authority. */
      }
    }
    if (!same(incident, await authorize(db, input))) fail();
    return npRequireAgentIncidentResponseV1({
      choices: available,
      plans,
      truncated: rows.length > 50,
    });
  }
  async function mutate(
    input: Input & {
      command: NpAgentIncidentResponsePlanInputV1 | NpAgentIncidentResponseExecuteInputV1;
    },
    operationId:
      | "agents.incidents.response_plan"
      | "agents.incidents.response_execute"
      | "agents.incidents.restore",
  ) {
    npAssertAgentPreviewEffectsAllowed();
    return withCurrentSite(input.siteId, () =>
      withDeferredPostCommit(() =>
        getDb().transaction(
          async (tx) =>
            npWithAgentRuntimeControlTransactionV1(
              input.siteId,
              async ({ db }) => {
                const incident = await authorize(db, input);
                const result = await admission({
                  db,
                  siteId: input.siteId,
                  actor: input.actor,
                  operationId,
                  targetId: input.incidentId,
                  command: input.command,
                  mutate: async ({ db, command, invocationId }) => {
                    const [current] = await db
                      .select()
                      .from(npAgentIncidents)
                      .where(
                        and(
                          eq(npAgentIncidents.siteId, input.siteId),
                          eq(npAgentIncidents.id, input.incidentId),
                        ),
                      )
                      .for("update");
                    if (!current || current.versionNumber !== command.expectedVersion) fail();
                    let capabilityId: "moderation.quarantine" | "moderation.restore";
                    let parsed;
                    if ("proposal" in command) {
                      capabilityId = command.capabilityId;
                      const available = await choices(db, input, incident);
                      if (capabilityId === "moderation.quarantine") {
                        const p = npRequireAgentQuarantineProposalV1(command.proposal);
                        if (
                          p.incidentId !== input.incidentId ||
                          !available.some(
                            (c) =>
                              c.capabilityId === capabilityId &&
                              same(c.target, p.target) &&
                              c.expectedVersionDigest === p.expectedVersionDigest,
                          )
                        )
                          fail();
                      } else {
                        const p = npRequireAgentRestoreProposalV1(command.proposal);
                        if (
                          !available.some(
                            (c) =>
                              c.capabilityId === capabilityId &&
                              c.containmentId === p.containmentId &&
                              c.expectedVersionDigest === p.expectedVersionDigest,
                          )
                        )
                          fail();
                      }
                      parsed = { mode: "propose" as const, proposal: command.proposal };
                    } else {
                      capabilityId =
                        operationId === "agents.incidents.restore"
                          ? "moderation.restore"
                          : "moderation.quarantine";
                      const { facts } = await options.moderation.staff.review({
                        ...input,
                        db,
                        actionId: command.actionId,
                      });
                      if (
                        facts.incidentId !== input.incidentId ||
                        facts.capabilityId !== capabilityId
                      )
                        fail();
                      parsed = {
                        mode: "execute_approved" as const,
                        actionId: command.actionId,
                        approvalId: command.approvalId,
                        proposalHash: command.proposalHash,
                      };
                    }
                    const action = await options.moderation.staff.invoke({
                      ...input,
                      db,
                      invocationId,
                      capabilityId,
                      parsed: npRequireAgentModerationCapabilityInputV1(capabilityId, parsed),
                      idempotencyKey: command.idempotencyKey,
                    });
                    return { resourceId: action.actionId, output: { actionId: action.actionId } };
                  },
                });
                await options.moderation.staff.authorizeReplay({
                  ...input,
                  db,
                  actionId: result.resourceId,
                });
                return { resourceId: input.incidentId, replayed: result.replayed };
              },
              tx as Db,
            ),
          { isolationLevel: "serializable" },
        ),
      ),
    );
  }
  return {
    get: (input) => withCurrentSite(input.siteId, () => get(input)),
    responsePlan: (input) =>
      mutate(
        { ...input, command: npRequireAgentIncidentResponsePlanInputV1(input.command) },
        "agents.incidents.response_plan",
      ),
    responseExecute: (input) =>
      mutate(
        { ...input, command: npRequireAgentIncidentResponseExecuteInputV1(input.command) },
        "agents.incidents.response_execute",
      ),
    restore: (input) =>
      mutate(
        { ...input, command: npRequireAgentIncidentResponseExecuteInputV1(input.command) },
        "agents.incidents.restore",
      ),
  };
}
