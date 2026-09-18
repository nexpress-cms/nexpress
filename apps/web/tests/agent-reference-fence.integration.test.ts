import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  NP_AGENT_JOB_REFERENCE_FENCE_INSTALL_SQL_V1,
  NP_AGENT_REFERENCE_FENCE_SQL_V2,
  npAgentReferenceFenceCoverageSqlV1,
  npAgentReferenceFenceTriggersSqlV1,
} from "../../../packages/core/src/agent/reference-fence-sql.js";

const sourceId = "10000000-0000-4000-8000-000000000001";
const tables = [
  "np_agent_runs",
  "np_agent_actions",
  "np_audit_events",
  "np_agent_source_releases",
  "np_agent_source_release_edges",
] as const;

/**
 * This protocol test deliberately uses a minimal isolated database. It proves
 * the actual migration SQL with independent sessions, without pretending that
 * fixture-only receipts prove the owning canonical evidence verifiers.
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)("Agent reference fence PostgreSQL protocol", () => {
  const database = `np_fence_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Client;
  let observer: pg.Client;
  let cleaner: pg.Client;
  let writer: pg.Client;
  let databaseUrl: string;

  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = "/postgres";
    admin = new pg.Client({ connectionString: url.href });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    url.pathname = `/${database}`;
    databaseUrl = url.href;
    [observer, cleaner, writer] = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const client = new pg.Client({ connectionString: url.href });
        await client.connect();
        await client.query("SET statement_timeout='5s'");
        return client;
      }),
    );
    await observer.query(`
      CREATE TABLE np_sites(id text PRIMARY KEY);
      CREATE TABLE np_agent_reference_fence(id integer PRIMARY KEY CHECK(id=1),epoch bigint NOT NULL CHECK(epoch>=0));
      INSERT INTO np_agent_reference_fence VALUES(1,0);
      CREATE TABLE np_agent_runs(id uuid PRIMARY KEY,site_id text NOT NULL);
      CREATE TABLE np_agent_actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id text,run_id uuid,run_fingerprint text,run_source_release_id uuid,input_hash text,sequence integer,idempotency_key text);
      CREATE TABLE np_audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id text,payload jsonb,actor_user_id uuid,actor_member_id uuid);
      CREATE TABLE np_agent_source_releases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id text NOT NULL,source_id uuid NOT NULL,source_kind text DEFAULT 'runtime-run',evidence_body jsonb DEFAULT '{"admissionFingerprint":"fingerprint"}');
      CREATE INDEX np_fence_source_idx ON np_agent_source_releases(source_id,site_id);
      CREATE TABLE np_agent_source_release_edges(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id text NOT NULL,owner_kind text NOT NULL,owner_id uuid NOT NULL,source_release_id uuid,edge_code text);
      ${NP_AGENT_REFERENCE_FENCE_SQL_V2}
      ${tables.map(npAgentReferenceFenceTriggersSqlV1).join("\n")}
    `);
  });

  beforeEach(async () => {
    await cleaner.query("ROLLBACK");
    await writer.query("ROLLBACK");
    await observer.query(`TRUNCATE ${tables.join(",")},np_sites;
      INSERT INTO np_sites VALUES('site-a'),('site-b');
      INSERT INTO np_agent_reference_fence VALUES(1,0) ON CONFLICT(id) DO UPDATE SET epoch=0;
      INSERT INTO np_agent_runs VALUES('${sourceId}','site-a');`);
  });

  afterAll(async () => {
    for (const client of [writer, cleaner, observer]) await client?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      await admin.end();
    }
  });

  async function waitForPid(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await observer.query<{ wait_event_type: string | null }>(
        "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
        [pid],
      );
      if (result.rows[0]?.wait_event_type === "Lock") return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Expected a real PostgreSQL lock wait.");
  }

  async function writerPid(): Promise<number> {
    return (await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
  }

  async function lockCleaner(): Promise<void> {
    await cleaner.query("BEGIN");
    await cleaner.query("SELECT * FROM np_agent_reference_fence WHERE id=1 FOR UPDATE NOWAIT");
    await cleaner.query("UPDATE np_agent_reference_fence SET epoch=epoch+1 WHERE id=1");
  }

  async function releaseSource(): Promise<void> {
    await cleaner.query(
      "INSERT INTO np_agent_source_releases(site_id,source_id) VALUES('site-a',$1)",
      [sourceId],
    );
    await cleaner.query("DELETE FROM np_agent_runs WHERE id=$1", [sourceId]);
  }

  function insertAudit(siteId: string | null = "site-a") {
    return writer.query("INSERT INTO np_audit_events(site_id,payload) VALUES($1,$2)", [
      siteId,
      { nested: { sourceId } },
    ]);
  }

  it.each(["site-a", null])(
    "rejects a blocked READ COMMITTED insert with a fresh release snapshot (%s)",
    async (siteId) => {
      const pid = await writerPid();
      await lockCleaner();
      await releaseSource();
      const result = insertAudit(siteId).then(
        () => null,
        (error: unknown) => error,
      );
      await waitForPid(pid);
      await cleaner.query("COMMIT");
      expect(await result).toMatchObject({ code: "23514" });
      expect((await observer.query("SELECT count(*) FROM np_audit_events")).rows[0].count).toBe(
        "0",
      );
    },
  );

  it.each(["REPEATABLE READ", "SERIALIZABLE"])(
    "aborts a stale %s writer after the epoch changes",
    async (isolation) => {
      const pid = await writerPid();
      await writer.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await writer.query("SELECT * FROM np_agent_reference_fence");
      await lockCleaner();
      await releaseSource();
      const result = insertAudit().then(
        () => null,
        (error: unknown) => error,
      );
      await waitForPid(pid);
      await cleaner.query("COMMIT");
      expect(await result).toMatchObject({ code: "40001" });
    },
  );

  it("defers a cleaner when a writer already holds the shared barrier", async () => {
    await writer.query("BEGIN");
    await insertAudit();
    await cleaner.query("BEGIN");
    await expect(
      cleaner.query("SELECT * FROM np_agent_reference_fence WHERE id=1 FOR UPDATE NOWAIT"),
    ).rejects.toMatchObject({ code: "55P03" });
  });

  it("avoids inversion when a writer already owns a source row", async () => {
    const pid = await writerPid();
    await writer.query("BEGIN");
    await writer.query("SELECT * FROM np_agent_runs WHERE id=$1 FOR UPDATE", [sourceId]);
    await lockCleaner();
    const result = insertAudit().then(
      () => null,
      (error: unknown) => error,
    );
    await waitForPid(pid);
    await expect(
      cleaner.query("SELECT * FROM np_agent_runs WHERE id=$1 FOR UPDATE NOWAIT", [sourceId]),
    ).rejects.toMatchObject({ code: "55P03" });
    await cleaner.query("ROLLBACK");
    expect(await result).toBeNull();
  });

  it("retains site isolation, rejects UUID substrings and rolls back multirow writes", async () => {
    await lockCleaner();
    await releaseSource();
    await cleaner.query("COMMIT");
    await insertAudit("site-b");
    await expect(
      writer.query("INSERT INTO np_audit_events(site_id,payload) VALUES('site-a','{}'),(null,$1)", [
        { note: `prefix:${sourceId}:suffix` },
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    expect((await observer.query("SELECT count(*) FROM np_audit_events")).rows[0].count).toBe("1");
    await expect(
      writer.query("INSERT INTO np_agent_runs VALUES($1,'site-a')", [sourceId]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rolls back source deletion and epoch together", async () => {
    await lockCleaner();
    await releaseSource();
    await cleaner.query("ROLLBACK");
    expect((await observer.query("SELECT epoch FROM np_agent_reference_fence")).rows[0].epoch).toBe(
      "0",
    );
    expect((await observer.query("SELECT count(*) FROM np_agent_runs")).rows[0].count).toBe("1");
    await insertAudit();
  });

  it("freezes historical owners, permits exact noops and refuses owner deletion", async () => {
    await insertAudit();
    await lockCleaner();
    await releaseSource();
    await cleaner.query(
      "INSERT INTO np_agent_source_release_edges(site_id,owner_kind,owner_id) SELECT site_id,'runtime-audit',id FROM np_audit_events",
    );
    await cleaner.query("COMMIT");
    await writer.query("UPDATE np_audit_events SET payload=payload");
    await expect(
      writer.query("UPDATE np_audit_events SET payload=payload||'{\"new\":1}'"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(writer.query("UPDATE np_audit_events SET payload='{}'")).rejects.toMatchObject({
      code: "23514",
    });
    await writer.query("UPDATE np_audit_events SET actor_user_id=gen_random_uuid()");
    await writer.query("UPDATE np_audit_events SET actor_user_id=null");
    await expect(
      writer.query("UPDATE np_audit_events SET actor_user_id=$1", [sourceId]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(writer.query("DELETE FROM np_audit_events")).rejects.toMatchObject({
      code: "23514",
    });
  });

  it.each(["valid", "wrong"])(
    "allows only the proved Action locator transition with a %s deterministic key",
    async (keyKind) => {
      const actionId = randomUUID();
      await writer.query(
        "INSERT INTO np_agent_actions(id,site_id,run_id,run_fingerprint,input_hash,sequence,idempotency_key) VALUES($1,'site-a',$2,'fingerprint','unchanged',1,$3)",
        [actionId, sourceId, `runtime:${sourceId}:${keyKind === "valid" ? 1 : 2}`],
      );
      await lockCleaner();
      const { rows } = await cleaner.query<{ id: string }>(
        "INSERT INTO np_agent_source_releases(site_id,source_id) VALUES('site-a',$1) RETURNING id",
        [sourceId],
      );
      const releaseId = rows[0]!.id;
      await cleaner.query(
        "INSERT INTO np_agent_source_release_edges(site_id,owner_kind,owner_id,source_release_id,edge_code) VALUES('site-a','read-action',$1,$2,'action-run')",
        [actionId, releaseId],
      );
      const transition = cleaner.query(
        "UPDATE np_agent_actions SET run_id=null,run_source_release_id=$1 WHERE id=$2",
        [releaseId, actionId],
      );
      if (keyKind === "wrong") {
        await expect(transition).rejects.toMatchObject({ code: "23514" });
        await cleaner.query("ROLLBACK");
        expect(
          (await observer.query("SELECT run_id FROM np_agent_actions WHERE id=$1", [actionId]))
            .rows[0].run_id,
        ).toBe(sourceId);
        expect(
          (await observer.query("SELECT count(*) FROM np_agent_source_releases")).rows[0].count,
        ).toBe("0");
        return;
      }
      await transition;
      await cleaner.query("DELETE FROM np_agent_runs WHERE id=$1", [sourceId]);
      await cleaner.query("COMMIT");
      await writer.query("UPDATE np_agent_actions SET input_hash=input_hash WHERE id=$1", [
        actionId,
      ]);
      await expect(
        writer.query("UPDATE np_agent_actions SET input_hash='changed' WHERE id=$1", [actionId]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        writer.query("UPDATE np_agent_actions SET run_source_release_id=null WHERE id=$1", [
          actionId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    },
  );

  it("makes receipt deletion contingent on committed whole-site deletion", async () => {
    await lockCleaner();
    await releaseSource();
    await cleaner.query("COMMIT");
    await expect(
      writer.query("UPDATE np_agent_source_releases SET source_id=gen_random_uuid()"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(writer.query("DELETE FROM np_agent_source_releases")).rejects.toMatchObject({
      code: "23514",
    });
    await writer.query("BEGIN");
    await writer.query("DELETE FROM np_agent_source_releases WHERE site_id='site-a'");
    await writer.query("DELETE FROM np_sites WHERE id='site-a'");
    await writer.query("COMMIT");
    expect(
      (await observer.query("SELECT count(*) FROM np_agent_source_releases")).rows[0].count,
    ).toBe("0");
  });

  it("fails closed for a missing singleton and reports disabled guards", async () => {
    expect(
      (await observer.query(npAgentReferenceFenceCoverageSqlV1(tables))).rows[0].missing_count,
    ).toBe("0");
    await observer.query("DELETE FROM np_agent_reference_fence");
    await expect(insertAudit()).rejects.toMatchObject({ code: "23514" });
    expect(
      (await observer.query(npAgentReferenceFenceCoverageSqlV1(tables))).rows[0].missing_count,
    ).toBe("1");
    await observer.query(
      "INSERT INTO np_agent_reference_fence VALUES(1,0); ALTER TABLE np_audit_events DISABLE TRIGGER np_agent_reference_statement_v1",
    );
    expect(
      (await observer.query(npAgentReferenceFenceCoverageSqlV1(tables))).rows[0].missing_count,
    ).toBe("1");
    await observer.query(
      "ALTER TABLE np_audit_events ENABLE TRIGGER np_agent_reference_statement_v1",
    );
  });

  it("detects a replaced same-signature guard function and its unsafe attributes", async () => {
    const query = npAgentReferenceFenceCoverageSqlV1(tables);
    expect((await observer.query(query)).rows[0].missing_count).toBe("0");
    await observer.query(
      "CREATE OR REPLACE FUNCTION public.np_agent_reference_lock_v1() RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $$BEGIN RETURN; END$$",
    );
    expect((await observer.query(query)).rows[0].missing_count).toBe("1");
    await observer.query(NP_AGENT_REFERENCE_FENCE_SQL_V2);
    expect((await observer.query(query)).rows[0].missing_count).toBe("0");
    await observer.query("ALTER FUNCTION public.np_agent_reference_lock_v1() STABLE");
    expect((await observer.query(query)).rows[0].missing_count).toBe("1");
    await observer.query(NP_AGENT_REFERENCE_FENCE_SQL_V2);
  });

  it("guards direct old/new job partitions and fences partition attachment", async () => {
    await observer.query(`CREATE SCHEMA pgboss;
      CREATE TABLE pgboss.job(id uuid,name text,state text,data jsonb) PARTITION BY LIST(name);
      CREATE TABLE pgboss.old_queue PARTITION OF pgboss.job FOR VALUES IN ('old');`);
    try {
      await observer.query(NP_AGENT_JOB_REFERENCE_FENCE_INSTALL_SQL_V1);
      expect(
        (await observer.query(npAgentReferenceFenceCoverageSqlV1(tables))).rows[0].missing_count,
      ).toBe("0");
      await observer.query(
        "CREATE TABLE pgboss.new_queue PARTITION OF pgboss.job FOR VALUES IN ('new')",
      );
      expect(
        (await observer.query(npAgentReferenceFenceCoverageSqlV1(tables))).rows[0].missing_count,
      ).toBe("1");
      const pid = await writerPid();
      await lockCleaner();
      await releaseSource();
      const result = writer
        .query("INSERT INTO pgboss.new_queue VALUES(gen_random_uuid(),'new','created',$1)", [
          { siteId: "site-a", sourceId },
        ])
        .then(
          () => null,
          (error: unknown) => error,
        );
      await waitForPid(pid);
      await cleaner.query("COMMIT");
      expect(await result).toMatchObject({ code: "23514" });
      await observer.query(NP_AGENT_JOB_REFERENCE_FENCE_INSTALL_SQL_V1);
      expect(
        (await observer.query(npAgentReferenceFenceCoverageSqlV1(tables))).rows[0].missing_count,
      ).toBe("0");
      await expect(
        writer.query("INSERT INTO pgboss.old_queue VALUES(gen_random_uuid(),'old','created',$1)", [
          { sourceId },
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await cleaner.query("BEGIN; LOCK TABLE pgboss.job IN SHARE MODE NOWAIT");
      await writer.query("BEGIN; SET LOCAL lock_timeout='100ms'");
      await expect(
        writer.query(
          "CREATE TABLE pgboss.late_queue PARTITION OF pgboss.job FOR VALUES IN ('late')",
        ),
      ).rejects.toMatchObject({ code: "55P03" });
      await writer.query("ROLLBACK");
      await cleaner.query("ROLLBACK");
    } finally {
      await observer.query("DROP SCHEMA pgboss CASCADE");
    }
  });

  it("installs guards through the real pg-boss 12 producer adapter without a worker", async () => {
    const { PgBossAdapter } = await import("../../../packages/core/src/jobs/pg-boss-adapter.js");
    const adapter = new PgBossAdapter(databaseUrl, { supervise: false, schedule: false });
    try {
      // A CMS using a schema without this migration must still start its
      // ordinary producer; the adapter does not initialize Agent tables.
      await observer.query(
        "ALTER TABLE np_agent_reference_fence RENAME TO np_agent_reference_fence_hold",
      );
      await adapter.startProducer();
      expect(
        (
          await observer.query(
            "SELECT count(*) FROM pg_trigger WHERE tgrelid='pgboss.job'::regclass AND tgname='np_agent_reference_row_v1'",
          )
        ).rows[0].count,
      ).toBe("0");
      await observer.query(
        "ALTER TABLE np_agent_reference_fence_hold RENAME TO np_agent_reference_fence",
      );
      await adapter.startProducer();
      expect(
        (await observer.query(npAgentReferenceFenceCoverageSqlV1(tables))).rows[0].missing_count,
      ).toBe("0");
      const boss = Reflect.get(adapter, "boss") as {
        createQueue(name: string, options: { partition: boolean }): Promise<void>;
      };
      await boss.createQueue("fence.partition", { partition: true });
      expect(
        (await observer.query(npAgentReferenceFenceCoverageSqlV1(tables))).rows[0].missing_count,
      ).toBe("1");
      // Starting an existing producer is idempotent and repairs statement
      // coverage of a partition created by pg-boss after initial setup.
      await adapter.startProducer();
      expect(
        (await observer.query(npAgentReferenceFenceCoverageSqlV1(tables))).rows[0].missing_count,
      ).toBe("0");
      await lockCleaner();
      await releaseSource();
      await cleaner.query("COMMIT");
      await expect(
        writer.query("INSERT INTO pgboss.job(name,data) VALUES('fence.partition',$1)", [
          { siteId: "site-a", sourceId },
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await adapter.stop();
      await observer.query("DROP SCHEMA IF EXISTS pgboss CASCADE");
    }
  });

  it("uses indexed lookups with large retained history and a dense UUID payload", async () => {
    // Seeding 50,000 retained rows is setup, not the guarded-write workload.
    // Keep its CI I/O allowance transaction-local so measured writes retain 5s.
    const setupStarted = performance.now();
    await observer.query("BEGIN; SET LOCAL statement_timeout='60s'");
    try {
      await observer.query(
        "INSERT INTO np_agent_source_releases(site_id,source_id) SELECT 'site-a',gen_random_uuid() FROM generate_series(1,50000)",
      );
      await observer.query("ANALYZE np_agent_source_releases");
      await observer.query("COMMIT");
    } catch (error) {
      await observer.query("ROLLBACK");
      throw error;
    }
    const setupMs = Math.round(performance.now() - setupStarted);
    for (const client of [observer, writer])
      expect((await client.query("SHOW statement_timeout")).rows[0].statement_timeout).toBe("5s");
    const plan = await observer.query(
      "EXPLAIN (FORMAT JSON) SELECT EXISTS (SELECT 1 FROM np_agent_source_releases WHERE source_id=$1::uuid AND site_id=$2)",
      [sourceId, "site-a"],
    );
    expect(JSON.stringify(plan.rows)).toContain("np_fence_source_idx");
    const batchStarted = performance.now();
    await writer.query(
      "INSERT INTO np_audit_events(site_id,payload) SELECT 'site-a',jsonb_build_object('source',$1::text) FROM generate_series(1,1000)",
      [sourceId],
    );
    const batchMs = Math.round(performance.now() - batchStarted);
    expect((await observer.query("SELECT count(*) FROM np_audit_events")).rows[0].count).toBe(
      "1000",
    );
    // Every connection has a five-second statement timeout. This actual
    // 370KB/10,000-UUID input exposed quadratic full-string regexp_instr work.
    const denseStarted = performance.now();
    await writer.query("INSERT INTO np_audit_events(site_id,payload) VALUES('site-a',$1)", [
      { dense: `${sourceId} `.repeat(10_000) },
    ]);
    const denseMs = Math.round(performance.now() - denseStarted);
    expect((await observer.query("SELECT count(*) FROM np_audit_events")).rows[0].count).toBe(
      "1001",
    );
    console.info("Reference fence retained history", {
      retainedRows: 50_000,
      setupMs,
      batchRows: 1_000,
      batchMs,
      denseUuidCount: 10_000,
      denseMs,
    });
  }, 120_000);

  it.each(["audit", "job"])(
    "rejects an overlapping released UUID in %s INSERT and UPDATE",
    async (owner) => {
      const first = "aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb";
      const second = "bbbbbbbb-cccc-4ccc-8ccc-dddddddddddd";
      const overlap = `${first}-cccc-4ccc-8ccc-dddddddddddd`;
      expect(overlap).toContain(second);
      const rowId = randomUUID();
      if (owner === "job") {
        await observer.query(
          "CREATE SCHEMA pgboss; CREATE TABLE pgboss.job(id uuid,name text,state text,data jsonb)",
        );
        await observer.query(NP_AGENT_JOB_REFERENCE_FENCE_INSTALL_SQL_V1);
      }
      try {
        const insert =
          owner === "audit"
            ? (payload: object) =>
                writer.query(
                  "INSERT INTO np_audit_events(id,site_id,payload) VALUES($1,'site-a',$2)",
                  [randomUUID(), payload],
                )
            : (payload: object) =>
                writer.query(
                  "INSERT INTO pgboss.job VALUES(gen_random_uuid(),'overlap','created',$1)",
                  [{ siteId: "site-a", ...payload }],
                );
        if (owner === "audit") {
          await writer.query(
            "INSERT INTO np_audit_events(id,site_id,payload) VALUES($1,'site-a','{}')",
            [rowId],
          );
        } else {
          await writer.query(
            "INSERT INTO pgboss.job VALUES($1,'overlap','created','{\"siteId\":\"site-a\"}')",
            [rowId],
          );
        }
        await observer.query(
          "INSERT INTO np_agent_source_releases(site_id,source_id) VALUES('site-a',$1)",
          [second],
        );
        await insert({ note: first });
        await expect(insert({ nested: { note: overlap } })).rejects.toMatchObject({
          code: "23514",
        });
        await expect(insert({ [overlap]: "UUID in a key" })).rejects.toMatchObject({
          code: "23514",
        });
        const update =
          owner === "audit"
            ? writer.query("UPDATE np_audit_events SET payload=$1 WHERE id=$2", [
                { note: overlap },
                rowId,
              ])
            : writer.query("UPDATE pgboss.job SET data=$1 WHERE id=$2", [
                { siteId: "site-a", note: overlap },
                rowId,
              ]);
        await expect(update).rejects.toMatchObject({ code: "23514" });
        // Both owners call the same SQL scanner. Sweep all character offsets
        // once through audit; job retains multibyte/chunk-boundary probes as well
        // as its distinct data/site mapping, INSERT, UPDATE and key checks above.
        const offsets =
          owner === "audit" ? Array.from({ length: 240 }, (_, i) => i) : [0, 239, 240, 241];
        for (const padding of offsets) {
          await expect(insert({ note: `${"한".repeat(padding)}${overlap}` })).rejects.toMatchObject(
            {
              code: "23514",
            },
          );
        }
      } finally {
        if (owner === "job") await observer.query("DROP SCHEMA pgboss CASCADE");
      }
    },
  );

  it("scans a measured 33MiB sparse reference payload within the ordinary statement budget", async () => {
    const note = `${"x".repeat(33 * 1024 * 1024)}${sourceId}`;
    await writer.query("SET statement_timeout='30s'");
    try {
      const started = performance.now();
      await writer.query("INSERT INTO np_audit_events(site_id,payload) VALUES('site-a',$1)", [
        { note },
      ]);
      const elapsedMs = Math.round(performance.now() - started);
      console.info("Reference fence sparse payload", {
        payloadBytes: Buffer.byteLength(note),
        elapsedMs,
      });
      expect(elapsedMs).toBeLessThan(30_000);
      expect((await observer.query("SELECT count(*) FROM np_audit_events")).rows[0].count).toBe(
        "1",
      );
    } finally {
      await writer.query("SET statement_timeout='5s'");
    }
  });
});
