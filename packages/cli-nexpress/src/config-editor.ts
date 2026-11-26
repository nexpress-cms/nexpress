/**
 * Marker-based editor for `nexpress.config.ts`. The CLI manages two
 * regions inside the user's config file via comment markers, and never
 * tries to parse / rewrite arbitrary TypeScript:
 *
 *   // @nexpress:plugins-imports-start
 *   import readingTime from "@nexpress/reading-time";
 *   // @nexpress:plugins-imports-end
 *
 *   ...
 *   plugins: [
 *     // @nexpress:plugins-list-start
 *     readingTime,
 *     // @nexpress:plugins-list-end
 *   ],
 *
 * Why markers and not an AST: a typed AST edit needs a TypeScript
 * compiler dependency in the CLI, and projects are free to format /
 * comment / split the config however they like. Markers are a
 * compromise the user opts into in exchange for `nexpress plugin
 * add/remove` working without manual edits.
 *
 * Projects WITHOUT markers fall through with a `kind: "no-markers"`
 * outcome — the CLI prints the snippet to copy/paste and exits with a
 * non-zero status so the operator notices.
 */

export interface PluginEntry {
  /** npm package name, e.g. `"@nexpress/reading-time"` or `"my-plugin"`. */
  packageName: string;
  /** JS identifier used in the config — derived deterministically from the package name. */
  identifier: string;
}

/**
 * Turns an npm package name into a safe JS identifier:
 *   "@nexpress/reading-time"  → "readingTime"
 *   "my-plugin"               → "myPlugin"
 *   "@scope/with.dots"        → "withDots"
 *
 * camelCase, no leading punctuation, scope prefix stripped.
 */
export function packageToIdentifier(packageName: string): string {
  // Drop scope (`@scope/foo` → `foo`).
  const unscoped = packageName.replace(/^@[^/]+\//, "");
  // Replace any non-alphanumeric run with a single space, then camel-case.
  const parts = unscoped.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(`Cannot derive identifier from package name: "${packageName}"`);
  }
  const [first, ...rest] = parts;
  return (
    (first ?? "").toLowerCase() +
    rest.map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase()).join("")
  );
}

export type EditOutcome =
  | { kind: "ok"; content: string }
  | { kind: "no-markers"; missing: string[] }
  | { kind: "no-op"; reason: string };

interface MarkerSpan {
  startLine: number;
  endLine: number;
  /** Indentation prefix applied to inserted lines so they line up with sibling content. */
  indent: string;
}

function findSpan(lines: string[], startMarker: string, endMarker: string): MarkerSpan | null {
  let startLine = -1;
  let endLine = -1;
  let indent = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (startLine === -1 && line.includes(startMarker)) {
      startLine = i;
      const match = line.match(/^(\s*)/);
      indent = match?.[1] ?? "";
      continue;
    }
    if (startLine !== -1 && line.includes(endMarker)) {
      endLine = i;
      break;
    }
  }
  if (startLine === -1 || endLine === -1) return null;
  return { startLine, endLine, indent };
}

type ConfigEntryKind = "plugins" | "themes";

function readMarkerRegions(
  content: string,
  kind: ConfigEntryKind,
):
  | { kind: "ok"; lines: string[]; imports: MarkerSpan; list: MarkerSpan }
  | Extract<EditOutcome, { kind: "no-markers" }> {
  const importsStart = `// @nexpress:${kind}-imports-start`;
  const importsEnd = `// @nexpress:${kind}-imports-end`;
  const listStart = `// @nexpress:${kind}-list-start`;
  const listEnd = `// @nexpress:${kind}-list-end`;
  const missing: string[] = [];
  for (const [start, end] of [
    [importsStart, importsEnd],
    [listStart, listEnd],
  ]) {
    if (!content.includes(start) || !content.includes(end)) missing.push(`${start} / ${end}`);
  }
  if (missing.length > 0) return { kind: "no-markers", missing };

  const lines = content.split("\n");
  const imports = findSpan(lines, importsStart, importsEnd);
  const list = findSpan(lines, listStart, listEnd);
  if (!imports || !list) {
    return {
      kind: "no-markers",
      missing: [kind === "themes" ? "malformed theme marker pairs" : "malformed marker pairs"],
    };
  }
  return { kind: "ok", lines, imports, list };
}

function addConfigEntry(content: string, entry: PluginEntry, kind: ConfigEntryKind): EditOutcome {
  const regions = readMarkerRegions(content, kind);
  if (regions.kind !== "ok") return regions;
  const { lines, imports, list } = regions;
  const importsBlock = lines.slice(imports.startLine + 1, imports.endLine).join("\n");
  if (importsBlock.includes(`from "${entry.packageName}"`)) {
    return { kind: "no-op", reason: `import for "${entry.packageName}" already present` };
  }

  const binding = kind === "themes" ? `{ ${entry.identifier} }` : entry.identifier;
  const next = [...lines];
  // Keep the original import/list offsets while inserting both managed entries.
  next.splice(list.endLine, 0, `${list.indent}${entry.identifier},`);
  next.splice(
    imports.endLine,
    0,
    `${imports.indent}import ${binding} from "${entry.packageName}";`,
  );
  return { kind: "ok", content: next.join("\n") };
}

