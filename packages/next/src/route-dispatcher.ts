import type { ComponentType } from "react";
import type { Metadata } from "next";

import {
  getPluginPageRoutes,
  isPluginEnabled,
  npMatchPluginPageRoutePattern,
  type PluginPageRouteEntry,
} from "@nexpress/core";
import type {
  NpRouteRenderProps,
  NpTheme,
  NpThemeArchiveEntry,
  NpThemeArchives,
  NpThemeDateArchiveEntry,
  NpThemeRoute,
} from "@nexpress/theme";

/**
 * Phase F.2 — theme route dispatcher.
 *
 * Linear-scan a theme's declared routes (and expanded archives)
 * against a request path. First match wins. Returns the route
 * + extracted params, or null when nothing matches.
 *
 * Both the catch-all `Page` and `generateMetadata` MUST share
 * this dispatcher — otherwise theme-rendered URLs would emit
 * framework-default SEO (a real bug). The dispatcher is pure,
 * doesn't read the DB, doesn't await: cheap to call from both.
 */

export interface NpThemeRouteMatch {
  route: NpThemeRoute;
  params: Record<string, string>;
}

const DEFAULT_ARCHIVE_PATTERNS = {
  byCategory: "/category/:slug",
  byTag: "/tag/:slug",
  byAuthor: "/author/:id",
  search: "/search",
} as const;

function dateArchivePattern(granularity: NpThemeDateArchiveEntry["granularity"]): string {
  switch (granularity) {
    case "year":
      return "/:year(\\d{4})";
    case "month":
      return "/:year(\\d{4})/:month(\\d{2})";
    case "day":
      return "/:year(\\d{4})/:month(\\d{2})/:day(\\d{2})";
    default: {
      const _exhaustive: never = granularity;
      return _exhaustive;
    }
  }
}

/**
 * Expand `archives` sugar into concrete `NpThemeRoute`s. The
 * order — within a collection — is byCategory, byTag, byAuthor,
 * byDate, search. Across collections, declaration order. Because
 * dispatch is first-match-wins, more specific patterns naturally
 * appear in this list before broader ones (e.g. byCategory's
 * `/category/:slug` doesn't conflict with byDate's
 * `/:year/:month` — different segment counts and shapes).
 */
function expandArchives(archives: NpThemeArchives): NpThemeRoute[] {
  const out: NpThemeRoute[] = [];
  for (const [, raw] of Object.entries(archives)) {
    const byKind = raw;
    if (!byKind) continue;
    const entry = (e: NpThemeArchiveEntry | undefined, defaultPattern: string) => {
      if (!e) return;
      out.push({
        pattern: e.pattern ?? defaultPattern,
        component: e.component,
        metadata: e.metadata,
      });
    };
    entry(byKind.byCategory, DEFAULT_ARCHIVE_PATTERNS.byCategory);
    entry(byKind.byTag, DEFAULT_ARCHIVE_PATTERNS.byTag);
    entry(byKind.byAuthor, DEFAULT_ARCHIVE_PATTERNS.byAuthor);
    if (byKind.byDate) {
      out.push({
        pattern: byKind.byDate.pattern ?? dateArchivePattern(byKind.byDate.granularity),
        component: byKind.byDate.component,
        metadata: byKind.byDate.metadata,
      });
    }
    entry(byKind.search, DEFAULT_ARCHIVE_PATTERNS.search);
  }
  return out;
}

/**
 * Module-level set tracking patterns we've already warned about,
 * so the multi-collection collision warning fires once per
 * pattern per process (not per request). Reset is exposed for
 * tests via `__resetCollisionWarnings`.
 */
const warnedPatterns = new Set<string>();

/** Test hook — resets the warning de-dup set. */
export function __resetCollisionWarnings(): void {
  warnedPatterns.clear();
}

function detectAndWarnCollisions(routes: NpThemeRoute[]): void {
  const seen = new Map<string, number>();
  for (const r of routes) {
    seen.set(r.pattern, (seen.get(r.pattern) ?? 0) + 1);
  }
  for (const [pattern, count] of seen) {
    if (count > 1 && !warnedPatterns.has(pattern)) {
      warnedPatterns.add(pattern);

      console.warn(
        `[nexpress/theme] route pattern "${pattern}" is declared ${count} ` +
          `times in the active theme — only the first declaration will ` +
          `match. Override \`pattern\` on archive entries when using the ` +
          `same archive kind across multiple collections.`,
      );
    }
  }
}

/**
 * Concatenate explicit `routes` and expanded `archives` into a
 * single ordered list. Explicit routes come first so a theme
 * that declares both can override the archive sugar's default
 * pattern by adding an explicit route earlier. Logs a one-time
 * dev warning when two routes share the same pattern (a real
 * foot-gun for themes using archive sugar across multiple
 * collections — see `NpThemeArchives` JSDoc).
 */
