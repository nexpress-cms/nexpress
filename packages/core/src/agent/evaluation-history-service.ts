import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "../db/runtime.js";
import { npAuditEvents } from "../db/schema/community.js";
import {
  npAgentEvaluationSources,
  npAgentEvaluationReviews,
  npAgentInvocations,
} from "../db/schema/agent.js";
import {
  npRequireAgentEvaluationHistorySaveV1,
  npRequireAgentEvaluationHistorySourcesV1,
  npRequireAgentEvaluationHistoryDetailV1,
  npRequireAgentEvaluationHistoryCaseV1,
  type NpAgentEvaluationHistorySaveV1,
  type NpAgentEvaluationHistorySourcesV1,
  type NpAgentEvaluationHistoryDetailV1,
  type NpAgentEvaluationHistoryCaseV1,
  type NpAgentEvaluationHistorySourceV1,
  type NpAgentEvaluationHistoryRevisionV1,
} from "../agent-contract/evaluation-history-contract.js";
import type { NpAgentEvaluationWorkbenchResultV1 } from "../agent-contract/evaluation-workbench-contract.js";
import {
  canonicalBodySiteId,
  canonicalBodyUuid,
  canonicalBodyInteger,
  canonicalBodyEnum,
  canonicalBodySha256Digest,
} from "../agent-contract/canonical-body-validation.js";
import {
  npAgentEvaluationReportRecipesV1,
  type NpAgentEvaluationReportRecipeV1,
} from "../agent-contract/evaluation-report-contract.js";
import {
  npRequireAgentInvocationRequestCanonical,
  npDigestAgentInvocationRequestCanonical,
} from "../agent-contract/canonical-idempotency-request.js";
import {
  npRequireAgentAuthorizationContextCanonical,
  npDigestAgentAuthorizationContextCanonical,
} from "../agent-contract/canonical-authorization-context.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npBuildAgentEvaluationWorkbenchV1 } from "./evaluation-workbench.js";
import { npBuildAgentEvaluationReportV1 } from "./evaluation-report.js";
import {
  createAgentAdminAdmissionV1,
  npResolveAgentStaffSessionAuthorizationV1,
  NpAgentGatewayError,
  type NpAgentAdminActorV1,
} from "./admin-admission.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";

type Db = ReturnType<typeof getDb>;
type Staff = { siteId: string; actor: NpAgentAdminActorV1 };
type Source = typeof npAgentEvaluationSources.$inferSelect;
type Revision = typeof npAgentEvaluationReviews.$inferSelect;
type SourceMetadata = Pick<
  Source,
  "id" | "recipe" | "sourceHash" | "versionNumber" | "caseCount" | "createdAt"
>;
export interface NpAgentEvaluationHistoryServiceV1 {
  list(
    input: Staff & { cursor?: string | null; recipe?: string; sourceHash?: string },
  ): Promise<NpAgentEvaluationHistorySourcesV1>;
  get(input: Staff & { sourceId: string }): Promise<NpAgentEvaluationHistoryDetailV1>;
  history(
    input: Staff & {
      sourceId: string;
      caseId: string;
      caseVersion: number;
      before?: number | null;
    },
  ): Promise<NpAgentEvaluationHistoryCaseV1>;
  save(
    input: Staff & { command: NpAgentEvaluationHistorySaveV1 },
  ): Promise<{ resourceId: string; replayed: boolean }>;
}
function fail(code = "EVALUATION_HISTORY_INVALID", status = 409): never {
  throw new NpAgentGatewayError(code, status, "Evaluation review history is unavailable.");
}
const hash = (kind: string, value: unknown): string =>
  `cj1:sha256:${createHash("sha256")
    .update(`${kind}\0${serializeAgentCanonicalJson(value)}`)
    .digest("base64url")}`;
