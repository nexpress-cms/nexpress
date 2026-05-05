import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedActiveMember as harnessSeedActiveMember,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { POST as uploadPOST } from "@/app/api/members/media/upload/route";

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
  // `np_settings`, so this is belt-and-braces.
  afterEach(async () => {
    const db = await getTestDb();
    const { npSettings } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    await db.delete(npSettings).where(eq(npSettings.key, "community"));
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
    const { npMedia } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    await db
      .update(npMedia)
      .set({ deletedAt: new Date() })
      .where(eq(npMedia.id, mediaId));

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
    const { npMedia } = await import("@nexpress/core");
    const { eq } = await import("drizzle-orm");
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db
      .update(npMedia)
      .set({ createdAt: longAgo })
      .where(eq(npMedia.id, oldBody.body.id));

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
    const { uploadMedia, hashPassword, npUsers } = await import("@nexpress/core");
    const db = await getTestDb();
    const password = await hashPassword("password12345");
    const [user] = (await db
      .insert(npUsers)
      .values({ email: "quota-staff@example.com", password, name: "S", role: "editor" })
      .returning({ id: npUsers.id })) as Array<{ id: string }>;

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
    const { validateCommunitySettingsPatch, getCommunitySettings, NpValidationError } =
      await import("@nexpress/core");
    const current = await getCommunitySettings();

    const expectFieldError = (patch: unknown, field: string): void => {
      try {
        validateCommunitySettingsPatch(current, patch);
        throw new Error("expected validation to throw");
      } catch (err) {
        if (!(err instanceof NpValidationError)) throw err;
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

  // Issue #120 — pre-fix the count happened outside any lock or
  // transaction, so two concurrent uploads for the same member
  // could both observe the same pre-insert count and both succeed
  // past the cap. With the advisory-lock transaction added by the
  // fix, the second uploader's count sees the first's row and
  // throws.
  it("concurrent uploads for the same member can't bypass the cap (#120)", async () => {
    await setQuota({ perDay: null, total: 1 });
    const member = await seedActiveMember("quota-race");

    // Fire two uploads in parallel. With the lock in place, the
    // first acquires the lock and inserts; the second waits, sees
    // the inserted row, and throws 429.
    const results = await Promise.all([
      uploadPOST(uploadRequest(member)),
      uploadPOST(uploadRequest(member)),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // One success (202) and one quota-rejected (429).
    expect(statuses).toEqual([202, 429]);

    // Sanity: exactly one row in the DB despite the race.
    const db = await getTestDb();
    const { npMedia } = await import("@nexpress/core");
    const { and, eq, isNull } = await import("drizzle-orm");
    const rows = (await db
      .select()
      .from(npMedia)
      .where(
        and(
          eq(npMedia.uploadedByMemberId, member.memberId),
          isNull(npMedia.deletedAt),
        ),
      )) as Array<unknown>;
    expect(rows).toHaveLength(1);
  });

  it("concurrent uploads for DIFFERENT members don't contend (#120)", async () => {
    // Sanity that the per-member advisory lock doesn't serialize
    // unrelated uploaders. Both members have a quota of 1, both
    // upload concurrently, both should succeed because the lock
    // keys differ.
    await setQuota({ perDay: null, total: 1 });
    const a = await seedActiveMember("quota-race-a");
    const b = await seedActiveMember("quota-race-b");

    const results = await Promise.all([
      uploadPOST(uploadRequest(a)),
      uploadPOST(uploadRequest(b)),
    ]);
    expect(results.map((r) => r.status)).toEqual([202, 202]);
  });

  // Issue #138 — `uploadMedia` inserts the `np_media` row before
  // calling `adapter.upload`. If the storage call throws, the
  // pre-fix code left a permanent `processing` row that counted
  // against quota forever (no job was enqueued, no processor
  // would ever mark it `error`). The fix wraps the upload call
  // in try/catch and hard-deletes the row on failure.
  it("storage failure rolls back the row so quota stays correct (#138)", async () => {
    const core = await import("@nexpress/core");
    const original = core.getStorageAdapter();

    // Wrap the real adapter so reads still work (the test infra
    // never reads back the bytes for these uploads), but uploads
    // throw the way an S3 5xx would.
    const failingAdapter: typeof original = {
      upload: () => Promise.reject(new Error("simulated storage outage")),
      getStream: original.getStream.bind(original),
      getUrl: original.getUrl.bind(original),
      delete: original.delete.bind(original),
      exists: original.exists.bind(original),
    };
    core.setStorageAdapter(failingAdapter);

    try {
      await setQuota({ perDay: null, total: 2 });
      const member = await seedActiveMember("quota-storage-fail");

      // First upload — storage fails, row should be cleaned up.
      const failed = await uploadPOST(uploadRequest(member));
      // The route maps the thrown error to a 500 (or whatever
      // `npErrorResponse` produces for a non-`NpError` throw).
      expect(failed.status).toBeGreaterThanOrEqual(500);

      // Restore the working adapter and confirm the member can
      // still upload TWO times — i.e. the failed attempt did NOT
      // eat their quota allowance.
      core.setStorageAdapter(original);

      const ok1 = await uploadPOST(uploadRequest(member));
      expect(ok1.status).toBe(202);
      const ok2 = await uploadPOST(uploadRequest(member));
      expect(ok2.status).toBe(202);

      // Sanity: the failed row didn't survive in the DB.
      const db = await getTestDb();
      const { npMedia } = await import("@nexpress/core");
      const { and, eq, isNull } = await import("drizzle-orm");
      const live = (await db
        .select()
        .from(npMedia)
        .where(
          and(
            eq(npMedia.uploadedByMemberId, member.memberId),
            isNull(npMedia.deletedAt),
          ),
        )) as Array<unknown>;
      expect(live).toHaveLength(2);
    } finally {
      core.setStorageAdapter(original);
    }
  });
});
