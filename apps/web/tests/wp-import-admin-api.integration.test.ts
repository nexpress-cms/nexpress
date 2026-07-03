import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  getTestDatabaseUrl,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

import {
  findDocuments,
  getJobHandler,
  npImportRuns,
  npUsers,
  recordHeartbeat,
  setJobQueue,
  startWorker,
  stopWorker,
  type NpAuthUser,
  type NpJobType,
} from "@nexpress/core";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// eslint-disable-next-line import-x/no-relative-packages
import {
  createAndEnqueueWordPressImportRun,
  getWordPressImportRun,
  registerWordPressImportJobs,
} from "../../../packages/app/src/lib/wp-import-admin.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/wp-import/tests/fixtures/minimal.wxr.xml",
);

interface ImportResponse {
  mode: "preview" | "apply";
  dryRun: boolean;
  options: {
    resume: boolean;
  };
  counts: {
    records: number;
    recordsByType: Record<string, number>;
  };
  resume: {
    enabled: boolean;
    sourceHash: string | null;
    documents: number;
    comments: number;
    authors: number;
    media: number;
    taxonomies: number;
  };
  mappings: {
    configured: {
      total: number;
      items: Array<{
        wpType: string;
        collection: string;
        fieldOverrides: Record<string, string>;
        records: number;
      }>;
    };
    unmapped: {
      total: number;
      items: Array<{ wpType: string; records: number }>;
    };
  };
  report: {
    applied: { total: number; items: Array<{ collection: string; slug: string }> };
    skipped: { total: number; items: Array<{ reason: string }> };
    errors: { total: number };
    conversionSamples: {
      total: number;
      items: Array<{
        wpId: number;
        slug: string;
        rawHtml: string;
        lexicalJson: string;
      }>;
    };
    media: { status: "not-run" | "completed" };
    taxonomies: { status: "not-run" | "completed" };
    comments: { status: "not-run" | "completed" };
    authors: { status: "not-run" | "completed" };
  };
}

interface ImportRun {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  jobId: string | null;
  options: {
    update: boolean;
    strict: boolean;
    createAuthors: boolean;
    includeMedia: boolean;
    resume?: boolean;
    collectionMappings?: Record<
      string,
      { collection: string; fieldOverrides?: Record<string, string> }
    >;
  };
  sourceHash: string | null;
  resume: ImportResponse["resume"];
  report: ImportResponse | null;
  error: string | null;
}

interface QueuedResponse {
  mode: "apply";
  queued: true;
  run: ImportRun;
}

