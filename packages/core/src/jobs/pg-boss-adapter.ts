import { PgBoss, type ConstructorOptions, type Job } from "pg-boss";
import { type NxJobType } from "../config/types.js";
import { getAllJobHandlers } from "./handlers.js";
import { type NxJobQueue } from "./queue.js";

export class PgBossAdapter implements NxJobQueue {
  private readonly boss: PgBoss;

  constructor(connectionString: string, options?: ConstructorOptions) {
    this.boss = new PgBoss({ connectionString, ...options });
  }

  async enqueue(type: NxJobType, data: unknown): Promise<string> {
    const jobId = await this.boss.send(type, asJobPayload(data));

    if (!jobId) {
      throw new Error(`Failed to enqueue job: ${type}`);
    }

    return jobId;
  }

  async start(): Promise<void> {
    await this.boss.start();

    for (const [type, handler] of getAllJobHandlers()) {
      await this.boss.work(type, async (jobs: Job<unknown>[]) => {
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
    await this.boss.schedule("system:revisionPrune", "0 3 * * *", {});
    await this.boss.schedule("system:sessionCleanup", "0 * * * *", {});
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
