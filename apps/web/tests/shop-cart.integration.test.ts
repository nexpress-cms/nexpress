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
type ShopMethod = "GET" | "POST" | "PATCH" | "DELETE";

function route(method: ShopMethod, path = "/cart"): RouteHandler {
  const registration = shopPlugin.routes?.find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  if (!registration) throw new Error(`Missing ${method} Shop route ${path}.`);
  return registration.handler;
}

async function call(
  method: ShopMethod,
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

async function checkoutCall(
  method: "GET" | "POST" | "DELETE",
  input: {
    cookie?: string;
    csrf?: string;
    body?: unknown;
    intentId?: string;
    member?: { id: string };
  } = {},
) {
  return withCurrentSite("default", () =>
    route(method, "/checkout")(
      {
        method,
        path: "/checkout",
        params: { pluginId: "shop" },
        query: input.intentId ? { id: input.intentId } : {},
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

  it("creates one owner-scoped idempotent checkout intent and detects cart drift", async () => {
    const initial = await call("GET");
    const cookie = initial.headers?.["Set-Cookie"];
    const initialBody = initial.body as { csrfToken: string };
    const added = await call("POST", {
      cookie,
      csrf: initialBody.csrfToken,
      body: { productId, variantSku: null, quantity: 1, expectedRevision: 0 },
    });
    const addedBody = added.body as {
      csrfToken: string;
      quote: { revision: number; fingerprint: string };
    };
    const intentId = "323e4567-e89b-42d3-a456-426614174000";
    const createInput = {
      cookie,
      csrf: addedBody.csrfToken,
      body: {
        idempotencyKey: intentId,
        expectedRevision: addedBody.quote.revision,
        expectedFingerprint: addedBody.quote.fingerprint,
      },
    };

    const created = await Promise.all([
      checkoutCall("POST", createInput),
      checkoutCall("POST", createInput),
    ]);
    expect(created.map((response) => response.status)).toEqual([200, 200]);
    expect(created[0]?.body).toMatchObject({
      intent: {
        contract: "np.shop-checkout-intent.v1",
        id: intentId,
        status: "open",
        cartRevision: 1,
        currency: "KRW",
        subtotalMinor: 25_000,
        totalUnits: 1,
      },
    });
    expect(created[1]?.body).toEqual(created[0]?.body);

    const db = await getTestDb();
    const rows = await db
      .select({ key: npPluginStorage.key })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "checkout-intent:%"),
        ),
      );
    expect(rows).toHaveLength(1);

    for (const nextIntentId of [
      "523e4567-e89b-42d3-a456-426614174000",
      "623e4567-e89b-42d3-a456-426614174000",
      "723e4567-e89b-42d3-a456-426614174000",
      "823e4567-e89b-42d3-a456-426614174000",
    ]) {
      const admitted = await checkoutCall("POST", {
        ...createInput,
        body: { ...createInput.body, idempotencyKey: nextIntentId },
      });
      expect(admitted.status).toBe(200);
    }
    const overLimit = await checkoutCall("POST", {
      ...createInput,
      body: {
        ...createInput.body,
        idempotencyKey: "923e4567-e89b-42d3-a456-426614174000",
      },
    });
    expect(overLimit.status).toBe(400);

    const changed = await call("PATCH", {
      cookie,
      csrf: addedBody.csrfToken,
      body: {
        lineKey: `${productId}:_`,
        quantity: 2,
        expectedRevision: 1,
      },
    });
    expect(changed.status).toBe(200);
    const stale = await checkoutCall("GET", { cookie, intentId });
    expect(stale.body).toMatchObject({ intent: { id: intentId, status: "stale" } });
    const cancelledStale = await checkoutCall("DELETE", {
      cookie,
      csrf: addedBody.csrfToken,
      body: { intentId },
    });
    expect(cancelledStale.body).toMatchObject({
      intent: { id: intentId, status: "cancelled", cancelledAt: expect.any(String) },
    });

    const wrongOwner = await checkoutCall("GET", {
      intentId,
      member: { id: memberId },
    });
    expect(wrongOwner.status).toBe(404);
  });

  it("cancels checkout intents idempotently and cleans only their expired keys", async () => {
    const initial = await call("GET");
    const cookie = initial.headers?.["Set-Cookie"];
    const initialBody = initial.body as { csrfToken: string };
    const added = await call("POST", {
      cookie,
      csrf: initialBody.csrfToken,
      body: { productId, variantSku: null, quantity: 1, expectedRevision: 0 },
    });
    const addedBody = added.body as {
      csrfToken: string;
      quote: { revision: number; fingerprint: string };
    };
    const intentId = "423e4567-e89b-42d3-a456-426614174000";
    await checkoutCall("POST", {
      cookie,
      csrf: addedBody.csrfToken,
      body: {
        idempotencyKey: intentId,
        expectedRevision: addedBody.quote.revision,
        expectedFingerprint: addedBody.quote.fingerprint,
      },
    });
    const cancelled = await checkoutCall("DELETE", {
      cookie,
      csrf: addedBody.csrfToken,
      body: { intentId },
    });
    expect(cancelled.body).toMatchObject({
      intent: { id: intentId, status: "cancelled", cancelledAt: expect.any(String) },
    });
    const repeated = await checkoutCall("DELETE", {
      cookie,
      csrf: addedBody.csrfToken,
      body: { intentId },
    });
    expect(repeated.body).toEqual(cancelled.body);

    const db = await getTestDb();
    const expiredAt = new Date(Date.now() - 60_000);
    await db
      .update(npPluginStorage)
      .set({ expiresAt: expiredAt })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "checkout-intent:%"),
        ),
      );
    await db.insert(npPluginStorage).values({
      pluginId: "shop",
      siteId: "default",
      key: "checkout-cache:expired",
      value: {},
      expiresAt: expiredAt,
    });
    const cleanup = shopPlugin.scheduled?.find(
      (task) => task.id === "cleanup-expired-checkout-intents",
    );
    await withCurrentSite("default", () => cleanup?.handler({} as never));
    const remaining = await db
      .select({ key: npPluginStorage.key })
      .from(npPluginStorage)
      .where(and(eq(npPluginStorage.pluginId, "shop"), eq(npPluginStorage.siteId, "default")));
    expect(remaining.map((row) => row.key)).toContain("checkout-cache:expired");
    expect(remaining.some((row) => row.key.startsWith("checkout-intent:"))).toBe(false);
  });
});
