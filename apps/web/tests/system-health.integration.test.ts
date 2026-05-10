import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("system-health diagnostics (#F)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("reports the four framework tables as present after migrate + truncate", async () => {
    const { gatherSystemHealth } = await import("@/lib/system-health");
    const summary = await gatherSystemHealth();

    const db = summary.checks.find((c) => c.id === "db");
    const migrations = summary.checks.find((c) => c.id === "migrations");
    expect(db?.state).toBe("ok");
    expect(migrations?.state).toBe("ok");
    expect(migrations?.detail).toMatch(/4 framework tables/);
  });

  it("returns one row per built-in check id", async () => {
    const { gatherSystemHealth } = await import("@/lib/system-health");
    const summary = await gatherSystemHealth();
    const ids = summary.checks.map((c) => c.id);
    expect(ids).toEqual([
      "db",
      "migrations",
      "storage",
      "queue",
      "plugins",
      // #619 — runtime parallels of the boot-time safety checks
      // from #597, surfaced on /admin/health for operators who
      // are debugging "why did password reset stop working" etc.
      "site_url",
      "email",
      "secret",
    ]);
  });

  it("aggregates errorCount / warnCount honestly", async () => {
    const { gatherSystemHealth } = await import("@/lib/system-health");
    const summary = await gatherSystemHealth();
    expect(summary.errorCount).toBe(
      summary.checks.filter((c) => c.state === "error").length,
    );
    expect(summary.warnCount).toBe(
      summary.checks.filter((c) => c.state === "warn").length,
    );
  });
});
