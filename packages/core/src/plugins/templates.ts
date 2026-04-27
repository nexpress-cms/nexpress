/**
 * Phase 14.5 — plugin-contributed page templates. Plugins
 * register templates the same way themes do (`{ label,
 * description?, component }` keyed by collection then by
 * template id) but the registry here is global, separate
 * from any one theme. The theme registry's
 * `getThemeTemplateSummaries` merges both sets so admin
 * pickers and the catch-all see a unified list; theme
 * registrations win on id collisions because the active
 * theme is the design authority for the site.
 *
 * The framework keeps `impl: unknown` on the public
 * registered-theme shape (no React peer dep in core), so
 * plugin template values stay typed as `unknown` here too.
 * The caller casts to the typed `NxThemeTemplate` shape
 * from `@nexpress/theme` at the render boundary.
 */

interface PluginTemplateEntry {
  /** Plugin id that registered this template — useful for debugging. */
  pluginId: string;
  /** Template metadata + component, kept opaque here. */
  value: unknown;
}

const registry = new Map<string, Map<string, PluginTemplateEntry>>();

/**
 * Merge a single plugin's `templates` declaration into the
 * registry. Idempotent: re-registering the same plugin id
 * overwrites its previous entries.
 */
export function registerPluginTemplates(
  pluginId: string,
  templates: Record<string, Record<string, unknown>>,
): void {
  for (const [collectionSlug, set] of Object.entries(templates)) {
    if (!set || typeof set !== "object") continue;
    let perCollection = registry.get(collectionSlug);
    if (!perCollection) {
      perCollection = new Map();
      registry.set(collectionSlug, perCollection);
    }
    // Drop any prior entries from this plugin in this
    // collection — keeps re-registration deterministic.
    for (const [id, entry] of perCollection) {
      if (entry.pluginId === pluginId) {
        perCollection.delete(id);
      }
    }
    for (const [templateId, value] of Object.entries(set)) {
      perCollection.set(templateId, { pluginId, value });
    }
  }
}

/** Tests use this between cases; production callers shouldn't need it. */
export function resetPluginTemplates(): void {
  registry.clear();
}

/**
 * Returns every plugin-registered template for a collection,
 * keyed by template id. The returned values are opaque
 * (`unknown`); consumers cast to the appropriate shape at the
 * call site (theme registry casts to summary metadata; the
 * catch-all casts to `{ component }`).
 */
export function getPluginTemplatesForCollection(
  collectionSlug: string,
): Map<string, unknown> {
  const perCollection = registry.get(collectionSlug);
  if (!perCollection) return new Map();
  const out = new Map<string, unknown>();
  for (const [id, entry] of perCollection) {
    out.set(id, entry.value);
  }
  return out;
}
