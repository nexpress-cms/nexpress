import process from "node:process";
import { type Readable, type Writable } from "node:stream";

import {
  requireAgentStudioGatewayRuntimeV1,
  requireAgentStudioMcpRuntimeV1,
  type NpAgentAuthenticatedServicePrincipalV1,
  type NpAgentGatewayServiceV1,
  type NpAgentMcpGatewayV1,
} from "@nexpress/core/agents";
import {
  NpAgentMcpStdioError,
  runAgentMcpStdioV1,
  type NpAgentMcpStdioEventV1,
  type NpAgentMcpStdioIssueCodeV1,
  type NpAgentMcpStdioSignalSourceV1,
} from "@nexpress/mcp/stdio";

type GatewayAuthenticator = Pick<NpAgentGatewayServiceV1, "authenticateStdioServiceToken">;

const SAFE_STDIO_FAILURE_MESSAGES = {
  MCP_STDIO_BOOTSTRAP_FAILED: "Local MCP bootstrap failed.",
  MCP_STDIO_CREDENTIAL_REQUIRED: "NP_AGENT_SERVICE_TOKEN is required for local MCP.",
  MCP_STDIO_AUTHENTICATION_FAILED: "Local MCP authentication failed.",
  MCP_STDIO_CONFIGURATION_FAILED: "Local MCP server configuration failed.",
  MCP_STDIO_PROTOCOL_ERROR: "Local MCP protocol failed.",
  MCP_STDIO_SHUTDOWN_FAILED: "Local MCP shutdown failed.",
  MCP_STDIO_START_FAILED: "Local MCP transport failed to start.",
} as const satisfies Record<NpAgentMcpStdioIssueCodeV1, string>;

export interface NpRunAgentMcpStdioProcessOptionsV1 {
  ensureFor: (intent: "read") => Promise<void>;
  shutdown: () => Promise<void>;
  resolveGateway?: () => GatewayAuthenticator;
  resolveMcp?: () => NpAgentMcpGatewayV1;
  env?: Readonly<Record<string, string | undefined>>;
  input?: Readable;
  output?: Writable;
  signals?: NpAgentMcpStdioSignalSourceV1;
  report?: (event: NpAgentMcpStdioEventV1) => void;
}

export function formatAgentMcpStdioFailureV1(error: unknown): string {
  if (error instanceof NpAgentMcpStdioError) {
    return `nexpress-agent-mcp: ${error.code}: ${SAFE_STDIO_FAILURE_MESSAGES[error.code]}\n`;
  }
  return "nexpress-agent-mcp: MCP_STDIO_START_FAILED: Local MCP failed.\n";
}

export async function runAgentMcpStdioProcessV1(
  options: NpRunAgentMcpStdioProcessOptionsV1,
): Promise<void> {
  const resolveGateway =
    options.resolveGateway ?? (() => requireAgentStudioGatewayRuntimeV1().gateway);
  const resolveMcp = options.resolveMcp ?? (() => requireAgentStudioMcpRuntimeV1().mcp);
  await runAgentMcpStdioV1<NpAgentAuthenticatedServicePrincipalV1>({
    env: options.env,
    input: options.input,
    output: options.output,
    signals: options.signals,
    report:
      options.report ??
      ((event) => {
        process.stderr.write(`nexpress-agent-mcp: ${event.code}\n`);
      }),
    host: {
      ensureFor: options.ensureFor,
      authenticateStdioServiceToken: ({ credential }) =>
        resolveGateway().authenticateStdioServiceToken({ credential }),
      get projection() {
        // Core bootstrap is established by ensureFor() before the transport
        // reads this host-injected projection.
        return resolveMcp();
      },
      shutdown: options.shutdown,
    },
  });
}
