import { getRegisteredPatterns, getSharedRegistry } from "./registry.js";
import type {
  NpBlockDefinition,
  NpBlockMetadata,
  NpPattern,
} from "./types.js";

/**
 * Phase F.4 — block source identity model.
 *
 * The `source` field on registered blocks carries the
 * concrete contributor identity — `core` for built-ins,
 * `plugin:<id>` for plugin blocks, `theme:<id>` for theme
 * blocks. This is the contract the activation filter uses to
 * decide which blocks should be visible in the admin Add-block
 * popover and which should render as a "from inactive theme"
 * placeholder during page rendering.
 *
 * Broad legacy labels (`"plugin"`, `"theme"`, `"built-in"`)
 * still parse — they map to `kind` only — and the filter
 * treats them as always-active to avoid breaking older
 * registrations. New code should always go through the
 * bootstrap auto-stamp path (which produces concrete ids).
 */

export interface NpBlockSource {
  kind: "core" | "theme" | "plugin" | "custom";
  /** Concrete id when present. Broad legacy labels yield
   *  `id: undefined`, which the filter treats as always active.
   *  `custom` (operator-saved patterns) never carries an id —
   *  per-operator/per-site customs are stored elsewhere. */
  id?: string;
}

export function parseBlockSource(
  source: NpBlockMetadata["source"],
): NpBlockSource | null {
  if (!source) {
    // Undefined source is a built-in default (registry seeds them
    // without source). Treat as core.
    return { kind: "core" };
  }
  if (source === "core" || source === "built-in") {
    return { kind: "core" };
  }
  if (source === "custom") {
    // Operator-saved pattern (NpPattern union member). Custom
    // sources never have a concrete id — they're filed per-
    // operator outside the source registry — and the filter
    // always passes them.
    return { kind: "custom" };
  }
  if (source === "plugin") {
    return { kind: "plugin" };
  }
  if (source === "theme") {
    return { kind: "theme" };
  }
  if (source.startsWith("theme:")) {
    const id = source.slice("theme:".length);
    return id ? { kind: "theme", id } : { kind: "theme" };
  }
  if (source.startsWith("plugin:")) {
    const id = source.slice("plugin:".length);
    return id ? { kind: "plugin", id } : { kind: "plugin" };
  }
  return null;
}

export interface NpActiveSourceContext {
  /** Currently-active theme id for the site, or null. Theme
   *  blocks whose `source: "theme:<id>"` doesn't match this id
   *  are filtered out. Pass null when the site has no active
   *  theme (every theme's blocks are filtered, render-time
   *  shows the placeholder). */
  themeId: string | null;
}

/**
 * Decide whether a block (or pattern) with the given `source`
 * should be active for the current site context. v0.2 only
 * filters theme sources by `themeId` — plugin / core / unknown
 * sources always pass:
 *
 * - **Plugins** are process-global; the existing
 *   `resetSharedBlockRegistry` flow already drops disabled
 *   plugins' blocks at registry-write time, so any
 *   `plugin:<id>` source still reachable in the registry is
 *   from an enabled plugin. Re-filtering here would be
 *   redundant.
 * - **Theme blocks** stay append-only across plugin reloads
 *   so site A active=magazine and site B active=portfolio can
 *   coexist in the same process. The per-site filter happens
 *   here, at read time, against the site's `themeId`.
 * - **Core / built-in / unrecognized** sources pass — built-
 *   ins are universal, unknown labels are treated as
 *   conservative-allow.
 */
export function isBlockSourceActive(
  source: NpBlockMetadata["source"],
  ctx: NpActiveSourceContext,
): boolean {
  const parsed = parseBlockSource(source);
  if (!parsed) return true;
  if (parsed.kind === "theme") {
    if (parsed.id === undefined) return true;
    return parsed.id === ctx.themeId;
  }
  // core / plugin / custom: always pass per the rules above.
  return true;
}

/**
 * Filter the shared registry by the active-site source context.
 * Used by the admin Add-block popover; without this, sites in a
 * multi-site process would see every theme's blocks regardless
 * of which is active.
 */
export function getRegisteredBlocksForActiveSources(
  ctx: NpActiveSourceContext,
): NpBlockDefinition[] {
  return getSharedRegistry()
    .getAll()
    .filter((b) => isBlockSourceActive(b.source, ctx));
}

/**
 * Same filter but returns the serializable metadata shape
 * (no `render` function). The admin layout snapshots the
 * registry as metadata before sending to the browser; this
 * helper applies the source filter at the same boundary so the
 * page-builder's Add-block popover only shows blocks for the
 * current site's active theme.
 */
export function getRegisteredBlockMetadataForActiveSources(
  ctx: NpActiveSourceContext,
): NpBlockMetadata[] {
  return getRegisteredBlocksForActiveSources(ctx).map((definition) => {
    const { render: _render, ...metadata } = definition;
    void _render;
    return metadata;
  });
}

/**
 * Phase F.5 — sister filter for patterns. Same rules as the
 * block filter (`isBlockSourceActive`): theme patterns are
 * scoped by `themeId`, plugin / built-in / custom patterns
 * always pass. The admin layout uses this so the page builder's
 * pattern picker only shows patterns for the current site's
 * active theme.
 */
export function getRegisteredPatternsForActiveSources(
  ctx: NpActiveSourceContext,
): NpPattern[] {
  return getRegisteredPatterns().filter((p) => isBlockSourceActive(p.source, ctx));
}
