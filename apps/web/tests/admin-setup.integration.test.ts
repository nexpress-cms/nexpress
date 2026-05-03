import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  readJson,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

describe.skipIf(skipIfNoTestDb())("first-boot Admin Setup wizard", () => {
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

  it("GET /api/admin/setup reports available=true on a fresh DB", async () => {
    const { GET } = await import("@/app/api/admin/setup/route");
    const { status, body } = await readJson<{ data: { available: boolean } }>(
      await GET(),
    );
    expect(status).toBe(200);
    expect(body.data.available).toBe(true);
  });

  it("POST /api/admin/setup creates the first admin and issues a session", async () => {
    const { POST } = await import("@/app/api/admin/setup/route");
    const req = buildRequest("/api/admin/setup", {
      method: "POST",
      body: {
        email: "founder@example.com",
        password: "correct horse battery",
        name: "Founder",
        siteName: "Acme",
        sampleContent: false,
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/nx-session=/);
    expect(setCookie).toMatch(/nx-csrf=/);

    const { getDb } = await import("@/lib/db");
    const { nxUsers, getSiteById, NX_DEFAULT_SITE_ID } = await import(
      "@nexpress/core"
    );
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select({ email: nxUsers.email, role: nxUsers.role })
      .from(nxUsers)
      .where(eq(nxUsers.email, "founder@example.com"));
    expect(rows[0]?.role).toBe("admin");
    const site = await getSiteById(NX_DEFAULT_SITE_ID);
    expect(site?.name).toBe("Acme");
  });

  it("rejects a second setup once an admin already exists (409)", async () => {
    const { POST } = await import("@/app/api/admin/setup/route");
    const first = await POST(
      buildRequest("/api/admin/setup", {
        method: "POST",
        body: {
          email: "first@example.com",
          password: "correct horse battery",
          sampleContent: false,
        },
      }),
    );
    expect(first.status).toBe(200);

    const second = await POST(
      buildRequest("/api/admin/setup", {
        method: "POST",
        body: {
          email: "second@example.com",
          password: "correct horse battery",
          sampleContent: false,
        },
      }),
    );
    expect(second.status).toBe(409);
  });

  it("validates input (short password → 400)", async () => {
    const { POST } = await import("@/app/api/admin/setup/route");
    const res = await POST(
      buildRequest("/api/admin/setup", {
        method: "POST",
        body: { email: "x@example.com", password: "short" },
      }),
    );
    expect(res.status).toBe(400);
  });
});
