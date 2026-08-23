import { serializeAgentCanonicalJson } from "./canonical-foundation.js";
import type { NpAgentCanonicalPurposeV1 } from "./types.js";

export type NpAgentCanonicalRegistryPurposeV1 = Extract<
  NpAgentCanonicalPurposeV1,
  "np.agent-capability-registry.v1" | "np.agent-recipe-registry.v1"
>;

export const npAgentCanonicalIncompleteRegistryErrorCode =
  "AGENT_CANONICAL_INCOMPLETE_REGISTRY" as const;

export class NpAgentCanonicalIncompleteRegistryError<
  P extends NpAgentCanonicalRegistryPurposeV1 = "np.agent-capability-registry.v1",
> extends Error {
  readonly code = npAgentCanonicalIncompleteRegistryErrorCode;
  readonly purpose: P;

  constructor(message: string);
  constructor(purpose: P, message: string);
  constructor(purposeOrMessage: string, maybeMessage?: string) {
    const hasPurpose = maybeMessage !== undefined;
    super(hasPurpose ? maybeMessage : purposeOrMessage);
    this.name = "NpAgentCanonicalIncompleteRegistryError";
    this.purpose = (hasPurpose ? purposeOrMessage : "np.agent-capability-registry.v1") as P;
  }
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return serializeAgentCanonicalJson(left) === serializeAgentCanonicalJson(right);
}

export function requireAgentCanonicalRegistryCompleteness<T>(options: {
  purpose: NpAgentCanonicalRegistryPurposeV1;
  projection: "definition" | "registry";
  entries: readonly T[];
  installedEntries: readonly T[];
  entryId: (entry: T) => string;
  entryLabel: string;
}): void {
  const { purpose, projection, entries, installedEntries, entryId, entryLabel } = options;
  const definition = entries[0];
  const isComplete =
    projection === "registry"
      ? sameCanonicalValue(entries, installedEntries)
      : definition !== undefined &&
        installedEntries.some(
          (installedEntry) =>
            entryId(installedEntry) === entryId(definition) &&
            sameCanonicalValue(installedEntry, definition),
        );

  if (!isComplete) {
    throw new NpAgentCanonicalIncompleteRegistryError(
      purpose,
      projection === "registry"
        ? `Registry projection does not exactly match the installed ${entryLabel} snapshot`
        : `Definition projection is not an exact member of the installed ${entryLabel} snapshot`,
    );
  }
}
