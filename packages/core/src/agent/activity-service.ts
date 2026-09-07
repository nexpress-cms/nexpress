import {
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { and, eq, desc, gt, lt, lte, gte, or, type SQL } from "drizzle-orm";
import { npUsers } from "../db/schema/system.js";
import { npResolveLiveAgentStaffAuthorizationV1 } from "./admin-admission.js";
import { npRequireAgentRunLimitsCanonical } from "../agent-contract/canonical-bodies.js";
import { withCurrentSite } from "../sites/context.js";
import { npRequireAgentContractResult } from "../agent-contract/contract.js";
import { getDb } from "../db/runtime.js";
import {
  npAgentPrincipals,
  npAgentRuns,
  npAgentActions,
  npAgentInvocations,
} from "../db/schema/agent.js";
import { getCollectionConfig, findDocuments } from "../collections/index.js";
import { npAgentScopeStaffCapability, type NpAgentScope } from "../agent-contract/types.js";
import {
  npAnalyzeAgentActivityPrincipalsPageV1,
  npAnalyzeAgentActivityRunsPageV1,
  npAnalyzeAgentActivityActionsPageV1,
  npRequireAgentActivityQueryV1,
  npRequireAgentActivityRunDetailV1,
  npRequireAgentActivityActionDetailV1,
  type NpAgentActivityKindV1,
  type NpAgentActivityRunDetailV1,
  type NpAgentActivityActionDetailV1,
} from "../agent-contract/activity-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npResolveAgentStaffSessionAuthorizationV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
} from "./admin-admission.js";
import {
  npProjectAgentPrincipalV1,
  type NpAgentAuthenticatedServicePrincipalV1,
} from "./gateway-service.js";
import type { NpAgentCapabilityAdmissionServiceV1 } from "./capability-admission.js";
import type { NpAuthUser } from "../config/types.js";
import type { NpCapability } from "../auth/capabilities.js";

type Action = typeof npAgentActions.$inferSelect;
type Run = typeof npAgentRuns.$inferSelect;
type Invocation = Pick<
  typeof npAgentInvocations.$inferSelect,
  "id" | "principalId" | "expiresAt" | "auditEventId" | "operationId" | "authorizationContextBody"
>;
interface Staff {
  siteId: string;
  actor: NpAgentAdminActorV1;
}
interface Visibility {
  user: NpAuthUser;
  capabilities: readonly NpCapability[];
}
export interface NpAgentActivityServiceOptionsV1 {
  cursorHmacKey: Uint8Array;
  admission?: NpAgentCapabilityAdmissionServiceV1;
  now?: () => Date;
}
const missing = () =>
  new NpAgentGatewayError("ACTIVITY_NOT_FOUND", 404, "Activity is unavailable.");
const invalidCursor = () =>
  new NpAgentGatewayError("ACTIVITY_CURSOR_INVALID", 400, "Activity cursor is invalid.");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const iso = (v: Date | null) => v?.toISOString() ?? null;

