import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

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
  /**
   * Framework package ranges to write into the generated extension package.
   * Defaults to workspace links for NexPress monorepo authors; the CLI can
   * override this from a create-nexpress project's installed package ranges.
   */
  dependencyRanges?: ScaffoldDependencyRanges;
}

export interface ScaffoldResult {
  /** Files written, relative to the new package dir. CLI surfaces this list. */
  files: string[];
  /** Absolute path to the new package dir. */
  packageDir: string;
  /** Author-friendly label for the success message. */
  kind: ScaffoldKind;
  /** Block-only generator flag — `false` for non-block kinds. */
  interactive: boolean;
}

export type ScaffoldKind = "block" | "hook" | "route" | "admin" | "scheduled" | "theme";

export type ScaffoldFrameworkDependency =
  "@nexpress/blocks" | "@nexpress/plugin-sdk" | "@nexpress/theme";

export type ScaffoldDependencyRanges = Partial<Record<ScaffoldFrameworkDependency, string>>;

const DEFAULT_DEPENDENCY_RANGES: Record<ScaffoldFrameworkDependency, string> = {
  "@nexpress/blocks": "workspace:*",
  "@nexpress/plugin-sdk": "workspace:*",
  "@nexpress/theme": "workspace:*",
};

const DEFAULT_PLUGIN_DEPENDENCIES: ScaffoldFrameworkDependency[] = [
  "@nexpress/blocks",
  "@nexpress/plugin-sdk",
];

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
export function assertDirAvailable(packageDir: string): void {
  if (existsSync(packageDir)) {
    throw new Error(
      `Refusing to overwrite existing directory: ${packageDir}. Pick a new slug or remove the directory first.`,
    );
  }
}

function readPackageJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function readDependencyRange(pkg: unknown, name: ScaffoldFrameworkDependency): string | undefined {
  if (!pkg || typeof pkg !== "object") return undefined;
  for (const blockName of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const block = (pkg as Record<string, unknown>)[blockName];
    if (!block || typeof block !== "object") continue;
    const value = (block as Record<string, unknown>)[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Reads the nearest parent package.json and reuses installed framework
 * ranges for generated extension packages. In this repo there is no top-level
 * @nexpress dependency block, so callers naturally fall back to workspace:*.
 * In a create-nexpress project, the root has exact / file: ranges and the
 * generated extension package becomes installable in that project workspace.
 */
export function resolveScaffoldDependencyRanges(
  cwd: string,
  dependencies: ScaffoldFrameworkDependency[] = DEFAULT_PLUGIN_DEPENDENCIES,
): ScaffoldDependencyRanges {
  let current = resolve(cwd);
  while (true) {
    const packageJsonPath = resolve(current, "package.json");
    if (existsSync(packageJsonPath)) {
      const pkg = readPackageJson(packageJsonPath);
      const ranges: ScaffoldDependencyRanges = {};
      for (const name of dependencies) {
        const range = readDependencyRange(pkg, name);
        if (range) ranges[name] = range;
      }
      if (Object.keys(ranges).length > 0) return ranges;
    }
    if (
      existsSync(resolve(current, "pnpm-workspace.yaml")) ||
      existsSync(resolve(current, "nexpress.config.ts")) ||
      existsSync(resolve(current, "src/nexpress.config.ts"))
    ) {
      return {};
    }

    const parent = dirname(current);
    if (parent === current) return {};
    current = parent;
  }
}

export function frameworkDependencyRanges(
  overrides: ScaffoldDependencyRanges = {},
  dependencies: ScaffoldFrameworkDependency[] = DEFAULT_PLUGIN_DEPENDENCIES,
): Record<string, string> {
  const ranges: Record<string, string> = {};
  for (const dependency of dependencies) {
    ranges[dependency] = overrides[dependency] ?? DEFAULT_DEPENDENCY_RANGES[dependency];
  }
  return ranges;
}

function asPortableRelativePath(fromDir: string, targetFile: string): string {
  const path = relative(fromDir, targetFile).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

/**
 * Generates a tsconfig `extends` value for package-oriented workspaces. App
 * root tsconfig files often carry Next/noEmit/incremental settings that break
 * package dts builds, so only a real `tsconfig.base.json` is treated as safe.
 */
export function resolveTsconfigExtends(packageDir: string): string | undefined {
  let current = resolve(packageDir);
  while (true) {
    const candidate = resolve(current, "tsconfig.base.json");
    if (existsSync(candidate)) return asPortableRelativePath(packageDir, candidate);

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
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
    dependencyRanges?: ScaffoldDependencyRanges;
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
          ...frameworkDependencyRanges(options.dependencyRanges),
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
export function baseTsconfig(extras: { extendsPath?: string; lib?: string[] } = {}): string {
  return (
    JSON.stringify(
      {
        ...(extras.extendsPath ? { extends: extras.extendsPath } : {}),
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: extras.lib ?? ["ES2022"],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          isolatedModules: true,
          declaration: true,
          declarationMap: true,
          sourceMap: true,
          outDir: "dist",
          rootDir: "src",
          jsx: "react-jsx",
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
 * Writes every entry under `packageDir`. Each generator returns its file map;
 * this helper makes the write-side identical for every kind.
 */
export async function writeScaffoldFiles(
  packageDir: string,
  files: Record<string, string>,
): Promise<string[]> {
  await mkdir(resolve(packageDir, "src"), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(packageDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf-8");
  }
  return Object.keys(files);
}
