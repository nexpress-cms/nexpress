import { npIsAgentGuardianAssessmentRecipeV1 } from "../agent-contract/guardian-assessment-recipe-contract.js";
import { and, eq } from "drizzle-orm";
import { npAgentProviderCalls } from "../db/schema/agent.js";
import type { NpAgentIncidentReadContextV1 } from "./incident-service.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";
import { NpAgentGatewayError } from "./admin-admission.js";

/** New Runs lack a canonical source-parent link. Retried provider attempts retain their own Run. */
export async function npRequireAgentGuardianAssessmentRetryV1(
  context: Pick<NpAgentRuntimeRunContextV1, "db" | "run" | "evidence">,
): Promise<void> {
  if (
    !npIsAgentGuardianAssessmentRecipeV1(
      context.evidence.registry.recipes.find(
        (recipe) =>
          recipe.id === context.run.recipeId && recipe.version === context.run.recipeVersion,
      ),
    )
  )
    return;
  const calls = await context.db
    .select({ id: npAgentProviderCalls.id })
    .from(npAgentProviderCalls)
    .where(
      and(
        eq(npAgentProviderCalls.siteId, context.run.siteId),
        eq(npAgentProviderCalls.runId, context.run.id),
      ),
    )
    .limit(1);
  if (calls.length)
    throw new NpAgentGatewayError(
      "GUARDIAN_ASSESSMENT_RETRY_UNAVAILABLE",
      409,
      "Guardian assessment cannot be retried as a new Run after provider reservation.",
    );
}

export function npAssertAgentGuardianAssessmentContextV1(
  context: NpAgentRuntimeRunContextV1,
): void {
  const { principal, definition } = context.evidence;
  const recipe = context.evidence.registry.recipes.find(
    (entry) => entry.id === context.run.recipeId && entry.version === context.run.recipeVersion,
  );
  if (
    !npIsAgentGuardianAssessmentRecipeV1(recipe) ||
    context.run.siteId !== context.siteId ||
    principal.siteId !== context.siteId ||
    context.run.instructionTemplateId !== "guardian.incident-assessment" ||
    context.run.instructionTemplateVersion !== 1 ||
    context.run.instructionDigest !== recipe?.instruction?.digest ||
    principal.authorityKind !== "user" ||
    !context.staffUser ||
    context.staffUser.id !== principal.authorityUserId ||
    definition.template !== "guardian" ||
    definition.autonomy !== "observe" ||
    !["incident:read", "site:read"].every((scope) => definition.scopes.some((s) => s === scope)) ||
    definition.scopes.some((scope) => scope !== "incident:read" && scope !== "site:read") ||
    definition.capabilityModes.some(
      (m) => !["incident.get", "incident.list"].includes(m.capabilityId) || m.mode !== "observe",
    ) ||
    context.policy.effective.providerDataMaximum !== "sensitive-approved" ||
    context.run.providerDataClassCeiling !== "sensitive-approved"
  )
    throw new NpAgentGatewayError(
      "GUARDIAN_ASSESSMENT_UNAVAILABLE",
      409,
      "Guardian assessment evidence is unavailable.",
    );
}
export function npAgentGuardianAssessmentIncidentContextV1(
  context: NpAgentRuntimeRunContextV1,
): NpAgentIncidentReadContextV1 {
  npAssertAgentGuardianAssessmentContextV1(context);
  return {
    siteId: context.siteId,
    principal: {
      kind: "runtime",
      siteId: context.siteId,
      principalId: context.evidence.principal.id,
      runId: context.run.id,
      authority: { kind: "user", userId: context.staffUser!.id },
      scopes: context.evidence.definition.scopes,
    },
    requestedAt: context.now.toISOString(),
    staffUser: context.staffUser,
    runtimeResources: context.policy.effective.resources,
    transaction: context.db,
    abortSignal: new AbortController().signal,
  };
}
