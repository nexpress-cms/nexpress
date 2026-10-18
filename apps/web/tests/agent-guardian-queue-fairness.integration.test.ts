import { performance } from "node:perf_hooks";
import {
  getOptionalStorageRuntimeConfig as getInstalledStorageConfig,
  getStorageAdapter as getInstalledStorageAdapter,
} from "@nexpress/core/storage";
import { and, asc, count, eq, lt, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { npAgentEvents, npAgentRuns } from "../../../packages/core/src/db/schema/agent.js";
import { npAgentContentReceipts } from "../../../packages/core/src/db/schema/guardian.js";
import { npMedia } from "../../../packages/core/src/db/schema/media.js";
import { npRevisions, npSessions, npSites } from "../../../packages/core/src/db/schema/system.js";
import { createAgentRuntimeJobsV1 } from "../../../packages/core/src/agent/runtime-jobs.js";
import { PgBossAdapter } from "../../../packages/core/src/jobs/pg-boss-adapter.js";
import { setStorageAdapter } from "../../../packages/core/src/storage/registry.js";
import { npStorageObjectExists } from "../../../packages/core/src/storage/operations.js";
import { deleteMedia, uploadMedia } from "../../../packages/core/src/media/service.js";
import {
  configureBuiltinJobContext,
  registerBuiltinHandlers,
} from "../../../packages/core/src/jobs/builtin-handlers.js";
import { enqueueJob, setJobQueue } from "../../../packages/core/src/jobs/queue.js";
import { getCurrentSiteId, withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import {
  resetCollectionMutationObserverV1,
  setCollectionMutationObserverV1,
} from "../../../packages/core/src/collections/mutation-observer.js";
import {
  guardianAcceptanceCount,
  guardianAcceptanceTimeoutMs,
  guardianPrepareContent,
  guardianQuantiles,
  guardianReport,
  guardianSourceFixture,
  skipGuardianAcceptance,
} from "./agent-guardian-acceptance-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  getTestDatabaseUrl,
  registerTestCollections,
  truncateAll,
} from "./harness.js";

/** One genuine 10k content fixture serves capacity AND queue fairness. No
 * generated receipt SQL, fabricated Runs, provider or reduced workload. */
describe.skipIf(skipGuardianAcceptance)(
  "Guardian retained 10k content and real worker fairness",
  () => {
    beforeAll(ensureMigrated);
    beforeEach(async () => {
      await truncateAll();
      registerTestCollections();
      setJobQueue(null);
    });
    afterEach(() => {
      vi.useRealTimers();
      resetCollectionMutationObserverV1();
      configureBuiltinJobContext({ cleanupSessions: undefined });
      setJobQueue(null);
    });
    afterAll(closeTestDb);

    it(
      "reaches the later tenant through the durable25-site cursor, runs actual cleanup/content jobs under Guardian maintenance load, then drains all10000 receipts",
      async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const now = new Date();
        vi.setSystemTime(now);
        const sites = Array.from(
          { length: 26 },
          (_, index) => `guardian-fair-${String(index).padStart(2, "0")}`,
        );
        const hot = sites[0],
          later = sites.at(-1)!;
        const fixture = await guardianSourceFixture(["default", ...sites], () => new Date(now));
        const prepared = await guardianPrepareContent(fixture, [
          { siteId: hot, count: guardianAcceptanceCount },
          { siteId: later, count: 1 },
        ]);
        expect(prepared.committedSaves).toBe(guardianAcceptanceCount + 1);
        const receiptCount = async (siteId: string) => {
          const [row] = await fixture.db
            .select({ count: count() })
            .from(npAgentContentReceipts)
            .where(eq(npAgentContentReceipts.siteId, siteId));
          return Number(row.count);
        };
        expect(await receiptCount(hot)).toBe(guardianAcceptanceCount);
        expect(await fixture.db.select().from(npRevisions)).toHaveLength(0);
        const catalog = await fixture.db
          .select({ id: npSites.id })
          .from(npSites)
          .orderBy(asc(npSites.id));
        expect(catalog.length).toBeGreaterThanOrEqual(26);
        expect(catalog.findIndex((site) => site.id === later)).toBeGreaterThanOrEqual(25);
        const visits: string[] = [];
        const batchDurations: number[] = [];
        const hotTotals = {
          processed: 0,
          emitted: 0,
          blocked: 0,
          sampled: 0,
          held: 0,
          nonemptyBatches: 0,
        };
        let failures = 0;
        let injectHotFailure = true;
        const collectionStarted = performance.now();
        const collect: typeof fixture.contentSource.collect = async (input) => {
          expect(await getCurrentSiteId()).toBe(input.siteId);
          visits.push(input.siteId);
          if (input.siteId === hot && injectHotFailure) {
            injectHotFailure = false;
            failures++;
            throw new Error("Injected hot-source failure before delivery");
          }
          const started = performance.now();
          const result = await fixture.contentSource.collect(input);
          if (input.siteId === hot) {
            batchDurations.push(performance.now() - started);
            hotTotals.processed += result.processed;
            hotTotals.emitted += result.emitted;
            hotTotals.blocked += result.blocked;
            hotTotals.sampled += result.sampled;
            hotTotals.held += result.held;
            if (result.processed) hotTotals.nonemptyBatches++;
          }
          return result;
        };
        let executionCalls = 0;
        const jobs = createAgentRuntimeJobsV1({
          coordinationSiteId: "default",
          events: fixture.events,
          executor: {
            process: async () => {
              executionCalls++;
              throw new Error("No fabricated Run may execute");
            },
          },
          guardianContent: { collect },
          now: () => new Date(now),
        });
        const ticks = Math.ceil(catalog.length / 25);
        for (let tick = 0; tick < ticks; tick++) {
          try {
            await jobs.reconcile();
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            expect(error.message).toBe("Agent runtime job is unavailable.");
          }
        }
        expect(failures).toBe(1);
        expect(new Set(visits)).toEqual(new Set(catalog.map((site) => site.id)));
        const [laterReceipt] = await fixture.db
          .select()
          .from(npAgentContentReceipts)
          .where(eq(npAgentContentReceipts.siteId, later));
        expect(laterReceipt.state).toBe("emitted");
        expect(await receiptCount(hot)).toBe(guardianAcceptanceCount);

        const databaseUrl = getTestDatabaseUrl();
        if (!databaseUrl)
          throw new Error("TEST_DATABASE_URL required for actual worker acceptance");
        registerBuiltinHandlers();
        jobs.register();
        // Source-owned builtin modules use their own registry during tests.
        // Reuse the already initialized host's real local integration adapter.
        const storage = getInstalledStorageAdapter(),
          storageConfig = getInstalledStorageConfig();
        if (
          !process.env.NP_INTEGRATION_STORAGE_ROOT ||
          !process.env.NP_STORAGE_DIR ||
          storage.kind !== "local" ||
          storageConfig?.adapter !== "local" ||
          storageConfig.local.directory !== process.env.NP_STORAGE_DIR
        )
          throw new Error("Fairness media fixture requires the isolated integration local storage");
        setStorageAdapter(storage);
        const uploaded = await withCurrentSite(later, () =>
          uploadMedia(
            {
              buffer: Buffer.from("Synthetic Guardian fairness media cleanup fixture"),
              originalFilename: "guardian-fairness.pdf",
              mimeType: "application/pdf",
            },
            null,
          ),
        );
        await expect(withCurrentSite(later, () => deleteMedia(uploaded.id))).resolves.toEqual({
          deleted: true,
        });
        // Age only the actual soft-deleted fixture row. Its real uploaded local
        // object must remain present until the durable media job deletes it.
        const [expiredMedia] = await fixture.db
          .update(npMedia)
          .set({ deletedAt: new Date(now.getTime() - 31 * 86_400_000) })
          .where(and(eq(npMedia.siteId, later), eq(npMedia.id, uploaded.id)))
          .returning({ id: npMedia.id, storageKey: npMedia.storageKey });
        if (!expiredMedia) throw new Error("Missing eligible real media cleanup fixture");
        expect(await npStorageObjectExists(storage, expiredMedia.storageKey)).toBe(true);
        const adapter = new PgBossAdapter(databaseUrl, { supervise: false, schedule: false });
        let sessionCleanupCalls = 0;
        let queueReport: object | null = null;
        // The standard session job invokes a host-supplied cleanup owner. Bind a
        // real SQL deletion of an exact expired fixture row, not a mock completion.
        const [expired] = await fixture.db.select().from(npSessions).limit(1);
        if (!expired) throw new Error("Missing seeded session for cleanup acceptance");
        await fixture.db
          .update(npSessions)
          .set({ refreshExpiresAt: new Date(now.getTime() - 1000) })
          .where(eq(npSessions.id, expired.id));
        configureBuiltinJobContext({
          async cleanupSessions() {
            await fixture.db
              .delete(npSessions)
              .where(and(eq(npSessions.id, expired.id), lt(npSessions.refreshExpiresAt, now)));
            sessionCleanupCalls++;
          },
        });
        try {
          await adapter.startProducer();
          // Producer startup migrates storage; registered queues are otherwise
          // created only by worker startup, after this intentional preload.
          await adapter.getBoss().createQueue("agent.eventReconcile");
          setJobQueue(adapter);
          const maintenanceIds: string[] = [];
          // Legitimate global maintenance payloads; the installed job calls the
          // real collector against the real backlog, never a fake admitted Run.
          for (let index = 0; index < 80; index++) {
            const id = await enqueueJob("agent:eventReconcile", {});
            if (!id) throw new Error("Maintenance job was not durably enqueued");
            maintenanceIds.push(id);
          }
          await adapter.start();
          // Establish actual work, not merely an unconsumed queue. The first
          // two direct cursor ticks above deliberately processed no hot rows.
          await expect
            .poll(() => hotTotals.processed, { timeout: 30_000, interval: 50 })
            .toBeGreaterThan(0);
          const activeAtEnqueue = await fixture.db.execute<{ count: number }>(sql`
            select count(*)::int as count from pgboss.job
            where name='agent.eventReconcile' and state='active'`);
          expect(Number(activeAtEnqueue.rows[0].count)).toBeGreaterThan(0);
          const hotProcessedBeforeCore = hotTotals.processed;
          const started = performance.now();
          const documentId = prepared.documents.get(later);
          if (!documentId) throw new Error("Missing other-tenant committed document");
          // Let the real pipeline create its ordinary afterSave work. No fake
          // equivalent source or manually invented mutation job is substituted.
          setCollectionMutationObserverV1(fixture.contentSource.mutationObserver);
          try {
            await withCurrentSite(later, () =>
              saveDocument(
                "tags",
                documentId,
                { name: `Capacity ${later}`, description: "Other tenant queued committed save" },
                prepared.users[0],
              ),
            );
          } finally {
            resetCollectionMutationObserverV1();
          }
          const contentJobs = await fixture.db.execute<{ id: string }>(sql`
            select id::text from pgboss.job where name='content.afterSave'
            and data->>'siteId'=${later} and data->>'documentId'=${documentId}`);
          expect(contentJobs.rows).toHaveLength(1);
          const contentId = contentJobs.rows[0].id;
          const sessionId = await enqueueJob("system:sessionCleanup", {});
          const mediaId = await enqueueJob("media:cleanup", {});
          if (!contentId || !sessionId || !mediaId)
            throw new Error("Core work was not durably enqueued");
          const actualCoreState = async () => {
            const result = await fixture.db.execute<{ id: string; state: string }>(sql`
          select id::text,state::text from pgboss.job
          where id in (${contentId}::uuid,${sessionId}::uuid,${mediaId}::uuid)
          order by id`);
            return result.rows;
          };
          await expect
            .poll(async () => (await actualCoreState()).map((row) => row.state), {
              timeout: 30_000,
              interval: 50,
            })
            .toEqual(["completed", "completed", "completed"]);
          expect(
            await fixture.db.select().from(npMedia).where(eq(npMedia.id, expiredMedia.id)),
          ).toHaveLength(0);
          expect(await npStorageObjectExists(storage, expiredMedia.storageKey)).toBe(false);
          const coreFinishedMs = performance.now() - started;
          const pending = await fixture.db.execute<{ count: number }>(sql`
        select count(*)::int as count from pgboss.job
        where name='agent.eventReconcile' and state in ('created','retry','active')`);
          const remaining = Number(pending.rows[0].count);
          const retainedHot = await fixture.db
            .select({ count: count() })
            .from(npAgentContentReceipts)
            .where(
              and(
                eq(npAgentContentReceipts.siteId, hot),
                eq(npAgentContentReceipts.state, "pending"),
              ),
            );
          queueReport = {
            maintenanceJobs: maintenanceIds.length,
            maintenanceJobsStillPending: remaining,
            hotReceiptsStillPending: Number(retainedHot[0].count),
            coreFinishedMs,
            hotProcessedBeforeCore,
            hotProcessedWhenCoreFinished: hotTotals.processed,
            coreStates: await actualCoreState(),
            sessionCleanupCalls,
            sessionCleanupOwner:
              "fixture-owned exact expired-row SQL through the real optional builtin callback; no production cleanup policy claimed",
            mediaCleanupOwner:
              "actual default cleanupDeletedMedia(30) removed an eligible real soft-deleted row and its uploaded isolated local object",
            mediaRowAndObjectRemoved: true,
            path: "canonical PgBossAdapter + registered Runtime reconcile + actual content collector + built-in content/media/session handlers",
          };
          guardianReport("queue-fairness", queueReport);
          expect(remaining).toBeGreaterThan(0);
          expect(Number(retainedHot[0].count)).toBeGreaterThan(0);
          expect(sessionCleanupCalls).toBe(1);
          expect(
            await fixture.db.select().from(npSessions).where(eq(npSessions.id, expired.id)),
          ).toHaveLength(0);
        } finally {
          await adapter.stop();
          setJobQueue(null);
          // This isolated fixture owns these real queued jobs. Remove only after
          // the worker drains, before the next test can truncate referenced rows.
          await fixture.db.execute(sql`delete from pgboss.job where name in (
        'agent.eventReconcile','content.afterSave','system.sessionCleanup','media.cleanup')`);
        }
        // Exact 400 nonempty batches include work already performed by the actual
        // worker above. Every remaining receipt is still actually verified.
        for (let batch = 0; hotTotals.processed < guardianAcceptanceCount; batch++) {
          if (batch >= 400)
            throw new Error("Content collector did not progress within400 real batches");
          const result = await withCurrentSite(hot, () => collect({ siteId: hot, limit: 25 }));
          expect(result.processed).toBe(25);
        }
        const empty = await fixture.contentSource.collect({ siteId: hot, limit: 25 });
        guardianReport("content-10000", {
          setup: { preparationMs: prepared.preparationMs, committedSaves: prepared.committedSaves },
          hotSite: hot,
          hotCommittedSaves: guardianAcceptanceCount,
          hotTotals,
          sourceBatchTiming: guardianQuantiles(batchDurations),
          sourceBatchWorkMs: batchDurations.reduce((sum, value) => sum + value, 0),
          collectionWallElapsedMs: performance.now() - collectionStarted,
          finalBacklog: empty.backlog,
          cursorTicks: ticks,
          catalogSize: catalog.length,
          sourceFailures: failures,
          queueReport,
          basis:
            "all10000 real committed-save receipts; revisions disabled;100 emitted/9900 sampled are lower-bound coverage",
        });
        expect(hotTotals).toEqual({
          processed: 10_000,
          emitted: 100,
          blocked: 0,
          sampled: 9900,
          held: 0,
          nonemptyBatches: 400,
        });
        expect(empty).toMatchObject({ state: "collecting", processed: 0, backlog: 0 });
        const states = await fixture.db
          .select({ state: npAgentContentReceipts.state, count: count() })
          .from(npAgentContentReceipts)
          .where(eq(npAgentContentReceipts.siteId, hot))
          .groupBy(npAgentContentReceipts.state);
        expect(Object.fromEntries(states.map((row) => [row.state, Number(row.count)]))).toEqual({
          emitted: 100,
          sampled: 9900,
        });
        const [event] = await fixture.db
          .select()
          .from(npAgentEvents)
          .where(eq(npAgentEvents.siteId, hot))
          .limit(1);
        expect(
          await fixture.contentSource.verifyEvent({
            db: fixture.db,
            siteId: hot,
            eventId: event.id,
          }),
        ).toMatchObject({ source: "content", eventId: event.id });
        expect(await fixture.db.select().from(npAgentRuns)).toHaveLength(0);
        expect(executionCalls).toBe(0);
        expect(fixture.forbiddenCalls()).toBe(0);
      },
      guardianAcceptanceTimeoutMs,
    );
  },
);
