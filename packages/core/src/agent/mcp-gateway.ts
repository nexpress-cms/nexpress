import { npProjectAgentMcpInvocationOutputV1 } from "./changeset-execution-projection.js";
import type { NpAgentActivityServiceV1 } from "./activity-service.js";
import { canonicalBodyRecord } from "../agent-contract/canonical-body-validation.js";
import {
  npAgentInstalledCapabilityDescriptorsV1,
  npRequireAgentInstalledCapabilityInvocationRequestV1,
  type NpAgentInstalledCapabilityIdV1,
} from "../agent-contract/installed-capability-contract.js";
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  npAgentReadCapabilityDescriptorsV1,
  npRequireAgentActivityRunDetailV1,
  npRequireAgentMcpTaskTtlV1,
  type NpAgentJsonObject,
  type NpAgentJsonSchema,
  type NpAgentMcpStoredTerminalResultV1,
  type NpAgentMcpTaskV1,
  type NpAgentReadCapabilityIdV1,
  type NpAgentReadCapabilityInvocationRequestV1,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import type {
  NpAgentCapabilityAdmissionServiceV1,
  NpAgentCapabilityAuthenticationV1,
} from "./capability-admission.js";

const TOOL_TO_CAPABILITY = Object.freeze({
  inspect_site: "site.inspect",
  query_content: "content.query",
  create_changeset: "changeset.create",
  validate_changeset: "changeset.validate",
  preview_changeset: "changeset.preview",
  query_changesets: "changeset.get",
  apply_changeset: "changeset.apply",
  schedule_changeset: "changeset.schedule",
  rollback_changeset: "changeset.rollback",
} as const satisfies Record<string, NpAgentInstalledCapabilityIdV1>);

type NpAgentMcpToolNameV1 = keyof typeof TOOL_TO_CAPABILITY;

const CAPABILITY_TO_TOOL: Readonly<Record<string, NpAgentMcpToolNameV1 | undefined>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(TOOL_TO_CAPABILITY).map(([tool, capability]) => [capability, tool]),
    ) as Record<string, NpAgentMcpToolNameV1 | undefined>,
  );

const PAGE_SIZE = 50;
const JSON_MIME = "application/json" as const;

interface JsonSchemaObject extends Record<string, unknown> {
  type: "object";
}

export class NpAgentMcpGatewayProtocolErrorV1 extends Error {
  constructor(
    public readonly mcpCode: number,
    public readonly mcpMessage: string,
    public readonly mcpData?: NpAgentJsonObject,
  ) {
    super(mcpMessage);
    this.name = "NpAgentMcpGatewayProtocolErrorV1";
  }
}

export interface NpAgentMcpTaskProjectionServiceV1<TAuthentication> {
  get(authentication: TAuthentication, taskId: string): Promise<NpAgentMcpTaskV1>;
  list(
    authentication: TAuthentication,
    cursor?: string,
  ): Promise<{ tasks: NpAgentMcpTaskV1[]; nextCursor?: string }>;
  result(
    authentication: TAuthentication,
    taskId: string,
  ): Promise<
    | {
        kind: "tool_result";
        result: Extract<NpAgentMcpStoredTerminalResultV1, { kind: "tool_result" }>["result"];
      }
    | Extract<NpAgentMcpStoredTerminalResultV1, { kind: "jsonrpc_error" }>
  >;
  cancel(authentication: TAuthentication, taskId: string): Promise<NpAgentMcpTaskV1>;
}

export interface NpAgentMcpGatewayOptionsV1<
  TAuthentication extends NpAgentCapabilityAuthenticationV1,
> {
  admission: NpAgentCapabilityAdmissionServiceV1;
  cursorKey: { id: string; key: Uint8Array };
  tasks?: NpAgentMcpTaskProjectionServiceV1<TAuthentication>;
  runs?: Pick<NpAgentActivityServiceV1, "getMachineRun">;
}

function jsonSchema(value: NpAgentJsonSchema): JsonSchemaObject {
  return value;
}

function toolInputSchema(value: NpAgentJsonSchema, required = false): JsonSchemaObject {
  // Descriptor-local references remain rooted in the complete MCP input schema.
  const { $defs, ...input } = value;
  return {
    ...($defs === undefined ? {} : { $defs }),
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      input,
      idempotencyKey: required
        ? { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$", maxLength: 256 }
        : { type: "null" },
    },
    required: ["input", "idempotencyKey"],
  };
}

