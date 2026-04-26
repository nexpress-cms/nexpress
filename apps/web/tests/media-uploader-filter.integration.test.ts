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

import { GET as mediaListGET } from "@/app/api/media/route";
import { POST as memberUploadPOST } from "@/app/api/members/media/upload/route";
import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as verifyPOST } from "@/app/api/members/verify/route";
import { POST as loginPOST } from "@/app/api/members/login/route";

import { NextRequest } from "next/server";

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (
    !headers.has("content-type") &&
    init.body &&
    typeof init.body === "string"
  ) {
    headers.set("content-type", "application/json");
  }
  if (init.cookies && init.cookies.length > 0) {
    headers.set("cookie", init.cookies.join("; "));
  }
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

function staffRequest(
  path: string,
  user: TestUserSession,
  init: RequestInit = {},
): NextRequest {
  return jsonRequest(path, {
    ...init,
    cookies: [`nx-session=${user.accessToken}`, `nx-csrf=${user.csrfToken}`],
    headers: { ...(init.headers ?? {}), "x-csrf-token": user.csrfToken },
  });
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

async function memberUpload(
  member: { sessionCookie: string; csrfCookie: string },
  filename: string,
): Promise<string> {
  const formData = new FormData();
  // 1x1 PNG
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  formData.append("file", new Blob([png], { type: "image/png" }), filename);
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
  const res = await memberUploadPOST(req);
  const body = await readJson<{ id?: string }>(res);
  if (body.status !== 202) {
    throw new Error(`memberUpload failed (${body.status}): ${JSON.stringify(body.body)}`);
  }
  return body.body.id!;
}

async function staffUploadDirect(staffUserId: string, filename: string): Promise<string> {
  // Staff uploads via `uploadMedia` directly — exercising the real
  // /api/media/upload route would require multipart auth fixtures we
  // already have via `memberUpload`; for the listMedia filter test
  // we just need a row stamped with `uploaded_by`.
  const { uploadMedia } = await import("@nexpress/core");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const result = await uploadMedia(
    { buffer: png, originalFilename: filename, mimeType: "image/png" },
    staffUserId,
  );
  return result.id;
}

describe.skipIf(skipIfNoTestDb())("media uploader filters (Phase 9.7k)", () => {
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

  it("`uploaderKind=member` returns only member-uploaded rows; staff JOIN row is null on member rows", async () => {
    const editor = await seedUser({ role: "editor" });
    const member = await seedActiveMember("filt-anna");

    await staffUploadDirect(editor.userId, "staff-1.png");
    await memberUpload(member, "member-1.png");

    const res = await mediaListGET(
      staffRequest("/api/media?uploaderKind=member", editor),
    );
    const body = await readJson<{
      docs: Array<{
        id: string;
        filename: string;
        uploadedBy: string | null;
        uploadedByMemberId: string | null;
        uploader: {
          kind: "member" | "staff";
          handle?: string;
        } | null;
      }>;
      totalDocs: number;
    }>(res);
    expect(body.status).toBe(200);
    expect(body.body.totalDocs).toBe(1);
    expect(body.body.docs[0].filename).toBe("member-1.png");
    expect(body.body.docs[0].uploadedByMemberId).toBe(member.memberId);
    expect(body.body.docs[0].uploadedBy).toBeNull();
    expect(body.body.docs[0].uploader?.kind).toBe("member");
    expect(body.body.docs[0].uploader?.handle).toBe("filt-anna");
  });

  it("`uploaderKind=staff` returns only staff-uploaded rows; member JOIN is null on staff rows", async () => {
    const editor = await seedUser({ role: "editor" });
    const member = await seedActiveMember("filt-bea");

    await staffUploadDirect(editor.userId, "staff-2.png");
    await memberUpload(member, "member-2.png");

    const res = await mediaListGET(
      staffRequest("/api/media?uploaderKind=staff", editor),
    );
    const body = await readJson<{
      docs: Array<{
        filename: string;
        uploader: { kind: "member" | "staff" } | null;
      }>;
      totalDocs: number;
    }>(res);
    expect(body.status).toBe(200);
    expect(body.body.totalDocs).toBe(1);
    expect(body.body.docs[0].filename).toBe("staff-2.png");
    expect(body.body.docs[0].uploader?.kind).toBe("staff");
  });

  it("no uploader filter returns both kinds with enriched rows", async () => {
    const editor = await seedUser({ role: "editor" });
    const member = await seedActiveMember("filt-mix");

    await staffUploadDirect(editor.userId, "staff-3.png");
    await memberUpload(member, "member-3.png");

    const res = await mediaListGET(staffRequest("/api/media", editor));
    const body = await readJson<{
      docs: Array<{
        filename: string;
        uploader: { kind: "member" | "staff" } | null;
      }>;
      totalDocs: number;
    }>(res);
    expect(body.body.totalDocs).toBe(2);
    const kinds = body.body.docs.map((d) => d.uploader?.kind).sort();
    expect(kinds).toEqual(["member", "staff"]);
  });

  it("`uploadedByMemberId` narrows to one member's uploads", async () => {
    const editor = await seedUser({ role: "editor" });
    const a = await seedActiveMember("narrow-a");
    const b = await seedActiveMember("narrow-b");

    await memberUpload(a, "from-a-1.png");
    await memberUpload(a, "from-a-2.png");
    await memberUpload(b, "from-b-1.png");

    const res = await mediaListGET(
      staffRequest(`/api/media?uploadedByMemberId=${a.memberId}`, editor),
    );
    const body = await readJson<{
      docs: Array<{ filename: string; uploader: { kind: "member"; handle: string } | null }>;
      totalDocs: number;
    }>(res);
    expect(body.body.totalDocs).toBe(2);
    expect(body.body.docs.every((d) => d.uploader?.handle === "narrow-a")).toBe(true);
  });

  it("invalid `uploaderKind` value is treated as no filter (no 400)", async () => {
    const editor = await seedUser({ role: "editor" });
    const member = await seedActiveMember("typo-typo");
    await memberUpload(member, "typo.png");

    const res = await mediaListGET(
      staffRequest("/api/media?uploaderKind=hackers", editor),
    );
    const body = await readJson<{ totalDocs: number }>(res);
    expect(body.status).toBe(200);
    // Filter ignored — the one member row is returned.
    expect(body.body.totalDocs).toBe(1);
  });

  it("non-mod staff (author role) is forbidden by the existing media list gate", async () => {
    // Pre-existing behavior: GET /api/media requires `editor` role.
    // Just confirming 9.7k didn't change that.
    const author = await seedUser({ role: "author" });
    const res = await mediaListGET(
      staffRequest("/api/media?uploaderKind=member", author),
    );
    expect(res.status).toBe(403);
  });
});
