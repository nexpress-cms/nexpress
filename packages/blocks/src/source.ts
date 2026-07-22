import { npAnalyzeBlockContent } from "./content-contract.js";
import { getSharedBlockCandidates, getSharedPatternCandidates } from "./registry.js";
import type { NpBlockDefinition, NpBlockInstance, NpBlockMetadata, NpPattern } from "./types.js";

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

export function parseBlockSource(source: NpBlockMetadata["source"]): NpBlockSource | null {
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
  /** Plugin ids enabled for the current site. Configured plugin blocks remain
   * process-global in the registry and are filtered here at read/render time. */
  pluginIds: ReadonlySet<string>;
}

/**
 * Decide whether a block (or pattern) with the given `source`
 * should be active for the current site context.
 *
 * - **Plugins** are registered process-wide and filtered by the site's exact
 *   enabled id set, just like themes are filtered by active theme id.
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
  if (parsed.kind === "plugin") {
    if (parsed.id === undefined) return true;
    return ctx.pluginIds.has(parsed.id);
  }
  // core / custom: always pass per the rules above.
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
  const selected: NpBlockDefinition[] = [];
  for (const candidates of getSharedBlockCandidates().values()) {
    const definition = [...candidates]
      .reverse()
      .find((candidate) => isBlockSourceActive(candidate.source, ctx));
    if (definition) selected.push(definition);
  }
  return selected;
}

/** Resolve the last-loaded block owner that is active for one site. */
export function getBlockForActiveSources(
  type: string,
  ctx: NpActiveSourceContext,
): NpBlockDefinition | undefined {
  const candidates = getSharedBlockCandidates().get(type);
  return candidates
    ? [...candidates].reverse().find((candidate) => isBlockSourceActive(candidate.source, ctx))
    : undefined;
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
 * Sister filter for patterns. It restores the last active owner after a
 * collision and drops patterns whose content requires a block definition that
 * is unavailable for the site. This keeps insertion and rendering on the same
 * site-scoped contribution snapshot.
 */
export function getRegisteredPatternsForActiveSources(ctx: NpActiveSourceContext): NpPattern[] {
  const definitions = getRegisteredBlocksForActiveSources(ctx);
  const activeTypes = new Set(definitions.map((definition) => definition.type));
  const referencesOnlyActiveTypes = (blocks: readonly NpBlockInstance[]): boolean =>
    blocks.every(
      (block) =>
        activeTypes.has(block.type) &&
        (!block.children || referencesOnlyActiveTypes(block.children)),
    );
  const selected: NpPattern[] = [];
  for (const candidates of getSharedPatternCandidates().values()) {
    const pattern = [...candidates].reverse().find((candidate) => {
      if (!isBlockSourceActive(candidate.source, ctx)) return false;
      if (!referencesOnlyActiveTypes(candidate.blocks)) return false;
      return !npAnalyzeBlockContent(candidate.blocks, definitions).some(
        (issue) => issue.severity === "error",
      );
    });
    if (pattern) selected.push(pattern);
  }
  return selected;
}
