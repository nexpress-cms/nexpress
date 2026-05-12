/**
 * Path-rewrite helpers applied when mirroring apps/web's files into
 * `templates/snapshot/`. Lives under `src/` (not `scripts/`) so it
 * has unit-test coverage — a silent regression here would re-ship
 * a broken globals.css to every freshly scaffolded site.
 */

export interface GlobalsCssRewrite {
  before: string;
  after: string;
}

/**
 * Rewrites the three `@source` lines in apps/web's globals.css from
 * monorepo-relative paths into node_modules paths for a scaffolded
 * project.
 *
 * Why: apps/web sits at `<monorepo>/apps/web/src/app/globals.css`,
 * so `@source "../../../../packages/admin/src/..."` reaches
 * `<monorepo>/packages/admin/src/...`. A scaffolded site sits at
 * `<project>/src/app/globals.css` with no `packages/` sibling, so
 * the equivalent reach is `../../node_modules/@nexpress/admin/dist/...`.
 *
 * Why `.js` (dist) instead of `.ts` (src): the scaffolded project's
 * node_modules carries the published tsup output. admin / blocks /
 * editor all ship un-minified, so className strings stay intact in
 * the .js bundles for Tailwind v4's content scanner. If any of those
 * packages flip `minify: true`, every scaffolded admin will render
 * un-styled — guard with a CI smoke before flipping.
 *
 * Pattern: matches any depth of `../` prefix (so the rewrite stays
 * resilient if apps/web moves) followed by exactly
 * `packages/<name>/src/**\/*.{ts,tsx}`. Mismatched lines pass
 * through unchanged.
 */
export function rewriteScaffoldGlobalsCss(css: string): string {
  return css.replace(
    /@source "(?:\.\.\/)+packages\/(admin|blocks|editor)\/src\/\*\*\/\*\.\{ts,tsx\}";/g,
    '@source "../../node_modules/@nexpress/$1/dist/**/*.js";',
  );
}
