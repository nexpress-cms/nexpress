import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

/**
 * Audit list filter coverage. The base filters (target /
 * actor) are exercised through `moderation.integration.test.ts`'s
 * end-to-end flows; this file pins the new filters added in
 * the operational-efficiency cleanup: `action`, `since`,
 * `until`.
 */
describe.skipIf(skipIfNoTestDb())("audit list filters", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  async function seedEvents() {
    const { recordAuditEvent } = await import("@nexpress/core");
    const staff = await seedUser({ role: "admin" });
    const actor = { kind: "staff", userId: staff.userId } as const;

    // Two events on different actions, different times.
    // The harness's `recordAuditEvent` uses the DB clock for
    // `created_at`, so we can't backdate without an UPDATE —
    // the order is "second insert is later than first."
    await recordAuditEvent({
      actor,
      action: "comment.hide",
      targetType: "comment",
      targetId: "00000000-0000-0000-0000-000000000001",
      payload: {},
    });
    await recordAuditEvent({
      actor,
      action: "member.ban.issue",
      targetType: "member",
      targetId: "00000000-0000-0000-0000-000000000002",
      payload: { reason: "spam" },
    });
    await recordAuditEvent({
      actor,
      action: "comment.hide",
      targetType: "comment",
      targetId: "00000000-0000-0000-0000-000000000003",
      payload: {},
    });

    return { staff };
  }

  it("filters by action keyword", async () => {
    const { staff } = await seedEvents();
    const { GET } = await import("@/app/api/admin/audit/route");
    const req = buildRequest("/api/admin/audit", {
      session: staff,
      query: { action: "comment.hide" },
    });
    const res = await GET(req);
    const { status, body } = await readJson<{
      docs?: Array<{ action: string }>;
      totalDocs?: number;
    }>(res);
    expect(status).toBe(200);
    expect(body.docs?.every((d) => d.action === "comment.hide")).toBe(true);
    expect(body.totalDocs).toBe(2);
  });

  it("filters by `since` (lower-bound timestamp)", async () => {
    const { staff } = await seedEvents();
    // `since` set to "now + 1 minute" — every seeded event
    // is older, so the result should be empty.
    const future = new Date(Date.now() + 60_000).toISOString();
    const { GET } = await import("@/app/api/admin/audit/route");
    const req = buildRequest("/api/admin/audit", {
      session: staff,
      query: { since: future },
    });
    const res = await GET(req);
    const { status, body } = await readJson<{ totalDocs?: number }>(res);
    expect(status).toBe(200);
    expect(body.totalDocs).toBe(0);
  });

  it("filters by `until` (upper-bound timestamp)", async () => {
    const { staff } = await seedEvents();
    // `until` set to "now - 1 hour" — every seeded event is
    // newer, so the result should be empty.
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    const { GET } = await import("@/app/api/admin/audit/route");
    const req = buildRequest("/api/admin/audit", {
      session: staff,
      query: { until: past },
    });
    const res = await GET(req);
    const { status, body } = await readJson<{ totalDocs?: number }>(res);
    expect(status).toBe(200);
    expect(body.totalDocs).toBe(0);
  });

  it("ignores invalid `since` / `until` (drops the filter, doesn't 400)", async () => {
    const { staff } = await seedEvents();
    const { GET } = await import("@/app/api/admin/audit/route");
    const req = buildRequest("/api/admin/audit", {
      session: staff,
      query: { since: "not-a-date", until: "also-not-a-date" },
    });
    const res = await GET(req);
    const { status, body } = await readJson<{ totalDocs?: number }>(res);
    expect(status).toBe(200);
    expect(body.totalDocs).toBe(3);
  });

  it("combines action + since + targetType filters", async () => {
    const { staff } = await seedEvents();
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    const { GET } = await import("@/app/api/admin/audit/route");
    const req = buildRequest("/api/admin/audit", {
      session: staff,
      query: {
        action: "comment.hide",
        since: past,
        targetType: "comment",
      },
    });
    const res = await GET(req);
    const { status, body } = await readJson<{ totalDocs?: number }>(res);
    expect(status).toBe(200);
    expect(body.totalDocs).toBe(2);
  });
});
