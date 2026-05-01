import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Phase 17 — multi-tenant audit + plugin storage scope.
 *
 *   - `nx_audit_events.site_id` is filled by `recordAuditEvent`
 *     from `getCurrentSiteId()` and consulted by `listAuditEvents`
 *     so per-tenant queries don't leak cross-site rows.
 *   - `nx_plugin_storage.site_id` is part of the composite PK so
 *     the same plugin key under different sites stays isolated.
 *
 * Tests pin the current site via `withCurrentSite()` so they
 * exercise the resolver path.
 */
describe.skipIf(skipIfNoTestDb())("Phase 17 — multi-tenant audit + plugin storage", () => {
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

  it("recordAuditEvent stamps site_id from the current resolver", async () => {
    const session = await seedUser({ role: "admin" });
    const { recordAuditEvent, withCurrentSite } = await import("@nexpress/core");
    const { nxAuditEvents } = await import("@nexpress/core");

    await withCurrentSite("site-a", async () => {
      await recordAuditEvent({
        actor: { kind: "staff", userId: session.userId },
        action: "test.event",
        targetType: "test",
        targetId: "1",
      });
    });

    const db = await getTestDb();
    const rows = (await db.select().from(nxAuditEvents)) as Array<{
      siteId: string | null;
      action: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].siteId).toBe("site-a");
    expect(rows[0].action).toBe("test.event");
  });

  it("listAuditEvents filters by current site by default", async () => {
    const session = await seedUser({ role: "admin" });
    const { recordAuditEvent, listAuditEvents, withCurrentSite } = await import("@nexpress/core");

    await withCurrentSite("site-a", async () => {
      await recordAuditEvent({
        actor: { kind: "staff", userId: session.userId },
        action: "site-a.event",
      });
    });
    await withCurrentSite("site-b", async () => {
      await recordAuditEvent({
        actor: { kind: "staff", userId: session.userId },
        action: "site-b.event",
      });
    });

    // From inside site-a, only site-a's row should surface.
    const fromA = await withCurrentSite("site-a", () => listAuditEvents({}));
    expect(fromA.events.map((e) => e.action)).toEqual(["site-a.event"]);

    // From inside site-b, only site-b's row.
    const fromB = await withCurrentSite("site-b", () => listAuditEvents({}));
    expect(fromB.events.map((e) => e.action)).toEqual(["site-b.event"]);
  });

  it("listAuditEvents with siteId=null skips the site filter (super-admin override)", async () => {
    const session = await seedUser({ role: "admin" });
    const { recordAuditEvent, listAuditEvents, withCurrentSite } = await import("@nexpress/core");

    await withCurrentSite("site-a", async () => {
      await recordAuditEvent({
        actor: { kind: "staff", userId: session.userId },
        action: "site-a.event",
      });
    });
    await withCurrentSite("site-b", async () => {
      await recordAuditEvent({
        actor: { kind: "staff", userId: session.userId },
        action: "site-b.event",
      });
    });

    const all = await withCurrentSite("site-a", () => listAuditEvents({ siteId: null }));
    expect(all.events).toHaveLength(2);
    const actions = all.events.map((e) => e.action).sort();
    expect(actions).toEqual(["site-a.event", "site-b.event"]);
  });

  it("listAuditEvents with explicit siteId overrides the resolver", async () => {
    const session = await seedUser({ role: "admin" });
    const { recordAuditEvent, listAuditEvents, withCurrentSite } = await import("@nexpress/core");

    await withCurrentSite("site-a", async () => {
      await recordAuditEvent({
        actor: { kind: "staff", userId: session.userId },
        action: "site-a.event",
      });
    });
    await withCurrentSite("site-b", async () => {
      await recordAuditEvent({
        actor: { kind: "staff", userId: session.userId },
        action: "site-b.event",
      });
    });

    // Pin to site-b while resolver returns site-a — explicit wins.
    const fromB = await withCurrentSite("site-a", () => listAuditEvents({ siteId: "site-b" }));
    expect(fromB.events.map((e) => e.action)).toEqual(["site-b.event"]);
  });

  it("plugin storage isolates the same key across sites", async () => {
    // The plugin context module reads `getCurrentSiteId` from
    // `../sites/context.js` (relative source). Importing
    // `withCurrentSite` from the same source tree keeps the
    // resolver state in one module instance — pulling it from
    // `@nexpress/core` (dist) would land us on a separate
    // bundled copy whose resolver doesn't reach the source's.
    const { withCurrentSite } = await import(
      // eslint-disable-next-line import-x/no-relative-packages
      "../../../packages/core/src/sites/context.js"
    );
    const { createPluginRuntimeContext } = await import(
      // eslint-disable-next-line import-x/no-relative-packages
      "../../../packages/core/src/plugins/context.js"
    );

    const ctx = createPluginRuntimeContext({
      pluginId: "p-test",
      capabilities: ["storage:kv"],
      allowedHosts: [],
      config: {},
      registration: { actions: new Map() },
      lookupRegistration: () => undefined,
    }) as {
      storage: {
        get: <T>(key: string) => Promise<T | null>;
        set: (key: string, value: unknown) => Promise<void>;
        list: (prefix?: string) => Promise<string[]>;
      };
    };

    await withCurrentSite("site-a", () => ctx.storage.set("greeting", "hello-a"));
    await withCurrentSite("site-b", () => ctx.storage.set("greeting", "hello-b"));

    const a = await withCurrentSite("site-a", () => ctx.storage.get<string>("greeting"));
    const b = await withCurrentSite("site-b", () => ctx.storage.get<string>("greeting"));
    expect(a).toBe("hello-a");
    expect(b).toBe("hello-b");

    // List is scoped to the current site too.
    const keysA = await withCurrentSite("site-a", () => ctx.storage.list());
    const keysB = await withCurrentSite("site-b", () => ctx.storage.list());
    expect(keysA).toEqual(["greeting"]);
    expect(keysB).toEqual(["greeting"]);
  });

  it("plugin storage falls back to the global keyspace when no site is resolved", async () => {
    const { createPluginRuntimeContext } = await import(
      // eslint-disable-next-line import-x/no-relative-packages
      "../../../packages/core/src/plugins/context.js"
    );

    const ctx = createPluginRuntimeContext({
      pluginId: "p-global",
      capabilities: ["storage:kv"],
      allowedHosts: [],
      config: {},
      registration: { actions: new Map() },
      lookupRegistration: () => undefined,
    }) as {
      storage: {
        get: <T>(key: string) => Promise<T | null>;
        set: (key: string, value: unknown) => Promise<void>;
      };
    };

    await ctx.storage.set("k", "v-global");
    const v = await ctx.storage.get<string>("k");
    expect(v).toBe("v-global");

    const db = await getTestDb();
    const { nxPluginStorage } = await import("@nexpress/core");
    const rows = (await db.select().from(nxPluginStorage)) as Array<{
      siteId: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].siteId).toBe("_global_");
  });
});
