import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

import {
  configureAgentMcpProjectionV1,
  type NpAgentMcpProjectionProviderV1,
} from "./projection.js";

/**
 * NexPress deliberately stays on the MCP revision frozen by the R2 design.
 * The v1 SDK currently names this as its latest protocol revision. Moving to
 * a later MCP era is a separate compatibility change, not an SDK-range side
 * effect.
 */
export const NP_AGENT_MCP_PROTOCOL_VERSION_V1 = "2025-11-25" as const;

/** One complete JSON-RPC line, including protocol overhead, may be at most 5 MiB. */
export const NP_AGENT_MCP_MAX_FRAME_BYTES_V1 = 5 * 1024 * 1024;

export interface NpAgentMcpServerContextV1<TAuthentication> {
  protocolVersion: typeof NP_AGENT_MCP_PROTOCOL_VERSION_V1;
  authentication: TAuthentication;
}

export type NpConfigureAgentMcpServerV1<TAuthentication> = (
  server: Server,
  context: NpAgentMcpServerContextV1<TAuthentication>,
) => void | Promise<void>;

export async function createAgentMcpServerV1<TAuthentication>(input: {
  authentication: TAuthentication;
  projection?: NpAgentMcpProjectionProviderV1<TAuthentication>;
  configure?: NpConfigureAgentMcpServerV1<TAuthentication>;
}): Promise<Server> {
  const sdkProtocolVersion: string = LATEST_PROTOCOL_VERSION;
  if (sdkProtocolVersion !== NP_AGENT_MCP_PROTOCOL_VERSION_V1) {
    throw new Error("The installed MCP SDK does not match the frozen protocol revision.");
  }
  const server = new Server(
    { name: "nexpress-agent-gateway", version: "1" },
    {
      capabilities: {},
    },
  );
  if (input.projection) {
    await configureAgentMcpProjectionV1({
      server,
      authentication: input.authentication,
      provider: input.projection,
    });
  }
  await input.configure?.(server, {
    protocolVersion: NP_AGENT_MCP_PROTOCOL_VERSION_V1,
    authentication: input.authentication,
  });
  return server;
}