function safeGatewayError(error: unknown): never {
  if (error instanceof NpAgentMcpGatewayProtocolErrorV1) throw error;
  if (error instanceof NpAgentGatewayError) {
    if (error.code === "CAPABILITY_UNAVAILABLE" || error.status === 404) {
      throw new NpAgentMcpGatewayProtocolErrorV1(-32601, "Method not found");
    }
    if (error.code === "INSUFFICIENT_SCOPE") {
      throw new NpAgentMcpGatewayProtocolErrorV1(-32000, "Request rejected", {
        code: "INSUFFICIENT_SCOPE",
      });
    }
    if (error.status < 500) {
      throw new NpAgentMcpGatewayProtocolErrorV1(-32000, "Request rejected", {
        code: error.code,
      });
    }
  }
  throw new NpAgentMcpGatewayProtocolErrorV1(-32603, "Internal error");
}

function validateCursorKey(input: { id: string; key: Uint8Array }): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(input.id) || input.key.byteLength < 32) {
    throw new Error("Agent MCP cursor HMAC key must have a safe id and at least 256 bits.");
  }
}

function encodeCursor(
  key: { id: string; key: Uint8Array },
  kind: string,
  offset: number,
  authorizationFingerprint: string,
): string {
  const body = Buffer.from(
    JSON.stringify({ v: 1, k: key.id, t: kind, o: offset, a: authorizationFingerprint }),
    "utf8",
  ).toString("base64url");
  const tag = createHmac("sha256", key.key).update(body, "utf8").digest("base64url");
  return `npc1_${body}.${tag}`;
}

function decodeCursor(
  key: { id: string; key: Uint8Array },
  kind: string,
  cursor: string | undefined,
  authorizationFingerprint: string,
): number {
  if (cursor === undefined) return 0;
  const match = /^npc1_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(cursor);
  if (!match) throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
  const expected = createHmac("sha256", key.key).update(match[1], "utf8").digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(match[2], "base64url");
  } catch {
    throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
  }
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
  }
  try {
    const parsed = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as {
      v?: unknown;
      k?: unknown;
      t?: unknown;
      o?: unknown;
      a?: unknown;
    };
    if (
      parsed.v !== 1 ||
      parsed.k !== key.id ||
      parsed.t !== kind ||
      parsed.a !== authorizationFingerprint ||
      !Number.isSafeInteger(parsed.o) ||
      (parsed.o as number) < 1
    ) {
      throw new Error("invalid");
    }
    return parsed.o as number;
  } catch {
    throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
  }
}

function paginate<T>(input: {
  values: readonly T[];
  offset: number;
  kind: string;
  key: { id: string; key: Uint8Array };
  authorizationFingerprint: string;
}): { values: T[]; nextCursor?: string } {
  if (input.offset > input.values.length) {
    throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
  }
  const values = input.values.slice(input.offset, input.offset + PAGE_SIZE);
  const nextOffset = input.offset + values.length;
  return {
    values,
    ...(nextOffset < input.values.length
      ? {
          nextCursor: encodeCursor(
            input.key,
            input.kind,
            nextOffset,
            input.authorizationFingerprint,
          ),
        }
      : {}),
  };
}

function resourceUri(siteId: string, suffix: string): string {
  return `nexpress://site/${siteId}/${suffix}`;
}

