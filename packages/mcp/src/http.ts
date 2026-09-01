import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import {
  createAgentMcpServerV1,
  NP_AGENT_MCP_MAX_FRAME_BYTES_V1,
  NP_AGENT_MCP_PROTOCOL_VERSION_V1,
  type NpConfigureAgentMcpServerV1,
} from "./server.js";

export type NpAgentMcpHttpIssueCodeV1 =
  | "MCP_HTTP_CONFIGURATION_FAILED"
  | "MCP_HTTP_FRAME_TOO_LARGE"
  | "MCP_HTTP_INVALID_HEADERS"
  | "MCP_HTTP_INVALID_ORIGIN"
  | "MCP_HTTP_INVALID_REQUEST"
  | "MCP_HTTP_PROTOCOL_ERROR";

export interface NpAgentMcpHttpEventV1 {
  code: NpAgentMcpHttpIssueCodeV1;
}

export interface NpAgentMcpHttpOptionsV1<TAuthentication> {
  request: Request;
  canonicalOrigin: string;
  authentication: TAuthentication;
  configureServer?: NpConfigureAgentMcpServerV1<TAuthentication>;
  report?: (event: NpAgentMcpHttpEventV1) => void;
}

function jsonError(
  status: number,
  code: number,
  message: string,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, MCP-Protocol-Version",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function mediaTypes(value: string | null): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((part) => part.trim().split(";", 1)[0]?.toLowerCase())
      .filter((part): part is string => Boolean(part)),
  );
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const [mediaType, ...parameters] = value.split(";").map((part) => part.trim().toLowerCase());
  if (mediaType !== "application/json") return false;
  return parameters.every((parameter) => parameter === "charset=utf-8");
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/u.test(contentLength)) return null;
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > NP_AGENT_MCP_MAX_FRAME_BYTES_V1) return null;
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > NP_AGENT_MCP_MAX_FRAME_BYTES_V1) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isInitializeMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { method?: unknown }).method === "initialize"
  );
}

async function boundedResponse(response: Response): Promise<Response | null> {
  if (response.body === null) return response;
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^(0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > NP_AGENT_MCP_MAX_FRAME_BYTES_V1)
  ) {
    await response.body.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > NP_AGENT_MCP_MAX_FRAME_BYTES_V1) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(response.headers);
  headers.set("content-length", body.byteLength.toString());
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Handle one authenticated stateless Streamable HTTP frame. Authentication is
 * deliberately supplied by the host so this transport never sees cookies,
 * signing keys, database handles, or reusable raw credentials.
 */
export async function handleAgentMcpHttpV1<TAuthentication>(
  options: NpAgentMcpHttpOptionsV1<TAuthentication>,
): Promise<Response> {
  const request = options.request;
  const cors = corsHeaders(options.canonicalOrigin);
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    options.report?.({ code: "MCP_HTTP_INVALID_HEADERS" });
    return jsonError(400, -32600, "Invalid request");
  }
  if (
    requestUrl.origin !== options.canonicalOrigin ||
    requestUrl.pathname !== "/api/mcp" ||
    requestUrl.search ||
    requestUrl.hash
  ) {
    options.report?.({ code: "MCP_HTTP_INVALID_HEADERS" });
    return jsonError(403, -32000, "Forbidden");
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== options.canonicalOrigin) {
    options.report?.({ code: "MCP_HTTP_INVALID_ORIGIN" });
    return jsonError(403, -32000, "Forbidden");
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return jsonError(405, -32000, "Method not allowed", { ...cors, allow: "POST, OPTIONS" });
  }
  const accepted = mediaTypes(request.headers.get("accept"));
  if (!accepted.has("application/json") || !accepted.has("text/event-stream")) {
    options.report?.({ code: "MCP_HTTP_INVALID_HEADERS" });
    return jsonError(406, -32000, "Not acceptable", cors);
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    options.report?.({ code: "MCP_HTTP_INVALID_HEADERS" });
    return jsonError(415, -32000, "Unsupported media type", cors);
  }
  const bytes = await readBoundedBody(request);
  if (bytes === null) {
    options.report?.({ code: "MCP_HTTP_FRAME_TOO_LARGE" });
    return jsonError(413, -32000, "Request frame too large", cors);
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    options.report?.({ code: "MCP_HTTP_INVALID_REQUEST" });
    return jsonError(400, -32700, "Parse error", cors);
  }
  if (Array.isArray(body)) {
    options.report?.({ code: "MCP_HTTP_INVALID_REQUEST" });
    return jsonError(400, -32600, "Exactly one JSON-RPC message is required", cors);
  }
  const protocol = request.headers.get("mcp-protocol-version");
  if (
    (!isInitializeMessage(body) && protocol !== NP_AGENT_MCP_PROTOCOL_VERSION_V1) ||
    (protocol !== null && protocol !== NP_AGENT_MCP_PROTOCOL_VERSION_V1)
  ) {
    options.report?.({ code: "MCP_HTTP_PROTOCOL_ERROR" });
    return jsonError(400, -32000, "Unsupported MCP protocol version", cors);
  }

  let server;
  try {
    server = await createAgentMcpServerV1({
      authentication: options.authentication,
      configure: options.configureServer,
    });
  } catch {
    options.report?.({ code: "MCP_HTTP_CONFIGURATION_FAILED" });
    return jsonError(500, -32603, "Internal error", cors);
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    keepAliveMs: 0,
  });
  transport.onerror = () => options.report?.({ code: "MCP_HTTP_PROTOCOL_ERROR" });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: body });
    const bounded = await boundedResponse(response);
    if (!bounded) {
      options.report?.({ code: "MCP_HTTP_FRAME_TOO_LARGE" });
      return jsonError(500, -32603, "Internal error", cors);
    }
    const headers = new Headers(bounded.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    headers.set("cache-control", "no-store");
    headers.delete("mcp-session-id");
    return new Response(bounded.body, {
      status: bounded.status,
      statusText: bounded.statusText,
      headers,
    });
  } catch {
    options.report?.({ code: "MCP_HTTP_PROTOCOL_ERROR" });
    return jsonError(500, -32603, "Internal error", cors);
  } finally {
    await server.close().catch(() => undefined);
  }
}
