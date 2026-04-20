import { registerBuiltinHandlers } from "./builtin-handlers.js";
import { PgBossAdapter } from "./pg-boss-adapter.js";
import { setJobQueue } from "./queue.js";

let workerAdapter: PgBossAdapter | null = null;

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

export async function stopWorker(): Promise<void> {
  if (!workerAdapter) {
    return;
  }

  await workerAdapter.stop();
  workerAdapter = null;
}
