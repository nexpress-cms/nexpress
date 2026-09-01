import {
  npAgentDisabledGatewaySettingsV1,
  npRequireAgentGatewaySettings,
  npRequireAgentStudioAdapterV1,
  type NpAgentGatewaySettingsV1,
  type NpAgentStudioAdapterV1,
  type NpAgentStudioRuntimeV1,
} from "../agent-contract/index.js";

import type { NpAgentConnectionAdminServiceV1 } from "./connection-admin-service.js";
import type { NpAgentConnectionServiceV1 } from "./connection-service.js";
import type { NpAgentGatewayServiceV1 } from "./gateway-service.js";
import type { NpAgentOauthServiceV1 } from "./oauth-service.js";
import type { NpAgentMcpGatewayV1 } from "./mcp-gateway.js";
import type { NpAgentConnectionAuthAdapterRegistryV1 } from "./provider-auth-contract.js";
import { NpServiceUnavailableError } from "../errors.js";

export interface NpAgentStudioServerRuntimeV1 {
  connections: NpAgentConnectionServiceV1 | null;
  connectionAdmin: NpAgentConnectionAdminServiceV1 | null;
  gateway: NpAgentGatewayServiceV1 | null;
  oauth: NpAgentOauthServiceV1 | null;
  mcp: NpAgentMcpGatewayV1 | null;
  adapters: readonly NpAgentStudioAdapterV1[];
  resolveGatewaySettings: (siteId: string) => Promise<NpAgentGatewaySettingsV1>;
}

export interface NpAgentStudioServerRuntimeOptionsV1 {
  connections?: NpAgentConnectionServiceV1;
  connectionAdmin?: NpAgentConnectionAdminServiceV1;
  gateway?: NpAgentGatewayServiceV1;
  oauth?: NpAgentOauthServiceV1;
  mcp?: NpAgentMcpGatewayV1;
  providerRegistry?: NpAgentConnectionAuthAdapterRegistryV1;
}

function adapterProjection(
  adapter: ReturnType<NpAgentConnectionAuthAdapterRegistryV1["list"]>[number],
): NpAgentStudioAdapterV1 {
  return npRequireAgentStudioAdapterV1({
    schemaVersion: "np.agent-studio-adapter.v1",
    id: adapter.id,
    contractVersion: adapter.contractVersion,
    fingerprint: adapter.fingerprint,
    supportedConnectionKinds: [...adapter.supportedConnectionKinds],
    supportedAuthKinds: [...adapter.supportedAuthKinds],
    configSchema: adapter.configSchema,
    oauth: adapter.oauth
      ? {
          authorizationOrigins: [...adapter.oauth.authorizationOrigins],
          permissionInventory: [...adapter.oauth.permissionInventory],
        }
      : null,
  });
}

export function createAgentStudioServerRuntimeV1(
  options: NpAgentStudioServerRuntimeOptionsV1 = {},
): NpAgentStudioServerRuntimeV1 {
  if ((options.connections === undefined) !== (options.connectionAdmin === undefined)) {
    throw new Error("Agent Studio connection read and Admin services must be installed together.");
  }
  if (options.oauth !== undefined && options.gateway === undefined) {
    throw new Error("Agent OAuth runtime requires the Agent Gateway service.");
  }
  if (options.mcp !== undefined && options.gateway === undefined) {
    throw new Error("Agent MCP runtime requires the Agent Gateway service.");
  }
  const adapters = Object.freeze((options.providerRegistry?.list() ?? []).map(adapterProjection));
  return Object.freeze({
    connections: options.connections ?? null,
    connectionAdmin: options.connectionAdmin ?? null,
    gateway: options.gateway ?? null,
    oauth: options.oauth ?? null,
    mcp: options.mcp ?? null,
    adapters,
    resolveGatewaySettings: async (siteId: string) =>
      npRequireAgentGatewaySettings(
        (await options.gateway?.getEffectiveGatewaySettings(siteId)) ??
          npAgentDisabledGatewaySettingsV1,
      ),
  });
}

