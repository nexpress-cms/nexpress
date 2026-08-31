import process from "node:process";
import { type Readable, type Writable } from "node:stream";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import {
  createAgentMcpServerV1,
  NP_AGENT_MCP_MAX_FRAME_BYTES_V1,
  type NpConfigureAgentMcpServerV1,
} from "./server.js";

export const NP_AGENT_MCP_STDIO_AUDIENCE_V1 = "urn:nexpress:agent-gateway:stdio" as const;
export const NP_AGENT_MCP_STDIO_CREDENTIAL_ENV_V1 = "NP_AGENT_SERVICE_TOKEN" as const;

export type NpAgentMcpStdioIssueCodeV1 =
  | "MCP_STDIO_BOOTSTRAP_FAILED"
  | "MCP_STDIO_CREDENTIAL_REQUIRED"
  | "MCP_STDIO_AUTHENTICATION_FAILED"
  | "MCP_STDIO_CONFIGURATION_FAILED"
  | "MCP_STDIO_PROTOCOL_ERROR"
  | "MCP_STDIO_SHUTDOWN_FAILED"
  | "MCP_STDIO_START_FAILED";

export class NpAgentMcpStdioError extends Error {
  readonly code: NpAgentMcpStdioIssueCodeV1;

  constructor(code: NpAgentMcpStdioIssueCodeV1, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NpAgentMcpStdioError";
    this.code = code;
  }
}

export interface NpAgentMcpStdioEventV1 {
  code: NpAgentMcpStdioIssueCodeV1;
}

export interface NpAgentMcpStdioHostV1<TAuthentication> {
  ensureFor: (intent: "read") => Promise<void>;
  authenticateStdioServiceToken: (input: {
    credential: string;
    transport: "stdio";
    audience: typeof NP_AGENT_MCP_STDIO_AUDIENCE_V1;
  }) => Promise<TAuthentication>;
  configureServer?: NpConfigureAgentMcpServerV1<TAuthentication>;
  shutdown: () => Promise<void>;
}

export interface NpAgentMcpStdioSessionV1 {
  close: () => Promise<void>;
  closed: Promise<void>;
}

export interface NpAgentMcpStdioStartOptionsV1<TAuthentication> {
  host: NpAgentMcpStdioHostV1<TAuthentication>;
  env?: Readonly<Record<string, string | undefined>>;
  input?: Readable;
  output?: Writable;
  report?: (event: NpAgentMcpStdioEventV1) => void;
}

