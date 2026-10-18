import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npPruneAgentGuardianJobV1 } from "../../../packages/core/src/agent/guardian-retention-job.js";
import type { NpAgentGuardianRetentionResultV1 } from "../../../packages/core/src/agent/guardian-retention-service.js";
import { npSettings } from "../../../packages/core/src/db/schema/system.js";
import { fixture, siteId } from "./agent-changeset-fixture.js";
import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const key = "guardian.retention.cursor";
function result(nextCursor: string | null, examined = 1): NpAgentGuardianRetentionResultV1 {
  return {
    nextCursor,
    examined,
    eventsPruned: 0,
    receiptsPruned: 0,
    historyPruned: 0,
    closuresAdvanced: 0,
    skipped: [],
  };
}
describe.skipIf(skipIfNoTestDb())("Guardian durable retention cursor generation", () => {
  beforeAll(ensureMigrated);
  beforeEach(async () => {
    await truncateAll();
    registerTestCollections();
  });
  afterAll(closeTestDb);
  it("keeps a newer wrapped cursor when an older concurrent scan returns after null has reappeared", async () => {
    const f = await fixture();
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stale = npPruneAgentGuardianJobV1(
      siteId,
      {
        prune: async (input) => {
          expect(input).toEqual({ siteId, cursor: null, limit: 25 });
          entered();
          await gate;
          return result(randomUUID());
        },
      },
      () => new Date(),
    );
    try {
      await waiting;
      const advanced = randomUUID();
      await npPruneAgentGuardianJobV1(
        siteId,
        { prune: async () => result(advanced) },
        () => new Date(),
      );
      await npPruneAgentGuardianJobV1(
        siteId,
        {
          prune: async (input) => {
            expect(input.cursor).toBe(advanced);
            return result(null);
          },
        },
        () => new Date(),
      );
    } finally {
      release();
    }
    await stale;
    const [row] = await f.db
      .select()
      .from(npSettings)
      .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, key)));
    expect(row?.value).toEqual({
      schemaVersion: "np.agent-guardian-retention-cursor.v1",
      siteId,
      revision: 2,
      cursor: null,
    });
  });
  it("does not create private cursor settings when an unchanged empty scan has no work", async () => {
    const f = await fixture();
    await npPruneAgentGuardianJobV1(
      siteId,
      { prune: async () => result(null, 0) },
      () => new Date(),
    );
    expect(
      await f.db
        .select()
        .from(npSettings)
        .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, key))),
    ).toEqual([]);
  });
});
