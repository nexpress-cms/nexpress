import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { splitMigrationStatements } from "./migration-split.js";

/**
 * First-boot smoke: validate the on-disk drizzle migration set for
 * the reference app without needing a live Postgres. Catches the
 * shapes that have bitten this project before:
 *
 *   1. Splitter false-positive (#594) — a `--> statement-breakpoint`
 *      marker quoted inside a `--` comment caused `splitMigrationStatements`
 *      to cut inside the comment and orphan the trailing backtick into
 *      the next chunk. Postgres rejected the next chunk with a position-1
 *      syntax error and broke EVERY integration test at template-prepare
 *      time. The bug sat on `main` undetected for days because CI was on
 *      `workflow_dispatch` and nobody re-ran the integration suite.
 *
 *   2. Stale snapshot chain (#592 / #522) — a hand-authored migration
 *      whose `<idx>_snapshot.json` was a literal copy of the previous
 *      snapshot (same `id`, same `prevId`). `drizzle-kit generate` rejects
 *      the chain with "snapshot is pointing to a parent snapshot" but
 *      the runtime migration applier didn't notice; the snapshot stayed
 *      stale until someone tried to author a new migration.
 *
 * Both shapes are checked here as pure file-IO + JSON checks. Adds about
 * 20ms to `pnpm test`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.resolve(here, "../../../../apps/web/drizzle");
const META_DIR = path.join(DRIZZLE_DIR, "meta");

interface JournalEntry {
  idx: number;
  tag: string;
}

function loadJournal(): JournalEntry[] {
  const raw = readFileSync(path.join(META_DIR, "_journal.json"), "utf8");
  const parsed = JSON.parse(raw) as { entries: JournalEntry[] };
  return parsed.entries.slice().sort((a, b) => a.idx - b.idx);
}

interface Snapshot {
  id: string;
  prevId: string;
}

function loadSnapshot(idx: number): Snapshot {
  const file = path.join(META_DIR, `${String(idx).padStart(4, "0")}_snapshot.json`);
  const raw = readFileSync(file, "utf8");
  return JSON.parse(raw) as Snapshot;
}

describe("migration chain smoke", () => {
  const journal = loadJournal();

  it("journal is non-empty (sanity check)", () => {
    expect(journal.length).toBeGreaterThan(0);
  });

  it("every journal entry has a corresponding .sql file", () => {
    const sqlFiles = new Set(readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql")));
    for (const entry of journal) {
      expect(sqlFiles, `missing SQL for journal idx ${entry.idx}`).toContain(`${entry.tag}.sql`);
    }
  });

  it("every journal entry has a corresponding _snapshot.json", () => {
    const metaFiles = new Set(readdirSync(META_DIR));
    for (const entry of journal) {
      const expected = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
      expect(metaFiles, `missing snapshot for idx ${entry.idx}`).toContain(expected);
    }
  });

  it("snapshot chain is intact — each snapshot's prevId matches the previous snapshot's id (#522 regression)", () => {
    let prevId: string | null = null;
    for (const entry of journal) {
      const snapshot = loadSnapshot(entry.idx);
      if (entry.idx === 0) {
        // First snapshot's prevId is documented as the empty zero-uuid by drizzle.
        expect(snapshot.id).toBeTruthy();
      } else {
        expect(
          snapshot.prevId,
          `snapshot ${entry.idx} (${entry.tag}) prevId should match snapshot ${entry.idx - 1}`,
        ).toBe(prevId);
        // Catch the specific bug that hid for 5 days: a snapshot
        // whose `id` equals its `prevId` is a copy of the prior
        // snapshot — drizzle-kit refuses to walk it.
        expect(
          snapshot.id,
          `snapshot ${entry.idx} (${entry.tag}) id collides with prevId — the snapshot wasn't regenerated after the SQL was authored`,
        ).not.toBe(snapshot.prevId);
      }
      prevId = snapshot.id;
    }
  });

  it("every SQL file splits into well-formed statements (#594 regression)", () => {
    // A "well-formed" statement starts with one of the SQL keywords
    // drizzle-kit emits. The 0033 backtick-orphan bug produced a
    // statement starting with `` ` ``, which we want to catch here.
    // Comments are valid leading content (Postgres ignores them) so
    // we look at the first non-`--`, non-empty line of each chunk.
    const validLeading =
      /^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|DO|COMMENT|GRANT|REVOKE|BEGIN|TRUNCATE|SET|WITH)\b/i;

    for (const entry of journal) {
      const sql = readFileSync(path.join(DRIZZLE_DIR, `${entry.tag}.sql`), "utf8");
      const statements = splitMigrationStatements(sql);
      for (const [i, stmt] of statements.entries()) {
        // First non-comment line of the chunk
        const firstCodeLine =
          stmt
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.length > 0 && !l.startsWith("--")) ?? "";

        expect(
          firstCodeLine,
          `${entry.tag}.sql statement[${i}] has no SQL keyword — the splitter likely cut inside a comment. First chars: ${JSON.stringify(stmt.slice(0, 40))}`,
        ).toMatch(validLeading);
      }
    }
  });
});
