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
const SCAFFOLD_VARIANT_COMMENT = `/* Scaffold variant — admin/blocks/editor ship un-minified \`dist/*.js\` so Tailwind v4's content scanner picks up className strings from node_modules. \`@nexpress/app\` ships raw src/. Rewrite owned by \`pnpm sync-snapshot\`. */
`;

const SCAFFOLD_VARIANT_MARKER = "Scaffold variant —";

export function rewriteScaffoldGlobalsCss(css: string): string {
  // admin/blocks/editor ship as a single bundled `dist/<name>.js`
  // (tsup, un-minified) so the scaffold's Tailwind scanner can read
  // className strings out of the published JS. `@nexpress/app`, by
  // contrast, ships raw `src/*.tsx` (its export map points consumer
  // imports at `./src/admin/*.tsx` for transpilePackages), so the
  // scaffold needs to scan `node_modules/@nexpress/app/src/**` —
  // not `dist/`, which only carries the package's root entry.
  const rewritten = css
    .replace(
      /@source "(?:\.\.\/)+packages\/(admin|blocks|editor)\/src\/\*\*\/\*\.\{ts,tsx\}";/g,
      '@source "../../node_modules/@nexpress/$1/dist/**/*.js";',
    )
    .replace(
      /@source "(?:\.\.\/)+packages\/app\/src\/\*\*\/\*\.\{ts,tsx\}";/g,
      '@source "../../node_modules/@nexpress/app/src/**/*.{ts,tsx}";',
    );
  // Idempotency — only insert the comment if it's not already
  // there. A second sync-snapshot run starts from a fresh copy of
  // apps/web (so the comment is absent again on entry), but tests
  // also call this directly with pre-rewritten input.
  if (rewritten.includes(SCAFFOLD_VARIANT_MARKER)) {
    return rewritten;
  }
  // Insert the comment block immediately before the first
  // node_modules `@source` line so the rationale lives next to
  // the rewrite, not buried at the top of the file. Matches any
  // of admin / blocks / editor (not admin-only) so a future
  // reorder or drop of one line in apps/web's globals.css can't
  // silently strip the comment while the rewrite itself still
  // succeeds on the remaining lines.
  return rewritten.replace(
    /(@source "\.\.\/\.\.\/node_modules\/@nexpress\/(?:admin|app|blocks|editor)\/dist[^"]*";)/,
    SCAFFOLD_VARIANT_COMMENT + "$1",
  );
}
