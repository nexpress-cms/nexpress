import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import type { NxAuthUser } from "@nexpress/core";

import { type ApplyReport, type CollectionMapping } from "../apply/index.js";
import { type WpImportBundle } from "../parse/types.js";
import { parseWxr } from "../parse/wxr.js";
import { loadConfigFromPath, WpImportConfigError } from "./config.js";
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
  /**
   * Phase 21.8 — opt out of staff-user creation. With this flag the
   * shim swaps in a resolver that returns null for every author, so
   * imported posts have no `author` set and are attributed to the
   * import operator via `createdBy` / `updatedBy`.
   */
  "no-create-authors": { type: "boolean" as const, default: false },
  /**
   * Phase 21.9 — path to a JSON config file that declares custom-
   * post-type → collection mappings and optional postmeta-key →
   * field-name overrides. Records whose `wpType` isn't in the
   * config (and isn't post / page / attachment) are skipped with a
   * warning.
   */
  config: { type: "string" as const },
  /**
   * Phase 21.12 — escalate sub-pipeline warnings (media 4xx, MIME
   * reject, taxonomy/author resolver failures) into errors so the
   * CLI exits non-zero. Useful for "clean import or fail" scripts.
   */
  strict: { type: "boolean" as const, default: false },
  /**
   * Phase 21.12 — rewrite the existing document instead of
   * skipping when a slug collides. Comments are NOT re-imported on
   * an update pass — that needs the per-comment idempotency keys
   * landing in 21.14.
   */
  update: { type: "boolean" as const, default: false },
  /**
   * Phase 21.12 — write a side-by-side HTML/Lexical diff for every
   * imported record so the operator can spot-check the conversion.
   * Defaults to writing `<wxr>.report.html` next to the source.
   */
  "report-html": { type: "boolean" as const, default: false },
  /**
   * Phase 21.12 — override the default `<wxr>.report.html` path.
   * Implies `--report-html`; passing a path without the flag is
   * fine too.
   */
  "report-html-path": { type: "string" as const },
  /**
   * Phase 21.14 — load + persist a sidecar resume marker so re-runs
   * skip work that already landed and dedupe comments by
   * `wpCommentId`. Defaults the marker path to
   * `<wxr>.import-state.json`; override with `--resume-state`.
   */
  resume: { type: "boolean" as const, default: false },
  /** Phase 21.14 — override the default resume-marker path. */
  "resume-state": { type: "string" as const },
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
    ctx: {
      actor: NxAuthUser;
      dryRun: boolean;
      log: (line: string) => void;
      /** Phase 21.8 — true when the operator passed `--no-create-authors`. */
      createAuthors: boolean;
      /**
       * Phase 21.9 — operator-supplied custom-post-type mappings.
       * Empty object when no `--config` file was passed.
       */
      collectionMappings: Record<string, CollectionMapping>;
      /** Phase 21.12 — set when the operator passed `--strict`. */
      strict: boolean;
      /** Phase 21.12 — set when the operator passed `--update`. */
      update: boolean;
      /**
       * Phase 21.12 — when set, the operator wants a side-by-side
       * HTML/Lexical diff written somewhere. The CLI passes the
       * resolved file path; the shim is responsible for opening
       * the file and producing the deps. `null` means "don't emit".
       */
      reportHtmlPath: string | null;
      /**
       * Phase 21.14 — when set, the operator wants a resume marker
       * loaded + persisted at the named path. `null` means
       * "don't load or write a marker".
       */
      resumeStatePath: string | null;
    },
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

  let collectionMappings: Record<string, CollectionMapping> = {};
  if (parsed.values.config) {
    try {
      collectionMappings = loadConfigFromPath(parsed.values.config).collectionMappings;
    } catch (error) {
      io.stderr(
        error instanceof WpImportConfigError
          ? `wp-import: ${error.message}`
          : `wp-import: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
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

  // Phase 21.12 — `--report-html` enables the diff; `--report-html-path`
  // optionally overrides the default `<wxr>.report.html` location. Either
  // flag implies "emit a report", so a path without the boolean is also
  // valid.
  const reportHtmlPathOverride = parsed.values["report-html-path"];
  const reportHtmlPath: string | null =
    reportHtmlPathOverride && reportHtmlPathOverride.length > 0
      ? reportHtmlPathOverride
      : parsed.values["report-html"]
        ? `${sourcePath}.report.html`
        : null;

  // Phase 21.14 — resolve the resume marker path the same way:
  // explicit path wins; bare `--resume` falls back to a sibling of
  // the WXR.
  const resumeStatePathOverride = parsed.values["resume-state"];
  const resumeStatePath: string | null =
    resumeStatePathOverride && resumeStatePathOverride.length > 0
      ? resumeStatePathOverride
      : parsed.values.resume
        ? `${sourcePath}.import-state.json`
        : null;

  const report = await hooks.applyBundle(bundle, {
    actor,
    dryRun: parsed.values["dry-run"],
    log: (line) => io.stdout(line),
    createAuthors: !parsed.values["no-create-authors"],
    collectionMappings,
    strict: parsed.values.strict,
    update: parsed.values.update,
    reportHtmlPath,
    resumeStatePath,
  });

  io.stdout(formatApplyReport(report, { dryRun: parsed.values["dry-run"] }));

  return report.errors.length > 0 ? 1 : 0;
}

const USAGE = `Usage: wp-import <wxr-file> [--apply] [--dry-run] [--strict] [--update] [--no-create-authors] [--report-html] [--report-html-path <path>] [--resume] [--resume-state <path>]

Reads a WordPress eXtended RSS export and either prints a summary
of what would be imported (default) or applies it to the database
(--apply). With --apply you can still pass --dry-run to walk the
records and surface skip / collision decisions without writing.

Options:
  --apply               Run the applier (writes via @nexpress/core).
                        Without this flag only the parsed summary
                        is printed.
  --dry-run             When combined with --apply, walk records
                        but skip the actual writes. Useful for
                        previewing what the import will do against
                        a real DB.
  --no-create-authors   Skip creating staff users for WP authors.
                        Imported posts come in without an author
                        wired and the import operator takes credit
                        via createdBy / updatedBy (Phase 21.8).
  --config <path>       Path to a JSON config file declaring
                        custom-post-type mappings. Each mapping
                        routes a wpType into a NexPress collection
                        and optionally maps WP postmeta keys to
                        collection field names (Phase 21.9).
  --strict              Escalate sub-pipeline warnings (media 4xx,
                        MIME reject, taxonomy / author resolver
                        failures) into errors so the CLI exits
                        non-zero (Phase 21.12).
  --update              Rewrite the existing document instead of
                        skipping when a slug collides. Comments
                        are NOT re-imported on an update pass
                        (Phase 21.12).
  --report-html         Write a side-by-side HTML/Lexical diff of
                        every imported record so the operator can
                        spot-check the conversion. Defaults to
                        <wxr>.report.html (Phase 21.12).
  --report-html-path <path>
                        Override the default report path. Implies
                        --report-html.
  --resume              Read + persist a sidecar resume marker so
                        re-runs skip work that already landed and
                        dedupe comments by wpCommentId. Defaults
                        to <wxr>.import-state.json (Phase 21.14).
  --resume-state <path>
                        Override the default resume-marker path.
                        Implies --resume.
  -h, --help            Show this help message.`;
