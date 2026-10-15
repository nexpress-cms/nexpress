import { npIsAgentModeratorAssessmentRecipeV1 } from "../agent-contract/moderator-assessment-recipe-contract.js";
import type { NpAgentIncidentReadContextV1 } from "./incident-service.js";
import type { NpAgentRuntimeRunContextV1 } from "./runtime-admission.js";
import { NpAgentGatewayError } from "./admin-admission.js";
const unavailable = (): never => {
  throw new NpAgentGatewayError(
    "MODERATOR_ASSESSMENT_UNAVAILABLE",
    409,
    "Moderator assessment evidence is unavailable.",
  );
};

export function npAssertAgentModeratorAssessmentContextV1(
  context: NpAgentRuntimeRunContextV1,
): void {
  const { principal, definition } = context.evidence;
  const recipe = context.evidence.registry.recipes.find(
    (entry) => entry.id === context.run.recipeId && entry.version === context.run.recipeVersion,
  );
  if (
    !npIsAgentModeratorAssessmentRecipeV1(recipe) ||
    context.run.siteId !== context.siteId ||
    principal.siteId !== context.siteId ||
    context.run.instructionTemplateId !== "moderator.semantic-assessment" ||
    context.run.instructionTemplateVersion !== 1 ||
    context.run.instructionDigest !== recipe?.instruction?.digest ||
    principal.authorityKind !== "user" ||
    !context.staffUser ||
    context.staffUser.id !== principal.authorityUserId ||
    !["incident:read", "content:read", "site:read"].every((scope) =>
      definition.scopes.includes(scope as "incident:read" | "content:read" | "site:read"),
    ) ||
    context.policy.effective.providerDataMaximum !== "sensitive-approved" ||
    context.run.providerDataClassCeiling !== "sensitive-approved"
  )
    unavailable();
}
export function npAgentModeratorAssessmentIncidentContextV1(
  context: NpAgentRuntimeRunContextV1,
): NpAgentIncidentReadContextV1 {
  npAssertAgentModeratorAssessmentContextV1(context);
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
