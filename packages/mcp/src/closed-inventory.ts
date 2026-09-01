export const npAgentMcpToolNamesV1 = [
  "apply_changeset",
  "create_changeset",
  "execute_approved_action",
  "get_ops_status",
  "inspect_site",
  "plan_ops_action",
  "preview_changeset",
  "quarantine_content",
  "query_changesets",
  "query_content",
  "query_incidents",
  "restore_content",
  "revoke_sessions",
  "rollback_changeset",
  "run_site_audit",
  "schedule_changeset",
  "temporarily_limit_actor",
  "validate_changeset",
] as const;

export const npAgentMcpPromptNamesV1 = [
  "nexpress_content_maintenance",
  "nexpress_moderation_review",
  "nexpress_ops_triage",
  "nexpress_security_incident_review",
] as const;

export type NpAgentMcpClosedInventoryKindV1 = "prompt" | "resource" | "resource-template" | "tool";

export class NpAgentMcpClosedInventoryErrorV1 extends Error {
  readonly code = "MCP_CLOSED_INVENTORY_REJECTED" as const;

  constructor(readonly kind: NpAgentMcpClosedInventoryKindV1) {
    super(`The ${kind} is outside the closed NexPress MCP v1 inventory.`);
    this.name = "NpAgentMcpClosedInventoryErrorV1";
  }
}

const TOOL_NAMES = new Set<string>(npAgentMcpToolNamesV1);
const PROMPT_NAMES = new Set<string>(npAgentMcpPromptNamesV1);
const SITE = "[a-z][a-z0-9-]{0,62}";
const SEGMENT = "[A-Za-z0-9._~-]{1,128}";
const CONCRETE_RESOURCE_PATTERN = new RegExp(
  `^nexpress://site/${SITE}/(?:summary|capabilities|schema|schema/blocks|plugins|agent-policy|schema/collections/${SEGMENT}|changesets/${SEGMENT}|agent-previews/${SEGMENT}/artifacts/${SEGMENT}|incidents/${SEGMENT}|runs/${SEGMENT})$`,
  "u",
);
const RESOURCE_TEMPLATE_PATTERN = new RegExp(
  `^nexpress://site/${SITE}/(?:schema/collections/\\{slug\\}|changesets/\\{changesetId\\}|agent-previews/\\{previewId\\}/artifacts/\\{artifactId\\}|incidents/\\{incidentId\\}|runs/\\{runId\\})$`,
  "u",
);

export function npIsAgentMcpToolNameV1(
  value: unknown,
): value is (typeof npAgentMcpToolNamesV1)[number] {
  return typeof value === "string" && TOOL_NAMES.has(value);
}

export function npIsAgentMcpPromptNameV1(
  value: unknown,
): value is (typeof npAgentMcpPromptNamesV1)[number] {
  return typeof value === "string" && PROMPT_NAMES.has(value);
}

export function npIsAgentMcpResourceUriV1(value: unknown): value is string {
  return typeof value === "string" && CONCRETE_RESOURCE_PATTERN.test(value);
}

export function npIsAgentMcpResourceTemplateUriV1(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_TEMPLATE_PATTERN.test(value);
}

export function npRequireAgentMcpListedInventoryV1(
  kind: NpAgentMcpClosedInventoryKindV1,
  values: readonly unknown[],
): void {
  for (const value of values) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new NpAgentMcpClosedInventoryErrorV1(kind);
    }
    const record = value as Record<string, unknown>;
    const accepted = (() => {
      try {
        const key =
          kind === "tool" || kind === "prompt"
            ? "name"
            : kind === "resource"
              ? "uri"
              : "uriTemplate";
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        const candidate =
          descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : null;
        return kind === "tool"
          ? npIsAgentMcpToolNameV1(candidate)
          : kind === "prompt"
            ? npIsAgentMcpPromptNameV1(candidate)
            : kind === "resource"
              ? npIsAgentMcpResourceUriV1(candidate)
              : npIsAgentMcpResourceTemplateUriV1(candidate);
      } catch {
        return false;
      }
    })();
    if (!accepted) throw new NpAgentMcpClosedInventoryErrorV1(kind);
  }
}