let installedRuntime: NpAgentStudioServerRuntimeV1 | null = null;

/** Framework-host bootstrap setter. Application code must not call this directly. */
export function setAgentStudioServerRuntimeV1(
  runtime: NpAgentStudioServerRuntimeV1,
): NpAgentStudioServerRuntimeV1 {
  installedRuntime = runtime;
  return installedRuntime;
}

export function resetAgentStudioServerRuntimeV1(expected?: NpAgentStudioServerRuntimeV1): void {
  if (expected !== undefined && installedRuntime !== expected) return;
  installedRuntime = null;
}

export function getOptionalAgentStudioServerRuntimeV1(): NpAgentStudioServerRuntimeV1 | null {
  return installedRuntime;
}

export function npAgentStudioRuntimeStatusV1(
  runtime: NpAgentStudioServerRuntimeV1 | null = installedRuntime,
): NpAgentStudioRuntimeV1 {
  return {
    schemaVersion: "np.agent-studio-runtime.v1",
    connections:
      runtime?.connections && runtime.connectionAdmin
        ? { state: "ready", issueCode: null }
        : { state: "unavailable", issueCode: "AGENT_CONNECTION_RUNTIME_UNAVAILABLE" },
    gateway: runtime?.gateway
      ? { state: "ready", issueCode: null }
      : { state: "unavailable", issueCode: "AGENT_GATEWAY_RUNTIME_UNAVAILABLE" },
  };
}

export function requireAgentStudioConnectionRuntimeV1(): NpAgentStudioServerRuntimeV1 & {
  connections: NpAgentConnectionServiceV1;
  connectionAdmin: NpAgentConnectionAdminServiceV1;
} {
  const runtime = installedRuntime;
  if (!runtime?.connections || !runtime.connectionAdmin) {
    throw new NpServiceUnavailableError("Agent Studio connection runtime is unavailable.");
  }
  return runtime as NpAgentStudioServerRuntimeV1 & {
    connections: NpAgentConnectionServiceV1;
    connectionAdmin: NpAgentConnectionAdminServiceV1;
  };
}

export function requireAgentStudioGatewayRuntimeV1(): NpAgentStudioServerRuntimeV1 & {
  gateway: NpAgentGatewayServiceV1;
} {
  const runtime = installedRuntime;
  if (!runtime?.gateway) {
    throw new NpServiceUnavailableError("Agent Studio Gateway runtime is unavailable.");
  }
  return runtime as NpAgentStudioServerRuntimeV1 & { gateway: NpAgentGatewayServiceV1 };
}

export function requireAgentStudioOauthRuntimeV1(): NpAgentStudioServerRuntimeV1 & {
  gateway: NpAgentGatewayServiceV1;
  oauth: NpAgentOauthServiceV1;
} {
  const runtime = installedRuntime;
  if (!runtime?.gateway || !runtime.oauth) {
    throw new NpServiceUnavailableError("Agent Studio OAuth runtime is unavailable.");
  }
  return runtime as NpAgentStudioServerRuntimeV1 & {
    gateway: NpAgentGatewayServiceV1;
    oauth: NpAgentOauthServiceV1;
  };
}

export function requireAgentStudioMcpRuntimeV1(): NpAgentStudioServerRuntimeV1 & {
  gateway: NpAgentGatewayServiceV1;
  mcp: NpAgentMcpGatewayV1;
} {
  const runtime = installedRuntime;
  if (!runtime?.gateway || !runtime.mcp) {
    throw new NpServiceUnavailableError("Agent Studio MCP runtime is unavailable.");
  }
  return runtime as NpAgentStudioServerRuntimeV1 & {
    gateway: NpAgentGatewayServiceV1;
    mcp: NpAgentMcpGatewayV1;
  };
}
