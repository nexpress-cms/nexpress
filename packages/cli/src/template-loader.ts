import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
 *     readTemplate("site/layout.tsx", { NP_PROJECT_NAME: "my-app" })
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
export function readTemplate(relativePath: string, vars?: Record<string, string>): string {
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
    throw new Error(`Template not found: ${relativePath} (looked in ${candidates.join(", ")})`);
  }
  if (!vars) return content;

  return content.replace(/__NX_([A-Z0-9_]+)__/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key];
    }
    return match;
  });
}

/**
 * Resolves a template directory across the dev / published-build
 * candidate paths, the same way `readTemplate` resolves single
 * files.
 */
function resolveTemplateDir(relativePath: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "templates", relativePath),
    resolve(here, "templates", relativePath),
  ];
  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `Template directory not found: ${relativePath} (looked in ${candidates.join(", ")})`,
  );
}

/**
 * Walks a template subtree (e.g. `"snapshot/src/app"`) and returns
 * a flat map of `{ relPath: fileContent }`, where `relPath` is
 * relative to the subtree root.
 *
 * Used to mirror an entire subtree (the apps/web snapshot — root
 * layout, page wrappers, API route wrappers, shared lib/) into a
 * scaffolded project as-is so scaffolded sites and `apps/web`
 * resolve to byte-identical code through @nexpress/app's subpath
 * exports.
 *
 * Binary files (currently just `icon.svg`) come back as a base64
 * string under `{ encoding: "base64", content }`; callers writing
 * them out must decode before write. Everything else returns as a
 * utf-8 string under `{ encoding: "utf8", content }`.
 */
export type TemplateFile =
  { encoding: "utf8"; content: string } | { encoding: "base64"; content: string };

export function walkTemplateTree(relativePath: string): Record<string, TemplateFile> {
  const root = resolveTemplateDir(relativePath);
  const out: Record<string, TemplateFile> = {};

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = relative(root, abs);
      if (entry.endsWith(".svg") || entry.endsWith(".png") || entry.endsWith(".ico")) {
        out[rel] = { encoding: "base64", content: readFileSync(abs).toString("base64") };
      } else {
        out[rel] = { encoding: "utf8", content: readFileSync(abs, "utf8") };
      }
    }
  }

  walk(root);
  return out;
}
