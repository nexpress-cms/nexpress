import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pruneAgentRuntimeEventsV1 } from "../../../packages/core/src/agent/runtime-maintenance.js";
import { createAgentRuntimeExecutorV1 } from "../../../packages/core/src/agent/runtime-executor.js";
import { createAgentRuntimeExecutionStoreV1 } from "../../../packages/core/src/agent/runtime-execution-store.js";
import { createAgentRuntimeContextV1 } from "../../../packages/core/src/agent/runtime-context.js";
import { createAgentRuntimeUsageV1 } from "../../../packages/core/src/agent/runtime-usage.js";
import { createAgentRuntimeBreakersV1 } from "../../../packages/core/src/agent/runtime-breakers.js";
import { createAgentProviderInferenceRuntimeV1 } from "../../../packages/core/src/agent/provider-inference.js";
import { createAgentCapabilityAdmissionServiceV1 } from "../../../packages/core/src/agent/capability-admission.js";
import { createAgentReadCapabilityRegistryV1 } from "../../../packages/core/src/agent/capability-registry.js";
import { createAgentCoreReadCapabilityExecutorsV1 } from "../../../packages/core/src/agent/read-capability-executors.js";
import { npAgentDisabledGatewaySettingsV1 } from "../../../packages/core/src/agent-contract/types.js";
import { findDocuments, saveDocument } from "../../../packages/core/src/collections/pipeline.js";
import { npCreateEmptyRichTextContent } from "../../../packages/core/src/fields/rich-text.js";
import { withCurrentSite } from "../../../packages/core/src/sites/context.js";
import { registerBuiltinHandlers } from "../../../packages/core/src/jobs/builtin-handlers.js";
import { getJobHandler } from "../../../packages/core/src/jobs/handlers.js";
import { DEFAULT_JOB_LOG_RETENTION_MS } from "../../../packages/core/src/jobs/job-log.js";
import { npAuditEvents } from "../../../packages/core/src/db/schema/community.js";
import { npJobLogs } from "../../../packages/core/src/db/schema/system.js";
import {
  npAgentEvents,
  npAgentProviderCalls,
  npAgentUsageReservations,
} from "../../../packages/core/src/db/schema/agent.js";
import { runtimeUsageFixture } from "./agent-runtime-usage-fixture.js";
import { siteId } from "./agent-runtime-service-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Runtime provider outage isolation", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("keeps CMS and unrelated maintenance available during retention contention after provider failure", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("private unavailable provider"));
    const f = await runtimeUsageFixture({
      dataClassCeiling: "internal-redacted",
      providerInference: { invoke },
    });
    const store = createAgentRuntimeExecutionStoreV1({
      admission: f.admission,
      now: f.options.now,
    });
    const registry = await createAgentReadCapabilityRegistryV1(
      createAgentCoreReadCapabilityExecutorsV1({
        cursorHmacKey: { id: "runtime-isolation", key: new Uint8Array(32).fill(7) },
        resolveUser: () => null,
        resolveBlockSchemas: () => [],
      }),
    );
    const capabilities = createAgentCapabilityAdmissionServiceV1({
      registry,
      runtimeAdmission: f.admission,
      resolveGatewaySettings: () => npAgentDisabledGatewaySettingsV1,
      now: f.options.now,
    });
    const context = createAgentRuntimeContextV1({
      admission: f.admission,
      capabilities: {
        list: capabilities.sourceEntries,
        actionOutcomes: capabilities.runtimeActionOutcomes,
      },
    });
    const usage = createAgentRuntimeUsageV1({
      admission: f.admission,
      ambiguityWindowSeconds: 300,
      verifyRequest: context.verifyRequest,
      now: f.options.now,
    });
    const provider = createAgentProviderInferenceRuntimeV1({
      registry: f.providerRegistry,
      now: f.options.now,
    });
    const executor = createAgentRuntimeExecutorV1({
      store,
      context,
      usage,
      provider,
      providerRegistry: f.providerRegistry,
      vault: f.vault,
      capabilities,
      breakers: createAgentRuntimeBreakersV1({
        failureThreshold: 3,
        windowSeconds: 60,
        cooldownSeconds: 30,
        now: f.options.now,
      }),
      now: f.options.now,
    });

    try {
      const input = { siteId, runId: f.runId };
      expect(await executor.process(input)).toEqual({ state: "failed" });
      expect((await f.db.select().from(npAgentProviderCalls))[0]).toMatchObject({
        state: "ambiguous",
        dispatchState: "unknown",
        retryable: false,
      });
      expect((await f.db.select().from(npAgentUsageReservations))[0]?.state).toBe("reserved");

      const recordedAt = new Date(f.options.now().getTime() - 60_000);
      const expired = {
        id: randomUUID(),
        siteId,
        kind: "jobs.handler.failed",
        sourceKind: "jobs",
        sourceComponent: "runtime-isolation",
        eventHash: `cj1:sha256:${"A".repeat(43)}`,
        privacy: "internal",
        payload: {
          kind: "jobs.handler.failed" as const,
          handlerName: "agent:runExecute",
          jobId: randomUUID(),
          reasonCode: "UNAVAILABLE",
        },
        occurredAt: recordedAt,
        recordedAt,
        dispatchedAt: recordedAt,
        expiresAt: new Date(recordedAt.getTime() + 30_000),
      };
      await f.db.insert(npAgentEvents).values(expired);
      const events = await f.db.select().from(npAgentEvents);
      const epoch = await f.db.execute(sql`select epoch from np_agent_reference_fence where id=1`);
      await f.db.transaction(async (writer) => {
        // A real reference writer holds the shared ingress barrier. The actual
        // retention transaction must defer at its NOWAIT fence, releasing its
        // site lock without deleting the eligible event or advancing the epoch.
        await writer.insert(npAuditEvents).values({
          siteId,
          actorKind: "system",
          action: "runtime-isolation.reference-writer",
          payload: { reason: "retention contention" },
        });
        await Promise.all([
          expect(pruneAgentRuntimeEventsV1({ siteId, now: f.options.now() })).rejects.toMatchObject(
            {
              cause: { code: "55P03" },
            },
          ),
          (async () => {
            await withCurrentSite(siteId, async () => {
              const created = await saveDocument(
                "posts",
                null,
                { title: "CMS remains available", content: npCreateEmptyRichTextContent() },
                f.actor.actor.user,
                { status: "published" },
              );
              const id = String(created.doc.id);
              const read = () => findDocuments("posts", { where: { id } }, f.actor.actor.user);
              expect((await read()).docs).toMatchObject([{ id, title: "CMS remains available" }]);
              await saveDocument(
                "posts",
                id,
                { title: "Updated during outage" },
                f.actor.actor.user,
              );
              expect((await read()).docs).toMatchObject([{ id, title: "Updated during outage" }]);
            });

            // Exercise the real independent handler and database effect. This does
            // not claim a pg-boss dispatch or a fresh CMS bootstrap was performed.
            await f.db.insert(npJobLogs).values([
              {
                jobId: "runtime-isolation-expired",
                level: "info",
                message: "Old unrelated job",
                createdAt: new Date(Date.now() - DEFAULT_JOB_LOG_RETENTION_MS - 60_000),
              },
              { jobId: "runtime-isolation-fresh", level: "info", message: "Current unrelated job" },
            ]);
            registerBuiltinHandlers();
            const prune = getJobHandler("system:jobLogPrune");
            if (!prune) throw new Error("Built-in job log retention handler missing");
            await prune({});
            expect(await f.db.select({ jobId: npJobLogs.jobId }).from(npJobLogs)).toEqual([
              { jobId: "runtime-isolation-fresh" },
            ]);
          })(),
        ]);
        expect(await f.db.select().from(npAgentEvents)).toEqual(events);
        expect(
          (await f.db.execute(sql`select epoch from np_agent_reference_fence where id=1`)).rows,
        ).toEqual(epoch.rows);
      });
      // Once the writer commits, the same real cleanup succeeds. The outage's
      // ambiguous provider call and unresolved reservation remain protected.
      expect(await pruneAgentRuntimeEventsV1({ siteId, now: f.options.now() })).toEqual({
        examined: 1,
        pruned: 1,
        nextCursor: null,
      });
      expect(await f.db.select().from(npAgentEvents)).toHaveLength(0);
      expect((await f.db.select().from(npAgentProviderCalls))[0]).toMatchObject({
        state: "ambiguous",
        dispatchState: "unknown",
      });
      expect(await executor.process(input)).toEqual({ state: "failed" });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect((await f.db.select().from(npAgentUsageReservations))[0]?.state).toBe("reserved");
    } finally {
      executor.shutdown();
      context.dispose();
      await provider.shutdown();
      await f.dispose();
    }
  });
});
