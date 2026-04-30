import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { NxAuthUser } from "@nexpress/core";

import { exportXliff } from "./export.js";
import { importXliff } from "./import.js";

/**
 * IO seam — tests inject capture hooks; the apps/web shim wires
 * `process.stdout` / `process.stderr` directly.
 */
export interface CliIo {
  out(message: string): void;
  err(message: string): void;
}

export interface CliRunResult {
  /** 0 = success, non-zero = failure (mirrors process exit codes). */
  exitCode: number;
}

const USAGE = `Usage:
  xliff export <out-dir>           Write one .xliff file per (collection, locale-pair).
  xliff import <file> [--dry-run]  Apply a translator's XLIFF bundle.

Options:
  --dry-run                        Validate + report without writing.

Notes:
  - Source-locale rows must be \`status="published"\` to ship to translators.
  - Imported targets land as \`status="draft"\` so a reviewer can publish.
  - Run with apps/web's \`pnpm xliff\` shim so core services are wired.
`;

/**
 * Parse the raw argv and execute. Returns an exit code rather
 * than calling `process.exit` directly so the apps/web shim can
 * decide how to surface errors (and tests can drive it without
 * killing the runner).
 */
export async function runCli(
  io: CliIo,
  args: string[],
  options: { user: NxAuthUser },
): Promise<CliRunResult> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    io.out(USAGE);
    return { exitCode: command ? 0 : 1 };
  }

  if (command === "export") {
    return runExport(io, rest);
  }
  if (command === "import") {
    return runImport(io, rest, options.user);
  }
  io.err(`Unknown command: ${command}\n\n${USAGE}`);
  return { exitCode: 2 };
}

async function runExport(io: CliIo, args: string[]): Promise<CliRunResult> {
  const outDir = args[0];
  if (!outDir) {
    io.err("xliff export: <out-dir> argument is required\n");
    return { exitCode: 2 };
  }
  const bundle = await exportXliff();
  if (bundle.files.length === 0) {
    io.out(
      "xliff export: no i18n collections with translatable content — nothing written.\n",
    );
    return { exitCode: 0 };
  }
  for (const file of bundle.files) {
    const path = join(outDir, file.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.xml, "utf8");
    io.out(`  wrote ${path} (${file.unitCount} unit${file.unitCount === 1 ? "" : "s"})\n`);
  }
  io.out(
    `\nExported ${bundle.files.length} file${bundle.files.length === 1 ? "" : "s"} ` +
      `(${bundle.summary.docCount} doc${bundle.summary.docCount === 1 ? "" : "s"}, ` +
      `${bundle.summary.fieldCount} unit${bundle.summary.fieldCount === 1 ? "" : "s"}, ` +
      `targets: ${bundle.summary.targetLocales.join(", ")}).\n`,
  );
  return { exitCode: 0 };
}

async function runImport(
  io: CliIo,
  args: string[],
  user: NxAuthUser,
): Promise<CliRunResult> {
  const positional: string[] = [];
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--")) {
      io.err(`xliff import: unknown flag ${arg}\n`);
      return { exitCode: 2 };
    } else {
      positional.push(arg);
    }
  }
  const filePath = positional[0];
  if (!filePath) {
    io.err("xliff import: <file> argument is required\n");
    return { exitCode: 2 };
  }
  let xml: string;
  try {
    xml = readFileSync(filePath, "utf8");
  } catch (error) {
    io.err(`xliff import: cannot read ${filePath} — ${(error as Error).message}\n`);
    return { exitCode: 1 };
  }
  const result = await importXliff({ xml, user, dryRun });
  for (const a of result.applied) {
    const verb = dryRun ? `would ${a.operation}` : a.operation;
    io.out(
      `  ${verb}  ${a.collection}/${a.docId}  locale=${a.locale}  units=${a.unitCount}\n`,
    );
  }
  for (const s of result.skipped) {
    io.out(`  skip   ${s.reason}\n`);
  }
  io.out(
    `\n${dryRun ? "(dry-run) " : ""}` +
      `Applied ${result.applied.length}, skipped ${result.skipped.length}` +
      `${result.wrote ? "" : " (no writes)"}.\n`,
  );
  return { exitCode: 0 };
}
