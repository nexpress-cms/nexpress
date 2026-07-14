import { randomUUID } from "node:crypto";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, asc, eq, gt, isNull, like, or } from "drizzle-orm";

import type { NpAuthUser, NpFindOptions } from "../config/types.js";
import { NpError, NpForbiddenError } from "../errors.js";
import {
  deleteDocument as coreDeleteDocument,
  findDocuments as coreFindDocuments,
  getDocumentById as coreGetDocumentById,
  saveDocument as coreSaveDocument,
} from "../collections/pipeline.js";
import {
  listMedia as coreListMedia,
  getMediaById as coreGetMediaById,
  deleteMedia as coreDeleteMedia,
  uploadMedia as coreUploadMedia,
} from "../media/service.js";
import { npGetStorageObjectUrl } from "../storage/operations.js";
import { getStorageAdapter } from "../storage/registry.js";
import { getMediaUrl as coreGetMediaUrl } from "../media/url.js";
import type { NpGetMediaUrlOptions, NpMediaRecord } from "../media-contract/types.js";
import { getSiteGeneralSettings } from "../settings/service.js";
import { getDb } from "../db/runtime.js";
import { NP_GLOBAL_PLUGIN_SITE_ID, npPluginStorage, npSettings } from "../db/schema/system.js";
import { getScopedLogger } from "../observability/logger.js";
import { reportError } from "../observability/error-reporter.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID } from "../sites/registry.js";
import { npMergeThemeTokenOverlays } from "../theme/contract.js";
import { getTheme, npRequireThemeTokensOverlay } from "../theme/runtime.js";
import type { NpThemeTokens, NpThemeTokensOverlay } from "../theme/types.js";
import {
  npValidatePluginActionResult,
  type NpPluginActionRegistrationConflict,
  type NpPluginActionKind,
  type NpRegisteredPluginAction,
} from "./admin-action-contract.js";

/**
 * Two distinct fallbacks live here, intentionally:
 *
 *   - `resolveStorageSiteId` returns the `_global_` sentinel when no
 *     site context is set. `np_plugin_storage` is keyed by
 *     `(plugin_id, site_id, key)` and the sentinel scopes data as
 *     "process-wide / cross-site shared." Background workers, CLI
 *     tasks, and migrations all run without a site resolver and
 *     should land in the global keyspace by default.
 *
 *   - `resolveSettingsSiteId` returns the actual default site id
 *     when no context is set. `np_settings` rows ALWAYS belong to
 *     a real site, so falling through to a sentinel would orphan
 *     the row outside `np_sites` and break joins.
 *
 * They look superficially the same — one helper per intent so the
 * next reader doesn't have to reverse-engineer which fallback is
 * which by reading both schema definitions.
 */
async function resolveStorageSiteId(): Promise<string> {
  return (await getCurrentSiteId()) ?? NP_GLOBAL_PLUGIN_SITE_ID;
}

