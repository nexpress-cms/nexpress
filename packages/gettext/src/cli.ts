import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type NpAuthUser } from "@nexpress/core";

import { exportGettext } from "./export.js";
import { importGettext } from "./import.js";

export interface CliIo {
  out(message: string): void;
  err(message: string): void;
}

export interface CliRunResult {
  exitCode: number;
}

const USAGE = `Usage:
  gettext export <out-dir>           Write one .po file per (collection, locale-pair).
  gettext import <file> [--dry-run]  Apply a translator's PO catalog.

Options:
  --dry-run                           Validate + report without writing.

Notes:
  - Source-locale rows must be \`status="published"\` to ship to translators.
  - Imported targets land as \`status="draft"\` so a reviewer can publish.
  - Keep every \`msgctxt\` and rich-text \`{NP:...}\` token unchanged.
  - Run with apps/web's \`pnpm gettext\` shim so core services are wired.
`;

export async function runCli(
  io: CliIo,
  args: string[],
  options: { user: NpAuthUser },
): Promise<CliRunResult> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    io.out(USAGE);
    return { exitCode: command ? 0 : 1 };
  }
  if (command === "export") return runExport(io, rest, options.user);
  if (command === "import") return runImport(io, rest, options.user);
  io.err(`Unknown command: ${command}\n\n${USAGE}`);
  return { exitCode: 2 };
}

async function runExport(io: CliIo, args: string[], user: NpAuthUser): Promise<CliRunResult> {
  const outDir = args[0];
  if (!outDir) {
    io.err("gettext export: <out-dir> argument is required\n");
    return { exitCode: 2 };
  }
  const bundle = await exportGettext({ user });
  if (bundle.files.length === 0) {
    io.out("gettext export: no i18n collections with translatable content — nothing written.\n");
    return { exitCode: 0 };
  }
  for (const file of bundle.files) {
    const path = join(outDir, file.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.po, "utf8");
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

async function runImport(io: CliIo, args: string[], user: NpAuthUser): Promise<CliRunResult> {
  const positional: string[] = [];
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--")) {
      io.err(`gettext import: unknown flag ${arg}\n`);
      return { exitCode: 2 };
    } else positional.push(arg);
  }
  const filePath = positional[0];
  if (!filePath) {
    io.err("gettext import: <file> argument is required\n");
    return { exitCode: 2 };
  }
  let body: Buffer;
  try {
    body = readFileSync(filePath);
  } catch (error) {
    io.err(`gettext import: cannot read ${filePath} — ${(error as Error).message}\n`);
    return { exitCode: 1 };
  }
  const result = await importGettext({ po: body, user, dryRun });
  for (const applied of result.applied) {
    const verb = dryRun ? `would ${applied.operation}` : applied.operation;
    io.out(
      `  ${verb}  ${applied.collection}/${applied.docId}  locale=${applied.locale}  units=${applied.unitCount}\n`,
    );
  }
  for (const skipped of result.skipped) io.out(`  skip   ${skipped.reason}\n`);
  io.out(
    `\n${dryRun ? "(dry-run) " : ""}` +
      `Applied ${result.applied.length}, skipped ${result.skipped.length}` +
      `${result.wrote ? "" : " (no writes)"}.\n`,
  );
  return { exitCode: 0 };
}