export function collectThemeRoutes(theme: NpTheme): NpThemeRoute[] {
  const explicit = theme.impl.routes ?? [];
  const expanded = theme.impl.archives ? expandArchives(theme.impl.archives) : [];
  const all = [...explicit, ...expanded];
  detectAndWarnCollisions(all);
  return all;
}

/**
 * Pattern matcher. Splits both pattern and path on "/", walks
 * segment-by-segment. `:name` matches any single segment;
 * `:name(regex)` matches by regex. Literals match exactly.
 * Length must agree — no glob/wildcard in v0.2.
 *
 * Returns the captured params on success, null otherwise.
 */
function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternSegs = pattern.split("/").filter(Boolean);
  const pathSegs = path.split("/").filter(Boolean);
  if (patternSegs.length !== pathSegs.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegs.length; i++) {
    const ps = patternSegs[i];
    const xs = pathSegs[i];
    if (ps.startsWith(":")) {
      const parenStart = ps.indexOf("(");
      if (parenStart >= 0) {
        if (!ps.endsWith(")")) return null;
        const name = ps.slice(1, parenStart);
        const re = ps.slice(parenStart + 1, -1);
        if (!new RegExp(`^${re}$`).test(xs)) return null;
        params[name] = xs;
      } else {
        const name = ps.slice(1);
        params[name] = xs;
      }
    } else if (ps !== xs) {
      return null;
    }
  }
  return params;
}

export function dispatchThemeRoute(theme: NpTheme | null, path: string): NpThemeRouteMatch | null {
  if (!theme) return null;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const routes = collectThemeRoutes(theme);
  for (const route of routes) {
    const params = matchPattern(route.pattern, normalized);
    if (params) return { route, params };
  }
  return null;
}

/**
 * Build the props passed to a matched route component. Splits
 * the `searchParams` reading from the match itself so callers
 * (catch-all `Page` and `generateMetadata`) can compose with
 * their own argument shapes.
 */
export function buildRouteRenderProps(args: {
  match: NpThemeRouteMatch;
  searchParams: Record<string, string | string[] | undefined>;
  blockCtx: NpRouteRenderProps["blockCtx"];
}): NpRouteRenderProps {
  return {
    params: args.match.params,
    searchParams: args.searchParams,
    blockCtx: args.blockCtx,
  };
}

// ─────────────────────────────────────────────────────────────
// Plugin route dispatch (#623, PRT.2)
// ─────────────────────────────────────────────────────────────

/**
 * One matched plugin route. The component is narrowed from the
 * registry's `unknown` to `ComponentType<NpRouteRenderProps>`
 * here — the `@nexpress/core` plugin host stays React-free at
 * the type level (peer-dep boundary), and the dispatcher is
 * the right place to assert the runtime expectation.
 */
export interface NpPluginRouteMatch {
  pluginId: string;
  route: {
    pattern: string;
    component: ComponentType<NpRouteRenderProps>;
    metadata?: (ctx: NpRouteRenderProps) => Promise<Metadata> | Metadata;
    surface: "site" | "member";
    locale: "auto" | "none";
  };
  params: Record<string, string>;
}

/**
 * Module-level cache so the boot collision warning fires
 * once-per-pattern-per-process. Resets via the test hook below.
 */
const warnedPluginPatterns = new Set<string>();

/** Test hook — resets the plugin collision warning de-dup set. */
export function __resetPluginCollisionWarnings(): void {
  warnedPluginPatterns.clear();
}

function detectAndWarnPluginCollisions(
  themeRoutes: ReadonlyArray<NpThemeRoute>,
  pluginEntries: ReadonlyArray<{ pluginId: string; route: PluginPageRouteEntry }>,
): void {
  // Theme patterns shadow plugin patterns under the locked
  // precedence (theme > plugin, design doc § 2.3). Surface that
  // explicitly so an operator who installed a plugin AND chose a
  // theme that owns the same path knows why the plugin route
  // never renders.
  const themePatterns = new Set(themeRoutes.map((r) => r.pattern));
  for (const { pluginId, route } of pluginEntries) {
    const key = `theme:${route.pattern}`;
    if (themePatterns.has(route.pattern) && !warnedPluginPatterns.has(key)) {
      warnedPluginPatterns.add(key);

      console.warn(
        `[nexpress/plugin-routes] pattern "${route.pattern}" registered ` +
          `by plugin "${pluginId}" is shadowed by the active theme — the ` +
          `theme owns the path. Drop the override from the theme or rename ` +
          `the plugin's route.`,
      );
    }
  }
  // Two plugins claiming the same pattern: the first registered
  // wins (the `for` loop in `dispatchPluginRoute` matches in
  // order). Warn once per duplicate so operators can resolve
  // by disabling one.
  const pluginCounts = new Map<string, string[]>();
  for (const { pluginId, route } of pluginEntries) {
    const ids = pluginCounts.get(route.pattern) ?? [];
    ids.push(pluginId);
    pluginCounts.set(route.pattern, ids);
  }
  for (const [pattern, ids] of pluginCounts) {
    if (ids.length <= 1) continue;
    const key = `plugins:${pattern}`;
    if (warnedPluginPatterns.has(key)) continue;
    warnedPluginPatterns.add(key);

    console.warn(
      `[nexpress/plugin-routes] pattern "${pattern}" is registered by ` +
        `${ids.length} plugins (${ids.join(", ")}) — the first one wins. ` +
        `Disable conflicting plugins or contact the plugin authors to ` +
        `namespace their routes.`,
    );
  }
}