async function resolveSettingsSiteId(): Promise<string> {
  return (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
}

/**
 * Plugin principal used when plugin-initiated operations need an NpAuthUser.
 * Plugin ops bypass per-doc ACL; authorisation is enforced via the plugin's
 * declared `capabilities` instead. This matches the Phase 3 design: plugins
 * are trusted in-process code, capability flags gate coarse permissions.
 */
const pluginPrincipal = (pluginId: string): NpAuthUser => ({
  id: `plugin:${pluginId}`,
  email: `${pluginId}@plugins.local`,
  name: `plugin/${pluginId}`,
  role: "admin",
  tokenVersion: 0,
});

interface RegistrationLike {
  actions: Map<string, (data: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>>;
  actionMetadata?: Map<string, NpRegisteredPluginAction>;
  actionConflicts?: NpPluginActionRegistrationConflict[];
}

type RuntimeActionResult = { ok: boolean; data?: unknown; error?: string };
type RuntimeActionHandler = (
  data: unknown,
  ctx: Record<string, unknown>,
) => Promise<RuntimeActionResult>;

interface BuildContextOptions {
  pluginId: string;
  capabilities: readonly string[];
  allowedHosts: readonly string[];
  config: Record<string, unknown>;
  registration: RegistrationLike;
  lookupRegistration: (pluginId: string) => RegistrationLike | undefined;
}

/**
 * Per-process in-memory cache for `ctx.cache.*`. Keyed by `pluginId:key`,
 * each entry carries its expiry (ms) so `get()` lazily evicts stale entries.
 * Lost on process restart — use `ctx.storage` for durable state.
 */
const pluginCache = new Map<string, { value: unknown; expiresAt: number | null }>();
let pluginStorageAppendCounter = 0;

async function toPluginMediaItem(record: NpMediaRecord): Promise<Record<string, unknown>> {
  return {
    id: record.id,
    filename: record.filename,
    mimeType: record.mimeType,
    size: record.filesize,
    url: await npGetStorageObjectUrl(getStorageAdapter(), record.storageKey),
    ...(record.alt !== null ? { alt: record.alt } : {}),
    ...(record.width !== null ? { width: record.width } : {}),
    ...(record.height !== null ? { height: record.height } : {}),
    metadata: {
      status: record.status,
      storageKey: record.storageKey,
      hash: record.hash,
      folderId: record.folderId,
      focalPoint: record.focalPoint,
      sizes: record.sizes,
    },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function cacheKey(pluginId: string, key: string): string {
  return `${pluginId}:${key}`;
}

function assertCap(pluginId: string, capabilities: readonly string[], required: string): void {
  if (!capabilities.includes(required)) {
    throw new NpForbiddenError(
      `plugin:${pluginId}`,
      `capability "${required}" not declared in manifest`,
    );
  }
}

async function loadOptionalNextCache(): Promise<{
  revalidatePath?: (path: string) => void;
  revalidateTag?: (tag: string) => void;
} | null> {
  try {
    // Indirect specifier so TypeScript doesn't try to resolve
    // `next/cache` at compile time — `@nexpress/core` doesn't
    // depend on Next.js. Only the Next-runtime path needs
    // the cache helpers; worker / CLI / standalone Node
    // consumers see this fall through to null cleanly.
    const moduleId: string = "next/cache";
    const mod = (await import(moduleId)) as {
      revalidatePath?: (path: string) => void;
      revalidateTag?: (tag: string) => void;
    };
    return mod;
  } catch {
    return null;
  }
}

async function revalidateOptionalTag(tag: string): Promise<void> {
  const cache = await loadOptionalNextCache();
  const revalidateTag = cache?.revalidateTag;
  if (typeof revalidateTag !== "function") return;
  if (revalidateTag.length >= 2) {
    (revalidateTag as (cacheTag: string, profile: string) => void)(tag, "default");
  } else {
    revalidateTag(tag);
  }
}

/**
 * Produces the runtime ctx passed to plugin hook / route / setup handlers.
 * Matches the `NpPluginContext` shape declared in `@nexpress/plugin-sdk`.
 *
 * Every namespace declared on `NpPluginContext` is implemented:
 *   - `pluginId`, `config`, `capabilities`
 *   - `content.*` (find / findOne / save / delete)
 *   - `media.*` (list / getById / getUrl / upload / delete)
 *   - `settings.*`
 *   - `log.*`
 *   - `next.*`
 *   - `actions.*`
 *   - `storage.*` (plugin-scoped key/value persistence)
 *   - `cache.*` (revalidatePath / revalidateTag wrappers)
 *   - `theme.*` (read theme tokens / active theme)
 *   - `http.fetch` (allowlist-gated outbound HTTP)
 *
 * Capability checks (`assertCap`) gate every namespace so a
 * plugin that only declares `content:read` can't reach into
 * `media:upload` etc. without explicit opt-in.
 */
export function createPluginRuntimeContext(options: BuildContextOptions): Record<string, unknown> {
  const { pluginId, capabilities, allowedHosts, config, registration, lookupRegistration } =
    options;
  const db = (): NodePgDatabase<Record<string, unknown>> => getDb();
  const principal = pluginPrincipal(pluginId);

  // Plugin logs flow through the global logger (`setLogger` at app boot)
  // with `pluginId` bound, so operators can filter / route / aggregate
  // plugin output without each plugin reaching for `console.*`.
  const pluginLog = getScopedLogger({ pluginId });

  function registerAction(
    actionName: string,
    kind: NpPluginActionKind,
    handler: RuntimeActionHandler,
  ): void {
    const metadata: NpRegisteredPluginAction = {
      id: actionName,
      kind,
      source: "setup",
    };
    const previous = registration.actionMetadata?.get(actionName);
    if (previous) {
      registration.actionConflicts?.push({
        actionId: actionName,
        previous,
        replacement: metadata,
      });
    }
    registration.actionMetadata?.set(actionName, metadata);
    registration.actions.set(actionName, async (data) =>
      npValidatePluginActionResult(pluginId, actionName, kind, await handler(data, runtimeContext)),
    );
  }

  const runtimeContext: Record<string, unknown> = {
    pluginId,
    config,
    capabilities,

    content: {
      async find(collection: string, query?: Partial<NpFindOptions>) {
        assertCap(pluginId, capabilities, "content:read");
        return coreFindDocuments(collection, query ?? {}, principal);
      },
      async findOne(collection: string, id: string) {
        assertCap(pluginId, capabilities, "content:read");
        const doc = await coreGetDocumentById(collection, id, principal);
        return doc ?? null;
      },
      async create(collection: string, data: Record<string, unknown>) {
        assertCap(pluginId, capabilities, "content:write");
        const result = await coreSaveDocument(collection, null, data, principal);
        return result.doc;
      },
      async update(collection: string, id: string, data: Record<string, unknown>) {
        assertCap(pluginId, capabilities, "content:write");
        const result = await coreSaveDocument(collection, id, data, principal);
        return result.doc;
      },
      async delete(collection: string, id: string) {
        assertCap(pluginId, capabilities, "content:delete");
        await coreDeleteDocument(collection, id, principal);
      },
      async count(collection: string) {
        assertCap(pluginId, capabilities, "content:read");
        const result = await coreFindDocuments(collection, { limit: 1 }, principal);
        return result.totalDocs;
      },
    },

    media: {
      async list(query?: {
        page?: number;
        limit?: number;
        mimeType?: string;
        folder?: string;
        search?: string;
      }) {
        assertCap(pluginId, capabilities, "media:read");
        const result = await coreListMedia({
          page: query?.page,
          limit: query?.limit,
          mimeType: query?.mimeType,
          folderId: query?.folder,
          q: query?.search,
        });
        return {
          ...result,
          docs: await Promise.all(result.docs.map((record) => toPluginMediaItem(record))),
        };
      },
      async getById(id: string) {
        assertCap(pluginId, capabilities, "media:read");
        const record = await coreGetMediaById(id);
        return record ? toPluginMediaItem(record) : null;
      },
      async getUrl(id: string, options?: NpGetMediaUrlOptions) {
        assertCap(pluginId, capabilities, "media:read");
        return coreGetMediaUrl(id, options);
      },
      async upload(
        file: Uint8Array | ArrayBuffer,
        metadata: { filename: string; mimeType: string; folder?: string },
      ) {
        assertCap(pluginId, capabilities, "media:write");
        const buffer = Buffer.from(file instanceof ArrayBuffer ? new Uint8Array(file) : file);
        const result = await coreUploadMedia(
          {
            buffer,
            originalFilename: metadata.filename,
            mimeType: metadata.mimeType,
          },
          // `uploaded_by` is a nullable FK to `np_users.id`. The
          // previous `plugin:<id>` synthetic value violated the FK
          // and threw at insert time, leaving the storage object
          // orphaned. (#62) Plugin attribution lives in the audit
          // log + plugin-storage layer; the uploader column is for
          // staff-user provenance only.
          null,
          metadata.folder,
        );
        const record = await coreGetMediaById(result.id);
        if (!record) {
          throw new Error(
            `[plugin:${pluginId}] media.upload: stored media ${result.id} is missing.`,
          );
        }
        return toPluginMediaItem(record);
      },
      async delete(id: string) {
        assertCap(pluginId, capabilities, "media:delete");
        const result = await coreDeleteMedia(id);
        if (!result.deleted && result.references && result.references.length > 0) {
          throw new NpError(
            `[plugin:${pluginId}] media.delete: ${id} is referenced by ${result.references.length} document(s).`,
            "CONFLICT",
            409,
          );
        }
      },
    },

    storage: {
      // Phase 17 — every storage call resolves the current
      // site at call time and uses it as part of the composite
      // PK `(plugin_id, site_id, key)`. Background workers and
      // scripts (no site resolver) fall back to the
      // `_global_` sentinel so legacy single-site callers keep
      // their existing keyspace.
      async get<T = unknown>(key: string): Promise<T | null> {
        assertCap(pluginId, capabilities, "storage:kv");
        const siteId = await resolveStorageSiteId();
        const now = new Date();
        const rows = await db()
          .select()
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, pluginId),
              eq(npPluginStorage.siteId, siteId),
              eq(npPluginStorage.key, key),
              or(isNull(npPluginStorage.expiresAt), gt(npPluginStorage.expiresAt, now)),
            ),
          )
          .limit(1);
        const row = rows[0] as { value?: unknown } | undefined;
        return (row?.value as T | undefined) ?? null;
      },
      async set(key: string, value: unknown, opts?: { ttl?: number }): Promise<void> {
        assertCap(pluginId, capabilities, "storage:kv");
        const siteId = await resolveStorageSiteId();
        const expiresAt = opts?.ttl && opts.ttl > 0 ? new Date(Date.now() + opts.ttl * 1000) : null;
        await db()
          .insert(npPluginStorage)
          .values({
            pluginId,
            siteId,
            key,
            value,
            expiresAt,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
            set: { value, expiresAt, updatedAt: new Date() },
          });
      },
      async delete(key: string): Promise<void> {
        assertCap(pluginId, capabilities, "storage:kv");
        const siteId = await resolveStorageSiteId();
        await db()
          .delete(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, pluginId),
              eq(npPluginStorage.siteId, siteId),
              eq(npPluginStorage.key, key),
            ),
          );
      },
      async list(prefix?: string): Promise<string[]> {
        assertCap(pluginId, capabilities, "storage:kv");
        const siteId = await resolveStorageSiteId();
        const now = new Date();
        const where = prefix
          ? and(
              eq(npPluginStorage.pluginId, pluginId),
              eq(npPluginStorage.siteId, siteId),
              like(npPluginStorage.key, `${prefix}%`),
              or(isNull(npPluginStorage.expiresAt), gt(npPluginStorage.expiresAt, now)),
            )
          : and(
              eq(npPluginStorage.pluginId, pluginId),
              eq(npPluginStorage.siteId, siteId),
              or(isNull(npPluginStorage.expiresAt), gt(npPluginStorage.expiresAt, now)),
            );
        const rows = (await db()
          .select({ key: npPluginStorage.key })
          .from(npPluginStorage)
          .where(where)) as Array<{ key: string }>;
        return rows.map((row) => row.key);
      },
      async has(key: string): Promise<boolean> {
        assertCap(pluginId, capabilities, "storage:kv");
        const siteId = await resolveStorageSiteId();
        const now = new Date();
        const rows = await db()
          .select({ key: npPluginStorage.key })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, pluginId),
              eq(npPluginStorage.siteId, siteId),
              eq(npPluginStorage.key, key),
              or(isNull(npPluginStorage.expiresAt), gt(npPluginStorage.expiresAt, now)),
            ),
          )
          .limit(1);
        return rows.length > 0;
      },
      async append<T = unknown>(
        prefix: string,
        value: T,
        opts?: { ttl?: number },
      ): Promise<string> {
        assertCap(pluginId, capabilities, "storage:kv");
        const normalizedPrefix = prefix.length > 0 ? prefix : "append:";
        pluginStorageAppendCounter = (pluginStorageAppendCounter + 1) % 1_000_000;
        const sequence = String(pluginStorageAppendCounter).padStart(6, "0");
        const key = `${normalizedPrefix}${new Date().toISOString()}:${sequence}:${randomUUID()}`;
        const siteId = await resolveStorageSiteId();
        const expiresAt = opts?.ttl && opts.ttl > 0 ? new Date(Date.now() + opts.ttl * 1000) : null;

        await db().insert(npPluginStorage).values({
          pluginId,
          siteId,
          key,
          value,
          expiresAt,
          updatedAt: new Date(),
        });

        return key;
      },
      async listValues<T = unknown>(prefix: string): Promise<Array<{ key: string; value: T }>> {
        assertCap(pluginId, capabilities, "storage:kv");
        const siteId = await resolveStorageSiteId();
        const now = new Date();
        const rows = (await db()
          .select({ key: npPluginStorage.key, value: npPluginStorage.value })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, pluginId),
              eq(npPluginStorage.siteId, siteId),
              like(npPluginStorage.key, `${prefix}%`),
              or(isNull(npPluginStorage.expiresAt), gt(npPluginStorage.expiresAt, now)),
            ),
          )
          .orderBy(asc(npPluginStorage.key))) as Array<{ key: string; value: T }>;

        return rows;
      },
    },

    cache: {
      // The cache namespace is in-memory today (a process-
      // scoped Map). The interface is `Promise<...>` so a
      // future Redis-backed implementation can swap in
      // without breaking plugin authors; the sync
      // implementations return resolved promises directly so
      // the require-await rule stays happy.
      get<T = unknown>(key: string): Promise<T | null> {
        const entry = pluginCache.get(cacheKey(pluginId, key));
        if (!entry) return Promise.resolve(null);
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
          pluginCache.delete(cacheKey(pluginId, key));
          return Promise.resolve(null);
        }
        return Promise.resolve(entry.value as T);
      },
      set(key: string, value: unknown, ttl?: number): Promise<void> {
        pluginCache.set(cacheKey(pluginId, key), {
          value,
          expiresAt: ttl && ttl > 0 ? Date.now() + ttl * 1000 : null,
        });
        return Promise.resolve();
      },
      invalidate(key: string): Promise<void> {
        pluginCache.delete(cacheKey(pluginId, key));
        return Promise.resolve();
      },
      invalidateAll(): Promise<void> {
        const prefix = `${pluginId}:`;
        for (const key of pluginCache.keys()) {
          if (key.startsWith(prefix)) pluginCache.delete(key);
        }
        return Promise.resolve();
      },
    },

    settings: {
      async getSite() {
        assertCap(pluginId, capabilities, "settings:read");
        const siteId = await resolveSettingsSiteId();
        return getSiteGeneralSettings(siteId);
      },
      async getPlugin(): Promise<Record<string, unknown>> {
        assertCap(pluginId, capabilities, "settings:read");
        // G.1 — plugin config moved from np_plugins.config to
        // np_settings.(siteId, "plugin.config:<id>"). Read via the
        // versioned-envelope-aware helper so plugins still see the
        // unwrapped value.
        const { getPluginConfig } = await import("./config.js");
        const value = await getPluginConfig(pluginId);
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
        return {};
      },
      async setPlugin(data: Record<string, unknown>): Promise<void> {
        assertCap(pluginId, capabilities, "settings:write");
        // All writes route through the registered plugin contract. Plugins
        // without configSchema still get the exact versioned envelope, but
        // an unregistered owner can no longer mint arbitrary settings keys.
        const { pluginConfigCacheTag, setPluginConfig } = await import("./config.js");
        await setPluginConfig(pluginId, data, null);
        await revalidateOptionalTag(pluginConfigCacheTag(pluginId));
      },
    },

    theme: {
      async getTokens(): Promise<NpThemeTokens> {
        assertCap(pluginId, capabilities, "theme:read");
        return getTheme();
      },
      async setTokens(partial: NpThemeTokensOverlay): Promise<void> {
        assertCap(pluginId, capabilities, "theme:write");
        const validatedPartial = npRequireThemeTokensOverlay(
          partial,
          `plugin.${pluginId}.theme.tokens`,
        );
        const siteId = await resolveSettingsSiteId();
        const rows = await db()
          .select()
          .from(npSettings)
          .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "theme")))
          .limit(1);
        const existing = npRequireThemeTokensOverlay(rows[0]?.value, "settings.theme");
        const merged = npMergeThemeTokenOverlays(existing, validatedPartial);
        const updatedAt = new Date();
        await db()
          .insert(npSettings)
          .values({ siteId, key: "theme", value: merged, updatedAt })
          .onConflictDoUpdate({
            target: [npSettings.siteId, npSettings.key],
            set: { value: merged, updatedAt },
          });

        await revalidateOptionalTag(`nx:theme:${siteId}`);
      },
    },

    http: {
      async fetch(
        url: string,
        opts?: {
          method?: string;
          headers?: Record<string, string>;
          body?: unknown;
          timeoutMs?: number;
        },
      ): Promise<{ ok: boolean; status: number; headers: Record<string, string>; body?: unknown }> {
        assertCap(pluginId, capabilities, "network:fetch");
        // Allowed-host check: manifest.allowedHosts gates every fetch. Empty
        // list means the plugin declared network:fetch but didn't scope it
        // — refuse rather than allow anything. A literal "*" is reserved
        // for plugins whose endpoint host is operator-configured.
        let target: URL;
        try {
          target = new URL(url);
        } catch {
          throw new NpError(
            `[plugin:${pluginId}] http.fetch: invalid URL "${url}"`,
            "INVALID_URL",
            400,
          );
        }
        const hostMatches = allowedHosts.some((pattern) => {
          if (pattern === "*") return true;
          if (pattern === target.hostname) return true;
          if (pattern.startsWith("*.") && target.hostname.endsWith(pattern.slice(1))) return true;
          return false;
        });
        if (!hostMatches) {
          throw new NpForbiddenError(
            `plugin:${pluginId}`,
            `http.fetch to "${target.hostname}" blocked; add it to manifest.allowedHosts`,
          );
        }

        const timeoutMs = opts?.timeoutMs ?? 10_000;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          // `BodyInit` isn't in @types/node's global scope even with lib.dom
          // off, so keep the local union narrow enough for fetch() while
          // staying portable across runtimes.
          let body: string | Uint8Array | undefined;
          if (opts?.body !== undefined && opts.body !== null) {
            if (typeof opts.body === "string") {
              body = opts.body;
            } else if (opts.body instanceof Uint8Array) {
              body = opts.body;
            } else {
              body = JSON.stringify(opts.body);
            }
          }
          const response = await globalThis.fetch(url, {
            method: opts?.method ?? (body !== undefined ? "POST" : "GET"),
            headers: opts?.headers,
            body,
            signal: controller.signal,
          });
          const headers: Record<string, string> = {};
          response.headers.forEach((v, k) => {
            headers[k] = v;
          });
          const contentType = response.headers.get("content-type") ?? "";
          let parsedBody: unknown = undefined;
          if (contentType.includes("application/json")) {
            parsedBody = await response.json().catch(() => undefined);
          } else if (contentType.startsWith("text/")) {
            parsedBody = await response.text();
          }
          return {
            ok: response.ok,
            status: response.status,
            headers,
            body: parsedBody,
          };
        } finally {
          clearTimeout(timeout);
        }
      },
    },

    log: {
      debug(message: string, data?: Record<string, unknown>): void {
        pluginLog.debug(message, data);
      },
      info(message: string, data?: Record<string, unknown>): void {
        pluginLog.info(message, data);
      },
      warn(message: string, data?: Record<string, unknown>): void {
        pluginLog.warn(message, data);
      },
      error(message: string, data?: Record<string, unknown>): void {
        pluginLog.error(message, data);
      },
    },

    errors: {
      // Plugin-side error reporting with pluginId auto-tagged. The host
      // already auto-reports thrown hook handlers (in `dispatchHookHandler`),
      // so plugins typically only need this when *catching* an error
      // internally — e.g. a non-fatal upstream failure they want to log to
      // Sentry but recover from.
      report(
        error: unknown,
        context?: {
          extra?: Record<string, unknown>;
          tags?: Record<string, string>;
          user?: { id?: string; email?: string; role?: string };
        },
      ): Promise<void> {
        const err = error instanceof Error ? error : new Error(String(error));
        return reportError(err, {
          tags: { source: "plugin", pluginId, ...context?.tags },
          extra: context?.extra,
          user: context?.user,
        });
      },
    },

    next: {
      async revalidatePath(path: string): Promise<void> {
        const mod = await loadOptionalNextCache();
        mod?.revalidatePath?.(path);
      },
      async revalidateTag(tag: string): Promise<void> {
        const mod = await loadOptionalNextCache();
        const fn = mod?.revalidateTag;
        if (typeof fn !== "function") return;
        // Next 16 widened the signature to `(tag, profile)`.
        // Forward `"default"` when the runtime accepts the
        // extra arg so plugins keep their single-arg ergonomics.
        if (fn.length >= 2) {
          (fn as (tag: string, profile: string) => void)(tag, "default");
        } else {
          fn(tag);
        }
      },
    },

    actions: {
      register(actionName: string, handler: RuntimeActionHandler): void {
        registerAction(actionName, "action", handler);
      },
      registerMetric(actionName: string, handler: RuntimeActionHandler): void {
        registerAction(actionName, "metric", handler);
      },
      registerStatus(actionName: string, handler: RuntimeActionHandler): void {
        registerAction(actionName, "status", handler);
      },
      registerTable(actionName: string, handler: RuntimeActionHandler): void {
        registerAction(actionName, "table", handler);
      },
      async dispatch(
        targetPluginId: string,
        actionName: string,
        data?: unknown,
      ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
        const target = lookupRegistration(targetPluginId);
        const action = target?.actions.get(actionName);
        if (!action) {
          return {
            ok: false,
            error: `Action "${actionName}" not found on plugin "${targetPluginId}"`,
          };
        }
        return action(data);
      },
    },
  };

  return runtimeContext;
}
