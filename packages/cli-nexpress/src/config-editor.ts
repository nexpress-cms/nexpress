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

const IMPORTS_START = "// @nexpress:plugins-imports-start";
const IMPORTS_END = "// @nexpress:plugins-imports-end";
const LIST_START = "// @nexpress:plugins-list-start";
const LIST_END = "// @nexpress:plugins-list-end";

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
  const parts = unscoped
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);
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

function checkMarkers(content: string): { ok: true; lines: string[] } | { ok: false; missing: string[] } {
  const lines = content.split("\n");
  const missing: string[] = [];
  if (!content.includes(IMPORTS_START) || !content.includes(IMPORTS_END)) {
    missing.push(`${IMPORTS_START} / ${IMPORTS_END}`);
  }
  if (!content.includes(LIST_START) || !content.includes(LIST_END)) {
    missing.push(`${LIST_START} / ${LIST_END}`);
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, lines };
}

/**
 * Inserts an import + plugin-list entry for `entry` into `content`.
 * Idempotent: a second call with the same entry is a `kind: "no-op"` because
 * the import line already exists.
 */
export function addPluginToConfig(content: string, entry: PluginEntry): EditOutcome {
  const check = checkMarkers(content);
  if (!check.ok) return { kind: "no-markers", missing: check.missing };
  const lines = check.lines;

  const importsSpan = findSpan(lines, IMPORTS_START, IMPORTS_END);
  const listSpan = findSpan(lines, LIST_START, LIST_END);
  if (!importsSpan || !listSpan) {
    // Marker pair found but order/structure broken — fail loudly.
    return { kind: "no-markers", missing: ["malformed marker pairs"] };
  }

  const importLine = `${importsSpan.indent}import ${entry.identifier} from "${entry.packageName}";`;
  const listLine = `${listSpan.indent}${entry.identifier},`;

  // Idempotency: skip if either side already mentions the identifier.
  const importsBlock = lines.slice(importsSpan.startLine + 1, importsSpan.endLine).join("\n");
  if (importsBlock.includes(`from "${entry.packageName}"`)) {
    return { kind: "no-op", reason: `import for "${entry.packageName}" already present` };
  }

  // Insert in reverse order so the listSpan indices we computed for `lines`
  // stay valid after the imports edit (lower line numbers stay stable).
  const next = [...lines];
  next.splice(listSpan.endLine, 0, listLine);
  next.splice(importsSpan.endLine, 0, importLine);

  return { kind: "ok", content: next.join("\n") };
}

/**
 * Removes the matching import + plugin-list entry. Idempotent in the same
 * way as `addPluginToConfig` — if there's nothing to remove, returns
 * `kind: "no-op"` so the caller can decide whether that's an error.
 */
export function removePluginFromConfig(content: string, entry: PluginEntry): EditOutcome {
  const check = checkMarkers(content);
  if (!check.ok) return { kind: "no-markers", missing: check.missing };
  const lines = check.lines;

  const importsSpan = findSpan(lines, IMPORTS_START, IMPORTS_END);
  const listSpan = findSpan(lines, LIST_START, LIST_END);
  if (!importsSpan || !listSpan) {
    return { kind: "no-markers", missing: ["malformed marker pairs"] };
  }

  const isImportLine = (line: string) =>
    /^\s*import\s+/.test(line) && line.includes(`"${entry.packageName}"`);
  const isListLine = (line: string) =>
    new RegExp(`^\\s*${entry.identifier}\\s*,?\\s*$`).test(line);

  const next: string[] = [];
  let removed = false;
  for (let i = 0; i < lines.length; i++) {
    const inImports = i > importsSpan.startLine && i < importsSpan.endLine;
    const inList = i > listSpan.startLine && i < listSpan.endLine;
    const line = lines[i] ?? "";
    if (inImports && isImportLine(line)) {
      removed = true;
      continue;
    }
    if (inList && isListLine(line)) {
      removed = true;
      continue;
    }
    next.push(line);
  }

  if (!removed) {
    return { kind: "no-op", reason: `no entry for "${entry.packageName}" found` };
  }
  return { kind: "ok", content: next.join("\n") };
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
