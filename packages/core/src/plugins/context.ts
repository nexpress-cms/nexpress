import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, gt, isNull, like, or } from "drizzle-orm";

import type { NxAuthUser, NxFindOptions } from "../config/types.js";
import { NxError, NxForbiddenError } from "../errors.js";
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
  getStorageAdapter,
} from "../media/service.js";
import { getDb } from "../collections/pipeline.js";
import { nxPluginStorage, nxPlugins, nxSettings } from "../db/schema/system.js";
import { getScopedLogger } from "../observability/logger.js";

/**
 * Plugin principal used when plugin-initiated operations need an NxAuthUser.
 * Plugin ops bypass per-doc ACL; authorisation is enforced via the plugin's
 * declared `capabilities` instead. This matches the Phase 3 design: plugins
 * are trusted in-process code, capability flags gate coarse permissions.
 */
const pluginPrincipal = (pluginId: string): NxAuthUser => ({
  id: `plugin:${pluginId}`,
  email: `${pluginId}@plugins.local`,
  name: `plugin/${pluginId}`,
  role: "admin",
  tokenVersion: 0,
});

interface RegistrationLike {
  actions: Map<string, (data: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>>;
}

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

function cacheKey(pluginId: string, key: string): string {
  return `${pluginId}:${key}`;
}

function assertCap(pluginId: string, capabilities: readonly string[], required: string): void {
  if (!capabilities.includes(required)) {
    throw new NxForbiddenError(
      `plugin:${pluginId}`,
      `capability "${required}" not declared in manifest`,
    );
  }
}

async function loadOptionalNextCache(): Promise<
  | {
      revalidatePath?: (path: string) => void;
      revalidateTag?: (tag: string) => void;
    }
  | null
> {
  try {
    const importer = new Function("moduleId", "return import(moduleId);") as (
      moduleId: string,
    ) => Promise<unknown>;
    const mod = (await importer("next/cache")) as {
      revalidatePath?: (path: string) => void;
      revalidateTag?: (tag: string) => void;
    };
    return mod;
  } catch {
    return null;
  }
}

/**
 * Produces the runtime ctx passed to plugin hook / route / setup handlers.
 * Matches the `NxPluginContext` shape declared in `@nexpress/plugin-sdk`.
 *
 * Implemented: pluginId, config, capabilities, content.*, media.list/getById/getUrl,
 * settings.*, log.*, next.*, actions.*.
 *
 * Declared-but-not-implemented (throws NxError 501 with "NOT_IMPLEMENTED"):
 * storage.*, cache.*, http.fetch, theme.*, media.upload/delete.
 * These will land in follow-up PRs.
 */
export function createPluginRuntimeContext(
  options: BuildContextOptions,
): Record<string, unknown> {
  const { pluginId, capabilities, allowedHosts, config, registration, lookupRegistration } = options;
  const db = (): NodePgDatabase<Record<string, unknown>> => getDb();
  const principal = pluginPrincipal(pluginId);

  // Plugin logs flow through the global logger (`setLogger` at app boot)
  // with `pluginId` bound, so operators can filter / route / aggregate
  // plugin output without each plugin reaching for `console.*`.
  const pluginLog = getScopedLogger({ pluginId });

  return {
    pluginId,
    config,
    capabilities,

    content: {
      async find(collection: string, query?: Partial<NxFindOptions>) {
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
      }) {
        assertCap(pluginId, capabilities, "media:read");
        return coreListMedia({
          page: query?.page,
          limit: query?.limit,
          mimeType: query?.mimeType,
          folderId: query?.folder,
        });
      },
      async getById(id: string) {
        assertCap(pluginId, capabilities, "media:read");
        return coreGetMediaById(id);
      },
      async getUrl(id: string) {
        assertCap(pluginId, capabilities, "media:read");
        const media = await coreGetMediaById(id);
        if (!media || typeof media.storageKey !== "string") return "";
        const adapter = getStorageAdapter();
        return adapter.getUrl(media.storageKey);
      },
      async upload(
        file: Uint8Array | ArrayBuffer,
        metadata: { filename: string; mimeType: string; folder?: string },
      ) {
        assertCap(pluginId, capabilities, "media:write");
        const buffer = Buffer.from(
          file instanceof ArrayBuffer ? new Uint8Array(file) : file,
        );
        return coreUploadMedia(
          {
            buffer,
            originalFilename: metadata.filename,
            mimeType: metadata.mimeType,
          },
          // Plugin principal id is synthetic so uploads are traceable back to
          // the plugin via the `uploaded_by` column (even though no real user
          // row with that id exists).
          `plugin:${pluginId}`,
          metadata.folder,
        );
      },
      async delete(id: string) {
        assertCap(pluginId, capabilities, "media:delete");
        const result = await coreDeleteMedia(id);
        if (!result.deleted && result.references && result.references.length > 0) {
          throw new NxError(
            `[plugin:${pluginId}] media.delete: ${id} is referenced by ${result.references.length} document(s).`,
            "CONFLICT",
            409,
          );
        }
      },
    },

    storage: {
      async get<T = unknown>(key: string): Promise<T | null> {
        assertCap(pluginId, capabilities, "storage:kv");
        const now = new Date();
        const rows = await db()
          .select()
          .from(nxPluginStorage)
          .where(
            and(
              eq(nxPluginStorage.pluginId, pluginId),
              eq(nxPluginStorage.key, key),
              or(isNull(nxPluginStorage.expiresAt), gt(nxPluginStorage.expiresAt, now)),
            ),
          )
          .limit(1);
        const row = rows[0] as { value?: unknown } | undefined;
        return (row?.value as T | undefined) ?? null;
      },
      async set(key: string, value: unknown, opts?: { ttl?: number }): Promise<void> {
        assertCap(pluginId, capabilities, "storage:kv");
        const expiresAt =
          opts?.ttl && opts.ttl > 0 ? new Date(Date.now() + opts.ttl * 1000) : null;
        await db()
          .insert(nxPluginStorage)
          .values({
            pluginId,
            key,
            value,
            expiresAt,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [nxPluginStorage.pluginId, nxPluginStorage.key],
            set: { value, expiresAt, updatedAt: new Date() },
          });
      },
      async delete(key: string): Promise<void> {
        assertCap(pluginId, capabilities, "storage:kv");
        await db()
          .delete(nxPluginStorage)
          .where(
            and(eq(nxPluginStorage.pluginId, pluginId), eq(nxPluginStorage.key, key)),
          );
      },
      async list(prefix?: string): Promise<string[]> {
        assertCap(pluginId, capabilities, "storage:kv");
        const now = new Date();
        const where = prefix
          ? and(
              eq(nxPluginStorage.pluginId, pluginId),
              like(nxPluginStorage.key, `${prefix}%`),
              or(isNull(nxPluginStorage.expiresAt), gt(nxPluginStorage.expiresAt, now)),
            )
          : and(
              eq(nxPluginStorage.pluginId, pluginId),
              or(isNull(nxPluginStorage.expiresAt), gt(nxPluginStorage.expiresAt, now)),
            );
        const rows = (await db()
          .select({ key: nxPluginStorage.key })
          .from(nxPluginStorage)
          .where(where)) as Array<{ key: string }>;
        return rows.map((row) => row.key);
      },
      async has(key: string): Promise<boolean> {
        assertCap(pluginId, capabilities, "storage:kv");
        const now = new Date();
        const rows = await db()
          .select({ key: nxPluginStorage.key })
          .from(nxPluginStorage)
          .where(
            and(
              eq(nxPluginStorage.pluginId, pluginId),
              eq(nxPluginStorage.key, key),
              or(isNull(nxPluginStorage.expiresAt), gt(nxPluginStorage.expiresAt, now)),
            ),
          )
          .limit(1);
        return rows.length > 0;
      },
    },

    cache: {
      async get<T = unknown>(key: string): Promise<T | null> {
        const entry = pluginCache.get(cacheKey(pluginId, key));
        if (!entry) return null;
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
          pluginCache.delete(cacheKey(pluginId, key));
          return null;
        }
        return entry.value as T;
      },
      async set(key: string, value: unknown, ttl?: number): Promise<void> {
        pluginCache.set(cacheKey(pluginId, key), {
          value,
          expiresAt: ttl && ttl > 0 ? Date.now() + ttl * 1000 : null,
        });
      },
      async invalidate(key: string): Promise<void> {
        pluginCache.delete(cacheKey(pluginId, key));
      },
      async invalidateAll(): Promise<void> {
        const prefix = `${pluginId}:`;
        for (const key of pluginCache.keys()) {
          if (key.startsWith(prefix)) pluginCache.delete(key);
        }
      },
    },