function project(s: SourceMetadata): NpAgentEvaluationHistorySourceV1 {
  return {
    id: s.id,
    recipe: s.recipe,
    sourceHash: s.sourceHash,
    version: s.versionNumber,
    caseCount: s.caseCount,
    createdAt: s.createdAt.toISOString(),
  };
}
function revisionBody(r: Revision): Record<string, unknown> {
  return {
    siteId: r.siteId,
    sourceId: r.sourceId,
    version: r.versionNumber,
    caseId: r.caseId,
    caseVersion: r.caseVersion,
    caseHash: r.caseHash,
    predictionHash: r.predictionHash,
    previousRevisionId: r.previousRevisionId,
    actorFingerprint: r.actorFingerprint,
    recordedAt: r.createdAt.toISOString(),
    label: r.labelBody,
    invocationId: r.invocationId,
    auditEventId: r.auditEventId,
  };
}
/** Explicit host installation. Stored decisions attest an authenticated action, never capability approval. */
export function createAgentEvaluationHistoryServiceV1(
  options: { now?: () => Date } = {},
): NpAgentEvaluationHistoryServiceV1 {
  const now: () => Date = options.now ?? (() => new Date());
  const admission = createAgentAdminAdmissionV1({ now });
  async function staff(db: Db, input: Staff): Promise<string> {
    canonicalBodySiteId(input.siteId, "evaluation.siteId");
    const a = await npResolveAgentStaffSessionAuthorizationV1(db, input.siteId, input.actor, now());
    if (!a.authority.capabilities.includes("admin.manage")) fail("SITE_ACCESS_DENIED", 403);
    return serializeAgentCanonicalJson(a);
  }
  async function read<T>(input: Staff, fn: (db: Db) => Promise<T>): Promise<T> {
    const db = getDb();
    const auth = await staff(db, input);
    const result = await fn(db);
    if ((await staff(db, input)) !== auth) fail("STAFF_AUTHORIZATION_CHANGED");
    return result;
  }
  async function source(
    db: Db,
    input: Staff & { sourceId: string },
  ): Promise<{ s: Source; result: NpAgentEvaluationWorkbenchResultV1 }> {
    canonicalBodyUuid(input.sourceId, "evaluation.sourceId");
    const [s] = await db
      .select()
      .from(npAgentEvaluationSources)
      .where(
        and(
          eq(npAgentEvaluationSources.siteId, input.siteId),
          eq(npAgentEvaluationSources.id, input.sourceId),
        ),
      )
      .limit(1);
    if (!s) fail("EVALUATION_HISTORY_NOT_FOUND", 404);
    const result = await npBuildAgentEvaluationWorkbenchV1({
      schemaVersion: "np.agent-eval-workbench-request.v1",
      recipe: s.recipe,
      evaluation: s.evaluationBody,
      review: null,
      baseline: null,
      baselineReview: null,
      labels: null,
    });
    if (result.sourceHash !== s.sourceHash || result.cases.length !== s.caseCount) fail();
    return { s, result };
  }
  async function transaction<T>(input: Staff, fn: (db: Db) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++)
      try {
        return await getDb().transaction(
          (tx) =>
            npWithAgentRuntimeControlTransactionV1(input.siteId, ({ db }) => fn(db), tx as Db),
          { isolationLevel: "serializable" },
        );
      } catch (error) {
        const e = error as { code?: string; cause?: { code?: string } };
        if (attempt >= 2 || !["40001", "23505"].includes(e.cause?.code ?? e.code ?? ""))
          throw error;
      }
  }
  return {
    list(input) {
      return read(input, async (db): Promise<NpAgentEvaluationHistorySourcesV1> => {
        if (input.cursor) canonicalBodyUuid(input.cursor, "evaluation.cursor");
        const recipe =
          input.recipe === undefined
            ? undefined
            : canonicalBodyEnum<NpAgentEvaluationReportRecipeV1>(
                input.recipe,
                "evaluation.recipe",
                new Set(npAgentEvaluationReportRecipesV1),
              );
        if (input.sourceHash !== undefined)
          canonicalBodySha256Digest(input.sourceHash, "evaluation.sourceHash");
        const rows = await db
          .select({
            id: npAgentEvaluationSources.id,
            recipe: npAgentEvaluationSources.recipe,
            sourceHash: npAgentEvaluationSources.sourceHash,
            versionNumber: npAgentEvaluationSources.versionNumber,
            caseCount: npAgentEvaluationSources.caseCount,
            createdAt: npAgentEvaluationSources.createdAt,
          })
          .from(npAgentEvaluationSources)
          .where(
            and(
              eq(npAgentEvaluationSources.siteId, input.siteId),
              input.cursor ? gt(npAgentEvaluationSources.id, input.cursor) : undefined,
              recipe ? eq(npAgentEvaluationSources.recipe, recipe) : undefined,
              input.sourceHash
                ? eq(npAgentEvaluationSources.sourceHash, input.sourceHash)
                : undefined,
            ),
          )
          .orderBy(asc(npAgentEvaluationSources.id))
          .limit(26);
        return npRequireAgentEvaluationHistorySourcesV1({
          schemaVersion: "np.agent-evaluation-history-sources.v1",
          sources: rows.slice(0, 25).map(project),
          nextCursor: rows.length > 25 ? rows[24].id : null,
        });
      });
    },
    get(input) {
      return read(input, async (db): Promise<NpAgentEvaluationHistoryDetailV1> => {
        const { s } = await source(db, input);
        return npRequireAgentEvaluationHistoryDetailV1({
          schemaVersion: "np.agent-evaluation-history.v1",
          authority: "authenticated-staff-review-no-approval",
          source: project(s),
          evaluationJson: JSON.stringify(s.evaluationBody),
        });
      });
    },
    history(input) {
      return read(input, async (db): Promise<NpAgentEvaluationHistoryCaseV1> => {
        const { s, result } = await source(db, input);
        canonicalBodyInteger(input.caseVersion, "evaluation.caseVersion", 1, 2147483646);
        const entry = result.cases.find(
          (c) => c.caseId === input.caseId && c.caseVersion === input.caseVersion,
        );
        if (!entry) fail("EVALUATION_HISTORY_NOT_FOUND", 404);
        if (input.before !== undefined && input.before !== null)
          canonicalBodyInteger(input.before, "evaluation.before", 1, 2147483646);
        const rows = await db
          .select()
          .from(npAgentEvaluationReviews)
          .where(
            and(
              eq(npAgentEvaluationReviews.siteId, input.siteId),
              eq(npAgentEvaluationReviews.sourceId, s.id),
              eq(npAgentEvaluationReviews.caseId, input.caseId),
              eq(npAgentEvaluationReviews.caseVersion, input.caseVersion),
              input.before ? lt(npAgentEvaluationReviews.versionNumber, input.before) : undefined,
            ),
          )
          .orderBy(desc(npAgentEvaluationReviews.versionNumber))
          .limit(11);
        const revisions: NpAgentEvaluationHistoryRevisionV1[] = [];
        for (const r of rows.slice(0, 10)) {
          if (
            r.caseHash !== entry.caseHash ||
            r.predictionHash !== entry.predictionHash ||
            r.versionNumber > s.versionNumber ||
            r.revisionHash !== hash("np.agent-evaluation-history-revision.v1", revisionBody(r))
          )
            fail();
          const [inv] = await db
            .select()
            .from(npAgentInvocations)
            .where(
              and(
                eq(npAgentInvocations.siteId, input.siteId),
                eq(npAgentInvocations.id, r.invocationId),
              ),
            )
            .limit(1);
          if (
            !inv ||
            inv.operationId !== "agents.evaluations.review" ||
            inv.actorKind !== "staff" ||
            inv.operationKind !== "admin" ||
            inv.transport !== "admin" ||
            inv.state !== "completed" ||
            inv.resultKind !== "admin_resource" ||
            inv.actorFingerprint !== r.actorFingerprint ||
            inv.auditEventId !== r.auditEventId ||
            inv.resultId !== s.id
          )
            fail();
          const { request, context } = (() => {
            try {
              return {
                request: npRequireAgentInvocationRequestCanonical(inv.requestBody),
                context: npRequireAgentAuthorizationContextCanonical(inv.authorizationContextBody),
              };
            } catch {
              return fail();
            }
          })();
          if (context.actor.kind !== "staff" || context.authorityRef.kind !== "staff-session")
            fail();
          if (
            request.siteId !== input.siteId ||
            request.actorKind !== "staff" ||
            request.operationKind !== "admin" ||
            request.operationId !== inv.operationId ||
            request.contractVersion !== inv.contractVersion ||
            request.contractFingerprint !== inv.contractFingerprint ||
            request.actorFingerprint !== r.actorFingerprint ||
            request.authorizationContextFingerprint !== inv.authorizationContextFingerprint ||
            (await npDigestAgentInvocationRequestCanonical(request)) !== inv.requestHash ||
            context.siteId !== input.siteId ||
            context.transport !== "admin" ||
            context.actor.actorFingerprint !== r.actorFingerprint ||
            context.authorityRef.userId !== context.actor.userId ||
            hash("np.agent-staff-actor.v1", {
              siteId: input.siteId,
              userId: context.actor.userId,
            }) !== r.actorFingerprint ||
            (await npDigestAgentAuthorizationContextCanonical(context)) !==
              inv.authorizationContextFingerprint ||
            serializeAgentCanonicalJson(context.authorityRef) !==
              serializeAgentCanonicalJson(inv.authorityRef) ||
            (inv.staffUserId !== null && inv.staffUserId !== context.actor.userId) ||
            (r.recordedByUserId !== null && r.recordedByUserId !== context.actor.userId) ||
            request.input.idempotencyKey !== inv.idempotencyKey ||
            request.input.targetId !== null ||
            request.input.parentTargetId !== null ||
            !inv.completedAt ||
            inv.completedAt.getTime() !== r.createdAt.getTime() ||
            serializeAgentCanonicalJson(inv.outputRedacted) !==
              serializeAgentCanonicalJson({
                schemaVersion: "np.agent-evaluation-history-saved.v1",
                resourceId: s.id,
                version: r.versionNumber,
              }) ||
            inv.outputHash !== hash("np.agent-admin-output.v1", inv.outputRedacted)
          )
            fail();
          const decision =
            r.labelBody === null
              ? null
              : {
                  outcome: r.labelBody.outcome ?? r.labelBody.label,
                  notes: r.labelBody.notes,
                  editedProposal: r.labelBody.editedProposal ?? null,
                };
          if (
            request.input.sourceHash !== s.sourceHash ||
            request.input.caseHash !== r.caseHash ||
            request.input.predictionHash !== r.predictionHash ||
            request.input.caseId !== r.caseId ||
            request.input.caseVersion !== r.caseVersion ||
            request.input.expectedVersion !== r.versionNumber - 1 ||
            request.input.decisionHash !== hash("np.agent-evaluation-history-decision.v1", decision)
          )
            fail();
          if (
            r.labelBody !== null &&
            (r.labelBody.reviewer !== `staff:${r.actorFingerprint}` ||
              r.labelBody.reviewedAt !== r.createdAt.toISOString())
          )
            fail();
          const [audit] = await db
            .select()
            .from(npAuditEvents)
            .where(eq(npAuditEvents.id, r.auditEventId))
            .limit(1);
          if (
            !audit ||
            audit.siteId !== input.siteId ||
            audit.action !== "agents.evaluations.review" ||
            audit.targetType !== "agent-evaluation" ||
            audit.targetId !== s.id
          )
            fail();
          if (r.previousRevisionId) {
            const [previous] = await db
              .select()
              .from(npAgentEvaluationReviews)
              .where(
                and(
                  eq(npAgentEvaluationReviews.siteId, input.siteId),
                  eq(npAgentEvaluationReviews.id, r.previousRevisionId),
                  eq(npAgentEvaluationReviews.sourceId, s.id),
                ),
              )
              .limit(1);
            if (
              !previous ||
              previous.caseHash !== r.caseHash ||
              previous.caseId !== r.caseId ||
              previous.caseVersion !== r.caseVersion ||
              previous.versionNumber >= r.versionNumber
            )
              fail();
          }
          if (r.labelBody !== null) {
            const checked = await npBuildAgentEvaluationWorkbenchV1({
              schemaVersion: "np.agent-eval-workbench-request.v1",
              recipe: s.recipe,
              evaluation: s.evaluationBody,
              review: null,
              baseline: null,
              baselineReview: null,
              labels: [r.labelBody],
            });
            if (
              !checked.cases.find((c) => c.caseHash === r.caseHash && c.caseId === r.caseId)
                ?.labelJson
            )
              fail();
          }
          revisions.push({
            id: r.id,
            version: r.versionNumber,
            caseId: r.caseId,
            caseVersion: r.caseVersion,
            caseHash: r.caseHash,
            predictionHash: r.predictionHash,
            previousRevisionId: r.previousRevisionId,
            actorFingerprint: r.actorFingerprint,
            actorDeleted: r.recordedByUserId === null,
            recordedAt: r.createdAt.toISOString(),
            labelJson: r.labelBody === null ? null : JSON.stringify(r.labelBody),
            revisionHash: r.revisionHash,
          });
        }
        return npRequireAgentEvaluationHistoryCaseV1({
          schemaVersion: "np.agent-evaluation-history-case.v1",
          authority: "authenticated-staff-review-no-approval",
          source: project(s),
          caseId: input.caseId,
          caseVersion: input.caseVersion,
          revisions,
          nextBefore: rows.length > 10 ? rows[9].versionNumber : null,
        });
      });
    },
    async save(input): Promise<{ resourceId: string; replayed: boolean }> {
      npAssertAgentPreviewEffectsAllowed();
      const command = npRequireAgentEvaluationHistorySaveV1(input.command);
      await staff(getDb(), input);
      const report = await npBuildAgentEvaluationReportV1({
        schemaVersion: "np.agent-eval-report-input.v1",
        entries: [
          {
            recipe: command.recipe,
            current: { evaluation: JSON.parse(command.evaluationJson) as unknown, review: null },
            baseline: null,
          },
        ],
      });
      const evaluation = report.input.entries[0].current.evaluation;
      const checked = await npBuildAgentEvaluationWorkbenchV1({
        schemaVersion: "np.agent-eval-workbench-request.v1",
        recipe: command.recipe,
        evaluation,
        review: null,
        baseline: null,
        baselineReview: null,
        labels: null,
      });
      const entry = checked.cases.find(
        (c) => c.caseId === command.caseId && c.caseVersion === command.caseVersion,
      );
      if (
        checked.sourceHash !== command.sourceHash ||
        !entry?.eligible ||
        entry.caseHash !== command.caseHash ||
        entry.predictionHash !== command.predictionHash
      )
        fail();
      return transaction(input, async (db): Promise<{ resourceId: string; replayed: boolean }> => {
        await staff(db, input);
        const [existing] = await db
          .select()
          .from(npAgentEvaluationSources)
          .where(
            and(
              eq(npAgentEvaluationSources.siteId, input.siteId),
              eq(npAgentEvaluationSources.recipe, command.recipe),
              eq(npAgentEvaluationSources.sourceHash, command.sourceHash),
            ),
          )
          .limit(1);
        const admitted = await admission({
          db,
          siteId: input.siteId,
          actor: input.actor,
          operationId: "agents.evaluations.review",
          targetId: null,
          command,
          mutate: async ({ db, now, invocationId }) => {
            let s: Source | undefined = existing;
            if (!s) {
              if (command.expectedVersion !== 0 || command.decision === null)
                fail("EVALUATION_HISTORY_VERSION_CONFLICT");
              // Bound stored source count per site; saves remain useful without an automatic expiry policy.
              const count = await db.execute(
                sql`select count(*)::integer as n from np_agent_evaluation_sources where site_id=${input.siteId}`,
              );
              const n = Number((count.rows[0] as { n?: unknown })?.n);
              if (!Number.isSafeInteger(n) || n < 0) fail();
              if (n >= 1000) fail("EVALUATION_HISTORY_LIMIT_REACHED");
              [s] = await db
                .insert(npAgentEvaluationSources)
                .values({
                  siteId: input.siteId,
                  recipe: command.recipe,
                  sourceHash: command.sourceHash,
                  evaluationBody: evaluation,
                  versionNumber: 0,
                  caseCount: checked.cases.length,
                  createdAt: now,
                })
                .returning();
            }
            if (!s || s.versionNumber !== command.expectedVersion)
              fail("EVALUATION_HISTORY_VERSION_CONFLICT");
            if (s.versionNumber >= 10000) fail("EVALUATION_HISTORY_LIMIT_REACHED");
            if (
              serializeAgentCanonicalJson(s.evaluationBody) !==
                serializeAgentCanonicalJson(evaluation) ||
              s.caseCount !== checked.cases.length
            )
              fail();
            const [previous] = await db
              .select()
              .from(npAgentEvaluationReviews)
              .where(
                and(
                  eq(npAgentEvaluationReviews.siteId, input.siteId),
                  eq(npAgentEvaluationReviews.sourceId, s.id),
                  eq(npAgentEvaluationReviews.caseId, command.caseId),
                  eq(npAgentEvaluationReviews.caseVersion, command.caseVersion),
                ),
              )
              .orderBy(desc(npAgentEvaluationReviews.versionNumber))
              .limit(1);
            if (command.decision === null && (!previous || previous.labelBody === null))
              fail("EVALUATION_HISTORY_UNCHANGED");
            const [inv] = await db
              .select({
                actorFingerprint: npAgentInvocations.actorFingerprint,
                auditEventId: npAgentInvocations.auditEventId,
              })
              .from(npAgentInvocations)
              .where(eq(npAgentInvocations.id, invocationId))
              .limit(1);
            if (!inv?.auditEventId) fail();
            let label: Record<string, unknown> | null = null;
            if (command.decision) {
              if (!entry.allowedOutcomes.includes(command.decision.outcome)) fail();
              const binding = {
                caseId: command.caseId,
                caseHash: command.caseHash,
                predictionHash: command.predictionHash,
                sourceHash: command.sourceHash,
                reviewer: `staff:${inv.actorFingerprint}`,
                reviewedAt: now.toISOString(),
                notes: command.decision.notes,
              };
              const proposed =
                command.recipe === "moderator"
                  ? { ...binding, label: command.decision.outcome }
                  : {
                      ...binding,
                      outcome: command.decision.outcome,
                      editedProposal:
                        command.decision.editedProposalJson === null
                          ? null
                          : (JSON.parse(command.decision.editedProposalJson) as unknown),
                    };
              const reviewed = await npBuildAgentEvaluationWorkbenchV1({
                schemaVersion: "np.agent-eval-workbench-request.v1",
                recipe: command.recipe,
                evaluation,
                review: null,
                baseline: null,
                baselineReview: null,
                labels: [proposed],
              });
              const encoded = reviewed.cases.find(
                (c) => c.caseId === entry.caseId && c.caseVersion === entry.caseVersion,
              )?.labelJson;
              if (!encoded) fail();
              label = JSON.parse(encoded) as Record<string, unknown>;
            }
            const version = s.versionNumber + 1;
            const row: Omit<Revision, "id" | "revisionHash"> = {
              siteId: input.siteId,
              sourceId: s.id,
              versionNumber: version,
              caseId: command.caseId,
              caseVersion: command.caseVersion,
              caseHash: command.caseHash,
              predictionHash: command.predictionHash,
              previousRevisionId: previous?.id ?? null,
              recordedByUserId: input.actor.user.id,
              actorFingerprint: inv.actorFingerprint,
              createdAt: now,
              labelBody: label,
              invocationId,
              auditEventId: inv.auditEventId,
            };
            const revisionHash = hash("np.agent-evaluation-history-revision.v1", {
              siteId: row.siteId,
              sourceId: row.sourceId,
              version,
              caseId: row.caseId,
              caseVersion: row.caseVersion,
              caseHash: row.caseHash,
              predictionHash: row.predictionHash,
              previousRevisionId: row.previousRevisionId,
              actorFingerprint: row.actorFingerprint,
              recordedAt: now.toISOString(),
              label,
              invocationId,
              auditEventId: row.auditEventId,
            });
            await db.insert(npAgentEvaluationReviews).values({ ...row, revisionHash });
            const changed = await db
              .update(npAgentEvaluationSources)
              .set({ versionNumber: version })
              .where(
                and(
                  eq(npAgentEvaluationSources.id, s.id),
                  eq(npAgentEvaluationSources.siteId, input.siteId),
                  eq(npAgentEvaluationSources.versionNumber, command.expectedVersion),
                ),
              )
              .returning({ id: npAgentEvaluationSources.id });
            if (changed.length !== 1) fail("EVALUATION_HISTORY_VERSION_CONFLICT");
            return {
              resourceId: s.id,
              output: {
                schemaVersion: "np.agent-evaluation-history-saved.v1",
                resourceId: s.id,
                version,
              },
            };
          },
        });
        return { resourceId: admitted.resourceId, replayed: admitted.replayed };
      });
    },
  };
}
