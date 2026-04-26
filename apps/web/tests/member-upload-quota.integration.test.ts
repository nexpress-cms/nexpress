import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { POST as uploadPOST } from "@/app/api/members/media/upload/route";
import { POST as registerPOST } from "@/app/api/members/register/route";
import { POST as verifyPOST } from "@/app/api/members/verify/route";
import { POST as loginPOST } from "@/app/api/members/login/route";

import { NextRequest } from "next/server";

function jsonRequest(
  path: string,
  init: RequestInit & { cookies?: string[] } = {},
): NextRequest {
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

function uploadRequest(member: {
  sessionCookie: string;
  csrfCookie: string;
}): NextRequest {
  const formData = new FormData();
  const blob = new Blob([TINY_PNG], { type: "image/png" });
  formData.append("file", blob, "image.png");
  const headers = new Headers();
  headers.set(
    "cookie",
    `nx-mb-session=${member.sessionCookie}; nx-mb-csrf=${member.csrfCookie}`,
  );
  headers.set("x-csrf-token", member.csrfCookie);
  return new NextRequest("http://localhost:3000/api/members/media/upload", {
    method: "POST",
    headers,
    body: formData,
  });
}

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe.skipIf(skipIfNoTestDb())("member upload quota (Phase 9.7p)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  // Reset community settings between tests so a quota set in one
  // case doesn't leak into the next. `truncateAll` already clears
  // `nx_settings`, so this is belt-and-braces.
  afterEach(async () => {
    const db = await getTestDb();
    const { nxSettings } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    await db.delete(nxSettings).where(eq(nxSettings.key, "community"));
  });
  afterAll(async () => {
    await closeTestDb();
  });

  async function setQuota(quota: {
    perDay?: number | null;
    total?: number | null;
  }): Promise<void> {
    const { updateCommunitySettings } = await import("@nexpress/core");
    await updateCommunitySettings({ memberUploadQuota: quota }, null);
  }

  it("default settings (no quota): member uploads succeed indefinitely", async () => {
    const member = await seedActiveMember("quota-anna");
    for (let i = 0; i < 3; i++) {
      const res = await uploadPOST(uploadRequest(member));
      expect(res.status).toBe(202);
    }
  });

  it("`perDay` cap: 3rd upload within 24h is refused with 429", async () => {
    await setQuota({ perDay: 2, total: null });
    const member = await seedActiveMember("quota-bea");

    const a = await uploadPOST(uploadRequest(member));
    expect(a.status).toBe(202);
    const b = await uploadPOST(uploadRequest(member));
    expect(b.status).toBe(202);

    const c = await uploadPOST(uploadRequest(member));
    expect(c.status).toBe(429);
    const body = await readJson<{ error?: { code?: string; message?: string } }>(c);
    expect(body.body.error?.code).toBe("RATE_LIMITED");
    expect(body.body.error?.message).toContain("rate limit");
  });

  it("`total` cap: lifetime limit refuses upload past the cap with 429", async () => {
    await setQuota({ perDay: null, total: 1 });
    const member = await seedActiveMember("quota-carl");

    const ok = await uploadPOST(uploadRequest(member));
    expect(ok.status).toBe(202);

    const denied = await uploadPOST(uploadRequest(member));
    expect(denied.status).toBe(429);
    const body = await readJson<{ error?: { message?: string } }>(denied);
    expect(body.body.error?.message).toContain("lifetime cap");
  });

  it("soft-deleted media frees up `total` quota — operator purge restores headroom", async () => {
    await setQuota({ perDay: null, total: 1 });
    const member = await seedActiveMember("quota-dora");

    const first = await uploadPOST(uploadRequest(member));
    expect(first.status).toBe(202);
    const firstBody = await readJson<{ id: string }>(first);
    const mediaId = firstBody.body.id;

    // Soft-delete the row (mirrors what `deleteMedia` does — set
    // `deletedAt`). The next upload should now pass because the
    // quota count filters by `deletedAt IS NULL`.
    const db = await getTestDb();
    const { nxMedia } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    await db
      .update(nxMedia)
      .set({ deletedAt: new Date() })
      .where(eq(nxMedia.id, mediaId));

    const retry = await uploadPOST(uploadRequest(member));
    expect(retry.status).toBe(202);
  });

  it("`perDay` window is rolling 24h — old uploads outside the window don't count", async () => {
    await setQuota({ perDay: 2, total: null });
    const member = await seedActiveMember("quota-eric");

    // Upload one row, then back-date it past the 24h window so it
    // doesn't count toward today's allowance.
    const old = await uploadPOST(uploadRequest(member));
    expect(old.status).toBe(202);
    const oldBody = await readJson<{ id: string }>(old);
    const db = await getTestDb();
    const { nxMedia } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db
      .update(nxMedia)
      .set({ createdAt: longAgo })
      .where(eq(nxMedia.id, oldBody.body.id));

    // Two more should now pass; a fourth would bump us to perDay=3.
    const a = await uploadPOST(uploadRequest(member));
    expect(a.status).toBe(202);
    const b = await uploadPOST(uploadRequest(member));
    expect(b.status).toBe(202);
    const c = await uploadPOST(uploadRequest(member));
    expect(c.status).toBe(429);
  });

  it("staff uploads are NOT gated — quota only applies to members", async () => {
    // Direct call to `uploadMedia` with a staff uploader. Even
    // with a perDay=0 quota that would block any member, staff
    // sail through.
    await setQuota({ perDay: 0, total: 0 });
    const { uploadMedia, hashPassword, nxUsers } = await import("@nexpress/core");
    const db = await getTestDb();
    const password = await hashPassword("password12345");
    const [user] = (await db
      .insert(nxUsers)
      .values({ email: "quota-staff@example.com", password, name: "S", role: "editor" })
      .returning({ id: nxUsers.id })) as Array<{ id: string }>;

    const result = await uploadMedia(
      {
        buffer: Buffer.from(TINY_PNG),
        originalFilename: "staff.png",
        mimeType: "image/png",
      },
      { kind: "staff", userId: user.id },
    );
    expect(result.status).toBe("processing");
  });

  it("validation rejects negative or non-integer quota values", async () => {
    const { validateCommunitySettingsPatch, getCommunitySettings, NxValidationError } =
      await import("@nexpress/core");
    const current = await getCommunitySettings();

    const expectFieldError = (patch: unknown, field: string): void => {
      try {
        validateCommunitySettingsPatch(current, patch);
        throw new Error("expected validation to throw");
      } catch (err) {
        if (!(err instanceof NxValidationError)) throw err;
        const detail = err.errors.find((e) => e.field === field);
        expect(detail).toBeDefined();
        expect(detail?.message).toMatch(/non-negative integer/);
      }
    };

    expectFieldError(
      { memberUploadQuota: { perDay: -1 } },
      "memberUploadQuota.perDay",
    );
    expectFieldError(
      { memberUploadQuota: { total: 1.5 } },
      "memberUploadQuota.total",
    );

    // Null is fine — it means "unlimited".
    const ok = validateCommunitySettingsPatch(current, {
      memberUploadQuota: { perDay: null, total: 100 },
    });
    expect(ok.memberUploadQuota.perDay).toBeNull();
    expect(ok.memberUploadQuota.total).toBe(100);
  });
});
