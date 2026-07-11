import { and, eq } from "drizzle-orm";

import { getDb } from "../db/runtime.js";
import { npSettings } from "../db/schema/system.js";
import { NpValidationError } from "../errors.js";
import { addStrings } from "../i18n/strings.js";
import { getCurrentSiteId } from "../sites/context.js";
import { NP_DEFAULT_SITE_ID as DEFAULT_SITE } from "../sites/registry.js";
import type { NpRegisteredTheme } from "../config/types.js";
import { npValidateRegisteredThemeDefinition } from "./definition-contract.js";

/**
 * Phase 11.1 — theme registry. Sites declare an array of themes
 * in `nexpress.config.ts`; the framework registers them once at
 * boot. The active theme id lives in `np_settings.activeTheme`,
 * so admins can switch between installed themes via the admin UI
 * without a redeploy. New theme INSTALLATION still requires a
 * rebuild (Next.js bundles the components) — same constraint
 * WordPress has with file uploads on the server.
 *
 * The registry is a process-level Map; same lifetime as the
 * collection / plugin registries. Re-registration overwrites
 * by `manifest.id` so a hot-reload during dev doesn't accumulate
 * stale entries.
 */
const registry = new Map<string, NpRegisteredTheme>();

/**
 * Idempotent — call once at boot from the framework's
 * bootstrap, again from a hot-reload, etc. Themes are matched
 * by `manifest.id`; later registrations replace earlier ones.
 */
export function registerThemes(themes: NpRegisteredTheme[]): void {
  const incomingIds = new Set<string>();
  for (const theme of themes) {
    const validation = npValidateRegisteredThemeDefinition(theme);
    if (!validation.ok) {
      throw new Error(
        `Invalid theme definition at ${validation.issue.location}: ${validation.issue.message}`,
      );
    }
    if (incomingIds.has(theme.manifest.id)) {
      throw new Error(`Invalid theme registry: duplicate theme id "${theme.manifest.id}".`);
    }
    incomingIds.add(theme.manifest.id);
  }

  for (const theme of themes) {
    registry.set(theme.manifest.id, theme);

    // Phase 12.5 — themes can ship UI-string bundles via
    // `impl.i18n: { locale: { key: value } }`. Merging happens
    // here (alongside theme registration) rather than in the
    // bootstrap so live theme swaps in dev pick up updated
    // strings without a restart.
    const impl = theme.impl as { i18n?: Record<string, Record<string, string>> };
    if (impl?.i18n && typeof impl.i18n === "object") {
      for (const [locale, bundle] of Object.entries(impl.i18n)) {
        if (bundle && typeof bundle === "object") {
          addStrings(locale, bundle);
        }
      }
    }
  }
}

export function getRegisteredThemes(): NpRegisteredTheme[] {
  return Array.from(registry.values());
}

export function getThemeById(id: string): NpRegisteredTheme | undefined {
  return registry.get(id);
}

/** Tests use this between cases; production callers should never need it. */
export function resetThemes(): void {
  registry.clear();
}

/**
 * Reads the persisted active-theme id from `np_settings` for
 * the current site. Returns `null` when no row exists —
 * caller's job to decide the fallback (typically the first
 * registered theme).
 *
 * Phase 15.4 — scoped by current site. Single-tenant
 * deployments leave every row at `site_id = 'default'`, so
 * the lookup behaves identically to the pre-15.4 global
 * version.
 */
export async function getActiveThemeId(): Promise<string | null> {
  const db = getDb();
  const siteId = (await getCurrentSiteId()) ?? DEFAULT_SITE;
  const rows = (await db
    .select()
    .from(npSettings)
    .where(and(eq(npSettings.siteId, siteId), eq(npSettings.key, "activeTheme")))
    .limit(1)) as Array<{ value: unknown }>;
  const row = rows[0];
  if (!row) return null;
  return typeof row.value === "string" ? row.value : null;
}

/**
 * Resolves the active theme to render. Looks up the persisted id
 * in the registry; falls back to the first registered theme when
 * the id is unset, missing, or points at a theme that's no
 * longer in the registry (e.g. it was removed from
 * `nexpress.config.ts` between deploys). Returns `null` only
 * when the registry is completely empty.
 */
export async function getActiveTheme(): Promise<NpRegisteredTheme | null> {
  const id = await getActiveThemeId();
  if (id) {
    const theme = registry.get(id);
    if (theme) return theme;
  }
  // Registry preserves insertion order; the first registered
  // theme is the implicit default.
  const first = registry.values().next();
  return first.done ? null : first.value;
}

