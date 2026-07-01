import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

import { findDocuments, npUsers, type NpAuthUser } from "@nexpress/core";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/wp-import/tests/fixtures/minimal.wxr.xml",
);

interface ImportResponse {
  mode: "preview" | "apply";
  dryRun: boolean;
  counts: {
    records: number;
    recordsByType: Record<string, number>;
  };
  report: {
    applied: { total: number; items: Array<{ collection: string; slug: string }> };
    skipped: { total: number; items: Array<{ reason: string }> };
    errors: { total: number };
    media: { status: "not-run" | "completed" };
    taxonomies: { status: "not-run" | "completed" };
    comments: { status: "not-run" | "completed" };
    authors: { status: "not-run" | "completed" };
  };
}

describe.skipIf(skipIfNoTestDb())("admin WordPress import API", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });

  beforeEach(async () => {
    await truncateAll();
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
    expect(body.counts.records).toBe(3);
    expect(body.counts.recordsByType).toMatchObject({ attachment: 1, page: 1, post: 1 });
    expect(body.report.applied.total).toBe(2);
    expect(body.report.skipped.items.some((row) => row.reason.includes("attachment"))).toBe(true);
    expect(body.report.media.status).toBe("completed");
    expect(body.report.taxonomies.status).toBe("not-run");

    const actor = await asActor(admin);
    const posts = await findDocuments("posts", { where: { slug: "hello-world" }, limit: 1 }, actor);
    expect(posts.docs).toHaveLength(0);
  });

  it("applies a WXR file through the admin endpoint", async () => {
    const admin = await seedUser({ role: "admin" });
    const { POST } = await import("@/app/api/admin/import/wordpress/route");

    const response = await POST(
      multipartRequest("/api/admin/import/wordpress", admin, {
        mode: "apply",
        includeMedia: "false",
      }),
    );
    const { status, body } = await readJson<ImportResponse>(response);

    expect(status).toBe(200);
    expect(body.mode).toBe("apply");
    expect(body.dryRun).toBe(false);
    expect(body.report.errors.total).toBe(0);
    expect(body.report.applied.items.map((row) => `${row.collection}/${row.slug}`).sort()).toEqual([
      "pages/about",
      "posts/hello-world",
    ]);
    expect(body.report.media.status).toBe("not-run");
    expect(body.report.taxonomies.status).toBe("completed");
    expect(body.report.comments.status).toBe("completed");
    expect(body.report.authors.status).toBe("completed");

    const actor = await asActor(admin);
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
): NextRequest {
  const formData = new FormData();
  formData.set(
    "file",
    new File([readFileSync(FIXTURE)], "minimal.wxr.xml", {
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