describe.skipIf(skipIfNoTestDb())("admin WordPress import API", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(async () => {
    await stopWorker();
    setJobQueue(null);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("previews a WXR file without writing documents", async () => {
    const admin = await seedUser({ role: "admin" });
    const { POST } = await import("@/app/api/admin/import/wordpress/route");

    const response = await POST(
      multipartRequest("/api/admin/import/wordpress", admin, {
        mode: "preview",
        includeMedia: "true",
      }),
    );
    const { status, body } = await readJson<ImportResponse>(response);

    expect(status).toBe(200);
    expect(body.mode).toBe("preview");
    expect(body.dryRun).toBe(true);
    expect(body.options.resume).toBe(true);
    expect(body.resume).toMatchObject({
      enabled: true,
      documents: 0,
      comments: 0,
    });
    expect(body.counts.records).toBe(3);
    expect(body.counts.recordsByType).toMatchObject({ attachment: 1, page: 1, post: 1 });
    expect(body.report.applied.total).toBe(2);
    expect(body.report.skipped.items.some((row) => row.reason.includes("attachment"))).toBe(true);
    expect(body.report.media.status).toBe("completed");
    expect(body.report.taxonomies.status).toBe("not-run");
    expect(body.report.conversionSamples.total).toBe(2);
    expect(body.report.conversionSamples.items[0]?.lexicalJson).toContain('"root"');
    expect(body.mappings.unmapped.total).toBe(0);

    const actor = await asActor(admin);
    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    expect(posts.docs).toHaveLength(0);
  });

  it("previews custom post type mappings and flags unmapped types", async () => {
    const admin = await seedUser({ role: "admin" });
    const { POST } = await import("@/app/api/admin/import/wordpress/route");
    const xml = customTypeFixtureXml();

    const unmappedResponse = await POST(
      multipartRequest(
        "/api/admin/import/wordpress",
        admin,
        {
          mode: "preview",
          includeMedia: "false",
        },
        { xml },
      ),
    );
    const unmapped = await readJson<ImportResponse>(unmappedResponse);

    expect(unmapped.status).toBe(200);
    expect(unmapped.body.counts.recordsByType).toMatchObject({ landing: 1 });
    expect(unmapped.body.mappings.unmapped.items).toEqual([{ wpType: "landing", records: 1 }]);
    expect(
      unmapped.body.report.skipped.items.some((row) =>
        row.reason.includes('unmapped wpType "landing"'),
      ),
    ).toBe(true);

    const mappedResponse = await POST(
      multipartRequest(
        "/api/admin/import/wordpress",
        admin,
        {
          mode: "preview",
          includeMedia: "false",
          mappingConfig: customMappingConfig(),
        },
        { xml },
      ),
    );
    const mapped = await readJson<ImportResponse>(mappedResponse);

    expect(mapped.status).toBe(200);
    expect(mapped.body.mappings.unmapped.total).toBe(0);
    expect(mapped.body.mappings.configured.items[0]).toMatchObject({
      wpType: "landing",
      collection: "pages",
      records: 1,
      fieldOverrides: { _landing_template: "template" },
    });
    expect(
      mapped.body.report.applied.items.map((row) => `${row.collection}/${row.slug}`).sort(),
    ).toEqual(["pages/about", "posts/hello-world"]);
  });

  it("queues and applies a WXR file through the background admin flow", async () => {
    const admin = await seedUser({ role: "admin" });
    let enqueued: { type: NpJobType; data: unknown } | null = null;
    setJobQueue({
      enqueue: async (type, data) => {
        enqueued = { type, data };
        return "job-1";
      },
      start: async () => {},
      stop: async () => {},
    });
    const { POST } = await import("@/app/api/admin/import/wordpress/route");
    const xml = customTypeFixtureXml();

    const response = await POST(
      multipartRequest(
        "/api/admin/import/wordpress",
        admin,
        {
          mode: "apply",
          includeMedia: "false",
          mappingConfig: customMappingConfig(),
        },
        { xml },
      ),
    );
    const { status, body } = await readJson<QueuedResponse>(response);

    expect(status).toBe(200);
    expect(body.mode).toBe("apply");
    expect(body.queued).toBe(true);
    expect(body.run.status).toBe("queued");
    expect(body.run.jobId).toBe("job-1");
    expect(body.run.sourceHash).toBe(sha256(xml));
    expect(body.run.options.resume).toBe(true);
    expect(body.run.resume).toMatchObject({
      enabled: true,
      documents: 0,
    });
    expect(body.run.options.collectionMappings?.landing).toMatchObject({
      collection: "pages",
      fieldOverrides: { _landing_template: "template" },
    });
    expect(enqueued?.type).toBe("import:wordpressApply");

    const handler = getJobHandler("import:wordpressApply");
    expect(handler).toBeTypeOf("function");
    await handler!(enqueued?.data);

    const { GET } = await import("@/app/api/admin/import/wordpress/runs/[id]/route");
    const runResponse = await GET(
      new NextRequest(`http://localhost:3000/api/admin/import/wordpress/runs/${body.run.id}`, {
        headers: {
          cookie: `np-session=${admin.accessToken}; np-csrf=${admin.csrfToken}`,
          "x-csrf-token": admin.csrfToken,
        },
      }),
      { params: Promise.resolve({ id: body.run.id }) },
    );
    const runJson = await readJson<{ run: ImportRun }>(runResponse);
    const run = runJson.body.run;

    expect(runJson.status).toBe(200);
    expect(run.status).toBe("succeeded");
    expect(run.error).toBeNull();
    expect(run.report?.mode).toBe("apply");
    expect(run.report?.dryRun).toBe(false);
    expect(run.report?.report.errors.total).toBe(0);
    expect(
      run.report?.report.applied.items.map((row) => `${row.collection}/${row.slug}`).sort(),
    ).toEqual(["pages/about", "posts/hello-world"]);
    expect(run.report?.report.media.status).toBe("not-run");
    expect(run.report?.report.taxonomies.status).toBe("completed");
    expect(run.report?.report.comments.status).toBe("completed");
    expect(run.report?.report.authors.status).toBe("completed");
    expect(run.resume.documents).toBeGreaterThanOrEqual(2);
    expect(run.report?.resume.documents).toBeGreaterThanOrEqual(2);
    expect(run.report?.report.conversionSamples.total).toBe(2);
    expect(run.report?.mappings.configured.items[0]).toMatchObject({
      wpType: "landing",
      collection: "pages",
      records: 1,
    });

    const actor = await asActor(admin);
    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    expect(posts.docs[0]?.title).toBe("Hello World");
    const pages = await findDocuments("pages", { where: { slug: "about" }, limit: 1 }, actor);
    expect(pages.docs[0]?.template).toBe("landing-page");

    const secondResponse = await POST(
      multipartRequest(
        "/api/admin/import/wordpress",
        admin,
        {
          mode: "apply",
          includeMedia: "false",
          mappingConfig: customMappingConfig(),
        },
        { xml },
      ),
    );
    const second = await readJson<QueuedResponse>(secondResponse);
    expect(second.status).toBe(200);
    expect(second.body.run.sourceHash).toBe(body.run.sourceHash);
    expect(second.body.run.resume.documents).toBeGreaterThanOrEqual(2);
  });

  it("rejects invalid admin mapping config", async () => {
    const admin = await seedUser({ role: "admin" });
    const { POST } = await import("@/app/api/admin/import/wordpress/route");

    const response = await POST(
      multipartRequest("/api/admin/import/wordpress", admin, {
        mode: "preview",
        mappingConfig: JSON.stringify({ mappings: [{ wpType: "landing" }] }),
      }),
    );
    const { status, body } = await readJson<{ error?: { message?: string; details?: unknown } }>(
      response,
    );

    expect(status).toBe(400);
    expect(body.error?.message).toBe("Invalid input");
    expect(JSON.stringify(body.error)).toContain("mappingConfig");
  });

  it("lists recent WordPress import runs", async () => {
    const admin = await seedUser({ role: "admin" });
    setJobQueue({
      enqueue: async () => "job-list-1",
      start: async () => {},
      stop: async () => {},
    });
    const { POST } = await import("@/app/api/admin/import/wordpress/route");
    const { GET } = await import("@/app/api/admin/import/wordpress/runs/route");

    await POST(
      multipartRequest("/api/admin/import/wordpress", admin, {
        mode: "apply",
        includeMedia: "false",
      }),
    );

    const response = await GET(
      new NextRequest("http://localhost:3000/api/admin/import/wordpress/runs?limit=5", {
        headers: {
          cookie: `np-session=${admin.accessToken}; np-csrf=${admin.csrfToken}`,
          "x-csrf-token": admin.csrfToken,
        },
      }),
    );
    const { status, body } = await readJson<{ runs: ImportRun[] }>(response);

    expect(status).toBe(200);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]?.status).toBe("queued");
    expect(body.runs[0]?.jobId).toBe("job-list-1");
  });

  it("marks stale WordPress import runs failed through the admin sweep endpoint", async () => {
    const admin = await seedUser({ role: "admin" });
    const db = await getTestDb();
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const [run] = await db
      .insert(npImportRuns)
      .values({
        kind: "wordpress",
        mode: "apply",
        sourceName: "stale.wxr.xml",
        sourceSize: 128,
        sourceMimeType: "text/xml",
        sourceXml: "<rss />",
        options: {
          update: false,
          strict: false,
          createAuthors: true,
          includeMedia: false,
        },
        status: "queued",
        logs: ["Queued WordPress import for stale.wxr.xml."],
        createdBy: admin.userId,
        createdAt: old,
        updatedAt: old,
      })
      .returning({ id: npImportRuns.id });
    if (!run) throw new Error("failed to seed stale import run");
    const [running] = await db
      .insert(npImportRuns)
      .values({
        kind: "wordpress",
        mode: "apply",
        sourceName: "still-running.wxr.xml",
        sourceSize: 128,
        sourceMimeType: "text/xml",
        sourceXml: "<rss />",
        options: {
          update: false,
          strict: false,
          createAuthors: true,
          includeMedia: false,
        },
        status: "running",
        logs: ["Started WordPress import still-running."],
        createdBy: admin.userId,
        startedAt: old,
        createdAt: old,
        updatedAt: old,
      })
      .returning({ id: npImportRuns.id });
    if (!running) throw new Error("failed to seed running import run");
    await recordHeartbeat("wp-import-test-worker", { test: true });

    const { POST } = await import("@/app/api/admin/import/wordpress/runs/sweep/route");
    const response = await POST(
      new NextRequest("http://localhost:3000/api/admin/import/wordpress/runs/sweep", {
        method: "POST",
        headers: {
          cookie: `np-session=${admin.accessToken}; np-csrf=${admin.csrfToken}`,
          "x-csrf-token": admin.csrfToken,
        },
      }),
    );
    const { status, body } = await readJson<{ failed: number; runs: ImportRun[] }>(response);

    expect(status).toBe(200);
    expect(body.failed).toBe(1);
    expect(body.runs[0]?.id).toBe(run.id);
    expect(body.runs[0]?.status).toBe("failed");
    expect(body.runs[0]?.error).toContain("stale timeout");

    const [stored] = await db
      .select({
        status: npImportRuns.status,
        sourceXml: npImportRuns.sourceXml,
        error: npImportRuns.error,
      })
      .from(npImportRuns)
      .where(eq(npImportRuns.id, run.id));
    expect(stored).toMatchObject({
      status: "failed",
      sourceXml: null,
    });
    expect(stored?.error).toContain("stale timeout");

    const [runningStored] = await db
      .select({
        status: npImportRuns.status,
        sourceXml: npImportRuns.sourceXml,
      })
      .from(npImportRuns)
      .where(eq(npImportRuns.id, running.id));
    expect(runningStored).toMatchObject({
      status: "running",
      sourceXml: "<rss />",
    });
  });

  it("drains a queued WordPress import run through a real pg-boss worker", async () => {
    const admin = await seedUser({ role: "admin" });
    const actor = await asActor(admin);
    registerWordPressImportJobs();

    const url = getTestDatabaseUrl();
    if (!url) throw new Error("TEST_DATABASE_URL not set");
    await startWorker(url, {
      heartbeat: false,
      installSignalHandlers: false,
    });

    const run = await createAndEnqueueWordPressImportRun({
      xml: readFileSync(FIXTURE, "utf8"),
      actor,
      sourceName: "minimal.wxr.xml",
      sourceSize: readFileSync(FIXTURE).byteLength,
      sourceMimeType: "text/xml",
      options: {
        update: false,
        strict: false,
        createAuthors: true,
        includeMedia: false,
      },
    });

    const completed = await waitForImportRun(run.id, "succeeded");
    expect(completed.jobId).toBeTruthy();
    expect(completed.error).toBeNull();
    expect(completed.report?.report.applied.total).toBe(2);

    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    expect(posts.docs[0]?.title).toBe("Hello World");
  });

  it("forbids non-admin users", async () => {
    const editor = await seedUser({ role: "editor" });
    const { POST } = await import("@/app/api/admin/import/wordpress/route");

    const response = await POST(
      multipartRequest("/api/admin/import/wordpress", editor, {
        mode: "preview",
      }),
    );
    const { status } = await readJson(response);

    expect(status).toBe(403);
  });
});