/**
 * Plugin route dispatcher (#623). Walks every loaded plugin's
 * registered `pageRoutes` in registration order, returning the
 * first match against `path`. Disabled plugins (per the
 * `enabled-gate`) are skipped silently — same gating behavior
 * the hook dispatcher uses for `runHook`.
 *
 * Precedence vs theme routes lives at the call site (the
 * catch-all): theme dispatch runs first, plugin dispatch runs
 * only when theme returned null.
 *
 * `localeAwarePath` is the locale-stripped path the catch-all computes for
 * page lookup. `rawPath` preserves any locale prefix. Routes with
 * `locale: "auto"` match the first path; `locale: "none"` matches the raw
 * path so localized aliases are not created implicitly.
 */
export async function dispatchPluginRoute(ctx: {
  localeAwarePath: string;
  rawPath: string;
  themeRoutes: ReadonlyArray<NpThemeRoute>;
}): Promise<NpPluginRouteMatch | null> {
  const entries = getPluginPageRoutes();
  detectAndWarnPluginCollisions(ctx.themeRoutes, entries);

  for (const { pluginId, route } of entries) {
    // Disabled plugins skip — checked per-request so admin
    // toggles take effect without a process restart.
    if (!(await isPluginEnabled(pluginId))) continue;
    if (typeof route.component !== "function") continue;
    const path = route.locale === "none" ? ctx.rawPath : ctx.localeAwarePath;
    const params = npMatchPluginPageRoutePattern(route.pattern, path);
    if (!params) continue;
    return {
      pluginId,
      route: {
        pattern: route.pattern,
        component: route.component as ComponentType<NpRouteRenderProps>,
        metadata: route.metadata as
          ((ctx: NpRouteRenderProps) => Promise<Metadata> | Metadata) | undefined,
        surface: route.surface,
        locale: route.locale,
      },
      params,
    };
  }
  return null;
}

/**
 * Synchronous variant for callers that have already resolved
 * the enabled state externally (e.g. tests, or surfaces that
 * don't gate on enable). Skips the `isPluginEnabled` await.
 */
export function dispatchPluginRouteSync(ctx: {
  localeAwarePath: string;
  rawPath: string;
  themeRoutes: ReadonlyArray<NpThemeRoute>;
  enabled?: (pluginId: string) => boolean;
}): NpPluginRouteMatch | null {
  const entries = getPluginPageRoutes();
  detectAndWarnPluginCollisions(ctx.themeRoutes, entries);

  for (const { pluginId, route } of entries) {
    if (ctx.enabled && !ctx.enabled(pluginId)) continue;
    if (typeof route.component !== "function") continue;
    const path = route.locale === "none" ? ctx.rawPath : ctx.localeAwarePath;
    const params = npMatchPluginPageRoutePattern(route.pattern, path);
    if (!params) continue;
    return {
      pluginId,
      route: {
        pattern: route.pattern,
        component: route.component as ComponentType<NpRouteRenderProps>,
        metadata: route.metadata as
          ((ctx: NpRouteRenderProps) => Promise<Metadata> | Metadata) | undefined,
        surface: route.surface,
        locale: route.locale,
      },
      params,
    };
  }
  return null;
}

/**
 * Build `NpRouteRenderProps` for a plugin-route match. Same
 * shape `buildRouteRenderProps` produces for theme routes; kept
 * as a separate function so the params type stays accurate
 * (plugin route match has its own `params` field).
 */
export function buildPluginRouteRenderProps(args: {
  match: NpPluginRouteMatch;
  searchParams: Record<string, string | string[] | undefined>;
  blockCtx: NpRouteRenderProps["blockCtx"];
}): NpRouteRenderProps {
  return {
    params: args.match.params,
    searchParams: args.searchParams,
    blockCtx: args.blockCtx,
  };
}
