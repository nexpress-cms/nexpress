import {
  npAssertProjectConfig,
  type NpAuthUser,
  type NpConfig,
  type NpFieldConfig,
  type NpPluginConfig,
  type NpResolvedPluginLike,
  type NpRegisteredTheme,
} from "@nexpress/core";
import { verifyTokenFull } from "@nexpress/core/auth";
import {
  createDbConnection,
  configureStorageRuntime,
  getDb as getCoreDb,
  getOptionalJobQueue,
  loadPlugins,
  npCloseDbConnection,
  npShutdownStorageAdapter,
  registerCollection,
  registerThemes,
  resetCacheInvalidationAdapter,
  resetCollections,
  resetCurrentSiteResolver,
  resetDb,
  resetI18nConfig,
  resetPlugins,
  resetSearchAdapter,
  resetThemes,
  setCurrentSiteResolver,
  setCacheInvalidationAdapter,
  setDb,
  setI18nConfig,
  setSearchAdapter,
  shutdownSearchAdapter,
  startProducer,
  stopProducer,
  syncPluginRegistrations,
  teardownPlugins,
  type NpDb,
  type NpSearchAdapter,
} from "@nexpress/core/bootstrap";
import {
  configureEmailRuntime,
  npReadEmailRuntimeConfig,
  resetEmailAdapter,
  type NpEmailAdapter,
  type NpEmailRuntimeConfig,
} from "@nexpress/core/email";
import { type NpReconcileSchedulesResult } from "@nexpress/core/jobs";
import { npReadRateLimitRuntimeConfig } from "@nexpress/core/rate-limit";
import {
  configureObservabilityFromEnv,
  shutdownObservability,
  verifyStartupSafety,
  type NpErrorReporter,
  type NpLoggerAdapter,
} from "@nexpress/core/observability";
import { canOnSite, NP_DEFAULT_SITE_ID, resolveSiteForHostname } from "@nexpress/core/sites";
import { type NpStorageAdapter } from "@nexpress/core/storage";
import { npRequireCdnPurgeAdapter, type NpCdnPurgeAdapter } from "@nexpress/core/cache";
import { npRequireJobsEnabledFlag } from "@nexpress/core/jobs-contract";
import { npRequireSearchAdapter } from "@nexpress/core/search";
import {
  npAnalyzeBlockDefinitions,
  npAnalyzePatternDefinitions,
  getDefaultBlocks,
  registerBlock,
  registerPattern,
  resetSharedBlockRegistry,
  resetSharedPatternRegistry,
  type NpBlockDefinition,
  type NpPatternDefinition,
} from "@nexpress/blocks";
import { npAssertThemeDefinition, type NpTheme } from "@nexpress/theme";
import { cookies, headers } from "next/headers";
import {
  npNextCacheInvalidationAdapter,
  resetCdnPurgeAdapter,
  setCdnPurgeAdapter,
  shutdownCdnPurgeAdapter,
} from "./cdn-purge.js";

export type { NpDb } from "@nexpress/core/bootstrap";

// Plugin definitions can ship a `blocks` array (see plugin-sdk's
// NpPluginDefinition). Core's `loadPlugins` keeps the shape loose
// to avoid a cycle, so we narrow it here when we know we're in
// the bootstrap path that owns this wiring.
function pluginBlocks(plugin: NpPluginConfig | NpResolvedPluginLike): NpBlockDefinition[] {
  const blocks = (plugin as { blocks?: unknown }).blocks;
  if (blocks === undefined) return [];
  const issue = npAnalyzeBlockDefinitions(blocks)[0];
  if (issue) throw new Error(`[plugin:${resolvePluginId(plugin)}] ${issue.message}`);
  return blocks as NpBlockDefinition[];
}

// Core intentionally keeps `impl` opaque to stay React-free. Next is the host
// boundary that can load @nexpress/theme, so it repeats the complete contract
// for config objects that bypassed defineTheme() and returns a safely narrowed
// contribution bundle instead of filtering malformed entries.
function themeContributions(theme: NpRegisteredTheme): {
  theme: NpTheme;
  blocks: NpBlockDefinition[];
  patterns: NpPatternDefinition[];
} {
  npAssertThemeDefinition(theme);
  return {
    theme,
    blocks: theme.impl.blocks ?? [],
    patterns: theme.impl.patterns ?? [],
  };
}

