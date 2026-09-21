import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type { getDb } from "../db/runtime.js";
import { npSites, npSettings } from "../db/schema/system.js";
import { npAgentEvents, npAgentRuns } from "../db/schema/agent.js";
import { npIsCanonicalSiteId } from "../sites/id-contract.js";
import { withCurrentSite } from "../sites/context.js";
import { getJobHandler, registerJobHandler } from "../jobs/handlers.js";
import { enqueueJob } from "../jobs/queue.js";
import { npNormalizeJobPayload } from "../jobs-contract/contract.js";
import type { NpBuiltinJobPayloadMap, NpJobPayload } from "../jobs-contract/types.js";
import {
  NP_AGENT_RUNTIME_JOBS_SETTING_KEY,
  npCreateAgentRuntimeJobStateV1,
  npRequireAgentRuntimeJobStateV1,
} from "../agent-contract/runtime-job-state-contract.js";
import { npWithAgentRuntimeControlTransactionV1 } from "./runtime-controls.js";
import { npAssertAgentPreviewEffectsAllowed } from "./changeset-preview-overlay.js";
import type { NpAgentRuntimeEventServiceV1 } from "./runtime-event-service.js";
import type { createAgentRuntimeExecutorV1 } from "./runtime-executor.js";
import { npPruneAgentRuntimeJobV1 } from "./runtime-maintenance-job.js";

