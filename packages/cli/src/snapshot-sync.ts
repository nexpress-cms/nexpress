import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { rewriteScaffoldGlobalsCss } from "./snapshot-rewrites.js";

const SNAPSHOT_ENTRIES = ["app", "lib", "i18n.config.ts", "proxy.ts"] as const;

export interface SnapshotPaths {
  repoRoot: string;
  webRoot: string;
  snapRoot: string;
}

export interface SnapshotBuild {
  paths: SnapshotPaths;
  files: Map<string, Buffer>;
  globalsCssRewrite: {
    before: string;
    after: string;
  };
}

export interface SnapshotDiff {
  missing: string[];
  extra: string[];
  changed: string[];
}

export interface SnapshotWriteResult {
  paths: SnapshotPaths;
  filesWritten: number;
}

function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function resolveSnapshotPaths(repoRoot = defaultRepoRoot()): SnapshotPaths {
  return {
    repoRoot,
    webRoot: join(repoRoot, "apps/web/src"),
    snapRoot: join(repoRoot, "packages/cli/templates/snapshot/src"),
  };
}

function assertExists(path: string): void {
  try {
    statSync(path);
  } catch {
    throw new Error(`Expected ${path} to exist — wrong cwd?`);
  }
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function collectTree(root: string, relPrefix = ""): Map<string, Buffer> {
  const files = new Map<string, Buffer>();

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = toPosix(join(relPrefix, relative(root, abs)));
      files.set(rel, readFileSync(abs));
    }
  }

  walk(root);
  return files;
}

function collectSnapshotRoot(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const entry of SNAPSHOT_ENTRIES) {
    const abs = join(root, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      for (const [rel, content] of collectTree(abs, entry)) {
        files.set(rel, content);
      }
    } else {
      files.set(entry, readFileSync(abs));
    }
  }
  return files;
}

export function buildExpectedSnapshot(repoRoot?: string): SnapshotBuild {
  const paths = resolveSnapshotPaths(repoRoot);
  assertExists(paths.webRoot);
  assertExists(join(paths.webRoot, "app"));
  assertExists(join(paths.webRoot, "lib"));

  const files = collectSnapshotRoot(paths.webRoot);
  const globalsCss = files.get("app/globals.css");
  if (!globalsCss) {
    throw new Error("Expected apps/web/src/app/globals.css to exist");
  }

  const before = globalsCss.toString("utf8");
  const after = rewriteScaffoldGlobalsCss(before);
  if (before === after) {
    throw new Error(
      "snapshot-sync: globals.css @source rewrite produced no change. " +
        "Either the rewrite regex no longer matches apps/web's source paths " +
        "(check snapshot-rewrites.ts), or apps/web's globals.css already uses " +
        "node_modules paths (in which case this safety check is the one to remove).",
    );
  }
  files.set("app/globals.css", Buffer.from(after));

  return {
    paths,
    files,
    globalsCssRewrite: { before, after },
  };
}

export function collectCurrentSnapshot(repoRoot?: string): Map<string, Buffer> {
  const { snapRoot } = resolveSnapshotPaths(repoRoot);
  assertExists(snapRoot);
  return collectTree(snapRoot);
}

export function diffSnapshot(repoRoot?: string): SnapshotDiff {
  const expected = buildExpectedSnapshot(repoRoot).files;
  const current = collectCurrentSnapshot(repoRoot);
  const missing: string[] = [];
  const extra: string[] = [];
  const changed: string[] = [];

  for (const [rel, expectedContent] of expected) {
    const currentContent = current.get(rel);
    if (!currentContent) {
      missing.push(rel);
      continue;
    }
    if (!currentContent.equals(expectedContent)) {
      changed.push(rel);
    }
  }

  for (const rel of current.keys()) {
    if (!expected.has(rel)) {
      extra.push(rel);
    }
  }

  return {
    missing: missing.sort(),
    extra: extra.sort(),
    changed: changed.sort(),
  };
}

export function hasSnapshotDiff(diff: SnapshotDiff): boolean {
  return diff.missing.length > 0 || diff.extra.length > 0 || diff.changed.length > 0;
}

function formatList(label: string, paths: string[]): string[] {
  if (paths.length === 0) return [];
  return [label, ...paths.map((path) => `  - ${path}`)];
}

export function formatSnapshotDiff(diff: SnapshotDiff): string {
  if (!hasSnapshotDiff(diff)) {
    return "Scaffold snapshot is in sync with apps/web/src.";
  }

  return [
    "Scaffold snapshot drift detected.",
    "Run `pnpm --filter create-nexpress run sync-snapshot` and commit the result.",
    "",
    ...formatList("Missing from snapshot:", diff.missing),
    ...formatList("Extra in snapshot:", diff.extra),
    ...formatList("Changed in snapshot:", diff.changed),
  ]
    .filter((line, index, lines) => line !== "" || lines[index + 1] !== "")
    .join("\n");
}

export function writeExpectedSnapshot(repoRoot?: string): SnapshotWriteResult {
  const build = buildExpectedSnapshot(repoRoot);
  rmSync(build.paths.snapRoot, { recursive: true, force: true });
  mkdirSync(build.paths.snapRoot, { recursive: true });

  for (const [rel, content] of [...build.files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const target = join(build.paths.snapRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  return {
    paths: build.paths,
    filesWritten: build.files.size,
  };
}