// Sister to `pluginBlocks` — validates the whole recursive pattern tree
// without forcing core to depend on the pattern type. Source is stamped below.
function pluginPatterns(plugin: NpPluginConfig | NpResolvedPluginLike): NpPatternDefinition[] {
  const patterns = (plugin as { patterns?: unknown }).patterns;
  if (patterns === undefined) return [];
  const issue = npAnalyzePatternDefinitions(patterns)[0];
  if (issue) throw new Error(`[plugin:${resolvePluginId(plugin)}] ${issue.message}`);
  return patterns as NpPatternDefinition[];
}

function resolvePluginId(plugin: NpPluginConfig | NpResolvedPluginLike): string {
  return "manifest" in plugin ? plugin.manifest.id : plugin.id;
}

function assertKnownPatternBlockTypes(
  owner: string,
  patterns: NpPatternDefinition[],
  knownBlockTypes: ReadonlySet<string>,
): void {
  const issue = npAnalyzePatternDefinitions(patterns, { knownBlockTypes }).find(
    (candidate) => candidate.code === "unknown-block-type",
  );
  if (issue) throw new Error(`[${owner}] ${issue.message}`);
}

export const npBootstrapIntents = ["read", "plugins", "worker", "write"] as const;
export type NpBootstrapIntent = (typeof npBootstrapIntents)[number];

export function npIsBootstrapIntent(value: unknown): value is NpBootstrapIntent {
  return typeof value === "string" && npBootstrapIntents.includes(value as NpBootstrapIntent);
}

export function npRequireBootstrapIntent(value: unknown): NpBootstrapIntent {
  if (!npIsBootstrapIntent(value)) {
    throw new TypeError(`Invalid bootstrap intent: expected ${npBootstrapIntents.join(" | ")}.`);
  }
  return value;
}

