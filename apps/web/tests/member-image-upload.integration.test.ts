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
} from "./harness.js";

import { POST as uploadPOST } from "@/app/api/members/media/upload/route";
import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as verifyPOST } from "@/app/api/members/verify/route";
import { POST as loginPOST } from "@/app/api/members/login/route";

import { NextRequest } from "next/server";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

function cookieValue(setCookie: string | string[] | null, name: string): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const line of headers) {
    const m = new RegExp(`${name}=([^;]+)`).exec(line);
    if (m) return m[1];
  }
  return undefined;
}

async function seedActiveMember(
  handle: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const password = "password-12345";
  const email = `${handle}@example.com`;
  await registerPOST(
    jsonRequest("/api/members/register", {
      method: "POST",
      body: JSON.stringify({ email, password, handle, displayName: handle }),
    }),
  );
  const db = await getTestDb();
  const { createMemberEmailVerifyToken, nxMembers } = await import("@nexpress/core");
  const { eq } = await import("drizzle-orm");
  const [row] = (await db
    .select({ id: nxMembers.id })
    .from(nxMembers)
    .where(eq(nxMembers.handle, handle))
    .limit(1)) as Array<{ id: string }>;
  const issued = await createMemberEmailVerifyToken(db as never, row.id, 60_000);
  await verifyPOST(
    jsonRequest("/api/members/verify", {
      method: "POST",
      body: JSON.stringify({ token: issued.token }),
    }),
  );
  const login = await loginPOST(
    jsonRequest("/api/members/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  );
  const setCookies = login.headers.get("set-cookie");
  return {
    memberId: row.id,
    sessionCookie: cookieValue(setCookies, "nx-mb-session")!,
    csrfCookie: cookieValue(setCookies, "nx-mb-csrf")!,
  };
}

/**
 * Build a multipart upload request. The Next.js test harness uses
 * the standard `FormData` and reads it back via `request.formData()`
 * inside the route — same code path a real browser would hit.
 */
function uploadRequest(
  member: { sessionCookie: string; csrfCookie: string } | null,
  file: { name: string; type: string; bytes: Uint8Array },
  options: { skipCsrf?: boolean } = {},
): NextRequest {
  const formData = new FormData();
  const blob = new Blob([file.bytes], { type: file.type });
  formData.append("file", blob, file.name);

  const cookies: string[] = [];
  if (member) {
    cookies.push(`nx-mb-session=${member.sessionCookie}`);
    cookies.push(`nx-mb-csrf=${member.csrfCookie}`);
  }
  const headers = new Headers();
  if (cookies.length > 0) headers.set("cookie", cookies.join("; "));
  if (member && !options.skipCsrf) headers.set("x-csrf-token", member.csrfCookie);

  return new NextRequest("http://localhost:3000/api/members/media/upload", {
    method: "POST",
    headers,
    body: formData,
  });
}

// 1x1 transparent PNG (smallest valid PNG, used as the test fixture).
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe.skipIf(skipIfNoTestDb())("member image upload (Phase 9.7j)", () => {
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

  it("active member uploads an image — row stamps `uploaded_by_member_id`", async () => {
    const member = await seedActiveMember("upload-anna");

    const res = await uploadPOST(
      uploadRequest(member, { name: "tiny.png", type: "image/png", bytes: TINY_PNG }),
    );
    const body = await readJson<{ id?: string; status?: string; url?: string }>(res);
    expect(body.status).toBe(202);
    expect(body.body.id).toBeDefined();
    expect(body.body.status).toBe("processing");
    expect(typeof body.body.url).toBe("string");

    const db = await getTestDb();
    const { nxMedia } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const [row] = (await db
      .select({
        id: nxMedia.id,
        uploadedBy: nxMedia.uploadedBy,
        uploadedByMemberId: nxMedia.uploadedByMemberId,
        mimeType: nxMedia.mimeType,
      })
      .from(nxMedia)
      .where(eq(nxMedia.id, body.body.id!))
      .limit(1)) as Array<{
      id: string;
      uploadedBy: string | null;
      uploadedByMemberId: string | null;
      mimeType: string;
    }>;
    expect(row.uploadedBy).toBeNull();
    expect(row.uploadedByMemberId).toBe(member.memberId);
    expect(row.mimeType).toBe("image/png");
  });

  it("unauthenticated upload rejected (401)", async () => {
    const res = await uploadPOST(
      uploadRequest(null, { name: "anon.png", type: "image/png", bytes: TINY_PNG }),
    );
    expect(res.status).toBe(401);
  });

  it("missing CSRF rejected (401)", async () => {
    const member = await seedActiveMember("upload-csrf");
    const res = await uploadPOST(
      uploadRequest(member, { name: "csrf.png", type: "image/png", bytes: TINY_PNG }, {
        skipCsrf: true,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("non-image mime type rejected (400)", async () => {
    const member = await seedActiveMember("upload-mime");
    const res = await uploadPOST(
      uploadRequest(member, {
        name: "doc.pdf",
        type: "application/pdf",
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      }),
    );
    expect(res.status).toBe(400);
    const body = await readJson<{
      error?: { details?: Array<{ message?: string }> };
    }>(res);
    expect(body.body.error?.details?.[0]?.message).toContain("image");
  });

  it("oversized file rejected (400)", async () => {
    const member = await seedActiveMember("upload-size");
    // 6 MB of zero bytes — over the 5 MB cap.
    const oversized = new Uint8Array(6 * 1024 * 1024);
    const res = await uploadPOST(
      uploadRequest(member, { name: "big.png", type: "image/png", bytes: oversized }),
    );
    expect(res.status).toBe(400);
    const body = await readJson<{
      error?: { details?: Array<{ message?: string }> };
    }>(res);
    expect(body.body.error?.details?.[0]?.message).toContain("max size");
  });

  it("banned member rejected (403)", async () => {
    const admin = await seedUser({ role: "admin" });
    const member = await seedActiveMember("upload-banned");

    const { issueBan } = await import("@nexpress/core");
    await issueBan({
      memberId: member.memberId,
      scopeType: "site",
      kind: "permanent",
      reason: "test",
      actor: {
        kind: "staff",
        user: {
          id: admin.userId,
          email: admin.email,
          name: null,
          role: admin.role,
          tokenVersion: 0,
        },
      },
    });

    const res = await uploadPOST(
      uploadRequest(member, { name: "banned.png", type: "image/png", bytes: TINY_PNG }),
    );
    expect(res.status).toBe(403);

    // Confirm no row was inserted.
    const db = await getTestDb();
    const { nxMedia } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const rows = (await db
      .select()
      .from(nxMedia)
      .where(eq(nxMedia.uploadedByMemberId, member.memberId))) as Array<unknown>;
    expect(rows).toHaveLength(0);
  });

  it("upload missing the `file` field rejected (400)", async () => {
    const member = await seedActiveMember("upload-missing");
    const formData = new FormData();
    // No `file` appended — multipart body is empty.
    const headers = new Headers();
    headers.set(
      "cookie",
      `nx-mb-session=${member.sessionCookie}; nx-mb-csrf=${member.csrfCookie}`,
    );
    headers.set("x-csrf-token", member.csrfCookie);
    const req = new NextRequest("http://localhost:3000/api/members/media/upload", {
      method: "POST",
      headers,
      body: formData,
    });
    const res = await uploadPOST(req);
    expect(res.status).toBe(400);
  });
});

