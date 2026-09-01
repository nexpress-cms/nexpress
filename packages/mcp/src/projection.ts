import {
  CallToolRequestSchema,
  CallToolResultSchema,
  CancelTaskRequestSchema,
  CancelTaskResultSchema,
  CreateTaskResultSchema,
  ErrorCode,
  GetPromptRequestSchema,
  GetPromptResultSchema,
  GetTaskPayloadRequestSchema,
  GetTaskRequestSchema,
  GetTaskResultSchema,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ListTasksRequestSchema,
  ListTasksResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  McpError,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface NpAgentMcpProjectionSnapshotV1 {
  tools: boolean;
  resources: boolean;
  resourceTemplates: boolean;
  prompts: boolean;
  tasks: boolean;
}

export interface NpAgentMcpTaskResultV1 {
  kind: "tool_result" | "jsonrpc_error";
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Transport-neutral host boundary. The MCP package never receives a database,
 * policy object, cookie, signing key, or reusable credential through it.
 */
export interface NpAgentMcpProjectionProviderV1<TAuthentication> {
  snapshot(
    authentication: TAuthentication,
  ): NpAgentMcpProjectionSnapshotV1 | Promise<NpAgentMcpProjectionSnapshotV1>;
  listTools(authentication: TAuthentication, cursor?: string): Promise<unknown>;
  callTool(
    authentication: TAuthentication,
    input: {
      name: string;
      arguments: Record<string, unknown>;
      task: { ttlMs: number | null } | null;
    },
  ): Promise<unknown>;
  listResources(authentication: TAuthentication, cursor?: string): Promise<unknown>;
  listResourceTemplates(authentication: TAuthentication, cursor?: string): Promise<unknown>;
  readResource(authentication: TAuthentication, uri: string): Promise<unknown>;
  listPrompts(authentication: TAuthentication, cursor?: string): Promise<unknown>;
  getPrompt(
    authentication: TAuthentication,
    input: { name: string; arguments: Record<string, string> },
  ): Promise<unknown>;
  getTask(authentication: TAuthentication, taskId: string): Promise<unknown>;
  listTasks(authentication: TAuthentication, cursor?: string): Promise<unknown>;
  getTaskResult(authentication: TAuthentication, taskId: string): Promise<NpAgentMcpTaskResultV1>;
  cancelTask(authentication: TAuthentication, taskId: string): Promise<unknown>;
}

interface NpAgentMcpSafeErrorShapeV1 {
  mcpCode?: unknown;
  mcpMessage?: unknown;
  mcpData?: unknown;
}

function safeError(error: unknown): McpError {
  if (error instanceof McpError) return error;
  if (typeof error === "object" && error !== null) {
    const candidate = error as NpAgentMcpSafeErrorShapeV1;
    if (
      typeof candidate.mcpCode === "number" &&
      Number.isSafeInteger(candidate.mcpCode) &&
      typeof candidate.mcpMessage === "string" &&
      candidate.mcpMessage.length > 0 &&
      candidate.mcpMessage.length <= 1_024
    ) {
      return new McpError(candidate.mcpCode, candidate.mcpMessage, candidate.mcpData);
    }
  }
  return new McpError(ErrorCode.InternalError, "Internal error");
}

async function guarded<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw safeError(error);
  }
}

