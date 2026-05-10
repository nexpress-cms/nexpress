/**
 * Drizzle-kit emits `--> statement-breakpoint` between statements in
 * its generated SQL files. The integration-test migration runner
 * (and the template-DB initializer) splits each file on that marker
 * to feed Postgres one statement at a time.
 *
 * The naive `sql.split("--> statement-breakpoint")` strategy
 * false-positived in 0033_split_taxonomies.sql: a `--` comment
 * happened to contain the literal marker text wrapped in backticks
 * (`\`--> statement-breakpoint\``) as part of an explanatory note,
 * the splitter cut inside the comment, and the trailing backtick
 * orphaned into the next chunk. Postgres then rejected `\`\nCREATE
 * TABLE …` with a position-1 syntax error and broke every
 * integration test at template-prepare time.
 *
 * The marker itself is technically a Postgres line comment (anything
 * after `--` until end-of-line). Drizzle abuses that property — the
 * marker is a no-op for Postgres and a parsable token for splitters.
 *
 * Detection rule: on each line, find the first `--` outside a
 * single-quoted string literal. If that `--` starts the marker
 * (`--> statement-breakpoint`), it's a real split point. If it's
 * any other `-- comment`, the line carries no marker — even if the
 * marker text appears later inside that comment, it's commented-out
 * and must be ignored.
 *
 * Limitations (deferred until a real migration trips them):
 * - Doesn't track dollar-quoted strings (`$$..$$`). A migration that
 *   embeds the literal marker text inside a dollar-quoted body would
 *   still false-split. Drizzle never emits that shape; hand-authored
 *   migrations would have to construct it deliberately.
 * - Single-quoted string literals are tracked so `'-- not a comment'`
 *   inside a string doesn't get treated as a comment start. Postgres
 *   `''` quote-escaping inside literals toggles the in-string state
 *   twice, leaving it correct.
 */

const STATEMENT_MARKER = "--> statement-breakpoint";

export function splitMigrationStatements(sql: string): string[] {
  const lines = sql.split("\n");
  const statements: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const markerStart = findMarkerStart(line);
    if (markerStart === -1) {
      current.push(line);
      continue;
    }
    // Real marker at column `markerStart`. Anything to the left is
    // code that belongs to the current statement; anything to the
    // right is the marker plus any trailing whitespace/text on the
    // same line (drizzle never emits content past the marker).
    const before = line.slice(0, markerStart);
    if (before) current.push(before);
    const stmt = current.join("\n").trim();
    if (stmt) statements.push(stmt);
    current = [];
  }

  if (current.length > 0) {
    const tail = current.join("\n").trim();
    if (tail) statements.push(tail);
  }

  return statements;
}

/**
 * Returns the column position of the marker on `line`, or -1 if no
 * real marker is present. The detection walks left-to-right tracking
 * single-quoted string state. The first `--` outside a string is
 * either the marker (if followed by `> statement-breakpoint`) or a
 * regular line comment that swallows the rest of the line.
 */
function findMarkerStart(line: string): number {
  let inSingle = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (c === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && c === "-" && line[i + 1] === "-") {
      // First `--` outside a string. Either the marker or a comment.
      // The marker pattern is `--> statement-breakpoint`; everything
      // else is a comment that runs to end-of-line.
      const rest = line.slice(i);
      return rest.startsWith(STATEMENT_MARKER) ? i : -1;
    }
  }
  return -1;
}
