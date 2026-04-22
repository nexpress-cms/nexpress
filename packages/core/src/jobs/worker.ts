import { registerBuiltinHandlers } from "./builtin-handlers.js";
import { PgBossAdapter } from "./pg-boss-adapter.js";
import { setJobQueue } from "./queue.js";

let workerAdapter: PgBossAdapter | null = null;
let producerAdapter: PgBossAdapter | null = null;

export async function startWorker(
  connectionString: string,
  options?: { schema?: string },
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
