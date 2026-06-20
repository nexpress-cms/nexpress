import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Shared scaffold-time utilities used by every `nexpress create *-plugin`
 * subcommand. Centralised here so the per-kind generators stay focused on
 * their own starter content and don't drift in how they derive package
 * names / identifiers / dir layout.
 */

/**
 * `slug` → npm package name.
 * Scoped slugs (`@scope/foo`) are returned as-is; unscoped slugs become the
 * package name verbatim. The CLI accepts whichever form the operator types.
 */
export function packageNameFromSlug(slug: string): string {
  return slug;
}

/**
 * camelCase identifier: drops the npm scope, splits on non-word chars,
 * lowercases the first segment, capitalises the rest. Used for the JS
 * export name ("readingTimePlugin") and the block-type root.
 */
export function camelCase(input: string): string {
  const parts = input
    .replace(/^@[^/]+\//, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "plugin";
  const [first, ...rest] = parts;
  return (
    (first ?? "").toLowerCase() +
    rest.map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase()).join("")
  );
}

/** PascalCase variant of `camelCase` — used for component / class names. */
export function pascalCase(input: string): string {
  const lower = camelCase(input);
  return lower[0]?.toUpperCase() + lower.slice(1);
}

/**
 * On-disk directory name. Scoped slugs strip the scope so the folder is
 * `banner` for `@acme/banner` rather than `@acme%2Fbanner`.
 */
export function dirNameFromSlug(slug: string): string {
  return slug.replace(/^@[^/]+\//, "");
}

export interface ScaffoldOptions {
  slug: string;
  outDir: string;
  /**
   * Block-only generator flag. The other kinds (hook / route / admin /
   * scheduled) ignore this — kept on the shared shape so a future merge
   * into a single dispatcher doesn't have to widen the API again.
   */
  interactive?: boolean;
}

export interface ScaffoldResult {
  /** Files written, relative to the new plugin dir. CLI surfaces this list. */
  files: string[];
  /** Absolute path to the new plugin dir. */
  pluginDir: string;
  /** Author-friendly label for the success message. */
  kind: ScaffoldKind;
  /** Block-only generator flag — `false` for non-block kinds. */
  interactive: boolean;
}

export type ScaffoldKind = "block" | "hook" | "route" | "admin" | "scheduled";

export interface ScaffoldNames {
  packageName: string;
  pluginId: string;
  identifier: string;
  exportName: string;
  componentName: string;
  pluginDir: string;
}

/**
 * Single source of truth for slug → identifier derivation. Each scaffold
 * function calls this so the export name in the generated `src/index.tsx`
 * always matches the package name in `package.json` (which the operator
 * imports later in `nexpress.config.ts`).
 */
export function deriveNames(slug: string, outDir: string): ScaffoldNames {
  const packageName = packageNameFromSlug(slug);
  const dirName = dirNameFromSlug(slug);
  const identifier = camelCase(slug);
  const componentName = pascalCase(slug);
  return {
    packageName,
    pluginId: dirName,
    identifier,
    exportName: `${identifier}Plugin`,
    componentName,
    pluginDir: resolve(outDir, dirName),
  };
}

/** Throws if the target dir already exists. The CLI surfaces the message. */
export function assertDirAvailable(pluginDir: string): void {
  if (existsSync(pluginDir)) {
    throw new Error(
      `Refusing to overwrite existing directory: ${pluginDir}. Pick a new slug or remove the directory first.`,
    );
  }
}

/**
 * Builds a baseline `package.json` shape every generator can extend.
 * Scoped exports / extra deps go through the caller's overrides.
 */
export function basePackageJson(
  packageName: string,
  description: string,
  options: {
    extraDependencies?: Record<string, string>;
    extraExports?: Record<string, { types: string; import: string }>;
  } = {},
): string {
  const exportsBlock: Record<string, { types: string; import: string }> = {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
    ...(options.extraExports ?? {}),
  };
  return (
    JSON.stringify(
      {
        name: packageName,
        version: "0.1.0",
        description,
        license: "MIT",
        type: "module",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: exportsBlock,
        files: ["dist"],
        engines: { node: ">=20" },
        peerDependencies: {
          react: "^19.0.0",
        },
        dependencies: {
          "@nexpress/blocks": "workspace:*",
          "@nexpress/plugin-sdk": "workspace:*",
          ...(options.extraDependencies ?? {}),
        },
        devDependencies: {
          "@types/node": "^22.0.0",
          "@types/react": "^19.0.0",
          tsup: "^8.5.0",
          typescript: "^5.8.0",
        },
        scripts: {
          build: "tsup",
          dev: "tsup --watch --no-clean",
          clean: "rm -rf dist",
          typecheck: "tsc --noEmit",
        },
      },
      null,
      2,
    ) + "\n"
  );
}

/**
 * Default tsconfig for non-interactive (no `"use client"`) generators.
 * The interactive block scaffold overrides `lib` to include `DOM`.
 */
export function baseTsconfig(extras: { lib?: string[] } = {}): string {
  return (
    JSON.stringify(
      {
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          outDir: "dist",
          rootDir: "src",
          jsx: "react-jsx",
          ...(extras.lib ? { lib: extras.lib } : {}),
        },
        include: ["src"],
      },
      null,
      2,
    ) + "\n"
  );
}

/** Standard server-side tsup config used by hook/route/admin/scheduled. */
export const SERVER_TSUP_CONFIG = `import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  external: ["react"],
});
`;

/**
 * Writes every entry under `pluginDir`, creating the `src/` subdir as
 * needed. Each generator returns its file map; this helper makes the
 * write-side identical for every kind.
 */
export async function writePluginFiles(
  pluginDir: string,
  files: Record<string, string>,
): Promise<string[]> {
  await mkdir(resolve(pluginDir, "src"), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await writeFile(resolve(pluginDir, path), content, "utf-8");
  }
  return Object.keys(files);
}
