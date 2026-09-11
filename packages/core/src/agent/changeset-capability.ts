import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import {
  npAgentChangeSetCapabilityIdsV1,
  npBuildAgentChangeSetCapabilityDefinitionCanonicalV1,
  npRequireAgentChangeSetCapabilityInvocationResultV1,
  type NpAgentChangeSetCapabilityIdV1,
  type NpAgentChangeSetCapabilityInvocationRequestV1,
} from "../agent-contract/installed-capability-contract.js";
import type { NpAgentMcpTaskRequestV1 } from "./mcp-task-service.js";
import type { NpAgentChangeSetServiceV1 } from "./changeset-service.js";
import type { NpAgentCapabilityAuthenticationV1 } from "./capability-admission.js";

/** Explicitly installed projection of the existing service, including its journals and authority checks. */
export function createAgentChangeSetCapabilityFacadeV1(
  service: Pick<NpAgentChangeSetServiceV1, "invokeCapability" | "capabilityIds">,
) {
  if (
    service.capabilityIds.some(
      (id, index) =>
        !npAgentChangeSetCapabilityIdsV1.includes(id) ||
        (index > 0 && service.capabilityIds[index - 1] >= id),
    )
  )
    throw new Error("Invalid ChangeSet capability inventory.");
  function freeze<T>(value: T): T {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  }
  async function buildEntry(id: NpAgentChangeSetCapabilityIdV1) {
    const canonical = npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(id);
    const definition = canonical.capabilities[0];
    return freeze({
      definition,
      canonical: definition,
      definitionCanonical: canonical,
      capabilityFingerprint: await npDigestAgentCapabilityRegistryCanonical(
        canonical,
        canonical.capabilities,
      ),
    });
  }
  const entries = new Map<NpAgentChangeSetCapabilityIdV1, ReturnType<typeof buildEntry>>();
  return {
    ids: Object.freeze([...service.capabilityIds]),
    entry(id: NpAgentChangeSetCapabilityIdV1) {
      let cached = entries.get(id);
      if (!cached) {
        cached = buildEntry(id);
        entries.set(id, cached);
      }
      return cached;
    },
    async invoke(
      authentication: NpAgentCapabilityAuthenticationV1,
      request: NpAgentChangeSetCapabilityInvocationRequestV1,
      taskRequest?: NpAgentMcpTaskRequestV1,
    ) {
      const result = await service.invokeCapability({ authentication, request, taskRequest });
      const projected = npRequireAgentChangeSetCapabilityInvocationResultV1({
        schemaVersion: "np.agent-changeset-invocation-result.v1",
        invocationId: result.invocationId,
        capabilityId: request.capabilityId,
        output: result.output,
      });
      return { ...projected, ...(result.task ? { task: result.task } : {}) };
    },
  };
}
export type NpAgentChangeSetCapabilityFacadeV1 = ReturnType<
  typeof createAgentChangeSetCapabilityFacadeV1
>;