/** Explicit host installation; no runtime, transport or scheduler is created here. */
export function createAgentActivityServiceV1(options: NpAgentActivityServiceOptionsV1) {
  if (!(options.cursorHmacKey instanceof Uint8Array) || options.cursorHmacKey.byteLength < 32)
    throw new Error("Activity cursor key requires at least 32 bytes.");
  const key = Buffer.from(options.cursorHmacKey);
  const cursorEncryptionKey = createHmac("sha256", key)
    .update("np.agent-activity.cursor.encryption.v1")
    .digest();
  const now = options.now ?? (() => new Date());
  const mac = (value: string) =>
    createHmac("sha256", key)
      .update("np.agent-activity.cursor.v1\0")
      .update(value)
      .digest("base64url");
  async function staff(input: Staff) {
    const auth = await npResolveAgentStaffSessionAuthorizationV1(
      getDb(),
      input.siteId,
      input.actor,
      now(),
    );
    if (!auth.authority.capabilities.includes("admin.manage"))
      throw new NpAgentGatewayError("ACTIVITY_FORBIDDEN", 403, "Activity permission is required.");
    return {
      auth,
      visibility: {
        user: {
          ...input.actor.user,
          role:
            auth.authority.kind === "super-admin"
              ? "admin"
              : (auth.authority.role as NpAuthUser["role"]),
        },
        capabilities: auth.authority.capabilities,
      } satisfies Visibility,
    };
  }
  async function assertSameStaff(
    input: Staff,
    previous: Awaited<ReturnType<typeof staff>>["auth"],
  ) {
    const current = await staff(input);
    if (serializeAgentCanonicalJson(current.auth) !== serializeAgentCanonicalJson(previous))
      throw new NpAgentGatewayError("ACTIVITY_FORBIDDEN", 403, "Activity permission is required.");
  }
  async function invocation(siteId: string, id: string | null) {
    if (!id) return null;
    const [row] = await getDb()
      .select({
        id: npAgentInvocations.id,
        principalId: npAgentInvocations.principalId,
        expiresAt: npAgentInvocations.expiresAt,
        auditEventId: npAgentInvocations.auditEventId,
        operationId: npAgentInvocations.operationId,
        authorizationContextBody: npAgentInvocations.authorizationContextBody,
      })
      .from(npAgentInvocations)
      .where(and(eq(npAgentInvocations.siteId, siteId), eq(npAgentInvocations.id, id)))
      .limit(1);
    return row ?? null;
  }
  async function collectionVisible(collection: string, visibility: Visibility) {
    try {
      const config = getCollectionConfig(collection);
      return !config.access?.read || Boolean(await config.access.read({ user: visibility.user }));
    } catch {
      return false;
    }
  }
  async function actionVisible(row: Action, visibility: Visibility) {
    if (
      !row.requiredScopes.every((scope) =>
        visibility.capabilities.includes(npAgentScopeStaffCapability[scope]),
      )
    )
      return false;
    // Read capabilities historically have no targetRefs. Their exact selector still gates visibility.
    if (
      row.capabilityId === "content.query" ||
      (row.capabilityId === "schema.get" && row.inputCanonical.selector === "collection")
    ) {
      const collection =
        row.capabilityId === "schema.get" ? row.inputCanonical.slug : row.inputCanonical.collection;
      if (typeof collection !== "string" || !(await collectionVisible(collection, visibility)))
        return false;
    }
    for (const target of row.targetRefs) {
      if (target.kind !== "document") return false; // Future target families require their existing domain visibility facade.
      if (!(await collectionVisible(target.collection, visibility))) return false;
      try {
        const result = await withCurrentSite(row.siteId, () =>
          findDocuments(
            target.collection,
            { limit: 1, where: { id: target.documentId, siteId: row.siteId } },
            visibility.user,
          ),
        );
        if (!result.docs.length) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  async function actionOwner(row: Action, inv: Invocation | null) {
    if (!row.runId) return inv?.principalId ?? null;
    const [run] = await getDb()
      .select({ principalId: npAgentRuns.principalId })
      .from(npAgentRuns)
      .where(and(eq(npAgentRuns.siteId, row.siteId), eq(npAgentRuns.id, row.runId)))
      .limit(1);
    if (!run || (inv?.principalId && inv.principalId !== run.principalId)) return null;
    return run.principalId;
  }
  function actionDetail(
    row: Action,
    inv: Invocation | null,
    principalId: string,
  ): NpAgentActivityActionDetailV1 {
    return npRequireAgentActivityActionDetailV1({
      schemaVersion: "np.agent-activity-action.v1",
      principalId,
      invocationId: row.invocationId,
      evidence: inv && inv.expiresAt <= now() ? "expired" : "redacted",
      inputHash: row.inputHash,
      outputHash: row.outputHash,
      auditEventId: row.auditEventId,
      action: {
        schemaVersion: "np.agent-action-projection.v1",
        id: row.id,
        siteId: row.siteId,
        runId: row.runId,
        sequence: row.sequence,
        capabilityId: row.capabilityId,
        capabilityContractVersion: row.capabilityContractVersion,
        capabilityFingerprint: row.capabilityFingerprint,
        effectProfile: { id: row.effectProfileId, contractVersion: row.effectContractVersion },
        risk: row.risk,
        state: row.state,
        inputRedacted: {},
        outputRedacted: ["succeeded", "compensated"].includes(row.state) ? {} : null,
        requiredScopes: row.requiredScopes,
        targetRefs: row.targetRefs,
        proposalHash: row.inputHash,
        approvalId: row.approvalId,
        verificationState: row.verificationState,
        errorCode: row.errorCode === null ? null : "ACTION_FAILED",
        createdAt: iso(row.createdAt),
        startedAt: iso(row.startedAt),
        finishedAt: iso(row.finishedAt),
      },
    });
  }
  async function* runActions(row: Run) {
    let after: string | null = null;
    const maximum = npRequireAgentRunLimitsCanonical(row.runLimits).maxCapabilityCalls;
    let scanned = 0;
    for (;;) {
      const rows = await getDb()
        .select()
        .from(npAgentActions)
        .where(
          and(
            eq(npAgentActions.siteId, row.siteId),
            or(
              eq(npAgentActions.runId, row.id),
              row.invocationId ? eq(npAgentActions.invocationId, row.invocationId) : undefined,
            ),
            after ? gt(npAgentActions.id, after) : undefined,
          ),
        )
        .orderBy(npAgentActions.id)
        .limit(100);
      for (const action of rows) {
        if (++scanned > maximum) throw missing();
        yield action;
      }
      if (rows.length < 100) return;
      after = rows[rows.length - 1].id;
    }
  }
  async function runVisible(
    row: Run,
    visibility: Visibility,
    allowedScopes?: readonly NpAgentScope[],
  ) {
    for await (const action of runActions(row)) {
      if (allowedScopes && action.requiredScopes.some((scope) => !allowedScopes.includes(scope)))
        return false;
      if (!(await actionVisible(action, visibility))) return false;
    }
    return true;
  }
  function runDetail(row: Run, inv: Invocation | null): NpAgentActivityRunDetailV1 {
    return npRequireAgentActivityRunDetailV1({
      schemaVersion: "np.agent-activity-run.v1",
      invocationId: row.invocationId,
      evidence: inv && inv.expiresAt <= now() ? "expired" : "redacted",
      auditEventIds: inv ? [inv.auditEventId] : [],
      run: {
        schemaVersion: "np.agent-run.v1",
        id: row.id,
        siteId: row.siteId,
        origin: row.origin,
        agent:
          row.agentId && row.agentVersionId
            ? { id: row.agentId, versionId: row.agentVersionId }
            : null,
        principalId: row.principalId,
        rootRunId: row.rootRunId,
        parentRunId: row.parentRunId,
        causalDepth: row.causalDepth,
        state: row.state,
        goal: "[redacted]",
        runLimits: row.runLimits,
        usage:
          row.origin === "gateway"
            ? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costMicros: 0, ...row.usage }
            : row.usage,
        attempt: row.attempt,
        errorCode: row.errorCode === null ? null : "RUN_FAILED",
        errorMessage: row.errorCode === null ? null : "Run did not complete successfully.",
        queuedAt: iso(row.queuedAt),
        deadlineAt: iso(row.deadlineAt),
        startedAt: iso(row.startedAt),
        finishedAt: iso(row.finishedAt),
      },
    });
  }
  async function getPrincipal(input: Staff & { id: string }) {
    const { auth } = await staff(input);
    if (!uuid.test(input.id)) throw missing();
    const [row] = await getDb()
      .select()
      .from(npAgentPrincipals)
      .where(and(eq(npAgentPrincipals.siteId, input.siteId), eq(npAgentPrincipals.id, input.id)))
      .limit(1);
    if (!row) throw missing();
    await assertSameStaff(input, auth);
    try {
      return npProjectAgentPrincipalV1(row);
    } catch {
      throw missing();
    }
  }
  async function getAction(input: Staff & { id: string }) {
    const { auth, visibility } = await staff(input);
    if (!uuid.test(input.id)) throw missing();
    const [row] = await getDb()
      .select()
      .from(npAgentActions)
      .where(and(eq(npAgentActions.siteId, input.siteId), eq(npAgentActions.id, input.id)))
      .limit(1);
    if (!row || !(await actionVisible(row, visibility))) throw missing();
    const inv = await invocation(input.siteId, row.invocationId);
    const principalId = await actionOwner(row, inv);
    if (!principalId) throw missing();
    const detail = actionDetail(row, inv, principalId);
    await assertSameStaff(input, auth);
    return detail;
  }
  async function getRun(input: Staff & { id: string }) {
    const { auth, visibility } = await staff(input);
    if (!uuid.test(input.id)) throw missing();
    const [row] = await getDb()
      .select()
      .from(npAgentRuns)
      .where(and(eq(npAgentRuns.siteId, input.siteId), eq(npAgentRuns.id, input.id)))
      .limit(1);
    if (!row || !(await runVisible(row, visibility))) throw missing();
    const detail = runDetail(row, await invocation(input.siteId, row.invocationId));
    await assertSameStaff(input, auth);
    return detail;
  }
  type Position = { id: string; time: string };
  async function list(kind: NpAgentActivityKindV1, input: Staff & { query?: unknown }) {
    const { auth, visibility } = await staff(input);
    const query = npRequireAgentActivityQueryV1(kind, input.query ?? {});
    const { cursor, ...filters } = query;
    const binding = mac(
      serializeAgentCanonicalJson({
        siteId: input.siteId,
        sessionId: input.actor.sessionId,
        auth,
        kind,
        filters,
      }),
    );
    let position: Position | null = null;
    if (cursor) {
      try {
        const [body, signature, ...extra] = cursor.split(".");
        if (
          !body ||
          !signature ||
          extra.length ||
          signature.length !== 43 ||
          !timingSafeEqual(Buffer.from(signature), Buffer.from(mac(body)))
        )
          throw invalidCursor();
        const sealed = Buffer.from(body, "base64url");
        if (sealed.length < 29) throw invalidCursor();
        const decipher = createDecipheriv(
          "aes-256-gcm",
          cursorEncryptionKey,
          sealed.subarray(0, 12),
        );
        decipher.setAuthTag(sealed.subarray(12, 28));
        const plaintext = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
        const data = JSON.parse(plaintext.toString("utf8")) as {
          binding: string;
          expires: number;
          position: Position;
        };
        if (
          data.binding !== binding ||
          !Number.isFinite(data.expires) ||
          data.expires <= now().getTime() ||
          !uuid.test(data.position.id) ||
          new Date(data.position.time).toISOString() !== data.position.time
        )
          throw invalidCursor();
        position = data.position;
      } catch {
        throw invalidCursor();
      }
    }
    const limit = query.limit ?? 50;
    const items: unknown[] = [];
    let more = false;
    const table =
      kind === "principals" ? npAgentPrincipals : kind === "runs" ? npAgentRuns : npAgentActions;
    const time =
      kind === "runs"
        ? npAgentRuns.queuedAt
        : kind === "principals"
          ? npAgentPrincipals.createdAt
          : npAgentActions.createdAt;
    // At most 500 candidate rows per request. Cursor advances across invisible rows, preventing starvation.
    for (let scanned = 0; scanned < 500;) {
      const where: SQL[] = [eq(table.siteId, input.siteId)];
      if (position)
        where.push(
          or(
            lt(time, new Date(position.time)),
            and(eq(time, new Date(position.time)), lt(table.id, position.id)),
          )!,
        );
      if (query.from) where.push(gte(time, new Date(query.from)));
      if (query.to) where.push(lte(time, new Date(query.to)));
      if (query.state)
        where.push(
          eq(
            kind === "principals"
              ? npAgentPrincipals.status
              : kind === "runs"
                ? npAgentRuns.state
                : npAgentActions.state,
            query.state,
          ),
        );
      if (kind === "principals" && query.kind) where.push(eq(npAgentPrincipals.kind, query.kind));
      if (kind === "runs") {
        if (query.origin) where.push(eq(npAgentRuns.origin, query.origin));
        if (query.principalId) where.push(eq(npAgentRuns.principalId, query.principalId));
      }
      if (kind === "actions") {
        if (query.runId) where.push(eq(npAgentActions.runId, query.runId));
        if (query.capabilityId) where.push(eq(npAgentActions.capabilityId, query.capabilityId));
      }
      const rows = await getDb()
        .select()
        .from(table)
        .where(and(...where))
        .orderBy(desc(time), desc(table.id))
        .limit(100);
      more = rows.length === 100;
      for (const raw of rows) {
        scanned++;
        position = {
          id: raw.id,
          time: (kind === "runs" ? (raw as Run).queuedAt : (raw as Action).createdAt).toISOString(),
        };
        if (kind === "principals") {
          try {
            items.push(npProjectAgentPrincipalV1(raw as typeof npAgentPrincipals.$inferSelect));
          } catch {
            continue;
          }
        } else if (kind === "runs") {
          const row = raw as Run;
          const inv = await invocation(row.siteId, row.invocationId);
          if (query.capabilityId && inv?.operationId !== query.capabilityId) continue;
          if (!(await runVisible(row, visibility))) continue;
          items.push(runDetail(row, inv));
        } else {
          const row = raw as Action;
          const inv = await invocation(row.siteId, row.invocationId);
          const principalId = await actionOwner(row, inv);
          if (
            !principalId ||
            (query.principalId && principalId !== query.principalId) ||
            !(await actionVisible(row, visibility))
          )
            continue;
          items.push(actionDetail(row, inv, principalId));
        }
        if (items.length === limit) {
          more = true;
          break;
        }
      }
      if (items.length === limit || !more) break;
    }
    await assertSameStaff(input, auth);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", cursorEncryptionKey, nonce);
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify({ binding, expires: now().getTime() + 900_000, position }),
        "utf8",
      ),
      cipher.final(),
    ]);
    const body = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
    return {
      schemaVersion: `np.agent-activity-${kind}.v1`,
      items,
      nextCursor: more ? `${body}.${mac(body)}` : null,
    };
  }
  return {
    getPrincipal,
    getRun,
    getAction,
    listPrincipals: async (input: Staff & { query?: unknown }) =>
      npRequireAgentContractResult(
        npAnalyzeAgentActivityPrincipalsPageV1(await list("principals", input)),
      ),
    listRuns: async (input: Staff & { query?: unknown }) =>
      npRequireAgentContractResult(npAnalyzeAgentActivityRunsPageV1(await list("runs", input))),
    listActions: async (input: Staff & { query?: unknown }) =>
      npRequireAgentContractResult(
        npAnalyzeAgentActivityActionsPageV1(await list("actions", input)),
      ),
    async getMachineRun(input: {
      authentication: NpAgentAuthenticatedServicePrincipalV1;
      runId: string;
    }) {
      try {
        if (!options.admission || !uuid.test(input.runId)) throw missing();
        const { authentication } = input;
        const projection = await options.admission.project({ authentication });
        if (authentication.authorizationContext.transport !== "agent-api") throw missing();
        const [row] = await getDb()
          .select()
          .from(npAgentRuns)
          .where(
            and(
              eq(npAgentRuns.siteId, authentication.principal.siteId),
              eq(npAgentRuns.principalId, authentication.principal.id),
              eq(npAgentRuns.id, input.runId),
            ),
          )
          .limit(1);
        if (!row) throw missing();
        const inv = await invocation(row.siteId, row.invocationId);
        if (
          !inv ||
          inv.principalId !== row.principalId ||
          inv.authorizationContextBody.transport !==
            authentication.authorizationContext.transport ||
          inv.authorizationContextBody.authorityRef.kind !== "service-family" ||
          authentication.authorizationContext.authorityRef.kind !== "service-family" ||
          inv.authorizationContextBody.authorityRef.audience !==
            authentication.authorizationContext.authorityRef.audience
        )
          throw missing();
        if (!projection.entries.some((entry) => entry.definition.descriptor.id === inv.operationId))
          throw missing();
        if (
          authentication.principal.authority.kind !== "user" ||
          !authentication.principal.authority.userId
        )
          throw missing();
        const userId = authentication.principal.authority.userId;
        const live = await npResolveLiveAgentStaffAuthorizationV1(getDb(), row.siteId, userId);
        const [user] = await getDb().select().from(npUsers).where(eq(npUsers.id, userId)).limit(1);
        if (!user) throw missing();
        const visibility: Visibility = {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            tokenVersion: user.tokenVersion,
            role:
              live.authority.kind === "super-admin"
                ? "admin"
                : (live.authority.role as NpAuthUser["role"]),
          },
          capabilities: live.authority.capabilities,
        };
        if (!(await runVisible(row, visibility, authentication.scopes))) throw missing();
        await options.admission.project({ authentication });
        return runDetail(row, inv);
      } catch {
        throw missing();
      }
    },
  };
}
export type NpAgentActivityServiceV1 = ReturnType<typeof createAgentActivityServiceV1>;
