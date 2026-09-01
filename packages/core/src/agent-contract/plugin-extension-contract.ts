export const npAgentPluginGatewayForbiddenKeysV1 = [
  "agentCapabilities",
  "agentCapabilityIds",
  "agentScopes",
  "mcpPrompts",
  "mcpResourceTemplates",
  "mcpResources",
  "mcpTools",
] as const;

export interface NpAgentPluginGatewayExtensionIssueV1 {
  code: "AGENT_PLUGIN_EXTENSION_UNSUPPORTED";
  path: string;
  message: "Plugin-defined Agent Gateway extensions are not supported in v1.";
}

export class NpAgentPluginGatewayExtensionErrorV1 extends Error {
  readonly code = "AGENT_PLUGIN_EXTENSION_UNSUPPORTED" as const;

  constructor(readonly path: string) {
    super("Plugin-defined Agent Gateway extensions are not supported in v1.");
    this.name = "NpAgentPluginGatewayExtensionErrorV1";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function dataValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function issue(path: string): NpAgentPluginGatewayExtensionIssueV1 {
  return {
    code: "AGENT_PLUGIN_EXTENSION_UNSUPPORTED",
    path,
    message: "Plugin-defined Agent Gateway extensions are not supported in v1.",
  };
}

/**
 * Inspect only the definition/manifest metadata boundaries. Plugin config
 * schemas and runtime values may legitimately use similarly named business
 * fields and are deliberately not traversed.
 */
export function npAnalyzeAgentPluginGatewayExtensionsV1(
  value: unknown,
): NpAgentPluginGatewayExtensionIssueV1[] {
  try {
    const root = record(value);
    if (!root) return [];
    const findings: NpAgentPluginGatewayExtensionIssueV1[] = [];
    const inspect = (candidate: Record<string, unknown> | null, path: string): void => {
      if (!candidate) return;
      for (const key of npAgentPluginGatewayForbiddenKeysV1) {
        if (Object.hasOwn(candidate, key)) findings.push(issue(`${path}.${key}`));
      }
    };

    inspect(root, "plugin");
    const manifest = record(dataValue(root, "manifest"));
    inspect(manifest, "plugin.manifest");
    if (manifest) {
      inspect(record(dataValue(manifest, "agent")), "plugin.manifest.agent");
      inspect(record(dataValue(manifest, "provides")), "plugin.manifest.provides");
      const capabilities = dataValue(manifest, "capabilities");
      if (
        Array.isArray(capabilities) &&
        capabilities.some(
          (capability) => typeof capability === "string" && capability.startsWith("agent:"),
        )
      ) {
        findings.push(issue("plugin.manifest.capabilities"));
      }
    }
    return findings.sort((left, right) => left.path.localeCompare(right.path));
  } catch {
    return [issue("plugin")];
  }
}

export function npRequireNoAgentPluginGatewayExtensionsV1(value: unknown): void {
  const finding = npAnalyzeAgentPluginGatewayExtensionsV1(value)[0];
  if (finding) throw new NpAgentPluginGatewayExtensionErrorV1(finding.path);
}
