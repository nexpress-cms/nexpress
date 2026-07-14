import {
  createDbConnection,
  configureStorageRuntime,
  getDb,
  getOptionalJobQueue,
  listPluginStates,
  loadPlugins,
  registerCollection,
  registerThemes,
  resetPlugins,
  resolveSiteForHostname,
  setCurrentSiteResolver,
  setDb,
  setI18nConfig,
  startProducer,
  syncPluginRegistrations,
  teardownPlugins,
  verifyStartupSafety,
  verifyTokenFull,
  NP_DEFAULT_SITE_ID,
  type NpAuthUser,
  type NpConfig,
  type NpFieldConfig,
  type NpPluginConfig,
  type NpReconcileSchedulesResult,
  type NpResolvedPluginLike,
  type NpRegisteredTheme,
  type NpStorageAdapter,
} from "@nexpress/core";
import { npReadRateLimitRuntimeConfig } from "@nexpress/core/rate-limit";
import { canOnSite } from "@nexpress/core/sites";
import { npRequireJobsEnabledFlag } from "@nexpress/core/jobs-contract";
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
  /**
   * Programmatic storage implementation used only with
   * `storage: { adapter: "custom" }` / `NP_STORAGE_ADAPTER=custom`.
   */
  storageAdapter?: NpStorageAdapter;
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
      local: { directory: "./public/media", baseUrl: "/media" },
    };
    const storageAdapter = configureStorageRuntime(storageConfig, options.storageAdapter);

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
      emailAdapterEnv: process.env.NP_EMAIL_ADAPTER ?? null,
      databaseHost: extractDatabaseHost(
        options.connectionString || config.db.connectionString || process.env.DATABASE_URL || null,
      ),
      siteUrl: process.env.SITE_URL ?? null,
      // The proxy is a separate execution entrypoint, so its live
      // registry is not a reliable bootstrap signal. Validate the
      // shared env intent instead: `custom` means the proxy wrapper
      // must inject or register an adapter before its first request.
      rateLimiterCustom: npReadRateLimitRuntimeConfig(process.env).adapter === "custom",
    });

    servicesInitialized = true;
  }

  function ensureCollections(): void {
    if (collectionsRegistered) return;

    for (const collection of config.collections) {
      const relatedTables = resolveRelatedTables(
        generatedSchema,
        collection.slug,
        collection.fields,
      );
      registerCollection(
        collection.slug,
        resolveTable(generatedSchema, collection.slug),
        collection,
        relatedTables,
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
        const db = getDb();
        const user = await verifyTokenFull(sessionToken, secret, db, "access");
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
      const enabledWithContributions = enabled.map((plugin) => ({
        plugin,
        blocks: pluginBlocks(plugin),
        patterns: pluginPatterns(plugin),
      }));
      const themesWithContributions = (config.themes ?? []).map(themeContributions);
      const pluginBlockTypes = new Set([
        ...getDefaultBlocks().map((block) => block.type),
        ...enabledWithContributions.flatMap(({ blocks }) => blocks.map((block) => block.type)),
      ]);
      for (const { plugin, patterns } of enabledWithContributions) {
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
      await loadPlugins(enabled);
      // Push each enabled plugin's blocks into the shared block
      // registry so they appear in the admin's Add-block popover
      // and resolve correctly during server render.
      // `registerBlock` overwrites an existing source on HMR /
      // re-bootstrap. Same-plugin duplicates were rejected above.
      for (const { plugin, blocks } of enabledWithContributions) {
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
      for (const { plugin, patterns } of enabledWithContributions) {
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
      await teardownPlugins();
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
      // Same invariant for patterns: drop plugin-contributed
      // patterns on reload so a disabled plugin's pattern doesn't
      // linger in the editor's command-menu picker.
      resetSharedPatternRegistry();
      const instance = getDbInstance();
      const configured = config.plugins ?? [];
      const configuredIds = configured.map(resolvePluginId);

      await syncPluginRegistrations(instance, configuredIds);
      const states = await listPluginStates(instance);
      const disabledIds = new Set(states.filter((s) => !s.enabled).map((s) => s.id));

      const enabled = configured.filter((plugin) => !disabledIds.has(resolvePluginId(plugin)));
      const enabledWithContributions = enabled.map((plugin) => ({
        plugin,
        blocks: pluginBlocks(plugin),
        patterns: pluginPatterns(plugin),
      }));
      const themesWithContributions = (config.themes ?? []).map(themeContributions);
      const pluginBlockTypes = new Set([
        ...getDefaultBlocks().map((block) => block.type),
        ...enabledWithContributions.flatMap(({ blocks }) => blocks.map((block) => block.type)),
      ]);
      for (const { plugin, patterns } of enabledWithContributions) {
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
      await loadPlugins(enabled);
      for (const { plugin, blocks } of enabledWithContributions) {
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
      for (const { plugin, patterns } of enabledWithContributions) {
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
    if (!npRequireJobsEnabledFlag(process.env.NP_ENABLE_JOBS)) {
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