export interface NpBootstrapOptions {
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
  /**
   * Programmatic storage implementation used only with
   * `storage: { adapter: "custom" }` / `NP_STORAGE_ADAPTER=custom`.
   */
  storageAdapter?: NpStorageAdapter;
  /**
   * Programmatic logger used only with `NP_LOGGER_ADAPTER=custom`.
   * Built-in console intent rejects a custom adapter instead of silently
   * running a different implementation than the environment declares.
   */
  logger?: NpLoggerAdapter;
  /** Programmatic reporter used only with `NP_ERROR_REPORTER_ADAPTER=custom`. */
  errorReporter?: NpErrorReporter;
  /** Programmatic email adapter used only with `NP_EMAIL_ADAPTER=custom`. */
  emailAdapter?: NpEmailAdapter;
  /** Optional downstream CDN purge adapter, owned and closed by this bootstrap. */
  cdnPurgeAdapter?: NpCdnPurgeAdapter;
  /** Optional external search adapter, installed for reads and closed on terminal shutdown. */
  searchAdapter?: NpSearchAdapter;
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

export type NpBootstrap = {
  readonly getDb: (this: void) => NpDb;
  readonly ensureFor: (this: void, intent: NpBootstrapIntent) => Promise<void>;
  /**
   * Phase 5.1 — reset the registered plugin set + re-run the load
   * pipeline. Picks up DB-side config edits and re-runs each plugin's
   * `setup(ctx)` so handlers that
   * read config at boot get a fresh value. Does NOT bust the Node
   * module cache — code edits to a plugin still need a dev server
   * restart to take effect.
   *
   * Shared block/pattern registries reset to built-ins, then active plugin and
   * theme contributions are re-registered before the reload resolves.
   *
   * Idempotent on success: a fresh `ensureFor("plugins")` call after
   * `reloadPlugins()` is a no-op until the next reload.
   */
  readonly reloadPlugins: (this: void) => Promise<NpReloadPluginsResult>;
  /** Terminal, idempotent cleanup of every resource owned by this bootstrap. */
  readonly shutdown: (this: void) => Promise<void>;
};

function toCamelCase(slug: string): string {
  return slug.replace(/[-_](.)/g, (_, ch: string) => ch.toUpperCase());
}

function toPascalCase(value: string): string {
  const camel = toCamelCase(value);
  return camel ? `${camel.charAt(0).toUpperCase()}${camel.slice(1)}` : "";
}

/**
 * Best-effort hostname extractor for the boot-time safety check
 * (#597). Postgres URLs follow the standard `postgres://...`
 * shape so the URL constructor handles them; if parsing fails for
 * any reason (including the connection string being null) we
 * return null and the safety check skips the loopback warning
 * rather than guessing.
 */
function extractDatabaseHost(connectionString: string | null): string | null {
  if (!connectionString) return null;
  try {
    return new URL(connectionString).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Issue #221 — central access predicate the resolver uses to
 * confirm the authenticated session is allowed to operate on the
 * site id pulled from `np-admin-site`. Mirrors the rule in the
 * `/api/admin/sites/active` setter so the two paths can't drift:
 *
 *   - Super-admin can switch to anywhere.
 *   - A site membership grants access to that site.
 *   - Every authenticated staff user keeps the default-site fallback.
 *
 * Anyone else falls through and the resolver drops the override.
 */
export async function canActorUseSite(user: NpAuthUser, siteId: string): Promise<boolean> {
  return canOnSite(user, "site.access", siteId);
}

function resolveTable(generatedSchema: Record<string, unknown>, slug: string): unknown {
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

function resolveNestedTable(
  generatedSchema: Record<string, unknown>,
  collectionSlug: string,
  path: string[],
): unknown {
  const identifier = `${toCamelCase(collectionSlug)}${path.map(toPascalCase).join("")}Table`;
  const table = generatedSchema[identifier];
  if (!table) {
    throw new Error(
      `Collection "${collectionSlug}" field "${path.join(".")}" has no matching generated ` +
        `Drizzle table (expected export \`${identifier}\`). ` +
        `Did you run \`pnpm db:generate\` after changing nested fields?`,
    );
  }
  return table;
}

function resolveRelatedTables(
  generatedSchema: Record<string, unknown>,
  collectionSlug: string,
  fields: NpFieldConfig[],
): { childTables: Record<string, unknown>; joinTables: Record<string, unknown> } {
  const childTables: Record<string, unknown> = {};
  const joinTables: Record<string, unknown> = {};

  function collect(currentFields: NpFieldConfig[], prefix: string[]): void {
    for (const field of currentFields) {
      if (field.type === "group") {
        collect(field.fields, [...prefix, field.name]);
        continue;
      }

      if (field.type === "row" || field.type === "collapsible") {
        collect(field.fields, prefix);
        continue;
      }

      const path = [...prefix, field.name];
      const fieldPath = path.join(".");

      if (field.type === "array") {
        childTables[fieldPath] = resolveNestedTable(generatedSchema, collectionSlug, path);
        continue;
      }

      if (field.type === "relationship" && field.hasMany) {
        joinTables[fieldPath] = resolveNestedTable(generatedSchema, collectionSlug, path);
      }
    }
  }

  collect(fields, []);
  return { childTables, joinTables };
}

/**
 * Builds one lazy process runtime for a Next.js NexPress project. Intent
 * initialization is race-safe and retryable; `getDb()` requires a completed
 * read intent, and terminal `shutdown()` reverses every owned resource.
 */
export function createBootstrap(options: NpBootstrapOptions): NpBootstrap {
  npAssertProjectConfig(options.config);
  if (
    typeof options.generatedSchema !== "object" ||
    options.generatedSchema === null ||
    Array.isArray(options.generatedSchema)
  ) {
    throw new TypeError("Bootstrap generatedSchema must be a module-shaped object.");
  }
  const { config, generatedSchema } = options;
  const cdnPurgeAdapter =
    options.cdnPurgeAdapter === undefined
      ? undefined
      : npRequireCdnPurgeAdapter(options.cdnPurgeAdapter);
  const searchAdapter =
    options.searchAdapter === undefined ? undefined : npRequireSearchAdapter(options.searchAdapter);

  let lifecycle: "active" | "shutting-down" | "closed" = "active";
  let db: NpDb | null = null;
  let runtimeConnectionString: string | null = null;
  let observabilityConfigured = false;
  let storageConfigured = false;
  let cacheConfigured = false;
  let cdnPurgeConfigured = false;
  let ownedSearchAdapter: NpSearchAdapter | null = null;
  let readReady = false;
  let readStartingPromise: Promise<void> | null = null;
  let emailRuntimeConfig: NpEmailRuntimeConfig | null = null;
  let emailConfigured = false;
  let pluginsLoaded = false;
  let pluginsLoadingPromise: Promise<void> | null = null;
  let reloadPromise: Promise<NpReloadPluginsResult> | null = null;
  let producerReady = false;
  let producerActive = false;
  let producerStartingPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;

  function assertActive(): void {
    if (lifecycle !== "active") {
      throw new Error("Bootstrap has begun terminal shutdown and cannot be used again.");
    }
  }

  function resolveConnectionString(): string {
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

  function requireRuntimeConnectionString(): string {
    if (!runtimeConnectionString) {
      throw new Error('Bootstrap connection contract is not ready. Await ensureFor("read") first.');
    }
    return runtimeConnectionString;
  }

  function ensureServices(
    instance: NpDb,
    connectionString: string,
    resolvedEmailRuntime: NpEmailRuntimeConfig,
    rateLimiterCustom: boolean,
  ): void {
    setDb(instance);
    setCacheInvalidationAdapter(npNextCacheInvalidationAdapter);
    cacheConfigured = true;
    if (cdnPurgeAdapter) {
      setCdnPurgeAdapter(cdnPurgeAdapter);
      cdnPurgeConfigured = true;
    }
    if (searchAdapter) ownedSearchAdapter = setSearchAdapter(searchAdapter);
    const storageConfig = config.storage ?? {
      adapter: "local" as const,
      local: { directory: "./public/media", baseUrl: "/media" },
    };
    const storageAdapter = configureStorageRuntime(storageConfig, options.storageAdapter);
    storageConfigured = true;

    // Phase 22.2 — surface known-unsafe configurations once per
    // process (multi-node + LocalStorageAdapter, weak prod secret,
    // etc.). Pure function of its inputs so the bootstrap layer
    // stays the only place reading process.env for these flags.
    verifyStartupSafety({
      storageAdapter: storageAdapter.kind,
      secret: config.auth?.secret ?? process.env.NP_SECRET ?? null,
      nodeEnv: process.env.NODE_ENV,
      multiNodeFlag: process.env.NP_MULTI_NODE,
      replicasFlag: process.env.NP_REPLICAS,
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
      // #597 — three more prod-only checks that map to common
      // dev → prod slip-ups: noop email in prod, loopback DATABASE_URL
      // in prod, missing/loopback SITE_URL in prod.
      //
      // `emailAdapterEnv` is the env var rather than the live
      // adapter — by design, adapter installation happens AFTER this
      // safety check (the host's `init-core.ts` does it in the "write"
      // intent path), so a live-adapter check would always see the
      // default noop. Reading the exact operator intent (`noop`, `smtp`,
      // or `custom`) is the right signal at this boot stage.
      emailAdapterEnv: resolvedEmailRuntime.adapter,
      databaseHost: extractDatabaseHost(connectionString),
      siteUrl: process.env.SITE_URL ?? null,
      // The proxy is a separate execution entrypoint, so its live
      // registry is not a reliable bootstrap signal. Validate the
      // shared env intent instead: `custom` means the proxy wrapper
      // must inject or register an adapter before its first request.
      rateLimiterCustom,
    });
    emailRuntimeConfig = resolvedEmailRuntime;
  }

  function ensureCollectionsResolver(): void {
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
    // it on every `getCurrentSiteId()` and do not memoize across
    // request boundaries.
    const validateOverride = async (
      siteId: string,
      sessionToken: string | null,
    ): Promise<string | null> => {
      if (!sessionToken) return null;
      const secret = config.auth?.secret;
      if (!secret) return null;
      try {
        const instance = requireDbInstance();
        const user = await verifyTokenFull(sessionToken, secret, instance, "access");
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
  }

  function requireDbInstance(): NpDb {
    assertActive();
    if (!readReady) {
      throw new Error('Bootstrap database is not ready. Await ensureFor("read") first.');
    }
    // Always read through the core singleton. Test harnesses call
    // `setDb(testPool)` to swap the singleton, and the bootstrap's
    // closure-cached `db` would otherwise diverge — verification
    // would never find the test session row. Returning `getDb()`
    // keeps both halves of the runtime (singleton consumers vs.
    // bootstrap consumers) reading the same handle. The cast is
    // structural — `setDb()` accepts `NodePgDatabase<Record<string,
    // unknown>>`, but the actual instance handed in here is the
    // schema-typed `NpDb`, so the cast is a no-op at runtime.
    return getCoreDb() as NpDb;
  }

  async function rollbackRead(startupError: unknown): Promise<never> {
    const failures: unknown[] = [startupError];
    resetCurrentSiteResolver();
    resetI18nConfig();
    resetThemes();
    resetCollections();
    if (cacheConfigured) {
      resetCacheInvalidationAdapter(npNextCacheInvalidationAdapter);
      cacheConfigured = false;
    }
    if (cdnPurgeConfigured && cdnPurgeAdapter) {
      resetCdnPurgeAdapter(cdnPurgeAdapter);
      cdnPurgeConfigured = false;
    }
    if (ownedSearchAdapter) {
      resetSearchAdapter(ownedSearchAdapter);
      ownedSearchAdapter = null;
    }
    if (storageConfigured) {
      try {
        await npShutdownStorageAdapter();
      } catch (error) {
        failures.push(error);
      }
      storageConfigured = false;
    }
    const ownedDb = db;
    if (ownedDb) {
      resetDb(ownedDb);
      try {
        await npCloseDbConnection(ownedDb);
      } catch (error) {
        failures.push(error);
      }
      db = null;
    }
    if (observabilityConfigured) {
      try {
        await shutdownObservability();
      } catch (error) {
        failures.push(error);
      }
      observabilityConfigured = false;
    }
    emailRuntimeConfig = null;
    runtimeConnectionString = null;
    if (failures.length > 1) {
      throw new AggregateError(failures, "Bootstrap startup and rollback both failed.");
    }
    throw startupError;
  }

  async function ensureRead(): Promise<void> {
    assertActive();
    if (readReady) return;
    if (readStartingPromise) return readStartingPromise;

    readStartingPromise = (async () => {
      // Validate every generated table and theme before installing process state.
      const registrations = config.collections.map((collection) => ({
        collection,
        table: resolveTable(generatedSchema, collection.slug),
        relatedTables: resolveRelatedTables(generatedSchema, collection.slug, collection.fields),
      }));
      for (const theme of config.themes ?? []) themeContributions(theme);
      const resolvedEmailRuntime = npReadEmailRuntimeConfig(process.env);
      const rateLimiterCustom = npReadRateLimitRuntimeConfig(process.env).adapter === "custom";
      const connectionString = resolveConnectionString();

      try {
        configureObservabilityFromEnv(process.env, {
          logger: options.logger,
          errorReporter: options.errorReporter,
        });
        observabilityConfigured = true;

        const instance = createDbConnection({ connectionString });
        db = instance;
        ensureServices(instance, connectionString, resolvedEmailRuntime, rateLimiterCustom);

        // Static registrations are applied only after their full lookup pass succeeds.
        for (const { collection, table, relatedTables } of registrations) {
          registerCollection(collection.slug, table, collection, relatedTables);
        }
        if (config.themes && config.themes.length > 0) registerThemes(config.themes);
        setI18nConfig(config.i18n ?? null);
        // Install the request-aware resolver without repeating the registrations above.
        ensureCollectionsResolver();
        runtimeConnectionString = connectionString;
        readReady = true;
      } catch (error) {
        await rollbackRead(error);
      }
    })();

    try {
      await readStartingPromise;
    } finally {
      readStartingPromise = null;
    }
  }

  async function ensurePluginsLoaded(): Promise<void> {
    await ensureRead();
    assertActive();
    if (pluginsLoaded) return;
    if (pluginsLoadingPromise) return pluginsLoadingPromise;

    pluginsLoadingPromise = (async () => {
      const instance = requireDbInstance();
      const configured = config.plugins ?? [];
      const configuredIds = configured.map(resolvePluginId);

      await syncPluginRegistrations(instance, configuredIds);
      // Plugin code and registries are process-global. Every configured plugin
      // must be loaded so two concurrent sites can use different activation
      // sets; site-scoped dispatch and source filters decide what is active.
      const pluginsWithContributions = configured.map((plugin) => ({
        plugin,
        blocks: pluginBlocks(plugin),
        patterns: pluginPatterns(plugin),
      }));
      const themesWithContributions = (config.themes ?? []).map(themeContributions);
      const pluginBlockTypes = new Set([
        ...getDefaultBlocks().map((block) => block.type),
        ...pluginsWithContributions.flatMap(({ blocks }) => blocks.map((block) => block.type)),
      ]);
      for (const { plugin, patterns } of pluginsWithContributions) {
        assertKnownPatternBlockTypes(
          `plugin:${resolvePluginId(plugin)}`,
          patterns,
          pluginBlockTypes,
        );
      }
      for (const { theme, blocks, patterns } of themesWithContributions) {
        assertKnownPatternBlockTypes(
          `theme:${theme.manifest.id}`,
          patterns,
          new Set([...pluginBlockTypes, ...blocks.map((block) => block.type)]),
        );
      }
      await loadPlugins(configured);
      // Push each configured plugin's blocks into the shared block
      // registry so they appear in the admin's Add-block popover
      // and resolve correctly during server render.
      // `registerBlock` overwrites an existing source on HMR /
      // re-bootstrap. Same-plugin duplicates were rejected above.
      for (const { plugin, blocks } of pluginsWithContributions) {
        const pluginId = resolvePluginId(plugin);
        for (const block of blocks) {
          // Phase F.4 — auto-stamp concrete source identity
          // (`plugin:<pluginId>`) so the activation filter can
          // distinguish each plugin's blocks. Author-supplied
          // `source` is overridden unconditionally per design
          // doc §4.4 ("authors don't pass source manually").
          registerBlock({ ...block, source: `plugin:${pluginId}` });
        }
      }
      // Phase F.4 — register theme-shipped blocks too. Themes are
      // process-global installed (any of `config.themes` may be
      // active on any site in this process); the registry stays
      // append-only and the activation filter at admin/render
      // layer scopes by site context.
      //
      // Phase F.5 — same for theme-shipped patterns; both use
      // concrete `theme:<id>` source identity so the activation
      // filter scopes them per site.
      for (const { theme, blocks } of themesWithContributions) {
        for (const block of blocks) {
          registerBlock({
            ...block,
            source: `theme:${theme.manifest.id}`,
          });
        }
      }
      // Register patterns only after every referenced block is present.
      for (const { plugin, patterns } of pluginsWithContributions) {
        const pluginId = resolvePluginId(plugin);
        for (const pattern of patterns) {
          registerPattern({ ...pattern, source: `plugin:${pluginId}` });
        }
      }
      for (const { theme, patterns } of themesWithContributions) {
        for (const pattern of patterns) {
          registerPattern({ ...pattern, source: `theme:${theme.manifest.id}` });
        }
      }
      pluginsLoaded = true;
    })();

    try {
      await pluginsLoadingPromise;
    } catch (startupError) {
      const failures: unknown[] = [startupError];
      try {
        await teardownPlugins();
      } catch (error) {
        failures.push(error);
      }
      resetPlugins();
      resetSharedBlockRegistry();
      resetSharedPatternRegistry();
      pluginsLoaded = false;
      if (failures.length > 1) {
        throw new AggregateError(failures, "Plugin startup and rollback both failed.", {
          cause: startupError,
        });
      }
      throw startupError;
    } finally {
      pluginsLoadingPromise = null;
    }
  }

  async function reloadPlugins(): Promise<NpReloadPluginsResult> {
    assertActive();
    if (reloadPromise) return reloadPromise;
    const pendingReload = performPluginReload();
    reloadPromise = pendingReload;
    try {
      return await pendingReload;
    } finally {
      if (reloadPromise === pendingReload) reloadPromise = null;
    }
  }

  async function performPluginReload(): Promise<NpReloadPluginsResult> {
    await ensurePluginsLoaded();
    assertActive();
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
      await teardownPlugins();
      resetPlugins();
      // Plugin block/pattern registries are rebuilt alongside the host
      // registry. All configured contributions are registered process-wide;
      // site activation is applied when each surface reads the registry.
      resetSharedBlockRegistry();
      // Same invariant for patterns: drop removed or config-changed
      // contributions before rebuilding the process registry.
      resetSharedPatternRegistry();
      const instance = requireDbInstance();
      const configured = config.plugins ?? [];
      const configuredIds = configured.map(resolvePluginId);

      await syncPluginRegistrations(instance, configuredIds);
      const pluginsWithContributions = configured.map((plugin) => ({
        plugin,
        blocks: pluginBlocks(plugin),
        patterns: pluginPatterns(plugin),
      }));
      const themesWithContributions = (config.themes ?? []).map(themeContributions);
      const pluginBlockTypes = new Set([
        ...getDefaultBlocks().map((block) => block.type),
        ...pluginsWithContributions.flatMap(({ blocks }) => blocks.map((block) => block.type)),
      ]);
      for (const { plugin, patterns } of pluginsWithContributions) {
        assertKnownPatternBlockTypes(
          `plugin:${resolvePluginId(plugin)}`,
          patterns,
          pluginBlockTypes,
        );
      }
      for (const { theme, blocks, patterns } of themesWithContributions) {
        assertKnownPatternBlockTypes(
          `theme:${theme.manifest.id}`,
          patterns,
          new Set([...pluginBlockTypes, ...blocks.map((block) => block.type)]),
        );
      }
      await loadPlugins(configured);
      for (const { plugin, blocks } of pluginsWithContributions) {
        const pluginId = resolvePluginId(plugin);
        for (const block of blocks) {
          // Same concrete-source stamping as `ensurePluginsLoaded`.
          registerBlock({ ...block, source: `plugin:${pluginId}` });
        }
      }
      // Re-register theme blocks + patterns after the registry
      // resets above (resetSharedBlockRegistry / Pattern only
      // reseed built-in defaults). Theme contributions don't
      // change between reloads, but they live in the same
      // process-global registries so we have to put them back.
      for (const { theme, blocks } of themesWithContributions) {
        for (const block of blocks) {
          registerBlock({
            ...block,
            source: `theme:${theme.manifest.id}`,
          });
        }
      }
      for (const { plugin, patterns } of pluginsWithContributions) {
        const pluginId = resolvePluginId(plugin);
        for (const pattern of patterns) {
          registerPattern({ ...pattern, source: `plugin:${pluginId}` });
        }
      }
      for (const { theme, patterns } of themesWithContributions) {
        for (const pattern of patterns) {
          registerPattern({ ...pattern, source: `theme:${theme.manifest.id}` });
        }
      }
      pluginsLoaded = true;
    })();

    pluginsLoaded = false;
    pluginsLoadingPromise = loading;
    try {
      await loading;
    } catch (reloadError) {
      const failures: unknown[] = [reloadError];
      try {
        await teardownPlugins();
      } catch (error) {
        failures.push(error);
      }
      resetPlugins();
      resetSharedBlockRegistry();
      resetSharedPatternRegistry();
      pluginsLoaded = false;
      if (failures.length > 1) {
        throw new AggregateError(failures, "Plugin reload and rollback both failed.", {
          cause: reloadError,
        });
      }
      throw reloadError;
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

  function ensureEmailRuntime(): void {
    if (emailConfigured) return;
    if (!emailRuntimeConfig) {
      throw new Error('Bootstrap email contract is not ready. Await ensureFor("read") first.');
    }
    configureEmailRuntime(emailRuntimeConfig, options.emailAdapter);
    emailConfigured = true;
  }

  async function ensureJobProducer(): Promise<void> {
    if (producerReady) return;
    if (!npRequireJobsEnabledFlag(process.env.NP_ENABLE_JOBS)) {
      producerReady = true;
      return;
    }
    if (producerStartingPromise) return producerStartingPromise;

    producerStartingPromise = (async () => {
      await startProducer(requireRuntimeConnectionString());
      producerActive = true;
      producerReady = true;
    })();

    try {
      await producerStartingPromise;
    } finally {
      producerStartingPromise = null;
    }
  }

  async function ensureFor(intent: NpBootstrapIntent): Promise<void> {
    assertActive();
    const validatedIntent = npRequireBootstrapIntent(intent);
    await ensureRead();
    assertActive();
    if (validatedIntent === "read") return;
    await ensurePluginsLoaded();
    assertActive();
    if (validatedIntent === "plugins") return;
    ensureEmailRuntime();
    if (validatedIntent === "worker") return;
    assertActive();
    await ensureJobProducer();
    assertActive();
  }

  async function shutdown(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    lifecycle = "shutting-down";
    shutdownPromise = (async () => {
      const failures: unknown[] = [];
      const pending: Promise<unknown>[] = [];
      if (readStartingPromise) pending.push(readStartingPromise);
      if (pluginsLoadingPromise) pending.push(pluginsLoadingPromise);
      if (producerStartingPromise) pending.push(producerStartingPromise);
      if (reloadPromise) pending.push(reloadPromise);
      if (pending.length > 0) await Promise.allSettled(pending);

      async function attempt(operation: () => void | Promise<void>): Promise<void> {
        try {
          await operation();
        } catch (error) {
          failures.push(error);
        }
      }

      if (producerActive) await attempt(stopProducer);
      producerActive = false;
      producerReady = false;
      await attempt(teardownPlugins);
      resetPlugins();
      resetSharedBlockRegistry();
      resetSharedPatternRegistry();
      pluginsLoaded = false;
      resetCurrentSiteResolver();
      resetI18nConfig();
      resetThemes();
      resetCollections();
      if (cacheConfigured) resetCacheInvalidationAdapter(npNextCacheInvalidationAdapter);
      cacheConfigured = false;
      if (cdnPurgeConfigured && cdnPurgeAdapter) resetCdnPurgeAdapter(cdnPurgeAdapter);
      cdnPurgeConfigured = false;
      const searchAdapterToClose = ownedSearchAdapter;
      ownedSearchAdapter = null;
      if (searchAdapterToClose) {
        await attempt(() => shutdownSearchAdapter(searchAdapterToClose));
      }
      if (cdnPurgeAdapter) await attempt(() => shutdownCdnPurgeAdapter(cdnPurgeAdapter));
      if (emailConfigured) resetEmailAdapter();
      emailConfigured = false;
      emailRuntimeConfig = null;
      if (storageConfigured) await attempt(npShutdownStorageAdapter);
      storageConfigured = false;
      const ownedDb = db;
      if (ownedDb) {
        resetDb(ownedDb);
        await attempt(() => npCloseDbConnection(ownedDb));
      }
      db = null;
      runtimeConnectionString = null;
      readReady = false;
      if (observabilityConfigured) await attempt(shutdownObservability);
      observabilityConfigured = false;
      lifecycle = "closed";

      if (failures.length > 0) {
        throw new AggregateError(failures, "One or more bootstrap resources failed to shut down.");
      }
    })();
    return shutdownPromise;
  }

  return {
    getDb: requireDbInstance,
    ensureFor,
    reloadPlugins,
    shutdown,
  };
}