/** Install exactly the capabilities present in the authenticated snapshot. */
export async function configureAgentMcpProjectionV1<TAuthentication>(input: {
  server: Server;
  authentication: TAuthentication;
  provider: NpAgentMcpProjectionProviderV1<TAuthentication>;
}): Promise<void> {
  const snapshot = await guarded(() => input.provider.snapshot(input.authentication));
  const capabilities = {
    ...(snapshot.tools ? { tools: {} } : {}),
    ...(snapshot.resources || snapshot.resourceTemplates ? { resources: {} } : {}),
    ...(snapshot.prompts ? { prompts: {} } : {}),
    ...(snapshot.tasks
      ? { tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } } }
      : {}),
  };
  input.server.registerCapabilities(capabilities);

  if (snapshot.tools) {
    input.server.setRequestHandler(ListToolsRequestSchema, (request) =>
      guarded(async () =>
        ListToolsResultSchema.parse(
          await input.provider.listTools(input.authentication, request.params?.cursor),
        ),
      ),
    );
    input.server.setRequestHandler(CallToolRequestSchema, (request) =>
      guarded(async () => {
        const result = await input.provider.callTool(input.authentication, {
          name: request.params.name,
          arguments: request.params.arguments ?? {},
          task:
            snapshot.tasks && request.params.task
              ? { ttlMs: request.params.task.ttl ?? null }
              : null,
        });
        const task = CreateTaskResultSchema.safeParse(result);
        if (task.success) {
          if (!snapshot.tasks || request.params.task === undefined) {
            throw new McpError(ErrorCode.InternalError, "Internal error");
          }
          return task.data;
        }
        return CallToolResultSchema.parse(result);
      }),
    );
  }
  if (snapshot.resources) {
    input.server.setRequestHandler(ListResourcesRequestSchema, (request) =>
      guarded(async () =>
        ListResourcesResultSchema.parse(
          await input.provider.listResources(input.authentication, request.params?.cursor),
        ),
      ),
    );
    input.server.setRequestHandler(ReadResourceRequestSchema, (request) =>
      guarded(async () =>
        ReadResourceResultSchema.parse(
          await input.provider.readResource(input.authentication, request.params.uri),
        ),
      ),
    );
  }
  if (snapshot.resourceTemplates) {
    input.server.setRequestHandler(ListResourceTemplatesRequestSchema, (request) =>
      guarded(async () =>
        ListResourceTemplatesResultSchema.parse(
          await input.provider.listResourceTemplates(input.authentication, request.params?.cursor),
        ),
      ),
    );
  }
  if (snapshot.prompts) {
    input.server.setRequestHandler(ListPromptsRequestSchema, (request) =>
      guarded(async () =>
        ListPromptsResultSchema.parse(
          await input.provider.listPrompts(input.authentication, request.params?.cursor),
        ),
      ),
    );
    input.server.setRequestHandler(GetPromptRequestSchema, (request) =>
      guarded(async () =>
        GetPromptResultSchema.parse(
          await input.provider.getPrompt(input.authentication, {
            name: request.params.name,
            arguments: request.params.arguments ?? {},
          }),
        ),
      ),
    );
  }
  if (snapshot.tasks) {
    input.server.setRequestHandler(GetTaskRequestSchema, (request) =>
      guarded(async () =>
        GetTaskResultSchema.parse(
          await input.provider.getTask(input.authentication, request.params.taskId),
        ),
      ),
    );
    input.server.setRequestHandler(ListTasksRequestSchema, (request) =>
      guarded(async () =>
        ListTasksResultSchema.parse(
          await input.provider.listTasks(input.authentication, request.params?.cursor),
        ),
      ),
    );
    input.server.setRequestHandler(CancelTaskRequestSchema, (request) =>
      guarded(async () =>
        CancelTaskResultSchema.parse(
          await input.provider.cancelTask(input.authentication, request.params.taskId),
        ),
      ),
    );
    input.server.setRequestHandler(GetTaskPayloadRequestSchema, (request) =>
      guarded(async () => {
        const stored = await input.provider.getTaskResult(
          input.authentication,
          request.params.taskId,
        );
        if (stored.kind === "jsonrpc_error") {
          if (!stored.error) throw new McpError(ErrorCode.InternalError, "Internal error");
          throw new McpError(stored.error.code, stored.error.message, stored.error.data);
        }
        if (!stored.result) throw new McpError(ErrorCode.InternalError, "Internal error");
        return CallToolResultSchema.parse(stored.result);
      }),
    );
  }
}
