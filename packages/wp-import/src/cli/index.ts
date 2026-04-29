import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import type { NxAuthUser } from "@nexpress/core";

import { type ApplyReport } from "../apply/index.js";
import { type WpImportBundle } from "../parse/types.js";
import { parseWxr } from "../parse/wxr.js";
import { formatApplyReport, formatSummary } from "./format.js";

/**
 * Phase 21.3 — `wp-import` CLI runner.
 *
 * Returns an exit code instead of calling `process.exit` so the
 * shim (or a test harness) can decide whether to terminate. The
 * shim under `apps/web/scripts/wp-import.ts` does the actual exit.
 *
 * Today every invocation is a dry run because the applier doesn't
 * exist yet (Phase 21.4 lands content writes; 21.5 lands media).
 * `--dry-run` defaults to true; passing `--dry-run=false` prints a
 * useful "not implemented yet" message rather than silently doing
 * nothing.
 */
export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const DEFAULT_IO: CliIo = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

const CLI_OPTIONS = {
  "dry-run": { type: "boolean" as const, default: true },
  apply: { type: "boolean" as const, default: false },
  help: { type: "boolean" as const, short: "h" },
};

/**
 * Hooks the shim plumbs in so the CLI can run the applier without
 * directly depending on the framework's bootstrap. When omitted —
 * e.g. CI runs `runCli` from a unit test — the CLI prints the
 * dry-run summary and ignores `--apply`.
 */
export interface CliApplyHooks {
  applyBundle: (
    bundle: WpImportBundle,
    ctx: { actor: NxAuthUser; dryRun: boolean; log: (line: string) => void },
  ) => Promise<ApplyReport>;
  resolveActor: () => Promise<NxAuthUser>;
}

export async function runCli(
  argv: string[],
  io: CliIo = DEFAULT_IO,
  hooks?: CliApplyHooks,
): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof CLI_OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({
      args: argv,
      options: CLI_OPTIONS,
      allowPositionals: true,
    });
  } catch (error) {
    io.stderr(error instanceof Error ? `wp-import: ${error.message}` : "wp-import: bad arguments");
    io.stderr("");
    io.stderr(USAGE);
    return 2;
  }

  if (parsed.values.help) {
    io.stdout(USAGE);
    return 0;
  }

  const sourcePath = parsed.positionals[0];
  if (!sourcePath) {
    io.stderr("wp-import: missing path to a WXR file");
    io.stderr("");
    io.stderr(USAGE);
    return 2;
  }

  let xml: string;
  try {
    xml = readFileSync(sourcePath, "utf8");
  } catch (error) {
    io.stderr(
      `wp-import: cannot read ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  let bundle;
  try {
    bundle = parseWxr(xml);
  } catch (error) {
    io.stderr(`wp-import: parse failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  // Default mode: parse + summary only. No DB touch.
  if (!parsed.values.apply) {
    io.stdout(formatSummary({ bundle, sourcePath, dryRun: parsed.values["dry-run"] }));
    return 0;
  }

  // --apply path: needs the shim's hooks.
  if (!hooks) {
    io.stderr(
      "wp-import: --apply requires the shim that bootstraps core services. Run via `pnpm wp-import` from apps/web, not directly.",
    );
    return 1;
  }

  let actor: NxAuthUser;
  try {
    actor = await hooks.resolveActor();
  } catch (error) {
    io.stderr(
      `wp-import: cannot resolve admin actor: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const report = await hooks.applyBundle(bundle, {
    actor,
    dryRun: parsed.values["dry-run"],
    log: (line) => io.stdout(line),
  });

  io.stdout(formatApplyReport(report, { dryRun: parsed.values["dry-run"] }));

  return report.errors.length > 0 ? 1 : 0;
}

const USAGE = `Usage: wp-import <wxr-file> [--apply] [--dry-run]

Reads a WordPress eXtended RSS export and either prints a summary
of what would be imported (default) or applies it to the database
(--apply). With --apply you can still pass --dry-run to walk the
records and surface skip / collision decisions without writing.

Options:
  --apply           Run the applier (writes via @nexpress/core).
                    Without this flag only the parsed summary is
                    printed.
  --dry-run         When combined with --apply, walk records but
                    skip the actual writes. Useful for previewing
                    what the import will do against a real DB.
  -h, --help        Show this help message.`;
