import { npRequireAgentChangeSetResourceKey } from "../agent-contract/changeset-contract.js";
import type { NpAgentChangeSetResourceKeyV1, NpAgentTargetRef } from "../agent-contract/types.js";
import { compareCanonicalJson } from "../agent-contract/canonical-runtime-primitives.js";

/** Target inventory only; callers still recheck every operation through the existing resource ACL. */
export function npAgentChangeSetActionTargetsV1(
  resources: readonly NpAgentChangeSetResourceKeyV1[],
): NpAgentTargetRef[] {
  const targets = resources
    .map((value): NpAgentTargetRef => {
      const resource = npRequireAgentChangeSetResourceKey(value);
      return resource.kind === "media_ref"
        ? { kind: "document", collection: resource.collection, documentId: resource.documentId }
        : resource;
    })
    .sort(compareCanonicalJson);
  return targets.filter(
    (target, index) => index === 0 || compareCanonicalJson(targets[index - 1], target) !== 0,
  );
}