function multipartRequest(
  pathName: string,
  session: TestUserSession,
  fields: Record<string, string>,
  options: { xml?: string; fileName?: string } = {},
): NextRequest {
  const source = options.xml ?? readFileSync(FIXTURE);
  const formData = new FormData();
  formData.set(
    "file",
    new File([source], options.fileName ?? "minimal.wxr.xml", {
      type: "text/xml",
    }),
  );
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }

  return new NextRequest(`http://localhost:3000${pathName}`, {
    method: "POST",
    headers: {
      cookie: `np-session=${session.accessToken}; np-csrf=${session.csrfToken}`,
      "x-csrf-token": session.csrfToken,
    },
    body: formData,
  });
}

function customTypeFixtureXml(): string {
  const xml = readFileSync(FIXTURE, "utf8");
  return xml.replace(
    "<wp:post_type><![CDATA[page]]></wp:post_type>",
    `<wp:postmeta>
      <wp:meta_key><![CDATA[_landing_template]]></wp:meta_key>
      <wp:meta_value><![CDATA[landing-page]]></wp:meta_value>
    </wp:postmeta>
    <wp:post_type><![CDATA[landing]]></wp:post_type>`,
  );
}

function customMappingConfig(): string {
  return JSON.stringify({
    mappings: [
      {
        wpType: "landing",
        collection: "pages",
        fieldOverrides: {
          _landing_template: "template",
        },
      },
    ],
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function waitForImportRun(
  id: string,
  status: ImportRun["status"],
  timeoutMs = 15_000,
): Promise<ImportRun> {
  const started = Date.now();
  let last: ImportRun | null = null;

  while (Date.now() - started < timeoutMs) {
    last = await getWordPressImportRun(id);
    if (last.status === status) return last;
    if (last.status === "failed") return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for import run ${id} to reach ${status}; last status ${last?.status ?? "unknown"}`,
  );
}

async function asActor(session: TestUserSession): Promise<NpAuthUser> {
  const db = await getTestDb();
  const rows = await db
    .select({ name: npUsers.name, tokenVersion: npUsers.tokenVersion })
    .from(npUsers)
    .where(eq(npUsers.id, session.userId));
  const row = rows[0];
  if (!row) throw new Error("seed user missing");
  return {
    id: session.userId,
    email: session.email,
    name: row.name,
    role: session.role,
    tokenVersion: row.tokenVersion,
  };
}
