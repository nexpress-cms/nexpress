import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npBuildAgentChangeSetCapabilityDefinitionCanonicalV1,
  type NpAgentChangeSetCapabilityIdV1,
} from "../agent-contract/installed-capability-contract.js";

const immutableDefinitionJson = new WeakMap<object, string>();

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function npBuildAgentChangeSetCapabilityEntryV1(id: NpAgentChangeSetCapabilityIdV1) {
  const body = npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(id);
  const definition = body.capabilities[0];
  const entry = freeze({
    definition,
    canonical: definition,
    definitionCanonical: body,
    capabilityFingerprint: await npDigestAgentCapabilityRegistryCanonical(body, body.capabilities),
  });
  immutableDefinitionJson.set(entry, serializeAgentCanonicalJson(body));
  return entry;
}

/** Only entries built here have fixed canonical bytes and identical definition aliases. */
export function npGetAgentChangeSetCapabilityEntryJsonV1(entry: object): string | undefined {
  return immutableDefinitionJson.get(entry);
}
