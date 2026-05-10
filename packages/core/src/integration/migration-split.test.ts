import { describe, expect, it } from "vitest";

import { splitMigrationStatements } from "./migration-split.js";

describe("splitMigrationStatements", () => {
  it("splits drizzle's normal `;--> marker\\n…` shape", () => {
    const sql = [
      `CREATE TABLE "a" ("id" uuid PRIMARY KEY);--> statement-breakpoint`,
      `CREATE INDEX "a_idx" ON "a" ("id");`,
    ].join("\n");
    const out = splitMigrationStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain(`CREATE TABLE "a"`);
    expect(out[0]).not.toContain("statement-breakpoint");
    expect(out[1]).toContain(`CREATE INDEX "a_idx"`);
  });

  it("preserves leading `--` comment block on the first statement", () => {
    const sql = [
      `-- header comment`,
      `-- another line`,
      `CREATE TABLE "a" ("id" uuid PRIMARY KEY);--> statement-breakpoint`,
      `CREATE INDEX "a_idx" ON "a" ("id");`,
    ].join("\n");
    const out = splitMigrationStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("-- header comment");
    expect(out[0]).toContain(`CREATE TABLE "a"`);
  });

  it("ignores the marker when it appears INSIDE a `--` comment (the 0033 backtick-orphan bug)", () => {
    // Reproduces the exact failure mode from 0033_split_taxonomies.sql:
    // an explanatory comment quoted the marker text in backticks. The
    // naive splitter cut inside the comment and orphaned the trailing
    // backtick into the next chunk.
    const sql = [
      `-- See drizzle docs for \`--> statement-breakpoint\` semantics.`,
      `CREATE TABLE "a" ("id" uuid PRIMARY KEY);--> statement-breakpoint`,
      `CREATE INDEX "a_idx" ON "a" ("id");`,
    ].join("\n");
    const out = splitMigrationStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("-- See drizzle docs");
    expect(out[0]).toContain(`CREATE TABLE "a"`);
    // The next chunk must NOT start with an orphan backtick — that's
    // the position-1 syntax error scenario.
    expect(out[1].startsWith("`")).toBe(false);
    expect(out[1]).toContain(`CREATE INDEX "a_idx"`);
  });

  it("treats `'-- not a comment'` inside a string literal as code", () => {
    const sql = [
      `INSERT INTO "x" ("v") VALUES ('-- not a comment with --> statement-breakpoint inside');--> statement-breakpoint`,
      `INSERT INTO "x" ("v") VALUES ('after');`,
    ].join("\n");
    const out = splitMigrationStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain(`'-- not a comment with --> statement-breakpoint inside'`);
    expect(out[1]).toContain(`'after'`);
  });

  it("drops empty trailing chunks", () => {
    const sql = `CREATE TABLE "a" ("id" uuid);--> statement-breakpoint\n\n   \n`;
    const out = splitMigrationStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(`CREATE TABLE "a"`);
  });

  it("handles a `DO $$ … END$$;--> marker` block as a single statement", () => {
    const sql = [
      `DO $$`,
      `BEGIN`,
      `  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'a') THEN`,
      `    RAISE NOTICE 'exists';`,
      `  END IF;`,
      `END$$;--> statement-breakpoint`,
      `CREATE TABLE "b" ("id" uuid);`,
    ].join("\n");
    const out = splitMigrationStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain(`DO $$`);
    expect(out[0]).toContain(`END$$;`);
    expect(out[1]).toContain(`CREATE TABLE "b"`);
  });
});
