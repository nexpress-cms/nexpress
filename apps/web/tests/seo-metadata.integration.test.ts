import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
  type TestUserSession,
} from "./harness.js";

import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/settings/route";

import { NextRequest } from "next/server";

function adminRequest(staff: TestUserSession, path: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers(init.headers);
  headers.set("cookie", `np-session=${staff.accessToken}; np-csrf=${staff.csrfToken}`);
  if (init.body) headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET") {
    headers.set("x-csrf-token", staff.csrfToken);
  }
  return new NextRequest(`http://localhost:3000${path}`, { ...init, headers });
}

describe.skipIf(skipIfNoTestDb())("site SEO metadata + settings (Phase 10.3)", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    // `getSiteSeoSettings` calls `getDb()`, which fails until
    // `setDb` runs. The other tests in the suite trigger that
    // via `seedUser` → the read bootstrap; tests below that
    // don't seed a user (the empty-defaults / canonical /
    // article cases) need an explicit kick.
    const { ensureFor } = await import("@/lib/init-core");
    await ensureFor("read");
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("buildPageMetadata falls back to site defaults when input is empty", async () => {
    const { buildPageMetadata } = await import("@nexpress/core");
    const meta = await buildPageMetadata({ path: "/" });
    expect(meta.title).toBe("Default site");
    expect(meta.openGraph?.siteName).toBe("Default site");
    expect(meta.alternates?.canonical).toBe("http://localhost:3000/");
    // No image set, no defaults → twitter card stays summary.
    expect(meta.twitter?.card).toBe("summary");
  });

  it("page-level title/description override site defaults; canonical is normalized", async () => {
    const { buildPageMetadata } = await import("@nexpress/core");
    const meta = await buildPageMetadata({
      title: "About",
      description: "All about us.",
      path: "/about/",
    });
    expect(meta.title).toBe("About · Default site");
    expect(meta.description).toBe("All about us.");
    // Trailing slash normalized off (canonical convention).
    expect(meta.alternates?.canonical).toBe("http://localhost:3000/about");
    expect(meta.openGraph?.title).toBe(meta.title);
  });

  it("article ogType emits publishedTime / modifiedTime", async () => {
    const { buildPageMetadata } = await import("@nexpress/core");
    const published = new Date("2026-01-15T12:00:00Z");
    const modified = new Date("2026-04-01T08:30:00Z");
    const meta = await buildPageMetadata({
      title: "Hello",
      ogType: "article",
      publishedTime: published,
      modifiedTime: modified,
    });
    expect(meta.openGraph?.type).toBe("article");
    expect(meta.openGraph?.publishedTime).toBe(published.toISOString());
    expect(meta.openGraph?.modifiedTime).toBe(modified.toISOString());
  });

  it("admin can write seo settings via /api/settings; site reads them back", async () => {
    const admin = await seedUser({ role: "admin" });
    const put = await settingsPUT(
      adminRequest(admin, "/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          key: "seo",
          value: {
            defaultOgImage: "/og.png",
            twitterHandle: "nexpress",
            defaultLocale: "en_US",
          },
        }),
      }),
    );
    expect(put.status).toBe(200);

    const { getSiteSeoSettings, buildPageMetadata } = await import("@nexpress/core");
    const settings = await getSiteSeoSettings();
    expect(settings.defaultOgImage).toBe("/og.png");
    expect(settings.twitterHandle).toBe("nexpress");

    const meta = await buildPageMetadata({ title: "Hello", path: "/" });
    // /og.png gets joined to site origin and surfaced in OG + twitter.
    expect(meta.openGraph?.images?.[0]?.url).toBe("http://localhost:3000/og.png");
    expect(meta.twitter?.images?.[0]).toBe("http://localhost:3000/og.png");
    expect(meta.twitter?.card).toBe("summary_large_image");
    // Twitter site handle gets the @ prefix re-added.
    expect(meta.twitter?.site).toBe("@nexpress");
  });

  it("writes and reads the exact canonical site identity without legacy setting rows", async () => {
    const admin = await seedUser({ role: "admin" });
    const value = {
      name: "Acme",
      url: "https://example.com",
      description: "Canonical site identity",
      defaultLocale: "ko-KR",
      timezone: "Asia/Seoul",
    };
    const put = await settingsPUT(
      adminRequest(admin, "/api/settings", {
        method: "PUT",
        body: JSON.stringify({ key: "site", value }),
      }),
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ key: "site", value });

    const get = await settingsGET(adminRequest(admin, "/api/settings"));
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({
      site: value,
      seo: {
        defaultOgImage: null,
        twitterHandle: null,
        defaultLocale: "en_US",
      },
    });

    const { npSettings, npSites } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    const db = getDb();
    const [site] = await db.select().from(npSites);
    expect(site).toMatchObject({
      name: "Acme",
      description: "Canonical site identity",
      settings: {
        siteUrl: "https://example.com",
        defaultLocale: "ko-KR",
        timezone: "Asia/Seoul",
      },
    });
    expect((await db.select().from(npSettings)).filter((row) => row.key === "site")).toEqual([]);
  });

  it("rejects unknown general-setting keys and extra request fields", async () => {
    const admin = await seedUser({ role: "admin" });
    for (const body of [
      { key: "description", value: "legacy" },
      {
        key: "site",
        value: {
          name: "Default site",
          url: null,
          description: null,
          defaultLocale: null,
          timezone: null,
        },
        typo: true,
      },
    ]) {
      const response = await settingsPUT(
        adminRequest(admin, "/api/settings", {
          method: "PUT",
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("fails closed when persisted SEO settings violate the registry", async () => {
    const admin = await seedUser({ role: "admin" });
    const { npSettings } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    await getDb()
      .insert(npSettings)
      .values({
        key: "seo",
        value: { defaultOgImage: "javascript:alert(1)" },
      });

    const response = await settingsGET(adminRequest(admin, "/api/settings"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: "Invalid persisted SEO settings" },
    });
  });

  it("does not silently canonicalize persisted SEO settings", async () => {
    const admin = await seedUser({ role: "admin" });
    const { npSettings } = await import("@nexpress/core");
    const { getDb } = await import("@nexpress/core/db");
    await getDb()
      .insert(npSettings)
      .values({
        key: "seo",
        value: {
          defaultOgImage: null,
          twitterHandle: "@nexpress",
          defaultLocale: "en-US",
        },
      });

    const response = await settingsGET(adminRequest(admin, "/api/settings"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: "Invalid persisted SEO settings" },
    });
  });

  it("validator rejects javascript: URLs and stray protocols on defaultOgImage", async () => {
    const admin = await seedUser({ role: "admin" });
    const res = await settingsPUT(
      adminRequest(admin, "/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          key: "seo",
          value: {
            defaultOgImage: "javascript:alert(1)",
            twitterHandle: null,
            defaultLocale: "en_US",
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error?: { details?: Array<{ message?: string }> };
    };
    expect(body.error?.details?.[0]?.message).toMatch(/HTTP\(S\) URL or a \/-rooted path/);
  });

  it("validator rejects malformed Twitter handles", async () => {
    const admin = await seedUser({ role: "admin" });
    const res = await settingsPUT(
      adminRequest(admin, "/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          key: "seo",
          // Spaces in a handle — invalid.
          value: {
            defaultOgImage: null,
            twitterHandle: "with spaces",
            defaultLocale: "en_US",
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("non-admin GET /api/settings is rejected (existing gate)", async () => {
    const editor = await seedUser({ role: "editor" });
    const res = await settingsGET(adminRequest(editor, "/api/settings"));
    // The existing GET handler is admin-only; verify our changes
    // don't loosen it accidentally.
    expect(res.status).toBe(403);
  });
});
