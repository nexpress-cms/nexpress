import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import {
  canonicalBodyRecord,
  canonicalBodySiteId,
  canonicalBodyUuid,
} from "../agent-contract/canonical-body-validation.js";
import { createHash } from "node:crypto";
import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import {
  npAgentEvents,
  npAgentTriggers,
  npAgentRuns,
  npAgentActions,
  npAgents,
} from "../db/schema/agent.js";
import {
  npRequireAgentEventCanonical,
  npDigestAgentEventCanonical,
} from "../agent-contract/canonical-events.js";
import {
  npRequireAgentTriggerV1,
  npMatchAgentTriggerEventV1,
  npNextAgentTriggerScheduleV1,
  type NpAgentTrigger,
} from "../agent-contract/runtime-trigger-contract.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import type { NpAgentEventCanonicalV1 } from "../agent-contract/types.js";
import { NpAgentGatewayError } from "./admin-admission.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import {
  npRequireAgentRuntimeVersionV1,
  npResolveAgentRuntimeAuthorityV1,
  type NpAgentRuntimeServiceOptionsV1,
} from "./runtime-service.js";
import type { NpAgentRuntimeAdmissionV1 } from "./runtime-admission.js";

type Db = ReturnType<typeof getDb>;
type Trigger = typeof npAgentTriggers.$inferSelect;
type Event = typeof npAgentEvents.$inferSelect;
function fail(code = "RUNTIME_EVENT_INVALID"): never {
  throw new NpAgentGatewayError(code, 409, "Agent event operation is unavailable.");
}
function digest(value: unknown): string {
  return `cj1:sha256:${createHash("sha256").update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
}
function bounded(limit = 100): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail();
  return limit;
}
function definition(row: Trigger): NpAgentTrigger {
  if (row.filterHash !== digest(row.filter)) fail("RUNTIME_TRIGGER_INVALID");
  return npRequireAgentTriggerV1(
    row.kind === "event"
      ? {
          type: row.kind,
          id: row.id,
          eventKind: row.eventType,
          filter: row.filter,
          coalesceSeconds: row.coalesceSeconds,
        }
      : row.kind === "schedule"
        ? { type: row.kind, id: row.id, cron: row.cron, catchUp: row.catchUp }
        : { type: row.kind, id: row.id },
  );
}
function envelope(row: Event): NpAgentEventCanonicalV1 {
  return npRequireAgentEventCanonical({
    version: "np.agent-event.v1",
    siteId: row.siteId,
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    source: { kind: row.sourceKind, component: row.sourceComponent },
    subject: row.subject,
    actor: row.actor,
    causation: row.causation,
    correlationId: row.correlationId,
    deduplicationKey: row.deduplicationKey,
    privacy: row.privacy,
    payload: row.payload,
  });
}
export interface NpAgentRuntimeEventServiceOptionsV1 {
  admission: NpAgentRuntimeAdmissionV1;
  deploymentAuthority: NpAgentRuntimeServiceOptionsV1["deploymentAuthority"];
  now?: () => Date;
  enqueueRun?: (input: { siteId: string; runId: string }) => Promise<string>;
}
/** Explicit host service. Durable events and Runs are the delivery outbox; queue failures retain them. */
export function createAgentRuntimeEventServiceV1(options: NpAgentRuntimeEventServiceOptionsV1) {
  const now = options.now ?? (() => new Date());
  async function notify(siteId: string, runIds: string[]) {
    let enqueued = 0;
    for (const runId of runIds) {
      try {
        if (options.enqueueRun) {
          const jobId = await options.enqueueRun({ siteId, runId });
          if (typeof jobId === "string" && jobId.length > 0) enqueued++;
        }
      } catch {
        /* Durable queued Run is reconciled by the host. */
      }
    }
    return enqueued;
  }
  async function current(db: Db, trigger: Trigger) {
    const [agent] = await db
      .select()
      .from(npAgents)
      .where(and(eq(npAgents.siteId, trigger.siteId), eq(npAgents.id, trigger.agentId)))
      .limit(1);
    if (!agent || agent.status !== "active" || agent.activeVersionId !== trigger.agentVersionId)
      return [];
    const evidence = await npRequireAgentRuntimeVersionV1({
      db,
      siteId: trigger.siteId,
      agentId: trigger.agentId,
      versionId: trigger.agentVersionId,
    });
    await npResolveAgentRuntimeAuthorityV1({
      db,
      siteId: trigger.siteId,
      principal: evidence.principal,
      scopes: evidence.definition.scopes,
      deploymentAuthority: options.deploymentAuthority,
    });
    return evidence.registry.recipes.filter(
      (recipe) =>
        recipe.task === "interactive-capability" &&
        recipe.triggerKinds.includes(trigger.kind as "manual" | "event" | "schedule") &&
        evidence.definition.settings.some((branch) => branch.recipeId === recipe.id),
    );
  }
  async function registerTrigger(input: {
    siteId: string;
    agentId: string;
    expectedVersionId: string;
    trigger: NpAgentTrigger;
    enabled: boolean;
    db?: Db;
  }) {
    npAssertAgentPreviewEffectsAllowed();
    canonicalBodyRecord(
      input,
      "agent.runtime.trigger.register",
      ["siteId", "agentId", "expectedVersionId", "trigger", "enabled", "db"],
      ["siteId", "agentId", "expectedVersionId", "trigger", "enabled"],
      { seen: new WeakSet<object>() },
    );
    canonicalBodySiteId(input.siteId, "agent.runtime.siteId");
    canonicalBodyUuid(input.agentId, "agent.runtime.agentId");
    canonicalBodyUuid(input.expectedVersionId, "agent.runtime.versionId");
    const trigger = npRequireAgentTriggerV1(input.trigger);
    if (typeof input.enabled !== "boolean") fail();
    return npWithAgentRuntimeControlTransactionV1(
      input.siteId,
      async ({ db }) => {
        const time = now();
        const filter = trigger.type === "event" ? trigger.filter : {};
        const row = {
          id: trigger.id,
          siteId: input.siteId,
          agentId: input.agentId,
          agentVersionId: input.expectedVersionId,
          kind: trigger.type,
          eventType: trigger.type === "event" ? trigger.eventKind : null,
          cron: trigger.type === "schedule" ? trigger.cron : null,
          catchUp: trigger.type === "schedule" ? trigger.catchUp : null,
          nextRunAt:
            trigger.type === "schedule" && input.enabled
              ? npNextAgentTriggerScheduleV1(trigger.cron, time)
              : null,
          lastEnqueuedAt: null,
          filter,
          filterHash: digest(filter),
          coalesceSeconds: trigger.type === "event" ? trigger.coalesceSeconds : 0,
          enabled: input.enabled,
          createdAt: time,
          updatedAt: time,
        };
        if (!(await current(db, row)).length) fail("RUNTIME_RECIPE_UNAVAILABLE");
        const rows = await db
          .select()
          .from(npAgentTriggers)
          .where(eq(npAgentTriggers.siteId, input.siteId))
          .limit(101);
        const previous = rows.find((entry) => entry.id === trigger.id);
        if (previous) {
          if (
            previous.agentId !== row.agentId ||
            previous.agentVersionId !== row.agentVersionId ||
            previous.enabled !== row.enabled ||
            serializeAgentCanonicalJson(definition(previous)) !==
              serializeAgentCanonicalJson(trigger)
          )
            fail("IDEMPOTENCY_KEY_REUSED");
          return { triggerId: previous.id, replayed: true };
        }
        if (rows.length >= 100) fail("RUNTIME_TRIGGER_LIMIT");
        await db.insert(npAgentTriggers).values(row);
        return { triggerId: row.id, replayed: false };
      },
      input.db,
    );
  }
  return {
    registerTrigger,
    registerTriggerInTransaction: registerTrigger,
    async record(input: { siteId: string; event: NpAgentEventCanonicalV1; expiresAt?: Date }) {
      npAssertAgentPreviewEffectsAllowed();
      canonicalBodyRecord(
        input,
        "agent.runtime.event.record",
        ["siteId", "event", "expiresAt"],
        ["siteId", "event"],
        { seen: new WeakSet<object>() },
      );
      canonicalBodySiteId(input.siteId, "agent.runtime.siteId");
      if (
        input.expiresAt !== undefined &&
        (!(input.expiresAt instanceof Date) || !Number.isFinite(input.expiresAt.getTime()))
      )
        fail();
      const event = npRequireAgentEventCanonical(input.event);
      if (event.siteId !== input.siteId) fail();
      const eventHash = await npDigestAgentEventCanonical(event);
      return npWithAgentRuntimeControlTransactionV1(input.siteId, async ({ db }) => {
        const time = now(),
          expiresAt = input.expiresAt ?? new Date(time.getTime() + 14 * 86400_000);
        if (
          !Number.isFinite(expiresAt.getTime()) ||
          expiresAt <= time ||
          expiresAt.getTime() > time.getTime() + 14 * 86400_000
        )
          fail();
        if (event.deduplicationKey) {
          const [previous] = await db
            .select()
            .from(npAgentEvents)
            .where(
              and(
                eq(npAgentEvents.siteId, input.siteId),
                eq(npAgentEvents.kind, event.kind),
                eq(npAgentEvents.sourceKind, event.source.kind),
                eq(npAgentEvents.sourceComponent, event.source.component),
                eq(npAgentEvents.deduplicationKey, event.deduplicationKey),
              ),
            )
            .limit(1);
          if (previous) {
            if (previous.eventHash !== eventHash) fail("IDEMPOTENCY_KEY_REUSED");
            return { eventId: previous.id, replayed: true };
          }
        }
        const cause = event.causation;
        if (cause) {
          const [parent] = await db
            .select()
            .from(npAgentRuns)
            .where(and(eq(npAgentRuns.siteId, input.siteId), eq(npAgentRuns.id, cause.sourceRunId)))
            .limit(1);
          const [action] = await db
            .select()
            .from(npAgentActions)
            .where(
              and(
                eq(npAgentActions.siteId, input.siteId),
                eq(npAgentActions.id, cause.sourceActionId),
                eq(npAgentActions.runId, cause.sourceRunId),
              ),
            )
            .limit(1);
          if (
            !parent ||
            !action ||
            parent.rootRunId !== cause.rootRunId ||
            parent.causalDepth !== cause.depth
          )
            fail("RUNTIME_EVENT_LINEAGE_INVALID");
        }
        const [inserted] = await db
          .insert(npAgentEvents)
          .values({
            siteId: input.siteId,
            kind: event.kind,
            sourceKind: event.source.kind,
            sourceComponent: event.source.component,
            subject: event.subject,
            actor: event.actor,
            causation: cause,
            causalRootRunId: cause?.rootRunId,
            causalRunId: cause?.sourceRunId,
            causalActionId: cause?.sourceActionId,
            causalDepth: cause?.depth,
            correlationId: event.correlationId,
            deduplicationKey: event.deduplicationKey,
            eventHash,
            privacy: event.privacy,
            payload: event.payload,
            occurredAt: new Date(event.occurredAt),
            recordedAt: time,
            expiresAt,
          })
          .returning({ id: npAgentEvents.id });
        return { eventId: inserted.id, replayed: false };
      });
    },
    async dispatch(input: { siteId: string; eventId: string }) {
      npAssertAgentPreviewEffectsAllowed();
      canonicalBodyRecord(
        input,
        "agent.runtime.event.dispatch",
        ["siteId", "eventId"],
        ["siteId", "eventId"],
        { seen: new WeakSet<object>() },
      );
      canonicalBodySiteId(input.siteId, "agent.runtime.siteId");
      canonicalBodyUuid(input.eventId, "agent.runtime.eventId");
      async function inventory(db: Db, kind: string) {
        const rows = await db
          .select()
          .from(npAgentTriggers)
          .where(
            and(
              eq(npAgentTriggers.siteId, input.siteId),
              eq(npAgentTriggers.enabled, true),
              eq(npAgentTriggers.kind, "event"),
              eq(npAgentTriggers.eventType, kind),
            ),
          )
          .orderBy(asc(npAgentTriggers.id))
          .limit(101);
        if (rows.length > 100) fail("RUNTIME_TRIGGER_LIMIT");
        return rows;
      }
      function inventoryDigest(rows: Trigger[]) {
        return digest(
          rows.map((row) => ({
            id: row.id,
            agentId: row.agentId,
            versionId: row.agentVersionId,
            definition: definition(row),
          })),
        );
      }
      const snapshot = await npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async ({ db }) => {
          const [event] = await db
            .select()
            .from(npAgentEvents)
            .where(and(eq(npAgentEvents.siteId, input.siteId), eq(npAgentEvents.id, input.eventId)))
            .limit(1);
          if (!event || event.expiresAt <= now()) fail();
          const body = envelope(event);
          if ((await npDigestAgentEventCanonical(body)) !== event.eventHash) fail();
          const triggers = await inventory(db, event.kind);
          return { event, body, triggers, fingerprint: inventoryDigest(triggers) };
        },
      );
      if (snapshot.event.dispatchedAt)
        return { runIds: [] as string[], replayed: true, skipped: 0, enqueued: 0 };
      const runIds: string[] = [];
      let failed = 0,
        skipped = 0;
      for (const trigger of snapshot.triggers) {
        try {
          if (!npMatchAgentTriggerEventV1(definition(trigger), snapshot.body)) continue;
          const recipes = await npWithAgentRuntimeControlTransactionV1(input.siteId, ({ db }) =>
            current(db, trigger),
          );
          if (!recipes.length) skipped++;
          for (const recipe of recipes) {
            try {
              const runId = await npWithAgentRuntimeControlTransactionV1(
                input.siteId,
                async ({ db }) => {
                  const eligible = await current(db, trigger);
                  if (!eligible.some((entry) => entry.id === recipe.id))
                    fail("RUNTIME_RECIPE_UNAVAILABLE");
                  const event = snapshot.event;
                  const window = trigger.coalesceSeconds
                    ? Math.floor(event.recordedAt.getTime() / (trigger.coalesceSeconds * 1000))
                    : event.id;
                  const key = `event:${digest({ triggerId: trigger.id, recipeId: recipe.id, window, subject: event.subject, parent: event.causalRunId, action: event.causalActionId }).slice(11)}`;
                  const [prior] = await db
                    .select()
                    .from(npAgentRuns)
                    .where(
                      and(
                        eq(npAgentRuns.siteId, input.siteId),
                        eq(npAgentRuns.triggerId, trigger.id),
                        eq(npAgentRuns.idempotencyKey, key),
                      ),
                    )
                    .limit(1);
                  if (prior) {
                    await options.admission.withRunAuthority(
                      { db, siteId: input.siteId, runId: prior.id, allowTerminal: true },
                      () => Promise.resolve(undefined),
                    );
                    return prior.id;
                  }
                  return (
                    await options.admission.admit({
                      db,
                      siteId: input.siteId,
                      agentId: trigger.agentId,
                      expectedVersionId: trigger.agentVersionId,
                      recipeId: recipe.id,
                      idempotencyKey: key,
                      source: { triggerId: trigger.id, eventId: event.id },
                    })
                  ).runId;
                },
              );
              runIds.push(runId);
            } catch {
              failed++;
            }
          }
        } catch {
          failed++;
        }
      }
      const complete = await npWithAgentRuntimeControlTransactionV1(
        input.siteId,
        async ({ db }) => {
          const [event] = await db
            .select()
            .from(npAgentEvents)
            .where(and(eq(npAgentEvents.siteId, input.siteId), eq(npAgentEvents.id, input.eventId)))
            .limit(1);
          if (!event) return false;
          if (event.dispatchedAt) return true;
          if (
            failed ||
            event.expiresAt <= now() ||
            event.eventHash !== snapshot.event.eventHash ||
            inventoryDigest(await inventory(db, event.kind)) !== snapshot.fingerprint
          )
            return false;
          await db
            .update(npAgentEvents)
            .set({ dispatchedAt: now() })
            .where(
              and(
                eq(npAgentEvents.siteId, input.siteId),
                eq(npAgentEvents.id, event.id),
                isNull(npAgentEvents.dispatchedAt),
              ),
            );
          return true;
        },
      );
      const enqueued = await notify(input.siteId, runIds);
      if (!complete) fail("RUNTIME_EVENT_PENDING");
      return { runIds, replayed: false, skipped, enqueued };
    },
    async schedule(input: { siteId: string; cursor?: string; limit?: number }) {
      npAssertAgentPreviewEffectsAllowed();
      canonicalBodyRecord(
        input,
        "agent.runtime.schedule",
        ["siteId", "cursor", "limit"],
        ["siteId"],
        { seen: new WeakSet<object>() },
      );
      canonicalBodySiteId(input.siteId, "agent.runtime.siteId");
      if (input.cursor !== undefined) canonicalBodyUuid(input.cursor, "agent.runtime.cursor");
      const limit = bounded(input.limit);
      const rows = await npWithAgentRuntimeControlTransactionV1(input.siteId, async ({ db }) =>
        db
          .select({ id: npAgentTriggers.id })
          .from(npAgentTriggers)
          .where(
            and(
              eq(npAgentTriggers.siteId, input.siteId),
              eq(npAgentTriggers.kind, "schedule"),
              eq(npAgentTriggers.enabled, true),
              lte(npAgentTriggers.nextRunAt, now()),
              input.cursor ? gt(npAgentTriggers.id, input.cursor) : undefined,
            ),
          )
          .orderBy(asc(npAgentTriggers.id))
          .limit(limit + 1),
      );
      const runIds: string[] = [];
      let failed = 0;
      for (const candidate of rows.slice(0, limit)) {
        try {
          const plan = await npWithAgentRuntimeControlTransactionV1(
            input.siteId,
            async ({ db }) => {
              const time = now();
              const [trigger] = await db
                .select()
                .from(npAgentTriggers)
                .where(
                  and(
                    eq(npAgentTriggers.siteId, input.siteId),
                    eq(npAgentTriggers.id, candidate.id),
                    eq(npAgentTriggers.enabled, true),
                    eq(npAgentTriggers.kind, "schedule"),
                    lte(npAgentTriggers.nextRunAt, time),
                  ),
                )
                .limit(1);
              if (!trigger) return null;
              const def = definition(trigger);
              if (def.type !== "schedule" || !trigger.nextRunAt) fail();
              const [started] = await db
                .select({ id: npAgentRuns.id })
                .from(npAgentRuns)
                .where(
                  and(
                    eq(npAgentRuns.siteId, input.siteId),
                    eq(npAgentRuns.triggerId, trigger.id),
                    sql`${npAgentRuns.eventRef}->>'scheduledFor'=${trigger.nextRunAt.toISOString()}`,
                  ),
                )
                .limit(1);
              const currentMinute = new Date(Math.floor(time.getTime() / 60_000) * 60_000);
              const occurrence = npNextAgentTriggerScheduleV1(
                def.cron,
                new Date(currentMinute.getTime() - 1),
              );
              const selected =
                started || def.catchUp === "once"
                  ? trigger.nextRunAt
                  : occurrence.getTime() === currentMinute.getTime()
                    ? currentMinute
                    : null;
              const recipes = await current(db, trigger);
              if (!selected || !recipes.length) {
                await db
                  .update(npAgentTriggers)
                  .set({ nextRunAt: npNextAgentTriggerScheduleV1(def.cron, time), updatedAt: time })
                  .where(
                    and(
                      eq(npAgentTriggers.siteId, input.siteId),
                      eq(npAgentTriggers.id, trigger.id),
                    ),
                  );
                return null;
              }
              if (selected.getTime() !== trigger.nextRunAt.getTime())
                await db
                  .update(npAgentTriggers)
                  .set({ nextRunAt: selected, updatedAt: time })
                  .where(
                    and(
                      eq(npAgentTriggers.siteId, input.siteId),
                      eq(npAgentTriggers.id, trigger.id),
                    ),
                  );
              return {
                trigger,
                scheduledFor: selected.toISOString(),
                recipes,
                definitionHash: digest(def),
                recipesHash: digest(recipes),
              };
            },
          );
          if (!plan) continue;
          let unresolved = false;
          for (const recipe of plan.recipes) {
            try {
              const admitted = await npWithAgentRuntimeControlTransactionV1(
                input.siteId,
                async ({ db }) => {
                  const [trigger] = await db
                    .select()
                    .from(npAgentTriggers)
                    .where(
                      and(
                        eq(npAgentTriggers.siteId, input.siteId),
                        eq(npAgentTriggers.id, plan.trigger.id),
                      ),
                    )
                    .limit(1);
                  if (
                    !trigger ||
                    !trigger.enabled ||
                    trigger.nextRunAt?.toISOString() !== plan.scheduledFor ||
                    digest(definition(trigger)) !== plan.definitionHash ||
                    digest(await current(db, trigger)) !== plan.recipesHash
                  )
                    fail("RUNTIME_TRIGGER_UNAVAILABLE");
                  return options.admission.admit({
                    db,
                    siteId: input.siteId,
                    agentId: trigger.agentId,
                    expectedVersionId: trigger.agentVersionId,
                    recipeId: recipe.id,
                    idempotencyKey: `schedule:${digest({ triggerId: trigger.id, recipeId: recipe.id, scheduledFor: plan.scheduledFor }).slice(11)}`,
                    source: { triggerId: trigger.id, scheduledFor: plan.scheduledFor },
                  });
                },
              );
              runIds.push(admitted.runId);
            } catch {
              unresolved = true;
            }
          }
          const complete = await npWithAgentRuntimeControlTransactionV1(
            input.siteId,
            async ({ db }) => {
              const [trigger] = await db
                .select()
                .from(npAgentTriggers)
                .where(
                  and(
                    eq(npAgentTriggers.siteId, input.siteId),
                    eq(npAgentTriggers.id, plan.trigger.id),
                  ),
                )
                .limit(1);
              if (
                !trigger ||
                !trigger.enabled ||
                digest(definition(trigger)) !== plan.definitionHash ||
                digest(await current(db, trigger)) !== plan.recipesHash
              )
                return false;
              if (trigger.nextRunAt && trigger.nextRunAt.toISOString() > plan.scheduledFor)
                return true;
              if (unresolved || trigger.nextRunAt?.toISOString() !== plan.scheduledFor)
                return false;
              const def = definition(trigger);
              if (def.type !== "schedule") return false;
              const time = now();
              await db
                .update(npAgentTriggers)
                .set({
                  nextRunAt: npNextAgentTriggerScheduleV1(def.cron, time),
                  lastEnqueuedAt: time,
                  updatedAt: time,
                })
                .where(
                  and(eq(npAgentTriggers.siteId, input.siteId), eq(npAgentTriggers.id, trigger.id)),
                );
              return true;
            },
          );
          if (!complete) failed++;
        } catch {
          failed++;
        }
      }
      return {
        runIds,
        failed,
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
        enqueued: await notify(input.siteId, runIds),
      };
    },
  };
}
export type NpAgentRuntimeEventServiceV1 = ReturnType<typeof createAgentRuntimeEventServiceV1>;