function removeConfigEntry(
  content: string,
  entry: PluginEntry,
  kind: ConfigEntryKind,
): EditOutcome {
  const regions = readMarkerRegions(content, kind);
  if (regions.kind !== "ok") return regions;
  const { lines, imports, list } = regions;
  const isImportLine = (line: string) =>
    /^\s*import\s+/.test(line) && line.includes(`"${entry.packageName}"`);
  const isListLine = (line: string) => new RegExp(`^\\s*${entry.identifier}\\s*,?\\s*$`).test(line);

  const next: string[] = [];
  let removed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (
      (i > imports.startLine && i < imports.endLine && isImportLine(line)) ||
      (i > list.startLine && i < list.endLine && isListLine(line))
    ) {
      removed = true;
      continue;
    }
    next.push(line);
  }
  return removed
    ? { kind: "ok", content: next.join("\n") }
    : {
        kind: "no-op",
        reason: `no ${kind === "themes" ? "theme " : ""}entry for "${entry.packageName}" found`,
      };
}

/** Insert a default import and plugin-list entry within the opted-in markers. */
export function addPluginToConfig(content: string, entry: PluginEntry): EditOutcome {
  return addConfigEntry(content, entry, "plugins");
}

/** Remove only marker-managed plugin entries; repeated removal is a no-op. */
export function removePluginFromConfig(content: string, entry: PluginEntry): EditOutcome {
  return removeConfigEntry(content, entry, "plugins");
}

/** Snippet the CLI prints when markers are missing — operator pastes it. */
export function buildManualSnippet(entry: PluginEntry): string {
  return [
    `// Add to the imports section of your nexpress.config.ts:`,
    `import ${entry.identifier} from "${entry.packageName}";`,
    ``,
    `// Add to defineConfig({ plugins: [...] }):`,
    `${entry.identifier},`,
  ].join("\n");
}

/** Snippet the CLI prints when markers are missing during plugin removal. */
export function buildManualRemoveSnippet(entry: PluginEntry): string {
  return [
    `// Remove from the imports section of your nexpress.config.ts:`,
    `import ${entry.identifier} from "${entry.packageName}";`,
    ``,
    `// Remove from defineConfig({ plugins: [...] }):`,
    `${entry.identifier},`,
  ].join("\n");
}

// ────────────────────────────────────────────────────────────
// Theme add — marker-driven theme registration.
// ────────────────────────────────────────────────────────────

export interface ThemeEntry {
  /** npm package name, e.g. `"@nexpress/theme-magazine"`. */
  packageName: string;
  /**
   * JS identifier used in the config. Derived deterministically
   * from the package name via `packageToThemeIdentifier` —
   * `@nexpress/theme-magazine` → `magazineTheme`.
   */
  identifier: string;
}

/**
 * Turns an npm theme package name into the conventional
 * `<name>Theme` identifier:
 *
 *   "@nexpress/theme-magazine"  → "magazineTheme"
 *   "@me/theme-cool"            → "coolTheme"
 *   "theme-personal"            → "personalTheme"
 *   "@nexpress/theme-default"   → "defaultTheme"
 *
 * The unscoped portion must start with `theme-` so the suffix
 * lookup is unambiguous; everything after that is camel-cased
 * and a final `Theme` is appended. This matches the export
 * shape every existing reference theme uses (`magazineTheme`,
 * `defaultTheme`, etc.), so adding a third-party theme drops in
 * without a per-theme rename.
 *
 * Throws `Error` for packages whose unscoped name doesn't start
 * with `theme-` — the caller surfaces that as a "rename your
 * package or expose a `<name>Theme` named export" hint to the
 * operator.
 */
export function packageToThemeIdentifier(packageName: string): string {
  const unscoped = packageName.replace(/^@[^/]+\//, "");
  const match = unscoped.match(/^theme[-_](.+)$/);
  if (!match) {
    throw new Error(
      `Theme package name must contain "theme-" so the CLI can derive an identifier. Got "${packageName}". Rename the package to e.g. "@scope/theme-cool" or expose a named export and add it manually.`,
    );
  }
  const tail = match[1] ?? "";
  const parts = tail.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(`Cannot derive identifier from package name: "${packageName}"`);
  }
  const [first, ...rest] = parts;
  const camelHead =
    (first ?? "").toLowerCase() +
    rest.map((p) => p[0]?.toUpperCase() + p.slice(1).toLowerCase()).join("");
  return `${camelHead}Theme`;
}

/** Insert a named import and theme-list entry within the opted-in markers. */
export function addThemeToConfig(content: string, entry: ThemeEntry): EditOutcome {
  return addConfigEntry(content, entry, "themes");
}

/** Remove only marker-managed theme entries; repeated removal is a no-op. */
export function removeThemeFromConfig(content: string, entry: ThemeEntry): EditOutcome {
  return removeConfigEntry(content, entry, "themes");
}

/** Snippet printed when theme markers are missing. */
export function buildManualThemeSnippet(entry: ThemeEntry): string {
  return [
    `// Add to the imports section of your nexpress.config.ts:`,
    `import { ${entry.identifier} } from "${entry.packageName}";`,
    ``,
    `// Add to defineConfig({ themes: [...] }):`,
    `${entry.identifier},`,
  ].join("\n");
}

/** Snippet printed when theme markers are missing during theme removal. */
export function buildManualThemeRemoveSnippet(entry: ThemeEntry): string {
  return [
    `// Remove from the imports section of your nexpress.config.ts:`,
    `import { ${entry.identifier} } from "${entry.packageName}";`,
    ``,
    `// Remove from defineConfig({ themes: [...] }):`,
    `${entry.identifier},`,
  ].join("\n");
}
