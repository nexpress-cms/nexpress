import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeTestDb, ensureMigrated, getTestDatabaseUrl, skipIfNoTestDb } from "./setup.js";
import { createIntegrationTruncateSql } from "./table-reset.js";

async function waitForBlockedReset(writer: pg.Client, pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await writer.query<{ waiting: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted) AS waiting",
      [pid],
    );
    if (rows[0]!.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Reset did not wait for the fixture's database lock");
}

describe.skipIf(skipIfNoTestDb())("integration table reset", () => {
  let client: pg.Client;

  beforeAll(async () => {
    await ensureMigrated();
    client = new pg.Client({ connectionString: getTestDatabaseUrl()! });
    await client.connect();
  });
  beforeEach(async () => {
    await client.query(
      "CREATE SCHEMA np_reset_fixture; SET search_path TO np_reset_fixture, public",
    );
  });
  afterEach(async () => {
    await client.query("RESET search_path; DROP SCHEMA np_reset_fixture CASCADE");
  });
  afterAll(async () => {
    await client?.end();
    await closeTestDb();
  });

  it("clears nullable-FK descendants of empty parents and restarts empty owned sequences", async () => {
    await client.query(`
      CREATE TABLE parent (id integer PRIMARY KEY);
      CREATE TABLE untouched (id integer);
      CREATE TABLE child (id integer PRIMARY KEY, parent_id integer REFERENCES parent(id));
      CREATE TABLE grandchild (id integer REFERENCES child(id));
      CREATE TABLE numbered (id integer GENERATED ALWAYS AS IDENTITY);
      INSERT INTO child VALUES (1, NULL);
      INSERT INTO grandchild VALUES (1);
      SELECT nextval(pg_get_serial_sequence('numbered', 'id'));
    `);
    const before = await client.query("SELECT pg_relation_filenode('untouched') AS file");
    await client.query(createIntegrationTruncateSql(["parent", "untouched", "numbered"]));
    expect(
      (await client.query("SELECT * FROM child UNION ALL SELECT id, NULL FROM grandchild")).rows,
    ).toEqual([]);
    expect(
      (await client.query("SELECT nextval(pg_get_serial_sequence('numbered', 'id')) AS id")).rows,
    ).toEqual([{ id: "1" }]);
    // Avoiding file replacement for a proven-empty heap is the optimization's
    // observable storage contract, not a requirement on incidental SQL text.
    expect((await client.query("SELECT pg_relation_filenode('untouched') AS file")).rows).toEqual(
      before.rows,
    );
  });

  it("removes deleted tuples even for a pre-existing snapshot that had not locked the table", async () => {
    await client.query("CREATE TABLE parent (id integer); INSERT INTO parent VALUES (1)");
    const observer = new pg.Client({ connectionString: getTestDatabaseUrl()! });
    await observer.connect();
    try {
      await observer.query("BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT txid_current_snapshot()");
      await client.query("DELETE FROM parent");
      expect((await client.query("SELECT * FROM parent")).rows).toEqual([]);
      await client.query(createIntegrationTruncateSql(["parent"]));
      expect((await observer.query("SELECT * FROM np_reset_fixture.parent")).rows).toEqual([]);
      expect((await client.query("SELECT pg_relation_size('parent') AS bytes")).rows).toEqual([
        { bytes: "0" },
      ]);
    } finally {
      await observer.query("ROLLBACK");
      await observer.end();
    }
  });

  it("discovers newly added inheritance children instead of caching a table inventory", async () => {
    await client.query("CREATE TABLE parent (id integer)");
    const reset = createIntegrationTruncateSql(["parent"]);
    await client.query(`
      CREATE TABLE inherited () INHERITS (parent);
      INSERT INTO inherited VALUES (1);
    `);
    await client.query(reset);
    expect((await client.query("SELECT * FROM parent")).rows).toEqual([]);
  });

  it("retains full-command trigger effects and the caller's original trigger order", async () => {
    await client.query(`
      CREATE TABLE first (id integer);
      CREATE TABLE second (id integer);
      CREATE TABLE events (id integer GENERATED ALWAYS AS IDENTITY, target text);
      CREATE FUNCTION record_truncate() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN INSERT INTO events(target) VALUES (TG_TABLE_NAME); RETURN NULL; END $body$;
      CREATE TRIGGER first_reset AFTER TRUNCATE ON first
        FOR EACH STATEMENT EXECUTE FUNCTION record_truncate();
      CREATE TRIGGER second_reset AFTER TRUNCATE ON second
        FOR EACH STATEMENT EXECUTE FUNCTION record_truncate();
    `);
    await client.query(createIntegrationTruncateSql(["second", "first"]));
    expect((await client.query("SELECT target FROM events ORDER BY id")).rows).toEqual([
      { target: "second" },
      { target: "first" },
    ]);
  });

  it("locks before inspecting a concurrent writer and clears its committed row", async () => {
    await client.query("CREATE TABLE parent (id integer)");
    const writer = new pg.Client({ connectionString: getTestDatabaseUrl()! });
    await writer.connect();
    let reset: Promise<pg.QueryResult> | undefined;
    try {
      await writer.query("BEGIN; INSERT INTO np_reset_fixture.parent VALUES (1)");
      const {
        rows: [{ pid }],
      } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      reset = client.query(createIntegrationTruncateSql(["parent"]));
      await waitForBlockedReset(writer, pid);
      await writer.query("COMMIT");
      await reset;
      expect((await client.query("SELECT * FROM parent")).rows).toEqual([]);
    } finally {
      await writer.query("ROLLBACK");
      await reset;
      await writer.end();
    }
  });

  it("includes a foreign-key descendant committed while reset was acquiring its parent's lock", async () => {
    await client.query(`
      CREATE TABLE parent (id integer PRIMARY KEY);
      CREATE TABLE child (id integer PRIMARY KEY, parent_id integer REFERENCES parent);
    `);
    const writer = new pg.Client({ connectionString: getTestDatabaseUrl()! });
    await writer.connect();
    let reset: Promise<pg.QueryResult> | undefined;
    try {
      await writer.query(`
        BEGIN;
        CREATE TABLE np_reset_fixture.grandchild
          (id integer, child_id integer REFERENCES np_reset_fixture.child);
        INSERT INTO np_reset_fixture.grandchild VALUES (1, NULL);
      `);
      const {
        rows: [{ pid }],
      } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      reset = client.query(createIntegrationTruncateSql(["parent"]));
      await waitForBlockedReset(writer, pid);
      await writer.query("COMMIT");
      await reset;
      expect((await client.query("SELECT * FROM grandchild")).rows).toEqual([]);
    } finally {
      await writer.query("ROLLBACK");
      await reset;
      await writer.end();
    }
  });

  it("rolls back the reset when a later statement fails and quotes arbitrary identifiers", async () => {
    const name = `quoted_'";$np_integration_reset$`;
    const quoted = `"${name.replaceAll('"', '""')}"`;
    await client.query(`CREATE TABLE ${quoted} (id integer); INSERT INTO ${quoted} VALUES (1)`);
    const reset = createIntegrationTruncateSql([name]);
    await expect(client.query(`${reset} SELECT 1 / 0`)).rejects.toThrow("division by zero");
    expect((await client.query(`SELECT * FROM ${quoted}`)).rows).toEqual([{ id: 1 }]);
    await client.query(reset);
    expect((await client.query(`SELECT * FROM ${quoted}`)).rows).toEqual([]);
  });
});
