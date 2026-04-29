import { type ApplyReport } from "../apply/index.js";
import { type WpImportBundle, type WpImportRecord } from "../parse/types.js";

/**
 * Phase 21.3 — render a parsed `WpImportBundle` as a human-readable
 * summary. Pure function (no IO) so unit tests can pin the exact
 * shape of the operator-facing output.
 *
 * Format priorities, in order:
 *   1. Confirm what the parser found (counts, site identity).
 *   2. Surface anything an operator should act on before applying
 *      (CPTs without mappings, attachments that need media work,
 *      authors that will get auto-created in 21.8).
 *   3. Stay narrow — no terminal-width assumptions, ASCII only.
 *
 * The output is intentionally line-by-line predictable so this
 * doubles as a CI fixture in future sub-phases.
 */
export function formatSummary(args: {
  bundle: WpImportBundle;
  sourcePath: string;
  dryRun: boolean;
}): string {
  const { bundle, sourcePath, dryRun } = args;
  const lines: string[] = [];

  lines.push(`WordPress import${dryRun ? " — dry run" : ""}`);
  lines.push("");
  lines.push(`Source: ${sourcePath}`);
  lines.push(`Site:   ${bundle.site.title || "(untitled)"}`);
  if (bundle.site.link) lines.push(`        ${bundle.site.link}`);
  if (bundle.site.language) lines.push(`Lang:   ${bundle.site.language}`);

  lines.push("");
  lines.push(`Authors (${bundle.authors.length})`);
  for (const author of bundle.authors) {
    const email = author.email ? ` <${author.email}>` : "";
    const display = author.displayName ? `  ${author.displayName}` : "";
    lines.push(`  ${author.login}${email}${display}`);
  }
  if (bundle.authors.length === 0) {
    lines.push("  (none)");
  }

  lines.push("");
  const taxoCounts = countByKey(bundle.terms, (t) => t.taxonomy);
  lines.push(`Channel taxonomies (${taxoCounts.size})`);
  for (const [taxonomy, count] of sortedEntries(taxoCounts)) {
    lines.push(`  ${taxonomy.padEnd(12)} ${count}`);
  }
  if (taxoCounts.size === 0) {
    lines.push("  (none)");
  }

  lines.push("");
  const typeCounts = countByKey(bundle.records, (r) => r.wpType);
  lines.push(`Records (${bundle.records.length})`);
  for (const [wpType, count] of sortedEntries(typeCounts)) {
    const annotation = typeAnnotation(wpType, bundle.records);
    lines.push(`  ${wpType.padEnd(12)} ${count}${annotation ? `  ${annotation}` : ""}`);
  }
  if (typeCounts.size === 0) {
    lines.push("  (no items)");
  }

  const mediaUrls = collectInlineMediaUrls(bundle.records);
  const featuredCount = bundle.records.reduce(
    (acc, r) => acc + r.mediaRefs.filter((m) => m.kind === "featured").length,
    0,
  );
  lines.push("");
  lines.push(`Inline media refs (${mediaUrls.size} unique URL${mediaUrls.size === 1 ? "" : "s"})`);
  lines.push(`Featured images   (${featuredCount})`);

  const totalComments = bundle.records.reduce((acc, r) => acc + r.comments.length, 0);
  if (totalComments > 0) {
    const recordsWithComments = bundle.records.filter((r) => r.comments.length > 0).length;
    lines.push("");
    lines.push(
      `Comments: ${totalComments} across ${recordsWithComments} record${
        recordsWithComments === 1 ? "" : "s"
      }`,
    );
  }

  lines.push("");
  if (dryRun) {
    lines.push("This was a dry run. Pass --apply to write to the database.");
  } else {
    lines.push("Pass --apply to write to the database, or omit it to keep this summary view.");
  }

  return lines.join("\n");
}

/**
 * Annotation appended to a record-type tally line. Only meaningful
 * for "attachment" today; future sub-phases (21.9 CPTs) will widen
 * this to flag unmapped types.
 */
function typeAnnotation(wpType: string, _records: WpImportRecord[]): string {
  if (wpType === "attachment") {
    return "(downloaded + uploaded by the media pipeline)";
  }
  return "";
}

function countByKey<T>(rows: T[], keyOf: (row: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

function sortedEntries(map: Map<string, number>): Array<[string, number]> {
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function collectInlineMediaUrls(records: WpImportRecord[]): Set<string> {
  const out = new Set<string>();
  for (const record of records) {
    for (const ref of record.mediaRefs) {
      if (ref.kind === "inline" && ref.sourceUrl) {
        out.add(ref.sourceUrl);
      }
    }
  }
  return out;
}

/**
 * Phase 21.4 — render the result of `applyBundle()`. Operator-
 * facing summary printed after the apply pass finishes.
 */
export function formatApplyReport(report: ApplyReport, args: { dryRun: boolean }): string {
  const lines: string[] = [];
  lines.push(args.dryRun ? "Apply — dry run" : "Apply");
  lines.push("");

  lines.push(`${args.dryRun ? "Would write" : "Written"}: ${report.applied.length}`);
  for (const row of report.applied) {
    lines.push(`  ${row.collection.padEnd(8)} ${row.slug}  "${row.title}"`);
  }
  if (report.applied.length === 0) {
    lines.push("  (none)");
  }

  lines.push("");
  lines.push(`Skipped: ${report.skipped.length}`);
  const reasonCounts = new Map<string, number>();
  for (const row of report.skipped) {
    reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
  }
  for (const [reason, count] of [...reasonCounts.entries()].sort()) {
    lines.push(`  ${count.toString().padStart(3)}  ${reason}`);
  }
  if (report.skipped.length === 0) {
    lines.push("  (none)");
  }

  if (report.errors.length > 0) {
    lines.push("");
    lines.push(`Errors: ${report.errors.length}`);
    for (const err of report.errors) {
      lines.push(`  ${err.slug}: ${err.message}`);
    }
  }

  lines.push("");
  if (report.media) {
    const m = report.media;
    lines.push(
      `Media: ${m.uploaded} uploaded, ${m.skipped} skipped (dry run), ${m.errors.length} errors`,
    );
    for (const err of m.errors) {
      lines.push(`  ${err.url}: ${err.reason}`);
    }
  } else {
    lines.push("Media: pipeline not run (no upload hook supplied)");
  }

  lines.push("");
  if (report.taxonomies) {
    const t = report.taxonomies;
    lines.push(
      `Taxonomies: ${t.termIds.size} resolved, ${t.skipped.length} skipped, ${t.errors.length} errors`,
    );
    for (const err of t.errors) {
      lines.push(`  ${err.key.taxonomy}/${err.key.slug}: ${err.reason}`);
    }
    for (const skip of t.skipped) {
      lines.push(`  skipped ${skip.taxonomy}/${skip.slug}`);
    }
  } else {
    lines.push("Taxonomies: resolver not supplied — terms dropped");
  }

  if (report.notes.length > 0) {
    lines.push("");
    lines.push("Notes");
    for (const note of report.notes) {
      lines.push(`  - ${note}`);
    }
  }

  return lines.join("\n");
}
