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

function dateArchivePattern(
  granularity: NpThemeDateArchiveEntry["granularity"],
): string {
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

type ArchiveKindByCollection = NpThemeArchives[string];

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
    const byKind = raw as ArchiveKindByCollection;
    if (!byKind) continue;
    const entry = (
      e: NpThemeArchiveEntry | undefined,
      defaultPattern: string,
    ) => {
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
        pattern:
          byKind.byDate.pattern ?? dateArchivePattern(byKind.byDate.granularity),
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
      // eslint-disable-next-line no-console
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
  const expanded = theme.impl.archives
    ? expandArchives(theme.impl.archives)
    : [];
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
function matchPattern(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternSegs = pattern.split("/").filter(Boolean);
  const pathSegs = path.split("/").filter(Boolean);
  if (patternSegs.length !== pathSegs.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegs.length; i++) {
    const ps = patternSegs[i]!;
    const xs = pathSegs[i]!;
    if (ps.startsWith(":")) {
      // `:name` or `:name(regex)`
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

export function dispatchThemeRoute(
  theme: NpTheme | null,
  path: string,
): NpThemeRouteMatch | null {
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
