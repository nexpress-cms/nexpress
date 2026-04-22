import { PgBoss, type ConstructorOptions, type Job } from "pg-boss";
import { type NxJobType } from "../config/types.js";
import { getAllJobHandlers } from "./handlers.js";
import { type NxJobQueue } from "./queue.js";

/**
 * pg-boss 12+ rejects queue names containing `:`, but NexPress job types use
 * `:` as a namespace separator (e.g. "content:afterSave"). Translate here so
 * the external API keeps its readable form while pg-boss sees an allowed
 * name.
 */
function toQueueName(type: NxJobType): string {
  return type.replace(/:/g, ".");
}

export class PgBossAdapter implements NxJobQueue {
  private readonly boss: PgBoss;

  constructor(connectionString: string, options?: ConstructorOptions) {
    this.boss = new PgBoss({ connectionString, ...options });
  }

  async enqueue(type: NxJobType, data: unknown): Promise<string> {
    const jobId = await this.boss.send(toQueueName(type), asJobPayload(data));

    if (!jobId) {
      throw new Error(`Failed to enqueue job: ${type}`);
    }

    return jobId;
  }

  /**
   * Opens the pg-boss connection and runs its migrations. Safe to call from a
   * non-worker process (e.g. the Next.js server) so it can enqueue jobs.
   */
  async startProducer(): Promise<void> {
    await this.boss.start();
  }

  /**
   * Full start: opens the connection (idempotent with startProducer) and
   * registers `boss.work()` loops for every handler in the registry. Call
   * this from the dedicated worker process.
   */
  async start(): Promise<void> {
    await this.boss.start();

    for (const [type, handler] of getAllJobHandlers()) {
      const queueName = toQueueName(type);
      await this.boss.createQueue(queueName);
      await this.boss.work(queueName, async (jobs: Job<unknown>[]) => {
        for (const job of jobs) {
          await handler(job.data);
        }
      });
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30000 });
  }

  async scheduleRecurring(): Promise<void> {
    await this.boss.schedule(toQueueName("system:revisionPrune"), "0 3 * * *", {});
    await this.boss.schedule(toQueueName("system:sessionCleanup"), "0 * * * *", {});
  }

  getBoss(): PgBoss {
    return this.boss;
  }
}

function asJobPayload(data: unknown): object {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { payload: data };
  }

  return data;
}