    settings: {
      async getSite(): Promise<Record<string, unknown>> {
        assertCap(pluginId, capabilities, "settings:read");
        const rows = await db().select().from(nxSettings).where(eq(nxSettings.key, "site"));
        const row = rows[0] as { value?: unknown } | undefined;
        if (!row || !row.value || typeof row.value !== "object" || Array.isArray(row.value)) {
          return {};
        }
        return row.value as Record<string, unknown>;
      },
      async getPlugin(): Promise<Record<string, unknown>> {
        const rows = await db().select().from(nxPlugins).where(eq(nxPlugins.id, pluginId));
        const row = rows[0] as { config?: unknown } | undefined;
        if (!row || !row.config || typeof row.config !== "object" || Array.isArray(row.config)) {
          return {};
        }
        return row.config as Record<string, unknown>;
      },
      async setPlugin(data: Record<string, unknown>): Promise<void> {
        await db()
          .update(nxPlugins)
          .set({ config: data, updatedAt: new Date() })
          .where(eq(nxPlugins.id, pluginId));
      },
    },

    theme: {
      async getTokens(): Promise<Record<string, unknown>> {
        assertCap(pluginId, capabilities, "theme:read");
        const rows = await db().select().from(nxSettings).where(eq(nxSettings.key, "theme"));
        const row = rows[0] as { value?: unknown } | undefined;
        if (!row || !row.value || typeof row.value !== "object" || Array.isArray(row.value)) {
          return {};
        }
        return row.value as Record<string, unknown>;
      },
      async setTokens(partial: Record<string, unknown>): Promise<void> {
        assertCap(pluginId, capabilities, "theme:write");
        const rows = await db().select().from(nxSettings).where(eq(nxSettings.key, "theme"));
        const existing =
          rows[0] && (rows[0] as { value?: unknown }).value &&
          typeof (rows[0] as { value?: unknown }).value === "object" &&
          !Array.isArray((rows[0] as { value?: unknown }).value)
            ? ((rows[0] as { value: unknown }).value as Record<string, unknown>)
            : {};
        const merged = { ...existing, ...partial };
        await db()
          .insert(nxSettings)
          .values({ key: "theme", value: merged, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: nxSettings.key,
            set: { value: merged, updatedAt: new Date() },
          });
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
        // — refuse rather than allow anything.
        let target: URL;
        try {
          target = new URL(url);
        } catch {
          throw new NxError(`[plugin:${pluginId}] http.fetch: invalid URL "${url}"`, "INVALID_URL", 400);
        }
        const hostMatches = allowedHosts.some((pattern) => {
          if (pattern === target.hostname) return true;
          if (pattern.startsWith("*.") && target.hostname.endsWith(pattern.slice(1))) return true;
          return false;
        });
        if (!hostMatches) {
          throw new NxForbiddenError(
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

    next: {
      async revalidatePath(path: string): Promise<void> {
        const mod = await loadOptionalNextCache();
        mod?.revalidatePath?.(path);
      },
      async revalidateTag(tag: string): Promise<void> {
        const mod = await loadOptionalNextCache();
        mod?.revalidateTag?.(tag);
      },
    },

    actions: {
      register(
        actionName: string,
        handler: (
          data: unknown,
        ) => Promise<{ ok: boolean; data?: unknown; error?: string }>,
      ): void {
        registration.actions.set(actionName, handler);
      },
      async dispatch(
        targetPluginId: string,
        actionName: string,
        data?: unknown,
      ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
        const target = lookupRegistration(targetPluginId);
        const action = target?.actions.get(actionName);
        if (!action) {
          return { ok: false, error: `Action "${actionName}" not found on plugin "${targetPluginId}"` };
        }
        return action(data);
      },
    },
  };
}
