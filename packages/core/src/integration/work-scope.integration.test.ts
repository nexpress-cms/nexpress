import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { npSites } from "../db/schema/system.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";
import { createIntegrationWorkScope } from "./work-scope.js";

describe.skipIf(skipIfNoTestDb())("integration database cleanup ownership", () => {
  beforeAll(ensureMigrated);
  beforeEach(truncateAll);
  afterAll(closeTestDb);

  it("waits for a cancelled body's final write before resetting its worker database", async () => {
    const db = await getTestDb();
    let start!: () => void;
    let finish!: () => void;
    let stopped!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const finishing = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const stopping = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    const scope = createIntegrationWorkScope(stopped);
    const body = scope.run(async () => {
      await db.insert(npSites).values({ id: "before-cancellation", name: "Before cancellation" });
      start();
      await finishing;
      await db.insert(npSites).values({ id: "after-cancellation", name: "After cancellation" });
    });
    // A timeout abandons the body's promise; it does not cancel its DB writes.
    // The shared reset must initiate cancellation and wait for that last write.
    await started;
    let resetCompleted = false;
    const reset = truncateAll().then(() => {
      resetCompleted = true;
    });
    try {
      await stopping;
      expect(scope.signal.aborted).toBe(true);
      expect(resetCompleted).toBe(false);
      expect((await db.select({ id: npSites.id }).from(npSites)).map((site) => site.id)).toContain(
        "before-cancellation",
      );
    } finally {
      finish();
      await body;
      await reset;
    }
    expect(await db.select({ id: npSites.id, name: npSites.name }).from(npSites)).toEqual([
      { id: "default", name: "Default site" },
    ]);
  });
});