export function createAgentMcpGatewayV1<TAuthentication extends NpAgentCapabilityAuthenticationV1>(
  options: NpAgentMcpGatewayOptionsV1<TAuthentication>,
) {
  validateCursorKey(options.cursorKey);

  async function invokeRead<C extends NpAgentReadCapabilityIdV1>(
    authentication: TAuthentication,
    request: Extract<NpAgentReadCapabilityInvocationRequestV1, { capabilityId: C }>,
  ) {
    return options.admission.invoke<C>({
      authentication,
      request,
    });
  }

  async function projection(authentication: TAuthentication) {
    try {
      return await options.admission.project({ authentication });
    } catch (error) {
      safeGatewayError(error);
    }
  }

  async function toolInventory(authentication: TAuthentication) {
    const projected = await projection(authentication);
    return projected.entries
      .map((entry) => {
        const descriptor = entry.definition.descriptor;
        const name = CAPABILITY_TO_TOOL[descriptor.id];
        if (
          !name ||
          (!options.runs &&
            ["changeset.apply", "changeset.schedule", "changeset.rollback"].includes(descriptor.id))
        )
          return null;
        return {
          name,
          title: descriptor.title,
          description: descriptor.description,
          inputSchema:
            name === "query_changesets"
              ? toolInputSchema({
                  $schema: "https://json-schema.org/draft/2020-12/schema",
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    selector: { enum: ["by_id", "list"] },
                    ...Object.assign(
                      {},
                      ...projected.entries
                        .filter(
                          (e) =>
                            e.definition.descriptor.id === "changeset.get" ||
                            e.definition.descriptor.id === "changeset.list",
                        )
                        .map((e) => e.definition.descriptor.inputSchema.properties),
                    ),
                  },
                  oneOf: projected.entries
                    .filter(
                      (e) =>
                        e.definition.descriptor.id === "changeset.get" ||
                        e.definition.descriptor.id === "changeset.list",
                    )
                    .map((e) => ({
                      ...e.definition.descriptor.inputSchema,
                      properties: {
                        ...(e.definition.descriptor.inputSchema.properties as object),
                        selector: {
                          const: e.definition.descriptor.id === "changeset.get" ? "by_id" : "list",
                        },
                      },
                      required: [
                        ...(e.definition.descriptor.inputSchema.required as string[]),
                        "selector",
                      ],
                    })),
                })
              : toolInputSchema(descriptor.inputSchema, descriptor.idempotency === "required"),
          outputSchema:
            name === "query_changesets"
              ? jsonSchema({
                  ...descriptor.outputSchema,
                  properties: {
                    ...(npAgentInstalledCapabilityDescriptorsV1["changeset.get"].outputSchema
                      .properties as object),
                    ...(npAgentInstalledCapabilityDescriptorsV1["changeset.list"].outputSchema
                      .properties as object),
                    schemaVersion: {
                      enum: ["np.agent-changeset-result.v1", "np.agent-changeset-list.v1"],
                    },
                  },
                  required: [],
                  oneOf: [
                    npAgentInstalledCapabilityDescriptorsV1["changeset.get"].outputSchema,
                    npAgentInstalledCapabilityDescriptorsV1["changeset.list"].outputSchema,
                  ],
                })
              : jsonSchema(descriptor.outputSchema),
          annotations: {
            title: descriptor.title,
            readOnlyHint: descriptor.effectProfiles.every((profile) => profile.kind === "read"),
            destructiveHint: descriptor.risk === "destructive",
            idempotentHint: descriptor.idempotency !== "none",
            openWorldHint: false,
          },
          execution: {
            taskSupport:
              options.tasks &&
              ["changeset.apply", "changeset.schedule", "changeset.rollback"].includes(
                descriptor.id,
              )
                ? ("optional" as const)
                : ("forbidden" as const),
          },
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function resourceInventory(authentication: TAuthentication) {
    const projected = await projection(authentication);
    const ids = new Set(projected.entries.map((entry) => entry.definition.descriptor.id));
    const siteId = projected.principal.siteId;
    return [
      ...(ids.has("site.inspect")
        ? [
            {
              uri: resourceUri(siteId, "summary"),
              name: "Site summary",
              description: "Safe site and resource-catalog summary.",
              mimeType: JSON_MIME,
            },
            {
              uri: resourceUri(siteId, "capabilities"),
              name: "Capability catalog",
              description: "Effective Agent Gateway capability projection.",
              mimeType: JSON_MIME,
            },
          ]
        : []),
      ...(ids.has("schema.get")
        ? [
            {
              uri: resourceUri(siteId, "schema"),
              name: "Schema catalog",
              description: "Bounded site schema catalog.",
              mimeType: JSON_MIME,
            },
            {
              uri: resourceUri(siteId, "schema/blocks"),
              name: "Block schema catalog",
              description: "Bounded block schema catalog.",
              mimeType: JSON_MIME,
            },
          ]
        : []),
    ].sort((left, right) => left.uri.localeCompare(right.uri));
  }

  return Object.freeze({
    async snapshot(authentication: TAuthentication) {
      const projected = await projection(authentication);
      const ids = new Set(projected.entries.map((entry) => entry.definition.descriptor.id));
      return {
        tools: (await toolInventory(authentication)).length > 0,
        resources: ids.has("site.inspect") || ids.has("schema.get") || options.runs !== undefined,
        resourceTemplates: ids.has("schema.get") || options.runs !== undefined,
        // The four v1 starter prompts depend on capabilities not installed
        // until later APs. Empty capability advertisement stays honest.
        prompts: false,
        tasks: options.tasks !== undefined,
      };
    },

    async listTools(authentication: TAuthentication, cursor?: string) {
      const values = await toolInventory(authentication);
      const offset = decodeCursor(
        options.cursorKey,
        "tools",
        cursor,
        authentication.authorizationContextFingerprint,
      );
      const page = paginate({
        values,
        offset,
        kind: "tools",
        key: options.cursorKey,
        authorizationFingerprint: authentication.authorizationContextFingerprint,
      });
      return { tools: page.values, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
    },

    async callTool(
      authentication: TAuthentication,
      input: {
        name: string;
        arguments: Record<string, unknown>;
        task: { ttlMs: number | null } | null;
      },
    ) {
      let capabilityId: NpAgentInstalledCapabilityIdV1 | undefined = Object.hasOwn(
        TOOL_TO_CAPABILITY,
        input.name,
      )
        ? TOOL_TO_CAPABILITY[input.name as NpAgentMcpToolNameV1]
        : undefined;
      if (!capabilityId) throw new NpAgentMcpGatewayProtocolErrorV1(-32601, "Method not found");
      const tools = await toolInventory(authentication);
      const tool = tools.find((candidate) => candidate.name === input.name);
      if (!tool) throw new NpAgentMcpGatewayProtocolErrorV1(-32601, "Method not found");
      if (input.task !== null) {
        if (input.task.ttlMs !== null) {
          try {
            npRequireAgentMcpTaskTtlV1(input.task.ttlMs);
          } catch {
            throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
          }
        }
        if (
          !options.tasks ||
          !["changeset.apply", "changeset.schedule", "changeset.rollback"].includes(capabilityId)
        )
          throw new NpAgentMcpGatewayProtocolErrorV1(-32601, "Method not found");
      }
      try {
        let args: unknown = input.arguments;
        if (input.name === "query_changesets") {
          const wrapper = canonicalBodyRecord(
            input.arguments,
            "agent.mcp.arguments",
            ["input", "idempotencyKey"],
            ["input", "idempotencyKey"],
            { seen: new WeakSet<object>() },
          );
          const selected = canonicalBodyRecord(
            wrapper.input,
            "agent.mcp.query",
            [
              "selector",
              "changeSetId",
              "states",
              "actorKinds",
              "createdAfter",
              "createdBefore",
              "limit",
              "cursor",
            ],
            ["selector"],
            { seen: new WeakSet<object>() },
          );
          if (selected.selector !== "by_id" && selected.selector !== "list")
            throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
          const { selector, ...selectedInput } = selected;
          capabilityId = selector === "by_id" ? "changeset.get" : "changeset.list";
          args = { ...wrapper, input: selectedInput };
        }
        const request = npRequireAgentInstalledCapabilityInvocationRequestV1({
          schemaVersion: "np.agent-invocation-request.v1",
          capabilityId,
          arguments: args,
        });
        const invoked = await options.admission.invoke({
          authentication,
          request,
          ...(input.task ? { taskRequest: { requestedTtlMs: input.task.ttlMs } } : {}),
        });
        if (input.task) {
          if (!("task" in invoked) || !invoked.task)
            throw new NpAgentMcpGatewayProtocolErrorV1(-32603, "Internal error");
          return {
            task: invoked.task,
            _meta: { "io.modelcontextprotocol/related-task": { taskId: invoked.task.taskId } },
          };
        }
        return npProjectAgentMcpInvocationOutputV1(
          authentication.principal.siteId,
          invoked.output as unknown as NpAgentJsonObject,
        );
      } catch (error) {
        safeGatewayError(error);
      }
    },

    async listResources(authentication: TAuthentication, cursor?: string) {
      const values = await resourceInventory(authentication);
      const offset = decodeCursor(
        options.cursorKey,
        "resources",
        cursor,
        authentication.authorizationContextFingerprint,
      );
      const page = paginate({
        values,
        offset,
        kind: "resources",
        key: options.cursorKey,
        authorizationFingerprint: authentication.authorizationContextFingerprint,
      });
      return {
        resources: page.values,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },

    async listResourceTemplates(authentication: TAuthentication, cursor?: string) {
      const projected = await projection(authentication);
      const hasSchema = projected.entries.some(
        (entry) => entry.definition.descriptor.id === "schema.get",
      );
      const values = hasSchema
        ? [
            {
              uriTemplate: resourceUri(projected.principal.siteId, "schema/collections/{slug}"),
              name: "Collection schema",
              description: "One authorized collection schema.",
              mimeType: JSON_MIME,
            },
          ]
        : [];
      if (options.runs)
        values.push({
          uriTemplate: resourceUri(projected.principal.siteId, "runs/{runId}"),
          name: "ChangeSet execution status",
          description: "One currently authorized Gateway run.",
          mimeType: JSON_MIME,
        });
      const offset = decodeCursor(
        options.cursorKey,
        "resource-templates",
        cursor,
        authentication.authorizationContextFingerprint,
      );
      const page = paginate({
        values,
        offset,
        kind: "resource-templates",
        key: options.cursorKey,
        authorizationFingerprint: authentication.authorizationContextFingerprint,
      });
      return {
        resourceTemplates: page.values,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },

    async readResource(authentication: TAuthentication, uri: string) {
      const projected = await projection(authentication);
      const prefix = resourceUri(projected.principal.siteId, "");
      if (!uri.startsWith(prefix)) {
        throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
      }
      const suffix = uri.slice(prefix.length);
      let body: NpAgentJsonObject;
      if (/^runs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(suffix)) {
        if (!options.runs) throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
        try {
          body = npRequireAgentActivityRunDetailV1(
            await options.runs.getMachineRun({
              authentication,
              runId: suffix.slice(5),
            }),
          ) as unknown as NpAgentJsonObject;
        } catch {
          throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
        }
      } else if (suffix === "capabilities") {
        body = {
          schemaVersion: "np.agent-mcp-capability-catalog.v1",
          registryFingerprint: projected.registryFingerprint,
          capabilities: projected.entries.map((entry) => ({
            id: entry.definition.descriptor.id,
            title: entry.definition.descriptor.title,
            description: entry.definition.descriptor.description,
            requiredScopes: entry.definition.descriptor.requiredScopes,
            risk: entry.definition.descriptor.risk,
            approval: entry.definition.descriptor.approval,
            execution: entry.definition.descriptor.execution,
            idempotency: entry.definition.descriptor.idempotency,
            fingerprint: entry.capabilityFingerprint,
          })),
        };
      } else {
        try {
          if (suffix === "summary") {
            body = (
              await invokeRead(authentication, {
                schemaVersion: "np.agent-invocation-request.v1",
                capabilityId: "site.inspect",
                arguments: { input: {}, idempotencyKey: null },
              })
            ).output;
          } else if (suffix === "schema" || suffix === "schema/blocks") {
            body = (
              await invokeRead(authentication, {
                schemaVersion: "np.agent-invocation-request.v1",
                capabilityId: "schema.get",
                arguments: {
                  input: { selector: suffix === "schema" ? "catalog" : "blocks" },
                  idempotencyKey: null,
                },
              })
            ).output;
          } else if (/^schema\/collections\/[a-z][a-z0-9_-]{0,127}$/u.test(suffix)) {
            body = (
              await invokeRead(authentication, {
                schemaVersion: "np.agent-invocation-request.v1",
                capabilityId: "schema.get",
                arguments: {
                  input: { selector: "collection", slug: suffix.slice(19) },
                  idempotencyKey: null,
                },
              })
            ).output;
          } else {
            throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
          }
        } catch (error) {
          safeGatewayError(error);
        }
      }
      return { contents: [{ uri, mimeType: JSON_MIME, text: serializeAgentCanonicalJson(body) }] };
    },

    listPrompts() {
      return Promise.resolve({ prompts: [] });
    },
    getPrompt() {
      throw new NpAgentMcpGatewayProtocolErrorV1(-32601, "Method not found");
    },
    async getTask(authentication: TAuthentication, taskId: string) {
      if (!options.tasks) throw new NpAgentMcpGatewayProtocolErrorV1(-32601, "Method not found");
      return options.tasks.get(authentication, taskId);
    },
    async listTasks(authentication: TAuthentication, cursor?: string) {
      if (!options.tasks) throw new NpAgentMcpGatewayProtocolErrorV1(-32601, "Method not found");
      return options.tasks.list(authentication, cursor);
    },
    async getTaskResult(authentication: TAuthentication, taskId: string) {
      if (!options.tasks) throw new NpAgentMcpGatewayProtocolErrorV1(-32601, "Method not found");
      return options.tasks.result(authentication, taskId);
    },
    async cancelTask(authentication: TAuthentication, taskId: string) {
      if (!options.tasks) throw new NpAgentMcpGatewayProtocolErrorV1(-32601, "Method not found");
      return options.tasks.cancel(authentication, taskId);
    },
  });
}

export type NpAgentMcpGatewayV1 = ReturnType<typeof createAgentMcpGatewayV1>;

export const npAgentMcpReadToolNamesV1 = Object.freeze(
  Object.keys(TOOL_TO_CAPABILITY).sort() as NpAgentMcpToolNameV1[],
);

export const npAgentMcpReadCapabilityDescriptorsV1 = npAgentReadCapabilityDescriptorsV1;
