import { and, eq } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npAgentActions } from "../db/schema/agent.js";
import type { NpAgentApprovalTargetV1, NpAgentCapabilityId } from "../agent-contract/types.js";
import type { NpAgentApprovalServiceOptionsV1 } from "./approval-service.js";
import { NpAgentGatewayError } from "./admin-admission.js";

type Targets = NpAgentApprovalServiceOptionsV1["targets"];

/** Explicit routing only. Every selected owner still verifies current viewer and target authority. */
export function createAgentApprovalActionTargetRouterV1(options: {
  owners: readonly {
    capabilityIds: readonly NpAgentCapabilityId[];
    resolve: () => Targets | null;
  }[];
}): Targets {
  const owners = new Map<NpAgentCapabilityId, () => Targets | null>();
  for (const owner of options.owners) {
    for (const id of owner.capabilityIds) {
      if (owners.has(id)) throw new Error("Duplicate approval action owner.");
      owners.set(id, owner.resolve);
    }
  }
  const unavailable = () =>
    new NpAgentGatewayError("APPROVAL_NOT_FOUND", 404, "Approval is unavailable.");
  async function select(siteId: string, target: NpAgentApprovalTargetV1): Promise<Targets> {
    if (target.kind !== "action") throw unavailable();
    const [row] = await getDb()
      .select({ capabilityId: npAgentActions.capabilityId })
      .from(npAgentActions)
      .where(and(eq(npAgentActions.siteId, siteId), eq(npAgentActions.id, target.actionId)))
      .limit(1);
    const owner = row && owners.get(row.capabilityId as NpAgentCapabilityId)?.();
    if (!owner) throw unavailable();
    return owner;
  }
  return {
    visible: async (input) => (await select(input.siteId, input.target)).visible(input),
    actionReview: async (input) => {
      const owner = await select(input.siteId, input.target);
      if (!owner.actionReview) throw unavailable();
      return owner.actionReview(input);
    },
    withAuthority: async (input) => (await select(input.siteId, input.target)).withAuthority(input),
    review: async (input) => (await select(input.siteId, input.target)).review(input),
    revalidate: async (input) =>
      (await select(input.siteId, input.statement.target)).revalidate(input),
    expire: async (input) => (await select(input.siteId, input.target)).expire(input),
  };
}
