import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { npPlugins } from "../db/schema/system.js";
import {
  getPluginState,
  listPluginStates,
  syncPluginRegistrations,
  updatePluginState,
} from "../plugins/persistence.js";
import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";

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

  it("syncPluginRegistrations seeds a row per id, defaulting enabled=true and empty config", async () => {
    const db = await getTestDb();
    await syncPluginRegistrations(db, ["alpha", "beta"]);
    const rows = await listPluginStates(db);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.alpha.enabled).toBe(true);
    expect(byId.alpha.config).toEqual({});
    expect(byId.beta.enabled).toBe(true);
  });

  it("sync is idempotent and never clobbers operator edits", async () => {
    const db = await getTestDb();
    await syncPluginRegistrations(db, ["alpha"]);
    await updatePluginState(db, "alpha", { enabled: false, config: { foo: 1 } });

    // Re-sync should leave the existing row alone.
    await syncPluginRegistrations(db, ["alpha", "beta"]);
    const alpha = await getPluginState(db, "alpha");
    expect(alpha?.enabled).toBe(false);
    expect(alpha?.config).toEqual({ foo: 1 });

    const beta = await getPluginState(db, "beta");
    expect(beta?.enabled).toBe(true);
    expect(beta?.config).toEqual({});
  });

  it("updatePluginState patches only the fields provided", async () => {
    const db = await getTestDb();
    await syncPluginRegistrations(db, ["gamma"]);

    await updatePluginState(db, "gamma", { config: { x: "y" } });
    const afterConfig = await getPluginState(db, "gamma");
    expect(afterConfig?.enabled).toBe(true);
    expect(afterConfig?.config).toEqual({ x: "y" });

    await updatePluginState(db, "gamma", { enabled: false });
    const afterEnabled = await getPluginState(db, "gamma");
    expect(afterEnabled?.enabled).toBe(false);
    expect(afterEnabled?.config).toEqual({ x: "y" });
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
      enabled: false,
      config: { theme: "dark" },
      installedAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z"),
    });

    const state = await getPluginState(db, "delta");
    expect(state).toBeTruthy();
    expect(state?.enabled).toBe(false);
    expect(state?.config).toEqual({ theme: "dark" });
    expect(state?.installedAt).toBeInstanceOf(Date);

    // Sanity: direct SELECT yields the same row
    const [raw] = await db.select().from(npPlugins).where(eq(npPlugins.id, "delta"));
    expect(raw?.id).toBe("delta");
  });
});
