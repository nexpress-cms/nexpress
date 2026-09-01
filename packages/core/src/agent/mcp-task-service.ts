import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";

import {
  npAgentMcpTaskLimitsV1,
  npAgentMcpTaskStatusMessagesV1,
  npDigestAgentMcpTaskResultCanonical,
  npRequireAgentMcpStoredTerminalResult,
  npRequireAgentMcpTaskIdV1,
  npRequireAgentMcpTaskTtlV1,
  type NpAgentMcpStoredTerminalResultV1,
  type NpAgentMcpTaskStatusV1,
  type NpAgentMcpTaskV1,
} from "../agent-contract/index.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { getDb } from "../db/runtime.js";
import { npAgentInvocations, npAgentMcpTasks } from "../db/schema/agent.js";
import { npAuditEvents } from "../db/schema/community.js";
import { NpAgentMcpGatewayProtocolErrorV1 } from "./mcp-gateway.js";
import type {
  NpAgentCapabilityAdmissionServiceV1,
  NpAgentCapabilityAuthenticationV1,
} from "./capability-admission.js";

type Db = ReturnType<typeof getDb>;
type TaskRow = typeof npAgentMcpTasks.$inferSelect;

const TASK_PAGE_SIZE = 50;
const CANCELLED_RESULT = Object.freeze({
  schemaVersion: "np.agent-mcp-stored-task-result.v1",
  kind: "jsonrpc_error",
  error: { code: -32800, message: "Request cancelled" },
} as const satisfies NpAgentMcpStoredTerminalResultV1);
const EXPIRED_RESULT = Object.freeze({
  schemaVersion: "np.agent-mcp-stored-task-result.v1",
  kind: "jsonrpc_error",
  error: { code: -32800, message: "Task lifetime expired" },
} as const satisfies NpAgentMcpStoredTerminalResultV1);

export interface NpAgentMcpTaskServiceOptionsV1 {
  admission: NpAgentCapabilityAdmissionServiceV1;
  cursorKey: { id: string; key: Uint8Array };
  now?: () => Date;
  maximumTtlMs?: number;
  pollIntervalMs?: number;
  /**
   * Idempotently request cancellation of the underlying admitted work. This
   * hook runs outside database transactions and must be safe to retry by task id.
   */
  cancelUnderlying?: (input: {
    siteId: string;
    invocationId: string;
    runId: string | null;
    taskId: string;
  }) => boolean | Promise<boolean>;
}

function validateKey(key: { id: string; key: Uint8Array }): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(key.id) || key.key.byteLength < 32) {
    throw new Error("Agent MCP task cursor key must have a safe id and at least 256 bits.");
  }
}

function uuidV7(now: Date): string {
  const timestamp = now.getTime();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffffffff) {
    throw new Error("Agent MCP task clock is outside the UUIDv7 range.");
  }
  const random = randomBytes(10);
  const bytes = Buffer.allocUnsafe(16);
  let remaining = timestamp;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  bytes[6] = 0x70 | (random[0] & 0x0f);
  bytes[7] = random[1];
  bytes[8] = 0x80 | (random[2] & 0x3f);
  random.copy(bytes, 9, 3, 10);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function npCreateAgentMcpTaskIdV1(now = new Date()): string {
  return `npt1_${uuidV7(now)}`;
}

function taskProjection(row: TaskRow): NpAgentMcpTaskV1 {
  const status = row.status as NpAgentMcpTaskStatusV1;
  return {
    taskId: row.id,
    status,
    statusMessage: npAgentMcpTaskStatusMessagesV1[status],
    createdAt: row.createdAt.toISOString(),
    lastUpdatedAt: row.lastUpdatedAt.toISOString(),
    ttl: row.ttlMs,
    pollInterval: row.pollIntervalMs,
  };
}

function invalidParams(): never {
  throw new NpAgentMcpGatewayProtocolErrorV1(-32602, "Invalid params");
}

function retryAfterSeconds(deadline: Date | null | undefined, now: Date): number {
  if (!deadline || Number.isNaN(deadline.getTime())) return 60;
  return Math.max(1, Math.min(60, Math.ceil((deadline.getTime() - now.getTime()) / 1_000)));
}

function encodeCursor(
  key: { id: string; key: Uint8Array },
  authentication: NpAgentCapabilityAuthenticationV1,
  row: TaskRow,
): string {
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      k: key.id,
      a: authentication.authorizationContextFingerprint,
      t: row.createdAt.toISOString(),
      i: row.id,
    }),
    "utf8",
  ).toString("base64url");
  const tag = createHmac("sha256", key.key).update(body, "utf8").digest("base64url");
  return `nptc1_${body}.${tag}`;
}