export interface NpAgentMcpStdioSignalSourceV1 {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface NpAgentMcpStdioRunOptionsV1<
  TAuthentication,
> extends NpAgentMcpStdioStartOptionsV1<TAuthentication> {
  signals?: NpAgentMcpStdioSignalSourceV1;
}

class NpBoundedStdioServerTransportV1 extends StdioServerTransport {
  override async send(message: JSONRPCMessage): Promise<void> {
    let serialized: string;
    try {
      const candidate = JSON.stringify(message);
      if (typeof candidate !== "string") throw new Error("Response did not serialize to JSON.");
      serialized = candidate;
    } catch {
      await this.close();
      throw new Error("MCP stdio response is not serializable.");
    }
    const bytes = Buffer.byteLength(serialized, "utf8") + 1;
    if (bytes > NP_AGENT_MCP_MAX_FRAME_BYTES_V1) {
      await this.close();
      throw new Error("MCP stdio response exceeds the frame limit.");
    }
    // The SDK serializes again inside super.send(). Reparse the exact bounded
    // representation so mutable getters or toJSON hooks cannot change the
    // frame between the size check and stdout write.
    await super.send(JSON.parse(serialized) as JSONRPCMessage);
  }
}

function safeError(code: NpAgentMcpStdioIssueCodeV1, message: string): NpAgentMcpStdioError {
  return new NpAgentMcpStdioError(code, message);
}

function readCredential(env: Readonly<Record<string, string | undefined>>): string {
  const credential = env[NP_AGENT_MCP_STDIO_CREDENTIAL_ENV_V1];
  if (typeof credential !== "string" || credential.length === 0) {
    throw new NpAgentMcpStdioError(
      "MCP_STDIO_CREDENTIAL_REQUIRED",
      `${NP_AGENT_MCP_STDIO_CREDENTIAL_ENV_V1} is required for local MCP.`,
    );
  }
  return credential;
}

async function shutdownAfterStartupFailure<TAuthentication>(
  host: NpAgentMcpStdioHostV1<TAuthentication>,
  original: unknown,
): Promise<never> {
  try {
    await host.shutdown();
  } catch {
    throw new NpAgentMcpStdioError(
      "MCP_STDIO_SHUTDOWN_FAILED",
      "Local MCP startup cleanup failed.",
    );
  }
  throw original;
}

/**
 * Authenticates once before the SDK starts reading stdin, then leaves every
 * capability call to the shared admission service, which rechecks live token,
 * principal, staff authority, scopes, and Gateway ceilings.
 */
export async function startAgentMcpStdioV1<TAuthentication>(
  options: NpAgentMcpStdioStartOptionsV1<TAuthentication>,
): Promise<NpAgentMcpStdioSessionV1> {
  const env = options.env ?? process.env;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const credential = readCredential(env);

  try {
    await options.host.ensureFor("read");
  } catch {
    const safe = safeError("MCP_STDIO_BOOTSTRAP_FAILED", "Local MCP bootstrap failed.");
    return shutdownAfterStartupFailure(options.host, safe);
  }

  let authentication: TAuthentication;
  try {
    authentication = await options.host.authenticateStdioServiceToken({
      credential,
      transport: "stdio",
      audience: NP_AGENT_MCP_STDIO_AUDIENCE_V1,
    });
  } catch {
    const safe = safeError("MCP_STDIO_AUTHENTICATION_FAILED", "Local MCP authentication failed.");
    return shutdownAfterStartupFailure(options.host, safe);
  }

  let server;
  try {
    server = await createAgentMcpServerV1({
      authentication,
      configure: options.host.configureServer,
    });
  } catch {
    const safe = safeError(
      "MCP_STDIO_CONFIGURATION_FAILED",
      "Local MCP server configuration failed.",
    );
    return shutdownAfterStartupFailure(options.host, safe);
  }

  const transport = new NpBoundedStdioServerTransportV1(input, output, {
    maxBufferSize: NP_AGENT_MCP_MAX_FRAME_BYTES_V1,
  });
  let resolveClosed!: () => void;
  let rejectClosed!: (error: unknown) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  let finalizeStarted = false;

  const finalize = (): Promise<void> => {
    if (!finalizeStarted) {
      finalizeStarted = true;
      void (async () => {
        try {
          await options.host.shutdown();
          resolveClosed();
        } catch {
          const safe = safeError(
            "MCP_STDIO_SHUTDOWN_FAILED",
            "Local MCP bootstrap shutdown failed.",
          );
          options.report?.({ code: safe.code });
          rejectClosed(safe);
        }
      })();
    }
    return closed;
  };

  server.onclose = () => {
    void finalize().catch(() => undefined);
  };
  server.onerror = () => {
    // Do not forward SDK errors or frames to diagnostics: parser failures may
    // contain hostile input. The stable code is sufficient for operators.
    options.report?.({ code: "MCP_STDIO_PROTOCOL_ERROR" });
  };

  const close = async (): Promise<void> => {
    try {
      await server.close();
    } finally {
      await finalize();
    }
  };

  try {
    await server.connect(transport);
  } catch {
    const safe = safeError("MCP_STDIO_START_FAILED", "Local MCP transport failed to start.");
    try {
      await close();
    } catch {
      throw safeError("MCP_STDIO_SHUTDOWN_FAILED", "Local MCP startup cleanup failed.");
    }
    throw safe;
  }

  return { close, closed };
}

/** Runs one dedicated stdio process until EOF, transport close, SIGINT, or SIGTERM. */
export async function runAgentMcpStdioV1<TAuthentication>(
  options: NpAgentMcpStdioRunOptionsV1<TAuthentication>,
): Promise<void> {
  const input = options.input ?? process.stdin;
  const signals = options.signals ?? process;
  const session = await startAgentMcpStdioV1({ ...options, input });
  const requestClose = () => {
    void session.close().catch(() => undefined);
  };
  input.once("end", requestClose);
  input.once("close", requestClose);
  signals.once("SIGINT", requestClose);
  signals.once("SIGTERM", requestClose);
  if (input.readableEnded || input.destroyed) requestClose();
  try {
    await session.closed;
  } finally {
    input.off("end", requestClose);
    input.off("close", requestClose);
    signals.off("SIGINT", requestClose);
    signals.off("SIGTERM", requestClose);
  }
}
