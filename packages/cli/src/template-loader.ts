import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads a verbatim template file from `packages/cli/templates/`.
 *
 * Templates that don't need per-project substitution live as real
 * files on disk rather than as TS string literals — `.dockerfile`,
 * `.yml`, etc. get syntax highlighting and can be opened by the
 * tools that natively understand them. The CLI ships them inside
 * its npm tarball via `package.json` `files`, and tsup's onSuccess
 * hook copies the directory into `dist/templates/` at build time.
 *
 * Files that need substitution (project name, secret, etc.) still
 * live as TS string templates for now — see #268 for the migration
 * plan.
 *
 * @param relativePath path under `packages/cli/templates/`,
 *                     e.g. `"docker/Dockerfile"`
 */
export function readTemplate(relativePath: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // In dev (running from `src/` via tsx), templates live up one
  // directory. In published builds, tsup's onSuccess hook
  // copied them to `dist/templates/`, alongside the bundled JS.
  const candidates = [
    resolve(here, "..", "templates", relativePath),
    resolve(here, "templates", relativePath),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `Template not found: ${relativePath} (looked in ${candidates.join(", ")})`,
  );
}
