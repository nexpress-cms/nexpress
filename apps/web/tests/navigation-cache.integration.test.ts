import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { npNavigation } from "@nexpress/core";

import {
  buildRequest,
  closeTestDb,
  ensureMigrated,
  getTestDb,
  readJson,
  registerTestCollections,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

import { GET as openApiGET } from "@/app/api/openapi.json/route";

/**
 * Phase 14.3 — navigation PUT round-trip + cached read.
 *
 *   1. PUT /api/navigation persists the items and returns the
 *      stored row. Pinned because navigation had no integration
 *      coverage before — saving was the only mutation that
 *      didn't fire any cache invalidation.
 *   2. The `getCachedNavigation` helper reads what the API
 *      wrote. The cache wrapper falls through to the uncached
 *      read in the test harness (no Next incremental cache),
 *      so this also exercises the fallback path.
 */
describe.skipIf(skipIfNoTestDb())("navigation cache (Phase 14.3)", () => {
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

  it("PUT /api/navigation persists items and getCachedNavigation reads them back", async () => {
    const admin = await seedUser({ role: "admin" });
    const { PUT } = await import("@/app/api/navigation/route");

    const req = buildRequest("/api/navigation", {
      session: admin,
      method: "PUT",
      body: {
        location: "header",
        items: [
          { id: "blog", type: "link", label: "Blog", url: "/blog" },
          { id: "about", type: "link", label: "About", url: "/about" },
        ],
      },
    });
    const res = await PUT(req);
    const { status, body } = await readJson<{
      location?: string;
      items?: Array<{ label: string }>;
    }>(res);
    expect(status).toBe(200);
    expect(body.location).toBe("header");
    expect(body.items?.map((i) => i.label)).toEqual(["Blog", "About"]);
    expect(body).not.toHaveProperty("siteId");
    expect(body).not.toHaveProperty("updatedBy");

    // The cached helper falls through to the uncached read when
    // Next's incremental cache isn't reachable (test harness),
    // so we get the freshly-persisted row even without a tag bust.
    const { getCachedNavigation } = await import("@nexpress/next");
    const items = await getCachedNavigation("header");
    expect(items.map((i) => i.label)).toEqual(["Blog", "About"]);
  });

  it("rejects non-admin PUTs (admin-only gate)", async () => {
    const editor = await seedUser({ role: "editor" });
    const { PUT } = await import("@/app/api/navigation/route");

    const req = buildRequest("/api/navigation", {
      session: editor,
      method: "PUT",
      body: { location: "header", items: [] },
    });
    const res = await PUT(req);
    const { status } = await readJson(res);
    expect(status).toBe(403);
  });

  it("validates the items shape (rejects malformed entries)", async () => {
    const admin = await seedUser({ role: "admin" });
    const { PUT } = await import("@/app/api/navigation/route");

    const req = buildRequest("/api/navigation", {
      session: admin,
      method: "PUT",
      body: {
        location: "header",
        items: [{ label: "missing id and type" }],
      },
    });
    const res = await PUT(req);
    const { status } = await readJson(res);
    expect(status).toBe(400);
  });

  it("rejects cross-kind fields, duplicate ids, unsafe URLs, excess depth, and invalid locations", async () => {
    const admin = await seedUser({ role: "admin" });
    const { PUT } = await import("@/app/api/navigation/route");
    const invalidBodies: unknown[] = [
      {
        location: "header",
        items: [{ id: "page", label: "Page", type: "page", pageId: "page", url: "/bad" }],
      },
      {
        location: "header",
        items: [
          {
            id: "same",
            label: "Parent",
            type: "link",
            url: "/",
            children: [{ id: "same", label: "Child", type: "link", url: "/child" }],
          },
        ],
      },
      {
        location: "header",
        items: [{ id: "unsafe", label: "Unsafe", type: "link", url: "javascript:alert(1)" }],
      },
      {
        location: "header",
        items: [
          {
            id: "one",
            label: "One",
            type: "link",
            url: "/one",
            children: [
              {
                id: "two",
                label: "Two",
                type: "link",
                url: "/two",
                children: [{ id: "three", label: "Three", type: "link", url: "/three" }],
              },
            ],
          },
        ],
      },
      { location: "Bad Location", items: [] },
      { location: 123, items: [] },
      { location: " footer ", items: [] },
      { location: "bad--location", items: [] },
    ];

    for (const body of invalidBodies) {
      const response = await PUT(
        buildRequest("/api/navigation", { session: admin, method: "PUT", body }),
      );
      expect(response.status).toBe(400);
    }

    const db = await getTestDb();
    expect(await db.select().from(npNavigation)).toHaveLength(0);
  });

  it("rejects noncanonical rename and delete locations instead of normalizing them", async () => {
    const admin = await seedUser({ role: "admin" });
    const { DELETE, PATCH } = await import("@/app/api/navigation/route");

    const rename = await PATCH(
      buildRequest("/api/navigation", {
        session: admin,
        method: "PATCH",
        query: { location: " custom-location " },
        body: { newLocation: "renamed-location" },
      }),
    );
    expect(rename.status).toBe(400);

    const remove = await DELETE(
      buildRequest("/api/navigation", {
        session: admin,
        method: "DELETE",
        query: { location: " custom-location " },
      }),
    );
    expect(remove.status).toBe(400);
  });

  it("fails closed when a malformed persisted tree is read", async () => {
    const db = await getTestDb();
    await db.insert(npNavigation).values({
      location: "broken",
      items: [{ id: "unsafe", label: "Unsafe", type: "link", url: "javascript:alert(1)" }],
    });
    const { GET } = await import("@/app/api/navigation/route");
    const response = await GET(buildRequest("/api/navigation", { query: { location: "broken" } }));
    const { status, body } = await readJson<{
      error: { code: string; details: Array<{ field: string }> };
    }>(response);
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0]?.field).toBe("navigation.broken.items.0.url");
    const { getNavigation } = await import("@nexpress/core");
    await expect(getNavigation("broken")).rejects.toMatchObject({
      name: "NpValidationError",
      errors: [expect.objectContaining({ field: "navigation.broken.items.0.url" })],
    });
  });

  it("revalidates theme navigation at the seed write boundary", async () => {
    const admin = await seedUser({ role: "admin" });
    const { seedNavigation } = await import("@/lib/seed-content");
    await expect(
      seedNavigation(
        {
          id: admin.userId,
          email: admin.email,
          name: "Admin",
          role: admin.role,
          tokenVersion: 0,
        },
        {
          header: [{ id: "unsafe", label: "Unsafe", type: "link", url: "javascript:alert(1)" }],
        },
      ),
    ).rejects.toMatchObject({ name: "NpValidationError" });
    const db = await getTestDb();
    expect(await db.select().from(npNavigation)).toHaveLength(0);
  });

  it("publishes the same exact discriminated tree through OpenAPI", async () => {
    const response = await openApiGET();
    const { body } = await readJson<{
      components: {
        schemas: {
          navigation_item: {
            oneOf: Array<{
              additionalProperties: boolean;
              required: string[];
              properties: { type: { enum: string[] } };
            }>;
          };
          navigation_items: { maxItems: number; items: { $ref: string } };
          navigation_payload: { additionalProperties: boolean };
        };
      };
      paths: {
        "/api/navigation": {
          get: { security: unknown[] };
          put: {
            requestBody: {
              content: { "application/json": { schema: { additionalProperties: boolean } } };
            };
          };
        };
      };
    }>(response);
    const schemas = body.components.schemas;
    expect(schemas.navigation_item.oneOf).toHaveLength(3);
    expect(schemas.navigation_item.oneOf.map((entry) => entry.properties.type.enum[0])).toEqual([
      "link",
      "collection",
      "page",
    ]);
    expect(schemas.navigation_item.oneOf.every((entry) => !entry.additionalProperties)).toBe(true);
    expect(schemas.navigation_items.maxItems).toBe(200);
    expect(schemas.navigation_items.items.$ref).toBe("#/components/schemas/navigation_item");
    expect(schemas.navigation_payload.additionalProperties).toBe(false);
    expect(body.paths["/api/navigation"].get.security).toEqual([]);
    expect(
      body.paths["/api/navigation"].put.requestBody.content["application/json"].schema
        .additionalProperties,
    ).toBe(false);
  });
});
