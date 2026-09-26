import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import {
  npAgentModerationCapabilityIdsV1,
  npBuildAgentModerationCapabilityDefinitionCanonicalV1,
  npRequireAgentModerationCapabilityInvocationResultV1,
  type NpAgentModerationCapabilityIdV1,
  type NpAgentModerationCapabilityInvocationRequestV1,
} from "../agent-contract/moderation-capability-contract.js";
import type { NpAgentModerationServiceV1 } from "./moderation-service.js";
import type { NpAgentCapabilityAuthenticationV1 } from "./capability-admission.js";

/** Explicit host installation. Absence keeps discovery and execution disabled. */
export function createAgentModerationCapabilityFacadeV1(service: NpAgentModerationServiceV1) {
  return {
    ids: npAgentModerationCapabilityIdsV1,
    async entry(id: NpAgentModerationCapabilityIdV1) {
      const canonical = npBuildAgentModerationCapabilityDefinitionCanonicalV1(id);
      const definition = canonical.capabilities[0];
      return {
        definition,
        canonical: definition,
        definitionCanonical: canonical,
        capabilityFingerprint: await npDigestAgentCapabilityRegistryCanonical(
          canonical,
          canonical.capabilities,
        ),
      };
    },
    async invoke(
      authentication: NpAgentCapabilityAuthenticationV1,
      request: NpAgentModerationCapabilityInvocationRequestV1,
    ) {
      return npRequireAgentModerationCapabilityInvocationResultV1(
        await service.invokeCapability({ authentication, request }),
      );
    },
  };
}
export type NpAgentModerationCapabilityFacadeV1 = ReturnType<
  typeof createAgentModerationCapabilityFacadeV1
>;
