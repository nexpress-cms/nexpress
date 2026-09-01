import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createSite,
  deleteSite,
  npAgentInvocations,
  npAgentMcpTasks,
  npAgentPrincipals,
  npAuditEvents,
} from "@nexpress/core";

// eslint-disable-next-line import-x/no-relative-packages
import {
  createAgentMcpTaskServiceV1,
  type NpAgentCapabilityAdmissionServiceV1,
  type NpAgentCapabilityAuthenticationV1,
} from "../../../packages/core/src/agent/index.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./harness.js";

const siteId = "agent-mcp-task";
const principalId = "01990000-0000-7000-8000-000000000001";
const authorityRef = {
  kind: "service-family",
  principalId,
  rotationFamilyId: "01990000-0000-7000-8000-000000000002",
  familyAuthorityVersion: 1,
  principalTokenVersion: 1,
  exposureMode: "read",
  audience: "https://cms.example/api/mcp",
} as const;
const authorizationContext = {
  schemaVersion: "np.agent-authorization-context.v1",
  siteId,
  actor: { kind: "principal", principalId, actorFingerprint: "cj1:sha256:actor" },
  transport: "mcp-service",
  gatewayExposure: "read",
  authorityRef,
} as const;

function authentication(
  fingerprint = "cj1:sha256:mcp-task-authorization",
): NpAgentCapabilityAuthenticationV1 {
  return {
    principal: { id: principalId, siteId },
    scopes: ["site:read"],
    authorizationContext,
    authorizationContextFingerprint: fingerprint,
  } as unknown as NpAgentCapabilityAuthenticationV1;
}

async function seedInvocation(requestedTtlMs: number | null): Promise<string> {
  const db = await getTestDb();
  const invocationId = randomUUID();
  const [audit] = await db
    .insert(npAuditEvents)
    .values({
      actorKind: "agent-principal",
      action: "agents.capability.invoke",
      targetType: "agent-capability",
      targetId: "site.inspect",
      siteId,
      payload: {},
    })
    .returning({ id: npAuditEvents.id });
  await db.insert(npAgentInvocations).values({
    id: invocationId,
    siteId,
    actorKind: "principal",
    principalId,
    actorFingerprint: authorizationContext.actor.actorFingerprint,
    authorizationContextBody: authorizationContext,
    authorizationContextFingerprint: authentication().authorizationContextFingerprint,
    authorityRef,
    operationKind: "capability",
    operationId: "site.inspect",
    contractVersion: 1,
    contractFingerprint: "cj1:sha256:site-inspect",
    capabilityDefinitionBody: {
      schemaVersion: "np.agent-capability-registry.v1",
      projection: "definition",
      capabilities: [],
    },
    effectProfileId: "domain.read",
    effectContractVersion: 1,
    transport: "mcp-service",
    mcpExecutionMode: "task",
    mcpRequestedTaskTtlMs: requestedTtlMs ?? 3_600_000,
    requestBody: {
      schemaVersion: "np.agent-idempotency-request.v1",
      siteId,
      actorKind: "principal",
      actorFingerprint: authorizationContext.actor.actorFingerprint,
      authorizationContextFingerprint: authentication().authorizationContextFingerprint,
      operationKind: "capability",
      operationId: "site.inspect",
      contractVersion: 1,
      contractFingerprint: "cj1:sha256:site-inspect",
      effectProfile: { id: "domain.read", contractVersion: 1 },
      input: {},
    },
    requestHash: "cj1:sha256:request",
    state: "accepted",
    auditEventId: audit!.id,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1_000),
  });
  return invocationId;
}

