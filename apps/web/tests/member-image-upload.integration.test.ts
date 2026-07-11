import { access } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedActiveMember as harnessSeedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { POST as uploadPOST } from "@/app/api/members/media/upload/route";
import { POST as staffUploadPOST } from "@/app/api/media/upload/route";

import { NextRequest } from "next/server";

interface CapturedMediaHook {
  hook: string;
  principal: unknown;
  member: unknown;
  file?: unknown;
  media?: unknown;
}

function jsonRequest(path: string, init: RequestInit & { cookies?: string[] } = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  if (init.cookies && init.cookies.length > 0) headers.set("cookie", init.cookies.join("; "));
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

async function seedActiveMember(
  handle: string,
): Promise<{ memberId: string; sessionCookie: string; csrfCookie: string }> {
  const session = await harnessSeedActiveMember({ handle });
  return {
    memberId: session.memberId,
    sessionCookie: session.sessionCookie,
    csrfCookie: session.csrfCookie,
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
    cookies.push(`np-mb-session=${member.sessionCookie}`);
    cookies.push(`np-mb-csrf=${member.csrfCookie}`);
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

function staffUploadRequest(
  user: { accessToken: string; csrfToken: string },
  file: { name: string; type: string; bytes: Uint8Array },
): NextRequest {
  const formData = new FormData();
  const blob = new Blob([file.bytes], { type: file.type });
  formData.append("file", blob, file.name);

  const headers = new Headers();
  headers.set("cookie", `np-session=${user.accessToken}; np-csrf=${user.csrfToken}`);
  headers.set("x-csrf-token", user.csrfToken);

  return new NextRequest("http://localhost:3000/api/media/upload", {
    method: "POST",
    headers,
    body: formData,
  });
}

async function registerMediaHookCapture(pluginId: string): Promise<CapturedMediaHook[]> {
  const { ensureFor } = await import("@/lib/init-core");
  const { loadPlugins } = await import("@nexpress/core");
  const { definePlugin } = await import("@nexpress/plugin-sdk");
  await ensureFor("plugins");

  const captured: CapturedMediaHook[] = [];
  await loadPlugins([
    definePlugin({
      manifest: {
        id: pluginId,
        version: "0.0.0",
        name: "Media hook capture",
        description: "Captures media hook actor payloads in tests",
        author: { name: "Test" },
        license: "MIT",
        nexpress: { minVersion: "0.1.0" },
        capabilities: ["hooks:media"],
        allowedHosts: [],
        provides: {
          blocks: [],
          collections: [],
          adminExtensions: [],
          apiRoutes: [],
          hooks: ["media:beforeUpload", "media:afterUpload"],
        },
        agent: { description: "test", category: "media", tags: [] },
        usesTokens: [],
        styleSlots: {},
      },
      hooks: {
        "media:beforeUpload": ({ hook, data }) => {
          captured.push({
            hook,
            principal: data.principal,
            member: data.member,
            file: data.file,
          });
        },
        "media:afterUpload": ({ hook, data }) => {
          captured.push({
            hook,
            principal: data.principal,
            member: data.member,
            media: data.media,
          });
        },
      },
    }),
  ]);
  return captured;
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
    const { npMedia } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const [row] = (await db
      .select({
        id: npMedia.id,
        uploadedBy: npMedia.uploadedBy,
        uploadedByMemberId: npMedia.uploadedByMemberId,
        mimeType: npMedia.mimeType,
        storageKey: npMedia.storageKey,
      })
      .from(npMedia)
      .where(eq(npMedia.id, body.body.id!))
      .limit(1)) as Array<{
      id: string;
      uploadedBy: string | null;
      uploadedByMemberId: string | null;
      mimeType: string;
      storageKey: string;
    }>;
    expect(row.uploadedBy).toBeNull();
    expect(row.uploadedByMemberId).toBe(member.memberId);
    expect(row.mimeType).toBe("image/png");

    const storageDirectory = process.env.NP_STORAGE_DIR;
    expect(storageDirectory).toBeDefined();
    expect(relative(process.cwd(), storageDirectory!).startsWith("..")).toBe(true);
    await expect(access(join(storageDirectory!, row.storageKey))).resolves.toBeUndefined();
    await expect(
      access(resolve(process.cwd(), "public/media", row.storageKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("member upload emits media hooks with the canonical member actor", async () => {
    const captured = await registerMediaHookCapture("test-member-media-hook-principal");
    const member = await seedActiveMember("upload-hook-member");

    const res = await uploadPOST(
      uploadRequest(member, { name: "hook-member.png", type: "image/png", bytes: TINY_PNG }),
    );
    expect(res.status).toBe(202);

    expect(captured.map((call) => call.hook)).toEqual(["media:beforeUpload", "media:afterUpload"]);
    for (const call of captured) {
      expect(call.principal).toEqual({ kind: "member", memberId: member.memberId });
      expect(call.member).toEqual(
        expect.objectContaining({
          id: member.memberId,
          handle: "upload-hook-member",
        }),
      );
    }
    expect(captured[0].file).toEqual(
      expect.objectContaining({ filename: "hook-member.png", mimeType: "image/png" }),
    );
    expect(captured[1].media).toEqual(expect.objectContaining({ id: expect.any(String) }));
  });

  it("staff upload emits media hooks with staff principal", async () => {
    const captured = await registerMediaHookCapture("test-staff-media-hook-principal");
    const editor = await seedUser({ role: "editor" });

    const res = await staffUploadPOST(
      staffUploadRequest(editor, { name: "hook-staff.png", type: "image/png", bytes: TINY_PNG }),
    );
    expect(res.status).toBe(202);

    expect(captured.map((call) => call.hook)).toEqual(["media:beforeUpload", "media:afterUpload"]);
    for (const call of captured) {
      expect(call.principal).toEqual({
        kind: "staff",
        user: expect.objectContaining({
          id: editor.userId,
          email: editor.email,
          role: editor.role,
        }),
      });
      expect(call.member).toBeNull();
    }
  });

  it("unauthenticated upload rejected (401)", async () => {
    const res = await uploadPOST(
      uploadRequest(null, { name: "anon.png", type: "image/png", bytes: TINY_PNG }),
    );
    expect(res.status).toBe(401);
  });

  // CSRF enforcement moved to apps/web/src/proxy.ts (#281); the
  // handler unit test no longer covers it because it bypasses the
  // proxy by calling the handler directly. Proxy-level coverage
  // belongs in an end-to-end test, not here.

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
    const { npMedia } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const rows = (await db
      .select()
      .from(npMedia)
      .where(eq(npMedia.uploadedByMemberId, member.memberId))) as Array<unknown>;
    expect(rows).toHaveLength(0);
  });

  it("upload missing the `file` field rejected (400)", async () => {
    const member = await seedActiveMember("upload-missing");
    const formData = new FormData();
    // No `file` appended — multipart body is empty.
    const headers = new Headers();
    headers.set("cookie", `np-mb-session=${member.sessionCookie}; np-mb-csrf=${member.csrfCookie}`);
    headers.set("x-csrf-token", member.csrfCookie);
    const req = new NextRequest("http://localhost:3000/api/members/media/upload", {
      method: "POST",
      headers,
      body: formData,
    });
    const res = await uploadPOST(req);
    expect(res.status).toBe(400);
  });

  // Issue #125 — the member upload endpoint trusted the client's
  // declared MIME and would happily store an SVG (active content)
  // under the requested type. Both the SVG-as-svg and the
  // PNG-claim-with-non-PNG-bytes variants must now be rejected
  // before storage so an attacker can't sneak an XSS payload into
  // a publicly-served `/uploads/...` URL.
  it("SVG upload is rejected even when declared as image/svg+xml (#125)", async () => {
    const member = await seedActiveMember("upload-svg");
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    );
    const res = await uploadPOST(
      uploadRequest(member, {
        name: "evil.svg",
        type: "image/svg+xml",
        bytes: svg,
      }),
    );
    expect(res.status).toBe(400);
    const body = await readJson<{
      error?: { details?: Array<{ message?: string }> };
    }>(res);
    // The MIME isn't in the raster allow-list, so the friendly
    // message is the "Only image uploads are accepted" one with
    // the comma-separated list of allowed types.
    expect(body.body.error?.details?.[0]?.message).toContain("png");
  });

  it("declared image/png with non-PNG bytes is rejected (#125)", async () => {
    const member = await seedActiveMember("upload-mismatch");
    // SVG bytes labelled as image/png — pre-fix, this would have
    // landed in storage with `Content-Type: image/png` and the
    // returned URL would have rendered the SVG inline.
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
    );
    const res = await uploadPOST(
      uploadRequest(member, {
        name: "fake.png",
        type: "image/png",
        bytes: svg,
      }),
    );
    expect(res.status).toBe(400);
    const body = await readJson<{
      error?: { details?: Array<{ message?: string }> };
    }>(res);
    expect(body.body.error?.details?.[0]?.message).toContain("don't match");
  });

  it("real GIF89a / WebP / JPEG bytes pass the magic-byte sniff", async () => {
    const member = await seedActiveMember("upload-formats");

    // GIF89a — minimal 1x1 transparent
    const tinyGif = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff,
      0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
      0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
    ]);
    const gifRes = await uploadPOST(
      uploadRequest(member, { name: "tiny.gif", type: "image/gif", bytes: tinyGif }),
    );
    expect(gifRes.status).toBe(202);

    // WebP — valid VP8 lossless 1x1 (RIFF…WEBP header is what we
    // actually verify; processor may post-fail but we only assert
    // the sniff lets it through).
    const tinyWebp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
      0x4c, 0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const webpRes = await uploadPOST(
      uploadRequest(member, {
        name: "tiny.webp",
        type: "image/webp",
        bytes: tinyWebp,
      }),
    );
    expect(webpRes.status).toBe(202);

    // JPEG — `FF D8 FF` start of image marker is enough for the
    // sniff. Sharp may reject it as truncated downstream, but that
    // turns into a `error` status on the row, not a 400 here.
    const tinyJpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);
    const jpegRes = await uploadPOST(
      uploadRequest(member, {
        name: "tiny.jpg",
        type: "image/jpeg",
        bytes: tinyJpeg,
      }),
    );
    expect(jpegRes.status).toBe(202);
  });
});
