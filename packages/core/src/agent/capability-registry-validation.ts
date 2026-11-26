import { npRequireAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import type {
  NpAgentCapabilityRegistryCanonicalV1,
  NpAgentCapabilityRegistryEntryCanonicalV1,
} from "../agent-contract/types.js";

type RegistryEntry = { readonly canonical: NpAgentCapabilityRegistryEntryCanonicalV1 };
const immutableEntries = new WeakSet<RegistryEntry>();

export function npFreezeAgentCapabilityMetadataV1<T>(value: T): T {
  const seen = new WeakSet<object>();
  function freeze(metadata: unknown) {
    if (!metadata || typeof metadata !== "object" || seen.has(metadata)) return;
    seen.add(metadata);
    // An already frozen container can still reference mutable children.
    for (const child of Object.values(metadata)) freeze(child);
    Object.freeze(metadata);
  }
  freeze(value);
  return value;
}

/** Framework constructors call this with canonical metadata they own. */
export function npFreezeAgentCapabilityEntryV1<T extends RegistryEntry>(entry: T): T {
  npFreezeAgentCapabilityMetadataV1(entry);
  immutableEntries.add(entry);
  return entry;
}

/** Keep one validated metadata assembly per admission service. */
export function npCreateAgentCapabilityRegistryValidatorV1() {
  let previous:
    | {
        capabilities: NpAgentCapabilityRegistryEntryCanonicalV1[];
        registry: NpAgentCapabilityRegistryCanonicalV1;
      }
    | undefined;
  return (entries: readonly RegistryEntry[]): NpAgentCapabilityRegistryCanonicalV1 => {
    const capabilities = entries.map((entry) => entry.canonical);
    const reusable = entries.every((entry) => immutableEntries.has(entry));
    const cached = previous;
    if (
      reusable &&
      cached &&
      cached.capabilities.length === capabilities.length &&
      capabilities.every((entry, index) => entry === cached.capabilities[index])
    ) {
      return cached.registry;
    }
    previous = undefined;
    const registry = npRequireAgentCapabilityRegistryCanonical({
      schemaVersion: "np.agent-capability-registry.v1",
      projection: "registry",
      capabilities,
    });
    if (reusable)
      previous = { capabilities, registry: npFreezeAgentCapabilityMetadataV1(registry) };
    return registry;
  };
}