function decodeCursor(
  key: { id: string; key: Uint8Array },
  authentication: NpAgentCapabilityAuthenticationV1,
  cursor: string | undefined,
): { createdAt: Date; id: string } | null {
  if (cursor === undefined) return null;
  const match = /^nptc1_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(cursor);
  if (!match) return invalidParams();
  const expected = createHmac("sha256", key.key).update(match[1], "utf8").digest();
  const actual = Buffer.from(match[2], "base64url");
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    return invalidParams();
  }
  try {
    const value = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as {
      v?: unknown;
      k?: unknown;
      a?: unknown;
      t?: unknown;
      i?: unknown;
    };
    const createdAt = typeof value.t === "string" ? new Date(value.t) : new Date(Number.NaN);
    if (
      value.v !== 1 ||
      value.k !== key.id ||
      value.a !== authentication.authorizationContextFingerprint ||
      Number.isNaN(createdAt.getTime()) ||
      typeof value.i !== "string"
    ) {
      return invalidParams();
    }
    npRequireAgentMcpTaskIdV1(value.i);
    return { createdAt, id: value.i };
  } catch {
    return invalidParams();
  }
}

async function lockCounter(tx: Db, value: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${value}, 0))`);
}

async function consumeOperation(
  tx: Db,
  authentication: NpAgentCapabilityAuthenticationV1,
  now: Date,
  operation: "create" | "get" | "list" | "result" | "cancel",
): Promise<void> {
  const fingerprint = authentication.authorizationContextFingerprint;
  await lockCounter(tx, `agent-mcp-task-operation:${fingerprint}`);
  const windowStart = new Date(now.getTime() - 60_000);
  const [countRow] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      oldestAt: sql<Date | null>`min(${npAuditEvents.createdAt})`,
    })
    .from(npAuditEvents)
    .where(
      and(
        eq(npAuditEvents.siteId, authentication.authorizationContext.siteId),
        eq(npAuditEvents.action, "agents.mcp_task.operation"),
        gt(npAuditEvents.createdAt, windowStart),
        sql`${npAuditEvents.payload}->>'authorizationContextFingerprint' = ${fingerprint}`,
      ),
    );
  if ((countRow?.count ?? 0) >= npAgentMcpTaskLimitsV1.operationsPerAuthorizationContextPerMinute) {
    const deadline = countRow?.oldestAt ? new Date(countRow.oldestAt.getTime() + 60_000) : null;
    throw new NpAgentMcpGatewayProtocolErrorV1(-32000, "Request rejected", {
      code: "RATE_LIMITED",
      retryAfterSeconds: retryAfterSeconds(deadline, now),
    });
  }
  await tx.insert(npAuditEvents).values({
    actorKind: "agent-principal",
    action: "agents.mcp_task.operation",
    targetType: "agent-mcp-task-operation",
    targetId: operation,
    siteId: authentication.authorizationContext.siteId,
    payload: {
      schemaVersion: "np.agent-mcp-task-operation-audit.v1",
      operation,
      authorizationContextFingerprint: fingerprint,
    },
    createdAt: now,
  });
}

async function expireWorkingTasks(tx: Db, now: Date, siteId?: string): Promise<void> {
  const result = npRequireAgentMcpStoredTerminalResult(EXPIRED_RESULT);
  const terminalResultDigest = await npDigestAgentMcpTaskResultCanonical(result);
  await tx
    .update(npAgentMcpTasks)
    .set({
      status: "cancelled",
      terminalResult: result,
      terminalResultDigest,
      safeStatusCode: "TASK_LIFETIME_EXPIRED",
      lastUpdatedAt: sql`${npAgentMcpTasks.expiresAt}`,
      cancelledAt: sql`${npAgentMcpTasks.expiresAt}`,
    })
    .where(
      and(
        eq(npAgentMcpTasks.status, "working"),
        sql`${npAgentMcpTasks.expiresAt} <= ${now}`,
        siteId === undefined ? undefined : eq(npAgentMcpTasks.siteId, siteId),
      ),
    );
}

function visibleWhere(authentication: NpAgentCapabilityAuthenticationV1, now: Date) {
  return and(
    eq(npAgentMcpTasks.siteId, authentication.authorizationContext.siteId),
    eq(npAgentMcpTasks.principalId, authentication.principal.id),
    eq(
      npAgentMcpTasks.authorizationContextFingerprint,
      authentication.authorizationContextFingerprint,
    ),
    gt(npAgentMcpTasks.expiresAt, now),
  );
}

export function createAgentMcpTaskServiceV1(options: NpAgentMcpTaskServiceOptionsV1) {
  validateKey(options.cursorKey);
  const nowFn = options.now ?? (() => new Date());
  const maximumTtlMs = npRequireAgentMcpTaskTtlV1(
    options.maximumTtlMs ?? npAgentMcpTaskLimitsV1.ttlMaxMs,
  );
  const pollIntervalMs = options.pollIntervalMs ?? npAgentMcpTaskLimitsV1.pollIntervalDefaultMs;
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < npAgentMcpTaskLimitsV1.pollIntervalMinMs ||
    pollIntervalMs > npAgentMcpTaskLimitsV1.pollIntervalMaxMs
  ) {
    throw new Error("Invalid Agent MCP task poll interval.");
  }

  async function live(authentication: NpAgentCapabilityAuthenticationV1) {
    return options.admission.project({ authentication });
  }

  async function consume(
    authentication: NpAgentCapabilityAuthenticationV1,
    now: Date,
    operation: "create" | "get" | "list" | "result" | "cancel",
  ): Promise<void> {
    await getDb().transaction(async (rawTx) => {
      await consumeOperation(rawTx, authentication, now, operation);
    });
  }

  async function findVisible(
    tx: Db,
    authentication: NpAgentCapabilityAuthenticationV1,
    taskId: string,
    now: Date,
    forUpdate = false,
  ): Promise<TaskRow> {
    try {
      npRequireAgentMcpTaskIdV1(taskId);
    } catch {
      return invalidParams();
    }
    let query = tx
      .select()
      .from(npAgentMcpTasks)
      .where(and(visibleWhere(authentication, now), eq(npAgentMcpTasks.id, taskId)))
      .limit(1);
    if (forUpdate) query = query.for("update") as typeof query;
    const [row] = await query;
    if (!row) return invalidParams();
    return row;
  }

  return Object.freeze({
    async create(input: {
      authentication: NpAgentCapabilityAuthenticationV1;
      invocationId: string;
      requestedTtlMs: number | null;
    }): Promise<NpAgentMcpTaskV1> {
      await live(input.authentication);
      const now = nowFn();
      await consume(input.authentication, now, "create");
      const requested =
        input.requestedTtlMs === null
          ? npAgentMcpTaskLimitsV1.ttlDefaultMs
          : npRequireAgentMcpTaskTtlV1(input.requestedTtlMs);
      const ttlMs = Math.min(requested, maximumTtlMs);
      const taskId = npCreateAgentMcpTaskIdV1(now);
      return getDb().transaction(
        async (rawTx) => {
          const tx = rawTx as Db;
          await lockCounter(tx, `agent-mcp-task-site:${input.authentication.principal.siteId}`);
          await lockCounter(
            tx,
            `agent-mcp-task-auth:${input.authentication.authorizationContextFingerprint}`,
          );
          await expireWorkingTasks(tx, now, input.authentication.principal.siteId);
          const [invocation] = await tx
            .select()
            .from(npAgentInvocations)
            .where(
              and(
                eq(npAgentInvocations.siteId, input.authentication.principal.siteId),
                eq(npAgentInvocations.id, input.invocationId),
                eq(npAgentInvocations.principalId, input.authentication.principal.id),
              ),
            )
            .for("update")
            .limit(1);
          if (
            !invocation ||
            invocation.operationKind !== "capability" ||
            !["mcp-oauth", "mcp-service"].includes(invocation.transport) ||
            invocation.mcpExecutionMode !== "task" ||
            invocation.mcpRequestedTaskTtlMs !== requested ||
            invocation.authorizationContextFingerprint !==
              input.authentication.authorizationContextFingerprint ||
            serializeAgentCanonicalJson(invocation.authorizationContextBody) !==
              serializeAgentCanonicalJson(input.authentication.authorizationContext) ||
            serializeAgentCanonicalJson(invocation.authorityRef) !==
              serializeAgentCanonicalJson(input.authentication.authorizationContext.authorityRef)
          ) {
            return invalidParams();
          }
          const [[siteCount], [authorizationCount]] = await Promise.all([
            tx
              .select({
                count: sql<number>`count(*)::int`,
                earliestExpiry: sql<Date | null>`min(${npAgentMcpTasks.expiresAt})`,
              })
              .from(npAgentMcpTasks)
              .where(
                and(
                  eq(npAgentMcpTasks.siteId, invocation.siteId),
                  eq(npAgentMcpTasks.status, "working"),
                ),
              ),
            tx
              .select({
                count: sql<number>`count(*)::int`,
                earliestExpiry: sql<Date | null>`min(${npAgentMcpTasks.expiresAt})`,
              })
              .from(npAgentMcpTasks)
              .where(
                and(
                  eq(npAgentMcpTasks.siteId, invocation.siteId),
                  eq(npAgentMcpTasks.principalId, input.authentication.principal.id),
                  eq(
                    npAgentMcpTasks.authorizationContextFingerprint,
                    invocation.authorizationContextFingerprint,
                  ),
                  eq(npAgentMcpTasks.status, "working"),
                ),
              ),
          ]);
          if (
            (siteCount?.count ?? 0) >= npAgentMcpTaskLimitsV1.activePerSite ||
            (authorizationCount?.count ?? 0) >= npAgentMcpTaskLimitsV1.activePerAuthorizationContext
          ) {
            const deadlines = [
              (siteCount?.count ?? 0) >= npAgentMcpTaskLimitsV1.activePerSite
                ? siteCount?.earliestExpiry
                : null,
              (authorizationCount?.count ?? 0) >=
              npAgentMcpTaskLimitsV1.activePerAuthorizationContext
                ? authorizationCount?.earliestExpiry
                : null,
            ].filter((value): value is Date => value instanceof Date);
            // Admission resumes only after every violated ceiling has a free slot.
            const deadline = deadlines.sort((left, right) => right.getTime() - left.getTime())[0];
            throw new NpAgentMcpGatewayProtocolErrorV1(-32000, "Request rejected", {
              code: "RATE_LIMITED",
              retryAfterSeconds: retryAfterSeconds(deadline, now),
            });
          }
          const expiresAt = new Date(now.getTime() + ttlMs);
          const [row] = await tx
            .insert(npAgentMcpTasks)
            .values({
              id: taskId,
              siteId: invocation.siteId,
              invocationId: invocation.id,
              runId: invocation.runId,
              principalId: input.authentication.principal.id,
              authorizationContextBody: input.authentication.authorizationContext,
              authorizationContextFingerprint: input.authentication.authorizationContextFingerprint,
              authorityRef: input.authentication.authorizationContext.authorityRef,
              status: "working",
              requestedTtlMs: input.requestedTtlMs,
              ttlMs,
              pollIntervalMs,
              createdAt: now,
              lastUpdatedAt: now,
              expiresAt,
            })
            .returning();
          if (!row) throw new Error("Failed to persist Agent MCP task.");
          return taskProjection(row);
        },
        { isolationLevel: "serializable" },
      );
    },

    async terminalize(input: {
      taskId: string;
      status: "completed" | "failed";
      result: NpAgentMcpStoredTerminalResultV1;
      safeStatusCode?: string | null;
    }): Promise<boolean> {
      npRequireAgentMcpTaskIdV1(input.taskId);
      const result = npRequireAgentMcpStoredTerminalResult(input.result);
      const isErrorResult =
        result.kind === "jsonrpc_error" ||
        (result.kind === "tool_result" && result.result.isError === true);
      if ((input.status === "failed") !== isErrorResult) {
        throw new Error("Agent MCP task terminal status does not match its result.");
      }
      const terminalResultDigest = await npDigestAgentMcpTaskResultCanonical(result);
      const now = nowFn();
      const rows = await getDb()
        .update(npAgentMcpTasks)
        .set({
          status: input.status,
          terminalResult: result,
          terminalResultDigest,
          safeStatusCode: input.safeStatusCode ?? null,
          lastUpdatedAt: now,
        })
        .where(
          and(
            eq(npAgentMcpTasks.id, input.taskId),
            eq(npAgentMcpTasks.status, "working"),
            gt(npAgentMcpTasks.expiresAt, now),
          ),
        )
        .returning({ id: npAgentMcpTasks.id });
      return rows.length === 1;
    },

    async reconcileExpired(now = nowFn()): Promise<number> {
      const db = getDb();
      const [before] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(npAgentMcpTasks)
        .where(
          and(eq(npAgentMcpTasks.status, "working"), sql`${npAgentMcpTasks.expiresAt} <= ${now}`),
        );
      await db.transaction((rawTx) => expireWorkingTasks(rawTx as Db, now));
      return before?.count ?? 0;
    },

    async get(authentication: NpAgentCapabilityAuthenticationV1, taskId: string) {
      await live(authentication);
      const now = nowFn();
      await consume(authentication, now, "get");
      return getDb().transaction(async (rawTx) => {
        const tx = rawTx as Db;
        const row = await findVisible(tx, authentication, taskId, now);
        return taskProjection(row);
      });
    },

    async list(authentication: NpAgentCapabilityAuthenticationV1, cursor?: string) {
      await live(authentication);
      const now = nowFn();
      await consume(authentication, now, "list");
      const decoded = decodeCursor(options.cursorKey, authentication, cursor);
      return getDb().transaction(async (rawTx) => {
        const tx = rawTx as Db;
        const rows = await tx
          .select()
          .from(npAgentMcpTasks)
          .where(
            and(
              visibleWhere(authentication, now),
              decoded
                ? or(
                    lt(npAgentMcpTasks.createdAt, decoded.createdAt),
                    and(
                      eq(npAgentMcpTasks.createdAt, decoded.createdAt),
                      lt(npAgentMcpTasks.id, decoded.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(npAgentMcpTasks.createdAt), desc(npAgentMcpTasks.id))
          .limit(TASK_PAGE_SIZE + 1);
        const page = rows.slice(0, TASK_PAGE_SIZE);
        const last = page.at(-1);
        return {
          tasks: page.map(taskProjection),
          ...(rows.length > TASK_PAGE_SIZE && last
            ? { nextCursor: encodeCursor(options.cursorKey, authentication, last) }
            : {}),
        };
      });
    },

    async result(authentication: NpAgentCapabilityAuthenticationV1, taskId: string) {
      await live(authentication);
      const now = nowFn();
      await consume(authentication, now, "result");
      return getDb().transaction(async (rawTx) => {
        const tx = rawTx as Db;
        const row = await findVisible(tx, authentication, taskId, now);
        if (row.status === "working") {
          throw new NpAgentMcpGatewayProtocolErrorV1(-32001, "Task is still working");
        }
        if (!row.terminalResult || !row.terminalResultDigest) {
          throw new NpAgentMcpGatewayProtocolErrorV1(-32603, "Internal error");
        }
        const result = npRequireAgentMcpStoredTerminalResult(row.terminalResult);
        if ((await npDigestAgentMcpTaskResultCanonical(result)) !== row.terminalResultDigest) {
          throw new NpAgentMcpGatewayProtocolErrorV1(-32603, "Internal error");
        }
        if (result.kind === "jsonrpc_error") return result;
        const existingMeta =
          typeof result.result._meta === "object" && result.result._meta !== null
            ? result.result._meta
            : {};
        return {
          kind: "tool_result" as const,
          result: {
            ...result.result,
            _meta: {
              ...existingMeta,
              "io.modelcontextprotocol/related-task": { taskId: row.id },
            },
          },
        };
      });
    },

    async cancel(authentication: NpAgentCapabilityAuthenticationV1, taskId: string) {
      await live(authentication);
      const now = nowFn();
      await consume(authentication, now, "cancel");
      const result = npRequireAgentMcpStoredTerminalResult(CANCELLED_RESULT);
      const terminalResultDigest = await npDigestAgentMcpTaskResultCanonical(result);
      const candidate = await getDb().transaction(async (rawTx) => {
        const tx = rawTx as Db;
        const row = await findVisible(tx, authentication, taskId, now);
        if (row.status !== "working") return invalidParams();
        return row;
      });
      if (
        options.cancelUnderlying &&
        !(await options.cancelUnderlying({
          siteId: candidate.siteId,
          invocationId: candidate.invocationId,
          runId: candidate.runId,
          taskId: candidate.id,
        }))
      ) {
        throw new NpAgentMcpGatewayProtocolErrorV1(-32000, "Request rejected", {
          code: "CONFLICT",
        });
      }
      return getDb().transaction(
        async (rawTx) => {
          const tx = rawTx as Db;
          const row = await findVisible(tx, authentication, taskId, now, true);
          if (row.status !== "working") return invalidParams();
          const [cancelled] = await tx
            .update(npAgentMcpTasks)
            .set({
              status: "cancelled",
              terminalResult: result,
              terminalResultDigest,
              safeStatusCode: "REQUEST_CANCELLED",
              lastUpdatedAt: now,
              cancelledAt: now,
            })
            .where(and(eq(npAgentMcpTasks.id, row.id), eq(npAgentMcpTasks.status, "working")))
            .returning();
          if (!cancelled) return invalidParams();
          return taskProjection(cancelled);
        },
        { isolationLevel: "serializable" },
      );
    },
  });
}

export type NpAgentMcpTaskServiceV1 = ReturnType<typeof createAgentMcpTaskServiceV1>;