describe.skipIf(skipIfNoTestDb())("Agent MCP task persistence", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  afterEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("binds create/list/result/cancel to one live authorization context", async () => {
    await createSite({ id: siteId, name: "Agent MCP task" });
    const db = await getTestDb();
    await db.insert(npAgentPrincipals).values({
      id: principalId,
      siteId,
      kind: "external",
      name: "MCP task principal",
      status: "active",
      scopes: ["site:read"],
      authorityKind: "deployment",
      authorityPolicyId: "deployment-default",
      authorityFingerprint: "cj1:sha256:deployment-authority",
    });
    const project = vi.fn(() => Promise.resolve({ entries: [] }));
    const admission = { project } as unknown as NpAgentCapabilityAdmissionServiceV1;
    const taskService = createAgentMcpTaskServiceV1({
      admission,
      cursorKey: { id: "mcp-task-test", key: new Uint8Array(32).fill(31) },
    });
    const auth = authentication();

    const invocationId = await seedInvocation(60_000);
    const created = await taskService.create({
      authentication: auth,
      invocationId,
      requestedTtlMs: 60_000,
    });
    expect(created).toMatchObject({
      taskId: expect.stringMatching(/^npt1_.*-7/u),
      status: "working",
      statusMessage: "Operation in progress",
      ttl: 60_000,
      pollInterval: 2_000,
    });
    expect(await taskService.get(auth, created.taskId)).toEqual(created);
    expect((await taskService.list(auth)).tasks).toEqual([created]);
    await expect(deleteSite(siteId, { cascade: true })).rejects.toThrow(
      "Agent site deletion requires every MCP task to be terminal.",
    );
    await expect(taskService.result(auth, created.taskId)).rejects.toMatchObject({
      mcpCode: -32001,
    });
    await expect(
      taskService.get(authentication("cj1:sha256:foreign"), created.taskId),
    ).rejects.toMatchObject({
      mcpCode: -32602,
    });

    expect(
      await taskService.terminalize({
        taskId: created.taskId,
        status: "completed",
        result: {
          schemaVersion: "np.agent-mcp-stored-task-result.v1",
          kind: "tool_result",
          result: { content: [{ type: "text", text: "done" }] },
        },
      }),
    ).toBe(true);
    expect(await taskService.get(auth, created.taskId)).toMatchObject({
      status: "completed",
      statusMessage: "Operation completed",
    });
    expect(await taskService.result(auth, created.taskId)).toEqual({
      kind: "tool_result",
      result: {
        content: [{ type: "text", text: "done" }],
        _meta: { "io.modelcontextprotocol/related-task": { taskId: created.taskId } },
      },
    });
    expect(
      await taskService.terminalize({
        taskId: created.taskId,
        status: "failed",
        result: {
          schemaVersion: "np.agent-mcp-stored-task-result.v1",
          kind: "jsonrpc_error",
          error: { code: -32603, message: "Internal error" },
        },
      }),
    ).toBe(false);

    const cancelInvocationId = await seedInvocation(null);
    const cancellable = await taskService.create({
      authentication: auth,
      invocationId: cancelInvocationId,
      requestedTtlMs: null,
    });
    expect(await taskService.cancel(auth, cancellable.taskId)).toMatchObject({
      status: "cancelled",
      statusMessage: "Operation cancelled",
    });
    await expect(taskService.cancel(auth, cancellable.taskId)).rejects.toMatchObject({
      mcpCode: -32602,
    });

    const operationAudits = await db
      .select({ payload: npAuditEvents.payload })
      .from(npAuditEvents)
      .where(eq(npAuditEvents.action, "agents.mcp_task.operation"));
    expect(
      operationAudits.filter(
        ({ payload }) =>
          payload.authorizationContextFingerprint === auth.authorizationContextFingerprint,
      ),
    ).toHaveLength(9);
    expect(
      operationAudits.filter(
        ({ payload }) => payload.authorizationContextFingerprint === "cj1:sha256:foreign",
      ),
    ).toHaveLength(1);

    const rows = await db.select().from(npAgentMcpTasks).where(eq(npAgentMcpTasks.siteId, siteId));
    expect(rows.map((row) => row.status).sort()).toEqual(["cancelled", "completed"]);
    expect(project).toHaveBeenCalled();
  });
});