/**
 * Persist the active theme. Validates the id is registered so
 * an admin can't pick a string that doesn't resolve to anything
 * (which would silently fall back to the default and confuse
 * the operator).
 *
 * Accepts an optional outer transaction so the active-theme flip
 * can sit inside the same atomic scope as a wipe + seed batch
 * (see `wipeSeededContent` / `seedAll`'s `tx` option). Without
 * an outer tx, the write runs against the pool handle and
 * commits standalone.
 */
export async function setActiveThemeId(
  id: string,
  updatedBy: string | null = null,
  options: { tx?: unknown } = {},
): Promise<void> {
  if (!registry.has(id)) {
    throw new NpValidationError("Invalid input", [
      {
        field: "themeId",
        message: `Unknown theme '${id}'. Register it in nexpress.config.ts first.`,
      },
    ]);
  }
  // `options.tx` is typed `unknown` here to avoid pulling Drizzle
  // internals onto the public registry surface. Callers thread
  // the NpTransaction value they received from
  // `db.transaction(async (tx) => …)`; structurally it has the
  // same `.insert(table)` chain we rely on.
  const dbHandle = (options.tx ?? getDb()) as ReturnType<typeof getDb>;
  const now = new Date();
  const siteId = (await getCurrentSiteId()) ?? DEFAULT_SITE;
  // Phase 15.4 — composite (site_id, key) PK.
  await dbHandle
    .insert(npSettings)
    .values({ siteId, key: "activeTheme", value: id, updatedAt: now, updatedBy })
    .onConflictDoUpdate({
      target: [npSettings.siteId, npSettings.key],
      set: { value: id, updatedAt: now, updatedBy },
    });
}

/**
 * Phase 11.3 — surface the active theme's templates for a
 * given collection so admin pickers and the catch-all renderer
 * can introspect what's available without reaching into the
 * opaque `impl` themselves. The result is sanitized for serial-
 * ization (no React component refs leak through this path) so
 * the same shape is safe to send over the API to the admin UI.
 */
export interface NpThemeTemplateSummary {
  id: string;
  label: string;
  description?: string;
}

export async function getThemeTemplateSummaries(
  collectionSlug: string,
): Promise<NpThemeTemplateSummary[]> {
  const summaries = new Map<string, NpThemeTemplateSummary>();

  // Phase 14.5 — start with plugin-contributed templates so
  // theme entries naturally overwrite them on id collision.
  // Lazy import keeps the registry → plugin coupling one-way
  // (plugins know about themes' template shape; themes don't
  // depend on plugins at type-import time).
  const { getPluginTemplatesForCollection } = await import("../plugins/templates.js");
  for (const [id, value] of getPluginTemplatesForCollection(collectionSlug)) {
    const def = value as { label?: unknown; description?: unknown };
    summaries.set(id, {
      id,
      label: typeof def.label === "string" ? def.label : id,
      description: typeof def.description === "string" ? def.description : undefined,
    });
  }

  const active = await getActiveTheme();
  if (active) {
    const impl = active.impl as {
      templates?: Record<string, Record<string, { label?: string; description?: string }>>;
    };
    const set = impl.templates?.[collectionSlug];
    if (set) {
      for (const [id, def] of Object.entries(set)) {
        summaries.set(id, {
          id,
          label: typeof def.label === "string" ? def.label : id,
          description: typeof def.description === "string" ? def.description : undefined,
        });
      }
    }
  }

  return [...summaries.values()];
}

/**
 * Phase 14.5 — resolve a template's render component for the
 * given collection + template id. Looks up theme first
 * (theme always wins), falls back to plugin-contributed
 * templates. Returns the opaque value (the catch-all casts to
 * `{ component }` at the render boundary).
 */
export async function resolveTemplateComponent(
  collectionSlug: string,
  templateId: string,
): Promise<unknown> {
  const active = await getActiveTheme();
  if (active) {
    const impl = active.impl as {
      templates?: Record<string, Record<string, unknown>>;
    };
    const themeEntry = impl.templates?.[collectionSlug]?.[templateId];
    if (themeEntry) return themeEntry;
  }

  const { getPluginTemplatesForCollection } = await import("../plugins/templates.js");
  const pluginEntry = getPluginTemplatesForCollection(collectionSlug).get(templateId);
  return pluginEntry ?? null;
}
