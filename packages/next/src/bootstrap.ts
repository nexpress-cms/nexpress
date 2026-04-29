import {
  createDbConnection,
  createStorageAdapter,
  getDb,
  hasRole,
  isSuperAdmin,
  listMembershipsForUser,
  listPluginStates,
  loadPlugins,
  registerCollection,
  registerThemes,
  resolveSiteForHostname,
  setCurrentSiteResolver,
  setDb,
  setI18nConfig,
  setMediaDb,
  setStorageAdapter,
  startProducer,
  syncPluginRegistrations,
  verifyTokenFull,
  NX_DEFAULT_SITE_ID,
  type NxAuthUser,
  type NxConfig,
  type NxPluginConfig,
  type NxResolvedPluginLike,
} from "@nexpress/core";
import { cookies, headers } from "next/headers";

function resolvePluginId(plugin: NxPluginConfig | NxResolvedPluginLike): string {
  return "manifest" in plugin ? plugin.manifest.id : plugin.id;
}

export type NxDb = ReturnType<typeof createDbConnection>;

export interface BootstrapOptions {
  /**
   * The project's nexpress.config — typically the default export of
   * `src/nexpress.config.ts`.
   */
  config: NxConfig;
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

export type Bootstrap = {
  readonly getDb: (this: void) => NxDb;
  readonly ensureCoreServices: (this: void) => void;
  readonly ensurePluginsLoaded: (this: void) => Promise<void>;
  readonly ensureJobProducer: (this: void) => Promise<void>;
};

function toCamelCase(slug: string): string {
  return slug.replace(/[-_](.)/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Issue #221 — central access predicate the resolver uses to
 * confirm the authenticated session is allowed to operate on the
 * site id pulled from `nx-admin-site`. Mirrors the rule in the
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
  user: NxAuthUser,
  siteId: string,
): Promise<boolean> {
  if (await isSuperAdmin(user)) return true;
  const memberships = await listMembershipsForUser(user.id);
  if (memberships.some((m) => m.siteId === siteId)) return true;
  if (siteId === NX_DEFAULT_SITE_ID && hasRole(user, "admin")) return true;
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

  let db: NxDb | null = null;
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
      throw new Error("DATABASE_URL is not set");
    }
    return connectionString;
  }

  function ensureServices(instance: NxDb): void {
    if (servicesInitialized) return;

    setDb(instance);
    setMediaDb(instance);
    setStorageAdapter(
      createStorageAdapter(
        config.storage ?? {
          adapter: "local",
          local: { directory: "./uploads", baseUrl: "/uploads" },
        },
      ),
    );

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
    // The middleware sets `x-nx-host` from the incoming
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
    // knows a target site id can forge `nx-admin-site=<id>`.
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
        // Use the singleton db (`getDb()`), not the bootstrap's
        // lazy-init `getDbInstance()`. Test harnesses call
        // `setDb(testPool)` to switch the singleton, but the
        // bootstrap's cache predates that swap and would point
        // at the dev DB pool instead — verification would never
        // find the test session row. The singleton is also what
        // `listMembershipsForUser` (called via `canActorUseSite`)
        // sees, so both halves of the validation read the same
        // DB.
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
        // only forwards `x-nx-admin-site` for /admin and
        // /api/admin URLs, so public site rendering still
        // routes by Host header even when an admin has a
        // picker cookie set.
        const adminOverride = headerList.get("x-nx-admin-site");
        if (adminOverride) {
          const sessionToken = cookieJar.get("nx-session")?.value ?? null;
          const validated = await validateOverride(adminOverride, sessionToken);
          if (validated) return validated;
          // Drop through to host-based resolution when the
          // override fails validation (forged cookie, expired
          // session, lost membership). Don't leak an explicit
          // 403; that just helps an attacker enumerate.
        }
        const host = headerList.get("x-nx-host");
        if (!host) return NX_DEFAULT_SITE_ID;
        const site = await resolveSiteForHostname(host);
        return site?.id ?? NX_DEFAULT_SITE_ID;
      } catch {
        return null;
      }
    });

    collectionsRegistered = true;
  }

  function getDbInstance(): NxDb {
    if (!db) {
      db = createDbConnection({ connectionString: getConnectionString() });
    }
    ensureServices(db);
    ensureCollections();
    return db;
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
      pluginsLoaded = true;
    })();

    return pluginsLoadingPromise;
  }

  const ensureCoreServices = (): void => {
    getDbInstance();
  };

  /**
   * Wires pg-boss as the job queue for this process so `enqueueJob` calls
   * actually send jobs. Opt-in via `NX_ENABLE_JOBS=1` — when it's off the
   * producer stays unwired and `enqueueJob` remains a no-op.
   *
   * Idempotent + race-safe.
   */
  async function ensureJobProducer(): Promise<void> {
    if (producerStarted) return;
    if (process.env.NX_ENABLE_JOBS !== "1") {
      producerStarted = true;
      return;
    }
    if (producerStartingPromise) return producerStartingPromise;

    producerStartingPromise = (async () => {
      await startProducer(getConnectionString());
      producerStarted = true;
    })();

    return producerStartingPromise;
  }

  return {
    getDb: getDbInstance,
    ensureCoreServices,
    ensurePluginsLoaded,
    ensureJobProducer,
  };
}
