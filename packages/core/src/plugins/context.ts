import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

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
  getStorageAdapter,
} from "../media/service.js";
import { getDb } from "../collections/pipeline.js";
import { nxPlugins, nxSettings } from "../db/schema/system.js";

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
  config: Record<string, unknown>;
  registration: RegistrationLike;
  lookupRegistration: (pluginId: string) => RegistrationLike | undefined;
}

function assertCap(pluginId: string, capabilities: readonly string[], required: string): void {
  if (!capabilities.includes(required)) {
    throw new NxForbiddenError(
      `plugin:${pluginId}`,
      `capability "${required}" not declared in manifest`,
    );
  }
}

function notImplemented(pluginId: string, area: string): never {
  throw new NxError(
    `[plugin:${pluginId}] ctx.${area} is not implemented in this release. ` +
      `See docs/plugin-system-design.md for the roadmap.`,
    "NOT_IMPLEMENTED",
    501,
  );
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
  const { pluginId, capabilities, config, registration, lookupRegistration } = options;
  const db = (): NodePgDatabase<Record<string, unknown>> => getDb();
  const principal = pluginPrincipal(pluginId);

  function prefix(level: string, message: string): string {
    return `[plugin:${pluginId}] ${level} ${message}`;
  }

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
      async list(query?: { page?: number; limit?: number; search?: string; folder?: string }) {
        assertCap(pluginId, capabilities, "media:read");
        return coreListMedia({
          page: query?.page,
          limit: query?.limit,
          search: query?.search,
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
        if (!media) return "";
        const adapter = getStorageAdapter();
        return adapter.getUrl(media.storageKey);
      },
      upload() {
        notImplemented(pluginId, "media.upload");
      },
      delete() {
        notImplemented(pluginId, "media.delete");
      },
    },

    storage: {
      get() {
        notImplemented(pluginId, "storage.get");
      },
      set() {
        notImplemented(pluginId, "storage.set");
      },
      delete() {
        notImplemented(pluginId, "storage.delete");
      },
      list() {
        notImplemented(pluginId, "storage.list");
      },
      has() {
        notImplemented(pluginId, "storage.has");
      },
    },

    cache: {
      get() {
        notImplemented(pluginId, "cache.get");
      },
      set() {
        notImplemented(pluginId, "cache.set");
      },
      invalidate() {
        notImplemented(pluginId, "cache.invalidate");
      },
      invalidateAll() {
        notImplemented(pluginId, "cache.invalidateAll");
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
      getTokens() {
        notImplemented(pluginId, "theme.getTokens");
      },
      setTokens() {
        notImplemented(pluginId, "theme.setTokens");
      },
    },

    http: {
      fetch() {
        notImplemented(pluginId, "http.fetch");
      },
    },

    log: {
      debug(message: string, data?: Record<string, unknown>): void {
        // eslint-disable-next-line no-console
        console.debug(prefix("debug", message), data ?? "");
      },
      info(message: string, data?: Record<string, unknown>): void {
        // eslint-disable-next-line no-console
        console.info(prefix("info", message), data ?? "");
      },
      warn(message: string, data?: Record<string, unknown>): void {
        // eslint-disable-next-line no-console
        console.warn(prefix("warn", message), data ?? "");
      },
      error(message: string, data?: Record<string, unknown>): void {
        // eslint-disable-next-line no-console
        console.error(prefix("error", message), data ?? "");
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
