import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npAgentChangesets, npAgentRuns } from "../../../packages/core/src/db/schema/agent.js";
import { npReconcileChangeSetExecutionProjectionV1 } from "../../../packages/core/src/agent/changeset-execution-projection.js";
import { runtimeApprovalResumeFixture } from "./agent-runtime-approval-resume-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("Runtime execution projection lock order", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);

  it("waits for the Runtime Run before taking the ChangeSet parent lock", async () => {
    const f = await runtimeApprovalResumeFixture();
    let markLocked!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => {
      markLocked = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = f.db.transaction(async (tx) => {
      await tx
        .select()
        .from(npAgentRuns)
        .where(and(eq(npAgentRuns.siteId, f.input.siteId), eq(npAgentRuns.id, f.input.runId)))
        .for("update");
      const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      markLocked(result.rows[0]!.pid);
      await released;
    });
    const holderPid = await locked;
    const reconciliation = npReconcileChangeSetExecutionProjectionV1({
      siteId: f.input.siteId,
      invocationId: f.requested.invocationId,
      now: f.options.now(),
    });
    const completion = Promise.allSettled([reconciliation]);
    try {
      // Confirm the actual database wait, rather than relying on a delay to guess ordering.
      await expect
        .poll(
          async () => {
            const result = await f.db.execute<{ waiting: boolean }>(sql`
          select exists(select 1 from pg_stat_activity
            where datname = current_database() and ${holderPid} = any(pg_blocking_pids(pid))) as waiting
        `);
            return result.rows[0]?.waiting;
          },
          { timeout: 5_000 },
        )
        .toBe(true);
      // A Run-owning Runtime invocation must remain able to take this parent next.
      // The old parent→Run projection order holds it here and fails immediately with 55P03.
      await f.db.transaction(async (tx) => {
        const rows = await tx.execute(sql`select id from ${npAgentChangesets}
          where site_id = ${f.input.siteId} and id = ${f.sealed.id} for update nowait`);
        expect(rows.rows).toHaveLength(1);
      });
    } finally {
      release();
      await holder;
      await completion;
    }
    expect((await completion)[0]).toMatchObject({ status: "fulfilled" });
    expect((await f.requestAction()).state).toBe("approval_pending");
    expect((await f.run()).state).toBe("waiting_approval");
  });
});
