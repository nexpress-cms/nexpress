import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { npPlugins, npSites } from "../db/schema/system.js";
import {
  getPluginState,
  listPluginStates,
  syncPluginRegistrations,
  updatePluginState,
} from "../plugins/persistence.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";

// Installation lives in np_plugins; activation is a sparse per-site override.
describe.skipIf(skipIfNoTestDb())("plugin persistence (integration)", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("syncPluginRegistrations seeds a row per id, defaulting enabled=true", async () => {
    const db = await getTestDb();
    await syncPluginRegistrations(db, ["alpha", "beta"]);
    const rows = await listPluginStates(db);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.alpha.enabled).toBe(true);
    expect(byId.beta.enabled).toBe(true);
  });

  it("sync is idempotent and never clobbers operator edits", async () => {
    const db = await getTestDb();
    await syncPluginRegistrations(db, ["alpha"]);
    await updatePluginState(db, "alpha", { enabled: false });

    // Re-sync should leave the existing row alone.
    await syncPluginRegistrations(db, ["alpha", "beta"]);
    const alpha = await getPluginState(db, "alpha");
    expect(alpha?.enabled).toBe(false);

    const beta = await getPluginState(db, "beta");
    expect(beta?.enabled).toBe(true);
  });

  it("updatePluginState patches only the fields provided", async () => {
    const db = await getTestDb();
    await syncPluginRegistrations(db, ["gamma"]);

    await updatePluginState(db, "gamma", { enabled: false });
    const afterEnabled = await getPluginState(db, "gamma");
    expect(afterEnabled?.enabled).toBe(false);
    expect(afterEnabled?.installedAt).toBeInstanceOf(Date);
  });

  it("isolates activation across sites while missing overrides default enabled", async () => {
    const db = await getTestDb();
    await syncPluginRegistrations(db, ["scoped"]);
    await db.insert(npSites).values({
      id: "tenant-a",
      name: "Tenant A",
      isDefault: false,
    });

    await updatePluginState(db, "scoped", { enabled: false }, "default");

    expect((await getPluginState(db, "scoped", "default"))?.enabled).toBe(false);
    expect((await getPluginState(db, "scoped", "tenant-a"))?.enabled).toBe(true);
  });

  it("updatePluginState returns null for an unknown plugin id", async () => {
    const db = await getTestDb();
    const result = await updatePluginState(db, "does-not-exist", { enabled: false });
    expect(result).toBeNull();
  });

  it("getPluginState reads back the persisted row shape", async () => {
    const db = await getTestDb();
    await db.insert(npPlugins).values({
      id: "delta",
      installedAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z"),
    });
    await updatePluginState(db, "delta", { enabled: false });

    const state = await getPluginState(db, "delta");
    expect(state).toBeTruthy();
    expect(state?.enabled).toBe(false);
    expect(state?.installedAt).toBeInstanceOf(Date);

    // Sanity: direct SELECT yields the same row
    const [raw] = await db.select().from(npPlugins).where(eq(npPlugins.id, "delta"));
    expect(raw?.id).toBe("delta");
  });
});
