import { npPluginStorage, withCurrentSite } from "@nexpress/core";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { shopCollections, shopPlugin } from "@nexpress/plugin-shop";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  shopCategoriesTable,
  shopProductsCategoriesTable,
  shopProductsGalleryTable,
  shopProductsTable,
  shopProductsVariantsTable,
} from "@/db/generated/collections";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const productId = "123e4567-e89b-42d3-a456-426614174000";
const memberId = "223e4567-e89b-42d3-a456-426614174000";

type RouteHandler = NonNullable<typeof shopPlugin.routes>[number]["handler"];

function route(method: "GET" | "POST"): RouteHandler {
  const registration = shopPlugin.routes?.find(
    (candidate) => candidate.method === method && candidate.path === "/cart",
  );
  if (!registration) throw new Error(`Missing ${method} Shop cart route.`);
  return registration.handler;
}

async function call(
  method: "GET" | "POST",
  input: {
    cookie?: string;
    csrf?: string;
    body?: unknown;
    member?: { id: string };
  } = {},
) {
  return withCurrentSite("default", () =>
    route(method)(
      {
        method,
        path: "/cart",
        params: { pluginId: "shop" },
        query: {},
        body: input.body,
        headers: {
          ...(input.cookie ? { cookie: input.cookie } : {}),
          ...(input.csrf ? { "x-csrf-token": input.csrf } : {}),
        },
        member: input.member,
      },
      {} as never,
    ),
  );
}

describe.skipIf(skipIfNoTestDb())("shop cart persistence", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { registerCollection } = await import("@nexpress/core");
    registerCollection("shop-categories", shopCategoriesTable, shopCollections[0]);
    registerCollection("shop-products", shopProductsTable, shopCollections[1], {
      childTables: {
        gallery: shopProductsGalleryTable,
        variants: shopProductsVariantsTable,
      },
      joinTables: { categories: shopProductsCategoriesTable },
    });
  });

  beforeEach(async () => {
    vi.stubEnv("NP_SECRET", "shop-cart-integration-secret-32-bytes-minimum");
    await truncateAll();
    const db = await getTestDb();
    await db.insert(shopProductsTable).values({
      id: productId,
      status: "published",
      visibility: "public",
      siteId: "default",
      name: "Everyday cup",
      slug: "everyday-cup",
      description: npCreateEmptyRichTextContent(),
      currency: "KRW",
      priceMinor: 25_000,
      trackInventory: true,
      stockQuantity: 8,
      lowStockThreshold: 3,
      available: true,
      inventoryState: "in-stock",
      skin: "classic",
      publishedAt: new Date(),
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeTestDb();
  });

  it("allows only one writer for the same expected revision", async () => {
    const initial = await call("GET");
    const cookie = initial.headers?.["Set-Cookie"];
    const initialBody = initial.body as { quote: { revision: number }; csrfToken: string };
    expect(cookie).toContain("np-shop-cart=");
    expect(initialBody.quote.revision).toBe(0);

    const request = {
      cookie,
      csrf: initialBody.csrfToken,
      body: {
        productId,
        variantSku: null,
        quantity: 1,
        expectedRevision: 0,
      },
    };
    const responses = await Promise.all([call("POST", request), call("POST", request)]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const successful = responses.find((response) => response.status === 200);
    expect(successful?.headers, JSON.stringify(successful)).toEqual(
      expect.objectContaining({ "Set-Cookie": expect.stringContaining("Max-Age=2592000") }),
    );
    const current = await call("GET", { cookie });
    expect(current.body).toMatchObject({
      quote: {
        revision: 1,
        totalUnits: 1,
        ready: true,
        totals: [{ currency: "KRW", subtotalMinor: 25_000 }],
      },
    });
  });

  it("merges a signed guest cart into one member owner and deletes the guest row", async () => {
    const initial = await call("GET");
    const cookie = initial.headers?.["Set-Cookie"];
    const initialBody = initial.body as { csrfToken: string };
    await call("POST", {
      cookie,
      csrf: initialBody.csrfToken,
      body: { productId, variantSku: null, quantity: 2, expectedRevision: 0 },
    });

    const merged = await call("GET", { cookie, member: { id: memberId } });
    expect(merged.headers?.["Set-Cookie"]).toContain("Max-Age=0");
    expect(merged.body).toMatchObject({
      quote: { revision: 1, totalUnits: 2, ready: true },
    });

    const db = await getTestDb();
    const guestRows = await db
      .select({ key: npPluginStorage.key })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "cart:guest:%"),
        ),
      );
    expect(guestRows).toHaveLength(0);
  });

  it("cleans only expired cart keys in a bounded scheduled pass", async () => {
    const db = await getTestDb();
    const expiredAt = new Date(Date.now() - 60_000);
    await db.insert(npPluginStorage).values([
      {
        pluginId: "shop",
        siteId: "default",
        key: "cart:guest:expired",
        value: {},
        expiresAt: expiredAt,
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: "catalog-cache:expired",
        value: {},
        expiresAt: expiredAt,
      },
    ]);
    const cleanup = shopPlugin.scheduled?.find((task) => task.id === "cleanup-expired-carts");
    expect(cleanup).toBeDefined();

    await withCurrentSite("default", () => cleanup?.handler({} as never));

    const remaining = await db
      .select({ key: npPluginStorage.key })
      .from(npPluginStorage)
      .where(and(eq(npPluginStorage.pluginId, "shop"), eq(npPluginStorage.siteId, "default")));
    expect(remaining).toEqual([{ key: "catalog-cache:expired" }]);
  });
});
