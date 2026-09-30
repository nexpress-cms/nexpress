import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import {
  npBuildAgentOperatorCapabilityDefinitionCanonicalV1,
  npRequireAgentOperatorCapabilityInvocationResultV1,
  type NpAgentOperatorCapabilityIdV1,
  type NpAgentOperatorCapabilityInvocationRequestV1,
} from "../agent-contract/operator-capability-contract.js";
import type { NpAgentOperatorServiceV1 } from "./operator-service.js";
import type { NpAgentCapabilityAuthenticationV1 } from "./capability-admission.js";
import type { NpAgentMcpTaskRequestV1 } from "./mcp-task-service.js";

/** Explicit installation of the durable Operator owner. */
export function createAgentOperatorCapabilityFacadeV1(service: NpAgentOperatorServiceV1) {
  return {
    ids: Object.freeze([...service.capabilityIds]),
    async entry(id: NpAgentOperatorCapabilityIdV1) {
      const canonical = npBuildAgentOperatorCapabilityDefinitionCanonicalV1(id);
      return {
        definition: canonical.capabilities[0],
        canonical: canonical.capabilities[0],
        definitionCanonical: canonical,
        capabilityFingerprint: await npDigestAgentCapabilityRegistryCanonical(
          canonical,
          canonical.capabilities,
        ),
      };
    },
    async invoke(
      authentication: NpAgentCapabilityAuthenticationV1,
      request: NpAgentOperatorCapabilityInvocationRequestV1,
      taskRequest?: NpAgentMcpTaskRequestV1,
    ) {
      const result = await service.invokeCapability({ authentication, request, taskRequest });
      const projected = npRequireAgentOperatorCapabilityInvocationResultV1({
        schemaVersion: result.schemaVersion,
        invocationId: result.invocationId,
        capabilityId: result.capabilityId,
        output: result.output,
      });
      return { ...projected, ...(result.task ? { task: result.task } : {}) };
    },
    inspectRuntimeApproval: (
      ...args: Parameters<NpAgentOperatorServiceV1["inspectRuntimeApproval"]>
    ) => service.inspectRuntimeApproval(...args),
    resumeRuntimeApproval: (
      ...args: Parameters<NpAgentOperatorServiceV1["resumeRuntimeApproval"]>
    ) => service.resumeRuntimeApproval(...args),
    invokeRuntime: (...args: Parameters<NpAgentOperatorServiceV1["invokeRuntimeCapability"]>) =>
      service.invokeRuntimeCapability(...args),
    projectRuntimeAction: (...args: Parameters<NpAgentOperatorServiceV1["projectRuntimeAction"]>) =>
      service.projectRuntimeAction(...args),
  };
}
export type NpAgentOperatorCapabilityFacadeV1 = ReturnType<
  typeof createAgentOperatorCapabilityFacadeV1
>;
