import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads a template file from `packages/cli/templates/` with
 * optional placeholder substitution.
 *
 * Templates live as real files on disk rather than TS string
 * literals — they get syntax highlighting, can be opened by the
 * tools that natively understand them, and (for the .ts ones)
 * are typecheck-able against the real `@nexpress/*` workspace
 * deps via `tsconfig.templates.json`.
 *
 * Per-project substitution uses a stub-based scheme. The on-disk
 * file embeds stable identifier-like markers like
 * `__NX_PROJECT_NAME__` that are valid TS / JSX text on their
 * own (so the file still typechecks). At scaffold time `vars`
 * maps each marker to its real value:
 *
 *     readTemplate("site/layout.tsx", { NX_PROJECT_NAME: "my-app" })
 *
 * Markers are matched verbatim — no escape, no logic. Branching
 * (e.g. "include example collections vs not") is handled by
 * shipping multiple variant files and choosing the right one in
 * the dispatch table, not by a mini template engine.
 *
 * @param relativePath path under `packages/cli/templates/`,
 *                     e.g. `"site/layout.tsx"`
 * @param vars         optional placeholder bindings; each key
 *                     replaces every `__NX_<KEY>__` in the file
 *                     content
 */
export function readTemplate(
  relativePath: string,
  vars?: Record<string, string>,
): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // In dev (running from `src/` via tsx), templates live up one
  // directory. In published builds, tsup's onSuccess hook
  // copied them to `dist/templates/`, alongside the bundled JS.
  const candidates = [
    resolve(here, "..", "templates", relativePath),
    resolve(here, "templates", relativePath),
  ];
  let content: string | null = null;
  for (const candidate of candidates) {
    try {
      content = readFileSync(candidate, "utf8");
      break;
    } catch {
      /* try next */
    }
  }
  if (content === null) {
    throw new Error(
      `Template not found: ${relativePath} (looked in ${candidates.join(", ")})`,
    );
  }
  if (!vars) return content;

  return content.replace(/__NX_([A-Z0-9_]+)__/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key]!;
    }
    return match;
  });
}
