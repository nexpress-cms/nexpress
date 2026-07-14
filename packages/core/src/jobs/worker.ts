import { registerBuiltinHandlers } from "./builtin-handlers.js";
import { startHeartbeatLoop } from "./heartbeat.js";
import { getJobsPauseState, startPauseSyncLoop, type PauseSyncLoopHandle } from "./pause-state.js";
import { PgBossAdapter } from "./pg-boss-adapter.js";
import { getOptionalJobQueue, setJobQueue } from "./queue.js";
import { getLogger } from "../observability/logger.js";
import { shutdownObservability } from "../observability/runtime.js";

let workerAdapter: PgBossAdapter | null = null;
let producerAdapter: PgBossAdapter | null = null;
let heartbeatHandle: { stop(): Promise<void> } | null = null;
let pauseSyncHandle: PauseSyncLoopHandle | null = null;
let signalHandlersInstalled = false;
const installedSignalHandlers = new Map<NodeJS.Signals, () => void>();

function clearQueueIfOwned(adapter: PgBossAdapter): void {
  if (getOptionalJobQueue() === adapter) setJobQueue(null);
}

function installShutdownSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  // Ensure the heartbeat row flips to `stopped` synchronously
  // before the process exits, even on signal-driven shutdown.
  // Without this a SIGTERM-driven shutdown raced with the
  // event-loop stopping and the row drifted into `unhealthy`
  // for a full WORKER_STALE_THRESHOLD_MS window.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = (): void => {
      void (async () => {
        try {
          await stopWorker();
        } catch (err) {
          getLogger().warn("Worker shutdown handler failed", {
            signal,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          try {
            await shutdownObservability();
          } catch (error) {
            // The configured logger has already been detached; use the
            // process console as the final non-recursive failure sink.
            console.error("[nexpress] observability shutdown failed:", error);
          }
          process.exit(0);
        }
      })();
    };
    process.on(signal, handler);
    installedSignalHandlers.set(signal, handler);
  }
}

function removeShutdownSignalHandlers(): void {
  if (!signalHandlersInstalled) return;
  for (const [signal, handler] of installedSignalHandlers) {
    process.off(signal, handler);
  }
  installedSignalHandlers.clear();
  signalHandlersInstalled = false;
}

export async function startWorker(
  connectionString: string,
  options?: {
    schema?: string;
    heartbeat?: boolean | { meta?: Record<string, unknown> };
    /**
     * When true (default), startWorker installs SIGINT / SIGTERM
     * listeners that call `stopWorker()` and `process.exit(0)`.
     * Set false in environments that manage their own shutdown
     * sequencing (custom supervisors, embedded test harnesses).
     */
    installSignalHandlers?: boolean;
  },
): Promise<void> {
  if (workerAdapter) {
    return;
  }

  registerBuiltinHandlers();

  workerAdapter = new PgBossAdapter(connectionString, {
    schema: options?.schema ?? "pgboss",
  });

  setJobQueue(workerAdapter);

  // #318 — wrap the post-init steps so a throw partway through
  // doesn't strand a half-set-up worker (signal handlers armed
  // on null state, dangling heartbeat row, etc). The catch
  // unwinds whatever did succeed before re-throwing, so the
  // orchestrator sees the original error and a subsequent
  // `startWorker()` retry starts from a clean slate.
  try {
    await workerAdapter.start();
    await workerAdapter.scheduleRecurring();

    // Phase 20.2 — if the operator paused processing while the
    // worker was offline, honor it on boot. The flag is global
    // (in `np_settings` siteId="_system") so it survives worker
    // restarts. Read and contract failures abort startup: running
    // jobs against an unknown persisted pause state is unsafe.
    const pauseState = await getJobsPauseState();
    if (pauseState.paused) {
      await workerAdapter.pauseProcessing();
      getLogger().info("Worker booted in paused state", {
        changedAt: pauseState.changedAt,
        reason: pauseState.reason,
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
      // Phase 20.2 — multi-pod pause sync. Each tick reads the
      // persisted flag and applies any divergence to the local
      // adapter, so an operator pause on one pod propagates to
      // the rest within ~30 s. Same gate as the heartbeat — if
      // the operator opted out of background loops (tests), we
      // skip this too.
      pauseSyncHandle = startPauseSyncLoop(workerAdapter);
    }

    // Install signal handlers LAST — if any earlier step threw,
    // the catch below has already unwound; we don't want to arm
    // shutdown handlers that would then fire against null state.
    if (options?.installSignalHandlers !== false) {
      installShutdownSignalHandlers();
    }
  } catch (err) {
    // Best-effort cleanup of whatever did succeed. Each step is
    // its own try so one failure here doesn't mask the original.
    if (heartbeatHandle) {
      try {
        await heartbeatHandle.stop();
      } catch {
        /* swallow — original error matters more */
      }
      heartbeatHandle = null;
    }
    if (pauseSyncHandle) {
      try {
        pauseSyncHandle.stop();
      } catch {
        /* swallow */
      }
      pauseSyncHandle = null;
    }
    const failedAdapter = workerAdapter;
    if (failedAdapter) {
      try {
        await failedAdapter.stop();
      } catch {
        /* swallow */
      }
      if (workerAdapter === failedAdapter) workerAdapter = null;
      clearQueueIfOwned(failedAdapter);
    }
    removeShutdownSignalHandlers();
    throw err;
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

  const adapter = new PgBossAdapter(connectionString, {
    schema: options?.schema ?? "pgboss",
  });
  producerAdapter = adapter;

  setJobQueue(adapter);

  try {
    await adapter.startProducer();
  } catch (error) {
    try {
      await adapter.stop();
    } catch {
      // Preserve the startup error; stop is best-effort for partial starts.
    }
    if (producerAdapter === adapter) producerAdapter = null;
    clearQueueIfOwned(adapter);
    throw error;
  }
}

export async function stopWorker(): Promise<void> {
  const adapter = workerAdapter;
  if (!adapter) return;

  let stopError: unknown;

  // Phase 19 — stop the heartbeat first so the row flips to
  // `stopped` while the DB is still reachable. The pg-boss
  // shutdown then clears the queue lock cleanly.
  if (heartbeatHandle) {
    try {
      await heartbeatHandle.stop();
    } catch (error) {
      stopError = error;
    }
    heartbeatHandle = null;
  }

  // Phase 20.2 — pause sync interval is just an in-memory
  // timer; clear it before tearing down the queue so a
  // late-firing tick doesn't try to call pauseProcessing on a
  // half-shut-down adapter.
  if (pauseSyncHandle) {
    try {
      pauseSyncHandle.stop();
    } catch (error) {
      stopError ??= error;
    }
    pauseSyncHandle = null;
  }

  try {
    await adapter.stop();
  } catch (error) {
    stopError ??= error;
  }
  if (workerAdapter === adapter) workerAdapter = null;
  clearQueueIfOwned(adapter);
  removeShutdownSignalHandlers();
  if (stopError) {
    throw stopError instanceof Error
      ? stopError
      : new Error("Job worker shutdown failed with a non-Error value.", { cause: stopError });
  }
}

export async function stopProducer(): Promise<void> {
  const adapter = producerAdapter;
  if (!adapter) return;

  try {
    await adapter.stop();
  } finally {
    if (producerAdapter === adapter) producerAdapter = null;
    clearQueueIfOwned(adapter);
  }
}
