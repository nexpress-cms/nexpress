import {
  can,
  createDbConnection,
  createStorageAdapter,
  getDb,
  getOptionalJobQueue,
  isSuperAdmin,
  listMembershipsForUser,
  listPluginStates,
  loadPlugins,
  registerCollection,
  registerThemes,
  resetPlugins,
  resolveSiteForHostname,
  setCurrentSiteResolver,
  setDb,
  setI18nConfig,
  setStorageAdapter,
  startProducer,
  syncPluginRegistrations,
  verifyStartupSafety,
  verifyTokenFull,
  NP_DEFAULT_SITE_ID,
  type NpAuthUser,
  type NpConfig,
  type NpPluginConfig,
  type NpReconcileSchedulesResult,
  type NpResolvedPluginLike,
} from "@nexpress/core";
import {
  registerBlock,
  resetSharedBlockRegistry,
  type NpBlockDefinition,
} from "@nexpress/blocks";
import { cookies, headers } from "next/headers";

// Plugin definitions can ship a `blocks` array (see plugin-sdk's
// NpPluginDefinition). Core's `loadPlugins` keeps the shape loose
// to avoid a cycle, so we narrow it here when we know we're in
// the bootstrap path that owns this wiring.
function pluginBlocks(plugin: NpPluginConfig | NpResolvedPluginLike): NpBlockDefinition[] {
  const blocks = (plugin as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.filter(
    (b): b is NpBlockDefinition =>
      b !== null &&
      typeof b === "object" &&
      typeof (b as { type?: unknown }).type === "string" &&
      typeof (b as { render?: unknown }).render === "function",
  );
}

function resolvePluginId(plugin: NpPluginConfig | NpResolvedPluginLike): string {
  return "manifest" in plugin ? plugin.manifest.id : plugin.id;
}

export type NpDb = ReturnType<typeof createDbConnection>;

export interface BootstrapOptions {
  /**
   * The project's nexpress.config — typically the default export of
   * `src/nexpress.config.ts`.
   */
  config: NpConfig;
  /**
   * The generated Drizzle schema module (e.g. `import * as schema from
   * "@/db/generated/collections"`). Tables are looked up by
   * `${camelCase(slug)}Table`, matching what `generate-schema.ts` emits.
   */
  generatedSchema: Record<string, unknown>;
  /**
   * Optional override for the database connection string. Falls back to
   * `config.db.connectionString` and then `DATABASE_URL`.
   */
  connectionString?: string;
}

/**
 * Outcome of `reloadPlugins()`. Always carries the reload-was-clean flag,
 * plus a `schedules` summary when the active queue can reconcile pg-boss
 * cron rows. Routes / UIs use this to give the operator an accurate
 * "what just happened" — the previous void-returning shape made it
 * impossible to surface that schedule changes were (or weren't) applied.
 */
export interface NpReloadPluginsResult {
  /** `true` once the in-memory plugin registry has been reset + reloaded. */
  reloaded: true;
  /**
   * Schedule reconcile result, when the active job queue supports it.
   * `null` when no queue is wired (pg-boss disabled, test runs) or the
   * adapter doesn't implement `reconcilePluginSchedules`. The admin UI
   * uses `null` to suppress the "schedules updated" line.
   */
  schedules: NpReconcileSchedulesResult | null;
}

export type Bootstrap = {
  readonly getDb: (this: void) => NpDb;
  readonly ensureCoreServices: (this: void) => void;
  readonly ensurePluginsLoaded: (this: void) => Promise<void>;
  readonly ensureJobProducer: (this: void) => Promise<void>;
  /**
   * Phase 5.1 — reset the registered plugin set + re-run the load
   * pipeline. Picks up DB-side state changes (enabled toggles, config
   * edits) and re-runs each plugin's `setup(ctx)` so handlers that
   * read config at boot get a fresh value. Does NOT bust the Node
   * module cache — code edits to a plugin still need a dev server
   * restart to take effect.
   *
   * Block registry isn't cleared (it would orphan in-flight pages
   * mid-render). Re-registration overwrites by `type`, so the next
   * boot of each plugin fixes any stale block definitions naturally.
   *
   * Idempotent on success: a fresh `ensurePluginsLoaded()` call after
   * `reloadPlugins()` is a no-op until the next reload.
   */
  readonly reloadPlugins: (this: void) => Promise<NpReloadPluginsResult>;
};

function toCamelCase(slug: string): string {
  return slug.replace(/[-_](.)/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Issue #221 — central access predicate the resolver uses to
 * confirm the authenticated session is allowed to operate on the
 * site id pulled from `np-admin-site`. Mirrors the rule in the
 * `/api/admin/sites/active` setter so the two paths can't drift:
 *
 *   - Super-admin can switch to anywhere.
 *   - A site membership grants access to that site.
 *   - A global admin keeps the default-site fallback so single-
 *     tenant deployments aren't broken by this guard.
 *
 * Anyone else falls through and the resolver drops the override.
 */
export async function canActorUseSite(
  user: NpAuthUser,
  siteId: string,
): Promise<boolean> {
  if (await isSuperAdmin(user)) return true;
  const memberships = await listMembershipsForUser(user.id);
  if (memberships.some((m) => m.siteId === siteId)) return true;
  if (siteId === NP_DEFAULT_SITE_ID && can(user, "admin.manage")) return true;
  return false;
}

function resolveTable(
  generatedSchema: Record<string, unknown>,
  slug: string,
): unknown {
  const identifier = `${toCamelCase(slug)}Table`;
  const table = generatedSchema[identifier];
  if (!table) {
    throw new Error(
      `Collection "${slug}" has no matching generated Drizzle table ` +
        `(expected export \`${identifier}\`). ` +
        `Did you run \`pnpm db:generate\` after adding the collection?`,
    );
  }
  return table;
}

/**
 * Builds a one-shot bootstrap for a Next.js nexpress project. The returned
 * `getDb()` is the single source of truth — it lazily creates the pg Pool,
 * wires the DB/storage singletons on `@nexpress/core`, and registers every
 * collection from the config using the generated schema for Drizzle tables.
 *
 * `ensurePluginsLoaded()` is idempotent and safe to race across requests.
 */
export function createBootstrap(options: BootstrapOptions): Bootstrap {
  const { config, generatedSchema } = options;

  let db: NpDb | null = null;
  let servicesInitialized = false;
  let collectionsRegistered = false;
  let pluginsLoaded = false;
  let pluginsLoadingPromise: Promise<void> | null = null;
  let producerStarted = false;
  let producerStartingPromise: Promise<void> | null = null;

  function getConnectionString(): string {
    const connectionString =
      options.connectionString || config.db.connectionString || process.env.DATABASE_URL;
    if (!connectionString) {
      // First-boot friendly: most operators trip here on a fresh
      // clone with no `.env`. Point them at the setup wizard
      // rather than the literal env var name. The legacy phrase
      // is preserved so existing logs / monitors still match.
      throw new Error(
        "DATABASE_URL is not set — run `pnpm run setup` (browser env wizard) or copy `.env.example` to `.env` and fill in your Postgres connection string.",
      );
    }
    return connectionString;
  }

  function ensureServices(instance: NpDb): void {
    if (servicesInitialized) return;

    setDb(instance);
    const storageConfig = config.storage ?? {
      adapter: "local" as const,
      local: { directory: "./uploads", baseUrl: "/uploads" },
    };
    setStorageAdapter(createStorageAdapter(storageConfig));

    // Phase 22.2 — surface known-unsafe configurations once per
    // process (multi-node + LocalStorageAdapter, weak prod secret,
    // etc.). Pure function of its inputs so the bootstrap layer
    // stays the only place reading process.env for these flags.
    verifyStartupSafety({
      storageAdapter: storageConfig.adapter,
      secret: config.auth?.secret ?? process.env.NP_SECRET ?? null,
      nodeEnv: process.env.NODE_ENV,
      multiNodeFlag: process.env.NP_MULTI_NODE,
      // Phase 23.2 — well-known env vars set by managed container
      // platforms. If any is present in production we treat the
      // deploy as "probably multi-replica" even when NP_MULTI_NODE
      // wasn't set, and warn about LocalStorageAdapter. The list is
      // additive — append new platform indicators here as they
      // become common.
      containerEnv: Boolean(
        process.env.KUBERNETES_SERVICE_HOST ||
          process.env.FLY_REGION ||
          process.env.RENDER_INSTANCE_ID ||
          process.env.RAILWAY_ENVIRONMENT_NAME,
      ),
    });

    servicesInitialized = true;
  }

  function ensureCollections(): void {
    if (collectionsRegistered) return;

    for (const collection of config.collections) {
      registerCollection(
        collection.slug,
        resolveTable(generatedSchema, collection.slug),
        collection,
      );
    }

    // Phase 11.1 — register themes alongside collections so the
    // theme registry is populated by the time any layout runs.
    // Idempotent on the registry side; calling again on hot
    // reload just overwrites entries by id.
    if (config.themes && config.themes.length > 0) {
      registerThemes(config.themes);
    }

    // Phase 12.1 — install the i18n config singleton so the
    // pipeline's locale resolver can read it. Idempotent;
    // re-calling on hot reload just overwrites the previous
    // value. Sites without an i18n block leave the singleton
    // null and the per-collection `i18n: true` opt-in is
    // already rejected at `defineConfig` time.
    setI18nConfig(config.i18n ?? null);

    // Phase 15.1 — install the per-request site resolver.
    // The middleware sets `x-np-host` from the incoming
    // Host header; this resolver maps it to a site id via
    // `resolveSiteForHostname` (DB lookup) and falls back to
    // the default site id. Reads `headers()` only inside a
    // request scope; throws are swallowed so non-request
    // contexts (background workers, scripts) just see a
    // null site id, which downstream callers treat as
    // "use default".
    //
    // Issue #221 — the override cookie is *untrusted input*.
    // The setter route validates membership before writing,
    // but the cookie itself is plain-text and anyone who
    // knows a target site id can forge `np-admin-site=<id>`.
    // We re-validate the override against the current
    // session here: load the access JWT, call
    // `assertCanUseSite()`, and only honor the override when
    // the session can actually act on that site. Forged or
    // stale-membership requests fall back to host-based
    // resolution silently — defense in depth, no error
    // surface that helps an attacker probe.
    // Validation inputs that can vary across requests inside the
    // same process: the cookie value and the auth secret. We call
    // it on every `getCurrentSiteId()`, which is fine — JWT verify
    // is microseconds and `listMembershipsForUser` is one indexed
    // SELECT. No memo to avoid leaking across requests.
    const validateOverride = async (
      siteId: string,
      sessionToken: string | null,
    ): Promise<string | null> => {
      if (!sessionToken) return null;
      const secret = config.auth?.secret;
      if (!secret) return null;
      try {
        const db = getDb();
        const user = await verifyTokenFull(
          sessionToken,
          secret,
          db as never,
          "access",
        );
        if (!user) return null;
        return (await canActorUseSite(user, siteId)) ? siteId : null;
      } catch {
        return null;
      }
    };
    setCurrentSiteResolver(async () => {
      try {
        const [headerList, cookieJar] = await Promise.all([headers(), cookies()]);
        // Phase 15.6 — the admin site-picker cookie wins over
        // hostname mapping inside admin paths. The middleware
        // only forwards `x-np-admin-site` for /admin and
        // /api/admin URLs, so public site rendering still
        // routes by Host header even when an admin has a
        // picker cookie set.
        const adminOverride = headerList.get("x-np-admin-site");
        if (adminOverride) {
          const sessionToken = cookieJar.get("np-session")?.value ?? null;
          const validated = await validateOverride(adminOverride, sessionToken);
          if (validated) return validated;
          // Drop through to host-based resolution when the
          // override fails validation (forged cookie, expired
          // session, lost membership). Don't leak an explicit
          // 403; that just helps an attacker enumerate.
        }
        const host = headerList.get("x-np-host");
        if (!host) return NP_DEFAULT_SITE_ID;
        const site = await resolveSiteForHostname(host);
        return site?.id ?? NP_DEFAULT_SITE_ID;
      } catch {
        return null;
      }
    });

    collectionsRegistered = true;
  }

  function getDbInstance(): NpDb {
    if (!db) {
      db = createDbConnection({ connectionString: getConnectionString() });
    }
    ensureServices(db);
    ensureCollections();
    // Always read through the core singleton. Test harnesses call
    // `setDb(testPool)` to swap the singleton, and the bootstrap's
    // closure-cached `db` would otherwise diverge — verification
    // would never find the test session row. Returning `getDb()`
    // keeps both halves of the runtime (singleton consumers vs.
    // bootstrap consumers) reading the same handle. The cast is
    // structural — `setDb()` accepts `NodePgDatabase<Record<string,
    // unknown>>`, but the actual instance handed in here is the
    // schema-typed `NpDb`, so the cast is a no-op at runtime.
    return getDb() as NpDb;
  }

  async function ensurePluginsLoaded(): Promise<void> {
    if (pluginsLoaded) return;
    if (pluginsLoadingPromise) return pluginsLoadingPromise;

    pluginsLoadingPromise = (async () => {
      const instance = getDbInstance();
      const configured = config.plugins ?? [];
      const configuredIds = configured.map(resolvePluginId);

      await syncPluginRegistrations(instance, configuredIds);
      const states = await listPluginStates(instance);
      const disabledIds = new Set(states.filter((s) => !s.enabled).map((s) => s.id));

      const enabled = configured.filter((plugin) => !disabledIds.has(resolvePluginId(plugin)));
      await loadPlugins(enabled);
      // Push each enabled plugin's blocks into the shared block
      // registry so they appear in the admin's Add-block popover
      // and resolve correctly during server render.
      // `registerBlock` overwrites on duplicate type, so HMR /
      // re-bootstrap on the same process don't blow up.
      for (const plugin of enabled) {
        for (const block of pluginBlocks(plugin)) {
          registerBlock(block);
        }
      }
      pluginsLoaded = true;
    })();

    try {
      await pluginsLoadingPromise;
    } catch (error) {
      pluginsLoadingPromise = null;
      throw error;
    }
  }

  async function reloadPlugins(): Promise<NpReloadPluginsResult> {
    // Drain any in-flight load before resetting so we don't race a
    // concurrent boot path mid-stream.
    if (pluginsLoadingPromise) {
      try {
        await pluginsLoadingPromise;
      } catch {
        // The previous load failed; we're about to redo it anyway.
      }
    }

    // Build the reload as a single Promise installed into
    // `pluginsLoadingPromise` BEFORE we await any of its body. An earlier
    // version `pluginsLoaded = false; await ensurePluginsLoaded()` left a
    // window where a concurrent request could see `pluginsLoaded === false`
    // AND `pluginsLoadingPromise === null`, kick off its own load, and end
    // up registering every plugin twice — leaving stale handlers in
    // `globalHooks` after both loads completed. Stashing the promise first
    // makes `ensurePluginsLoaded()` callers piggyback on the in-progress
    // reload instead of starting a parallel one.
    const loading = (async () => {
      resetPlugins();
      // Issue #477 — also drop plugin-contributed blocks from the
      // shared block registry. `resetPlugins()` clears hooks /
      // routes / actions, but block definitions live in a separate
      // registry that previously persisted across reloads. After a
      // disable + reload the disabled plugin's blocks would still
      // surface in the admin's Add-block popover and still resolve
      // server-side. Resetting here, then re-registering only the
      // currently-enabled set below, settles on
      // `built-ins + enabled plugins` — the obvious invariant.
      resetSharedBlockRegistry();
      const instance = getDbInstance();
      const configured = config.plugins ?? [];
      const configuredIds = configured.map(resolvePluginId);

      await syncPluginRegistrations(instance, configuredIds);
      const states = await listPluginStates(instance);
      const disabledIds = new Set(states.filter((s) => !s.enabled).map((s) => s.id));

      const enabled = configured.filter((plugin) => !disabledIds.has(resolvePluginId(plugin)));
      await loadPlugins(enabled);
      for (const plugin of enabled) {
        for (const block of pluginBlocks(plugin)) {
          registerBlock(block);
        }
      }
      pluginsLoaded = true;
    })();

    pluginsLoaded = false;
    pluginsLoadingPromise = loading;
    try {
      await loading;
    } finally {
      pluginsLoadingPromise = null;
    }

    // Issue #461 — bring pg-boss `pgboss.schedule` rows in sync with the
    // freshly-rebuilt registry. Without this, the in-memory plugin set
    // is up to date but pg-boss keeps firing the old cron set until a
    // worker restart, which contradicts the admin "Reload all" toast.
    // Reconcile is best-effort: a missing queue, a stub adapter, or a
    // failed call all fall through to `null` so the reload itself
    // doesn't fail just because the cron sync did.
    let schedules: NpReconcileSchedulesResult | null = null;
    const queue = getOptionalJobQueue();
    if (queue && typeof queue.reconcilePluginSchedules === "function") {
      try {
        schedules = await queue.reconcilePluginSchedules();
      } catch {
        schedules = null;
      }
    }

    return { reloaded: true, schedules };
  }

  const ensureCoreServices = (): void => {
    getDbInstance();
  };

  /**
   * Wires pg-boss as the job queue for this process so `enqueueJob` calls
   * actually send jobs. Opt-in via `NP_ENABLE_JOBS=1` — when it's off the
   * producer stays unwired and `enqueueJob` remains a no-op.
   *
   * Idempotent + race-safe.
   */
  async function ensureJobProducer(): Promise<void> {
    if (producerStarted) return;
    if (process.env.NP_ENABLE_JOBS !== "1") {
      producerStarted = true;
      return;
    }
    if (producerStartingPromise) return producerStartingPromise;

    producerStartingPromise = (async () => {
      await startProducer(getConnectionString());
      producerStarted = true;
    })();

    try {
      await producerStartingPromise;
    } catch (error) {
      producerStartingPromise = null;
      throw error;
    }
  }

  return {
    getDb: getDbInstance,
    ensureCoreServices,
    ensurePluginsLoaded,
    ensureJobProducer,
    reloadPlugins,
  };
}
