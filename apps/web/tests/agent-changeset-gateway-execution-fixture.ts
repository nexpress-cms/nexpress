import { randomUUID } from "node:crypto";
import {
  npBuildAgentChangeSetCapabilityDefinitionCanonicalV1,
  npRequireAgentInstalledCapabilityInvocationRequestV1,
  npRequireAgentChangeSetExecutionOutputV1,
  type NpAgentChangeSetCapabilityInvocationRequestV1,
} from "../../../packages/core/src/agent-contract/installed-capability-contract.js";
import { executionFixture, decideApproval } from "./agent-changeset-execution-fixture.js";
import { command, siteId } from "./agent-changeset-fixture.js";
export async function gatewayExecutionFixture(
  exposure: "propose" | "approved-execute" = "approved-execute",
  intendedOperation: "apply" | "schedule" = "apply",
  principalControl?: NonNullable<Parameters<typeof executionFixture>[0]>["principalControl"],
  configuration?: Pick<NonNullable<Parameters<typeof executionFixture>[0]>, "draftInput">,
) {
  const f = await executionFixture({
    ...configuration,
    principalExposure: exposure,
    intendedOperation,
    principalControl,
    resolveExecutionBinding: ({ intendedOperation }) =>
      Promise.resolve(
        npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(`changeset.${intendedOperation}`),
      ),
  });
  if (!f.principal) throw new Error("Expected Gateway principal");
  const principal = f.principal;
  return { ...f, principal };
}
export type GatewayExecutionFixture = Awaited<ReturnType<typeof gatewayExecutionFixture>>;
export function gatewayExecutionRequest(
  capabilityId: "changeset.apply" | "changeset.schedule" | "changeset.rollback",
  input: unknown,
  idempotencyKey: string = randomUUID(),
): NpAgentChangeSetCapabilityInvocationRequestV1 {
  const parsed = npRequireAgentInstalledCapabilityInvocationRequestV1({
    schemaVersion: "np.agent-invocation-request.v1",
    capabilityId,
    arguments: { input, idempotencyKey },
  });
  if (
    parsed.capabilityId !== "changeset.apply" &&
    parsed.capabilityId !== "changeset.schedule" &&
    parsed.capabilityId !== "changeset.rollback"
  )
    throw new Error("Expected execution request");
  return parsed;
}
export async function invokeGatewayExecution(
  f: GatewayExecutionFixture,
  req: NpAgentChangeSetCapabilityInvocationRequestV1,
) {
  const result = await f.service.invokeCapability({
    authentication: f.principal.authentication,
    request: req,
  });
  return { ...result, output: npRequireAgentChangeSetExecutionOutputV1(result.output) };
}
export async function readyGatewayExecution(f: GatewayExecutionFixture) {
  const created = await f.service.create({
    actor: f.principal.actor,
    command: await command({
      title: "Gateway SEO",
      summary: null,
      operations: [
        {
          kind: "setting",
          operation: "replace",
          clientOperationId: "seo",
          reason: null,
          resource: { key: "seo" },
          base: null,
          input: { value: { defaultOgImage: null, twitterHandle: "gateway", defaultLocale: "en" } },
        },
      ],
    }),
  });
  const sealed = await f.service.validate({
    actor: f.principal.actor,
    id: created.id,
    command: { expectedVersion: 1, idempotencyKey: randomUUID() },
  });
  const preview = await f.service.preview({
    actor: f.principal.actor,
    id: created.id,
    command: {
      expectedVersion: 1,
      expectedPlanHash: sealed.planHash,
      idempotencyKey: randomUUID(),
    },
  });
  await f.service.processPreview({ siteId, previewId: preview.previewId });
  return sealed;
}
export async function approveGatewayExecution(f: GatewayExecutionFixture, approvalId: string) {
  const detail = await f.service.approvals!.get({ siteId, actor: f.actor.actor, id: approvalId });
  return decideApproval(f.service.approvals!, f.actor, detail);
}
