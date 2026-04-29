import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { parseWxr } from "../parse/wxr.js";
import { formatSummary } from "./format.js";

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
  help: { type: "boolean" as const, short: "h" },
};

export async function runCli(argv: string[], io: CliIo = DEFAULT_IO): Promise<number> {
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

  io.stdout(formatSummary({ bundle, sourcePath, dryRun: parsed.values["dry-run"] }));
  return 0;
}

const USAGE = `Usage: wp-import <wxr-file> [--dry-run]

Reads a WordPress eXtended RSS export and prints a summary of what
would be imported. The applier (DB writes) lands in Phase 21.4 — for
now every run is a dry run regardless of the flag.

Options:
  --dry-run         Print the summary without writing to the DB.
                    Currently always-on; flag is reserved.
  -h, --help        Show this help message.`;
