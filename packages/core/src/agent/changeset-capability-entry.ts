import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npBuildAgentChangeSetCapabilityDefinitionCanonicalV1,
  type NpAgentChangeSetCapabilityIdV1,
} from "../agent-contract/installed-capability-contract.js";
import { npFreezeAgentCapabilityEntryV1 } from "./capability-registry-validation.js";

const immutableDefinitionJson = new WeakMap<object, string>();

export async function npBuildAgentChangeSetCapabilityEntryV1(id: NpAgentChangeSetCapabilityIdV1) {
  const body = npBuildAgentChangeSetCapabilityDefinitionCanonicalV1(id);
  const definition = body.capabilities[0];
  const entry = npFreezeAgentCapabilityEntryV1({
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