type Db = ReturnType<typeof getDb>;
type State = ReturnType<typeof npCreateAgentRuntimeJobStateV1>;
type SiteCursor = "eventSites" | "scheduleSites" | "retentionSites";
const BATCH = 25;
export interface NpAgentRuntimeJobsOptionsV1 {
  /** Explicit existing site that owns private global scan cursors; never a fallback tenant. */
  coordinationSiteId: string;
  events: Pick<NpAgentRuntimeEventServiceV1, "dispatch" | "schedule">;
  executor: Pick<ReturnType<typeof createAgentRuntimeExecutorV1>, "process">;
  now?: () => Date;
}
function unavailable(): never {
  // The generic job adapter persists thrown messages. Never propagate a source error or cause.
  const error = new Error("Agent runtime job is unavailable.");
  error.stack = error.message;
  throw error;
}
async function state(db: Db, siteId: string): Promise<State> {
  const [row] = await db
    .select({ value: npSettings.value })
    .from(npSettings)
    .where(
      and(eq(npSettings.siteId, siteId), eq(npSettings.key, NP_AGENT_RUNTIME_JOBS_SETTING_KEY)),
    )
    .limit(1);
  return row ? npRequireAgentRuntimeJobStateV1(row.value) : npCreateAgentRuntimeJobStateV1();
}
async function save(db: Db, siteId: string, value: State, now: Date): Promise<void> {
  await db
    .insert(npSettings)
    .values({ siteId, key: NP_AGENT_RUNTIME_JOBS_SETTING_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: [npSettings.siteId, npSettings.key],
      set: { value, updatedAt: now },
    });
}
/** Explicit registration only. No queue, worker, provider or site setting is enabled here. */
export function createAgentRuntimeJobsV1(options: NpAgentRuntimeJobsOptionsV1) {
  if (!npIsCanonicalSiteId(options.coordinationSiteId)) unavailable();
  const now = options.now ?? (() => new Date());
  const resolveSiteId = (input: { siteId: string }) => input.siteId;
  const safe =
    <T>(operation: (input: T) => Promise<void>) =>
    async (input: T): Promise<void> => {
      try {
        npAssertAgentPreviewEffectsAllowed();
        await operation(input);
      } catch {
        unavailable();
      }
    };
  async function enqueue<
    T extends "agent:eventDispatch" | "agent:runExecute" | "agent:retentionPrune",
  >(type: T, data: NpJobPayload<T>) {
    if (!(await enqueueJob(type, data))) unavailable();
  }
  async function sites(key: SiteCursor) {
    return npWithAgentRuntimeControlTransactionV1(options.coordinationSiteId, async ({ db }) => {
      const current = await state(db, options.coordinationSiteId);
      const cursor = current.cursors[key];
      const rows = await db
        .select({ id: npSites.id })
        .from(npSites)
        .where(cursor ? gt(npSites.id, cursor) : undefined)
        .orderBy(asc(npSites.id))
        .limit(BATCH);
      current.cursors[key] = rows.length === BATCH ? rows.at(-1)!.id : null;
      await save(db, options.coordinationSiteId, current, now());
      return rows.map((row) => row.id);
    });
  }
  async function fanout(key: SiteCursor, visit: (siteId: string) => Promise<void>) {
    let failed = false;
    // Advance the durable fair cursor before I/O. A lost enqueue remains eligible on the next wrap.
    for (const siteId of await sites(key)) {
      try {
        await withCurrentSite(siteId, () => visit(siteId));
      } catch {
        failed = true;
      }
    }
    if (failed) unavailable();
  }
  async function pending(siteId: string) {
    return npWithAgentRuntimeControlTransactionV1(siteId, async ({ db }) => {
      const current = await state(db, siteId);
      const at = now();
      const hadCursor = Boolean(current.cursors.events || current.cursors.runs);
      const events = await db
        .select({ id: npAgentEvents.id })
        .from(npAgentEvents)
        .where(
          and(
            eq(npAgentEvents.siteId, siteId),
            isNull(npAgentEvents.dispatchedAt),
            gt(npAgentEvents.expiresAt, at),
            current.cursors.events ? gt(npAgentEvents.id, current.cursors.events) : undefined,
          ),
        )
        .orderBy(asc(npAgentEvents.id))
        .limit(BATCH);
      const runs = await db
        .select({ id: npAgentRuns.id })
        .from(npAgentRuns)
        .where(
          and(
            eq(npAgentRuns.siteId, siteId),
            eq(npAgentRuns.origin, "runtime"),
            isNull(npAgentRuns.finishedAt),
            or(
              eq(npAgentRuns.state, "queued"),
              and(eq(npAgentRuns.state, "waiting_retry"), lte(npAgentRuns.runtimeRetryAt, at)),
              and(
                inArray(npAgentRuns.state, ["running", "verifying"]),
                or(isNull(npAgentRuns.leaseUntil), lte(npAgentRuns.leaseUntil, at)),
              ),
            ),
            current.cursors.runs ? gt(npAgentRuns.id, current.cursors.runs) : undefined,
          ),
        )
        .orderBy(asc(npAgentRuns.id))
        .limit(BATCH);
      current.cursors.events = events.length === BATCH ? events.at(-1)!.id : null;
      current.cursors.runs = runs.length === BATCH ? runs.at(-1)!.id : null;
      // Empty/default sites do not acquire Agent settings merely because a host scanned them.
      if (events.length || runs.length || hadCursor) await save(db, siteId, current, at);
      return { events, runs };
    });
  }
  const dispatch = safe<NpBuiltinJobPayloadMap["agent:eventDispatch"]>(async (input) => {
    await options.events.dispatch(input);
  });
  const execute = safe<NpBuiltinJobPayloadMap["agent:runExecute"]>(async (input) => {
    await options.executor.process(input);
  });
  const reconcile = safe<NpBuiltinJobPayloadMap["agent:eventReconcile"]>(async () => {
    await fanout("eventSites", async (siteId) => {
      const rows = await pending(siteId);
      let failed = false;
      for (const event of rows.events) {
        try {
          await enqueue("agent:eventDispatch", { siteId, eventId: event.id });
        } catch {
          failed = true;
        }
      }
      for (const run of rows.runs) {
        try {
          await enqueue("agent:runExecute", { siteId, runId: run.id });
        } catch {
          failed = true;
        }
      }
      if (failed) unavailable();
    });
  });
  const schedule = safe<NpBuiltinJobPayloadMap["agent:scheduleTick"]>(async () => {
    await fanout("scheduleSites", async (siteId) => {
      const cursor = await npWithAgentRuntimeControlTransactionV1(
        siteId,
        async ({ db }) => (await state(db, siteId)).cursors.triggers,
      );
      const result = await options.events.schedule({
        siteId,
        ...(cursor ? { cursor } : {}),
        limit: BATCH,
      });
      if (cursor || result.nextCursor || result.runIds.length)
        await npWithAgentRuntimeControlTransactionV1(siteId, async ({ db }) => {
          const current = await state(db, siteId);
          current.cursors.triggers = result.nextCursor;
          await save(db, siteId, current, now());
        });
      // Source notification is optional; the durable Run remains independently recoverable.
      if (result.enqueued < result.runIds.length)
        for (const runId of result.runIds) await enqueue("agent:runExecute", { siteId, runId });
      if (result.failed) unavailable();
    });
  });
  const prune = safe<NpBuiltinJobPayloadMap["agent:retentionPrune"]>(async ({ siteId }) => {
    await npPruneAgentRuntimeJobV1({ siteId, now });
  });
  const retention = safe<NpBuiltinJobPayloadMap["agent:retentionTick"]>(async () => {
    await fanout("retentionSites", (siteId) => enqueue("agent:retentionPrune", { siteId }));
  });
  let installed = false;
  return {
    register() {
      npAssertAgentPreviewEffectsAllowed();
      if (installed) return;
      for (const name of [
        "agent:eventDispatch",
        "agent:runExecute",
        "agent:retentionPrune",
        "agent:eventReconcile",
        "agent:scheduleTick",
        "agent:retentionTick",
      ] as const) {
        if (getJobHandler(name)) unavailable();
      }
      registerJobHandler("agent:eventDispatch", dispatch, { resolveSiteId });
      registerJobHandler("agent:runExecute", execute, { resolveSiteId, quota: "site" });
      registerJobHandler("agent:retentionPrune", prune, { resolveSiteId });
      registerJobHandler("agent:eventReconcile", reconcile);
      registerJobHandler("agent:scheduleTick", schedule);
      registerJobHandler("agent:retentionTick", retention);
      installed = true;
    },
    /** Same closed payload parser as enqueue and dispatch; caller cannot supply authority. */
    async reconcile() {
      await reconcile(npNormalizeJobPayload("agent:eventReconcile", {}));
    },
  };
}
