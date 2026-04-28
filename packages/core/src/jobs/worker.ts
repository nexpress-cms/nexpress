import { registerBuiltinHandlers } from "./builtin-handlers.js";
import { startHeartbeatLoop } from "./heartbeat.js";
import { getJobsPauseState } from "./pause-state.js";
import { PgBossAdapter } from "./pg-boss-adapter.js";
import { setJobQueue } from "./queue.js";
import { getLogger } from "../observability/logger.js";

let workerAdapter: PgBossAdapter | null = null;
let producerAdapter: PgBossAdapter | null = null;
let heartbeatHandle: { stop(): Promise<void> } | null = null;

export async function startWorker(
  connectionString: string,
  options?: {
    schema?: string;
    heartbeat?: boolean | { meta?: Record<string, unknown> };
  },
): Promise<void> {
  if (workerAdapter) {
    return;
  }

  registerBuiltinHandlers();

  workerAdapter = new PgBossAdapter(connectionString, {
    schema: options?.schema ?? "public",
  });

  setJobQueue(workerAdapter);

  await workerAdapter.start();
  await workerAdapter.scheduleRecurring();

  // Phase 20.2 — if the operator paused processing while the
  // worker was offline, honor it on boot. The flag is global
  // (in `nx_settings` siteId="_system") so it survives worker
  // restarts. We swallow read errors because a pre-migrate DB
  // would otherwise stop the worker from starting at all —
  // safer to default to "running" than to refuse to boot.
  try {
    const pauseState = await getJobsPauseState();
    if (pauseState.paused) {
      await workerAdapter.pauseProcessing();
      getLogger().info("Worker booted in paused state", {
        changedAt: pauseState.changedAt,
        reason: pauseState.reason,
      });
    }
  } catch (err) {
    getLogger().warn("Could not read jobs pause state on worker boot", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Phase 19 — start the heartbeat loop AFTER pg-boss is up so
  // a misconfigured DB surfaces as a `boss.start()` throw
  // rather than a heartbeat row that lies about a worker that
  // never really booted. Tests can pass `heartbeat: false` to
  // skip the recurring interval.
  const heartbeatOpt = options?.heartbeat ?? true;
  if (heartbeatOpt !== false) {
    const meta = typeof heartbeatOpt === "object" ? (heartbeatOpt.meta ?? {}) : {};
    heartbeatHandle = startHeartbeatLoop(meta);
  }
}

/**
 * Enqueue-only setup for the web/API process. Wires pg-boss as the job queue
 * singleton without attaching any `boss.work()` loops — those belong in the
 * dedicated worker process. Calling `enqueueJob` after this will actually
 * send jobs instead of no-op'ing.
 */
export async function startProducer(
  connectionString: string,
  options?: { schema?: string },
): Promise<void> {
  if (producerAdapter) {
    return;
  }

  producerAdapter = new PgBossAdapter(connectionString, {
    schema: options?.schema ?? "public",
  });

  setJobQueue(producerAdapter);

  await producerAdapter.startProducer();
}

export async function stopWorker(): Promise<void> {
  if (!workerAdapter) {
    return;
  }

  // Phase 19 — stop the heartbeat first so the row flips to
  // `stopped` while the DB is still reachable. The pg-boss
  // shutdown then clears the queue lock cleanly.
  if (heartbeatHandle) {
    await heartbeatHandle.stop();
    heartbeatHandle = null;
  }

  await workerAdapter.stop();
  workerAdapter = null;
}

export async function stopProducer(): Promise<void> {
  if (!producerAdapter) {
    return;
  }

  await producerAdapter.stop();
  producerAdapter = null;
}
