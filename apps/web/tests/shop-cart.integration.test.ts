import { npAuditEvents, npNotifications, npPluginStorage, withCurrentSite } from "@nexpress/core";
import {
  countFollows,
  follow,
  listFollowing,
  listFollowingTargetIds,
  unfollow,
} from "@nexpress/core/community";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import {
  createShop,
  npAnalyzeStoredShopFulfillment,
  NpShopCarrierProviderError,
  NpShopPaymentProviderError,
  npAnalyzeStoredShopOrder,
  npRequireShopOrderDraft,
  npListShopProductReviews,
  npGetShopWishlistPage,
  npProcessShopPriceAlerts,
  npReadShopProductReviewAggregate,
  npProcessShopRestockAlerts,
  npProcessShopOrderNotifications,
  shopCollections,
  shopPlugin,
  type NpShopCarrierBookingRequest,
  type NpShopExchangeCarrierBookingRequest,
  type NpShopExchangeCarrierCancelRequest,
  type NpShopCarrierLabelRequest,
  type NpShopCarrierParcelBookingRequest,
  type NpShopCarrierPickupCancelRequest,
  type NpShopCarrierPickupRequest,
  type NpShopReturnLogisticsCancelRequest,
  type NpShopReturnLogisticsLabelRequest,
  type NpShopReturnLogisticsRequest,
  type NpShopQuotedReturnLogisticsRequest,
  type NpShopReturnPostageQuoteRequest,
  type NpShopReturnTrackingPollRequest,
  type NpShopTrackingPollRequest,
} from "@nexpress/plugin-shop";
import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  shopCategoriesTable,
  shopProductsCategoriesTable,
  shopProductsGalleryTable,
  shopProductsTable,
  shopProductsVariantsTable,
  shopProductReviewsPhotosTable,
  shopProductReviewsTable,
  shopPromotionsCategoriesTable,
  shopPromotionsProductsTable,
  shopPromotionsTable,
  shopShippingPoliciesAdministrativeAreasTable,
  shopShippingPoliciesCategoriesTable,
  shopShippingPoliciesPostalPrefixesTable,
  shopShippingPoliciesProductsTable,
  shopShippingPoliciesTable,
} from "@/db/generated/collections";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  registerTestCollections,
  seedActiveMember,
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const productId = "123e4567-e89b-42d3-a456-426614174000";
const memberId = "223e4567-e89b-42d3-a456-426614174000";

type RouteHandler = NonNullable<typeof shopPlugin.routes>[number]["handler"];
type ShopMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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
    rawBody?: Uint8Array;
    headers?: Record<string, string>;
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
        bodyMode: input.rawBody ? "raw" : "json",
        rawBody: input.rawBody,
        headers: {
          ...input.headers,
          ...(input.cookie ? { cookie: input.cookie } : {}),
          ...(input.csrf ? { "x-csrf-token": input.csrf } : {}),
        },
        member: input.member,
      },
      {} as never,
    ),
  );
}

async function configuredShopCall(
  shop: ReturnType<typeof createShop>,
  method: ShopMethod,
  path: string,
  input: {
    cookie?: string;
    csrf?: string;
    body?: unknown;
    id?: string;
    query?: Record<string, string>;
    user?: { id: string; email: string; role: string };
    member?: { id: string };
    rawBody?: Uint8Array;
    headers?: Record<string, string>;
  } = {},
) {
  const handler = shop.plugin.routes?.find(
    (candidate) => candidate.method === method && candidate.path === path,
  )?.handler;
  if (!handler) throw new Error(`Missing ${method} configured Shop route ${path}.`);
  return withCurrentSite("default", () =>
    handler(
      {
        method,
        path,
        params: { pluginId: "shop" },
        query: input.query ?? (input.id ? { id: input.id } : {}),
        body: input.body,
        bodyMode: input.rawBody ? "raw" : "json",
        rawBody: input.rawBody,
        headers: {
          ...input.headers,
          ...(input.cookie ? { cookie: input.cookie } : {}),
          ...(input.csrf ? { "x-csrf-token": input.csrf } : {}),
        },
        member: input.member,
        user: input.user,
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

async function orderDraftCall(
  method: ShopMethod,
  input: {
    cookie?: string;
    csrf?: string;
    body?: unknown;
    draftId?: string;
    member?: { id: string };
  } = {},
) {
  return withCurrentSite("default", () =>
    route(method, "/order-drafts")(
      {
        method,
        path: "/order-drafts",
        params: { pluginId: "shop" },
        query: input.draftId ? { id: input.draftId } : {},
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

async function orderCall(
  method: "GET" | "POST" | "DELETE",
  input: {
    cookie?: string;
    csrf?: string;
    body?: unknown;
    orderId?: string;
    member?: { id: string };
  } = {},
) {
  return withCurrentSite("default", () =>
    route(method, "/orders")(
      {
        method,
        path: "/orders",
        params: { pluginId: "shop" },
        query: input.orderId ? { id: input.orderId } : {},
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

async function returnCall(
  method: "POST" | "DELETE",
  input: {
    cookie?: string;
    csrf?: string;
    body?: unknown;
    member?: { id: string };
  } = {},
) {
  return withCurrentSite("default", () =>
    route(method, "/returns")(
      {
        method,
        path: "/returns",
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

async function exchangeDestinationCall(input: {
  cookie?: string;
  csrf?: string;
  body: unknown;
  member?: { id: string };
}) {
  return withCurrentSite("default", () =>
    route("POST", "/exchanges/destination")(
      {
        method: "POST",
        path: "/exchanges/destination",
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

async function createPendingOrder(
  ids: { intentId: string; draftId: string; orderId: string },
  privateEmail: string,
  line: { variantSku: string | null; quantity: number } = {
    variantSku: null,
    quantity: 1,
  },
) {
  const initial = await call("GET");
  const cookie = initial.headers?.["Set-Cookie"];
  const csrf = (initial.body as { csrfToken: string }).csrfToken;
  const added = await call("POST", {
    cookie,
    csrf,
    body: {
      productId,
      variantSku: line.variantSku,
      quantity: line.quantity,
      expectedRevision: 0,
    },
  });
  const addedBody = added.body as {
    csrfToken: string;
    quote: { revision: number; fingerprint: string };
  };
  await checkoutCall("POST", {
    cookie,
    csrf: addedBody.csrfToken,
    body: {
      idempotencyKey: ids.intentId,
      expectedRevision: addedBody.quote.revision,
      expectedFingerprint: addedBody.quote.fingerprint,
    },
  });
  await orderDraftCall("POST", {
    cookie,
    csrf: addedBody.csrfToken,
    body: { idempotencyKey: ids.draftId, checkoutIntentId: ids.intentId },
  });
  await orderDraftCall("PATCH", {
    cookie,
    csrf: addedBody.csrfToken,
    body: {
      draftId: ids.draftId,
      expectedRevision: 1,
      customer: {
        fullName: "홍길동",
        email: privateEmail,
        phone: "010-1234-5678",
      },
      shipping: {
        recipientName: "홍길동",
        phone: "010-1234-5678",
        countryCode: "KR",
        postalCode: "04524",
        addressLine1: "서울특별시 중구 세종대로 110",
        addressLine2: null,
        locality: "중구",
        administrativeArea: "서울특별시",
      },
    },
  });
  const created = await orderCall("POST", {
    cookie,
    csrf: addedBody.csrfToken,
    body: {
      idempotencyKey: ids.orderId,
      draftId: ids.draftId,
      expectedRevision: 2,
    },
  });
  expect(created).toMatchObject({
    status: 200,
    body: { order: { id: ids.orderId, status: "pending-payment" } },
  });
  return { cookie, csrf: addedBody.csrfToken };
}

async function payPendingOrder(
  shop: ReturnType<typeof createShop>,
  input: { orderId: string; eventId: string; paymentReference: string; amountMinor?: number },
) {
  const handler = shop.plugin.routes?.find(
    (candidate) => candidate.path === "/payments/webhook",
  )?.handler;
  const rawBody = new TextEncoder().encode(
    JSON.stringify({
      contract: "np.shop-payment-event.v1",
      eventId: input.eventId,
      type: "payment.succeeded",
      orderId: input.orderId,
      paymentReference: input.paymentReference,
      currency: "KRW",
      amountMinor: input.amountMinor ?? 25_000,
      signedAt: new Date().toISOString(),
    }),
  );
  return withCurrentSite("default", () =>
    handler?.(
      {
        method: "POST",
        path: "/payments/webhook",
        params: { pluginId: "shop" },
        query: {},
        bodyMode: "raw",
        body: undefined,
        rawBody,
        headers: {},
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
    registerCollection("shop-promotions", shopPromotionsTable, shopCollections[2], {
      joinTables: {
        categories: shopPromotionsCategoriesTable,
        products: shopPromotionsProductsTable,
      },
    });
    registerCollection("shop-shipping-policies", shopShippingPoliciesTable, shopCollections[3], {
      childTables: {
        administrativeAreas: shopShippingPoliciesAdministrativeAreasTable,
        postalPrefixes: shopShippingPoliciesPostalPrefixesTable,
      },
      joinTables: {
        categories: shopShippingPoliciesCategoriesTable,
        products: shopShippingPoliciesProductsTable,
      },
    });
    registerCollection("shop-product-reviews", shopProductReviewsTable, shopCollections[4], {
      childTables: { photos: shopProductReviewsPhotosTable },
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

  it("stores member wishlists in the site-scoped follow graph and hydrates public products", async () => {
    const db = await getTestDb();
    const shop = createShop();
    const member = await seedActiveMember({ handle: "wishlist-member" });
    const missingProductId = "323e4567-e89b-42d3-a456-426614174000";

    await withCurrentSite("default", () =>
      follow({
        followerId: member.memberId,
        targetType: shop.runtime.collections.products,
        targetId: productId,
      }),
    );

    await expect(
      withCurrentSite("default", () =>
        listFollowingTargetIds(member.memberId, shop.runtime.collections.products, [
          missingProductId,
          productId,
        ]),
      ),
    ).resolves.toEqual([productId]);
    await expect(
      withCurrentSite("default", () =>
        listFollowing(member.memberId, { targetType: shop.runtime.collections.products }),
      ),
    ).resolves.toMatchObject([{ targetId: productId, siteId: "default" }]);
    await expect(
      withCurrentSite("default", () => countFollows(shop.runtime.collections.products)),
    ).resolves.toBe(1);
    await expect(
      withCurrentSite("other-site", () => countFollows(shop.runtime.collections.products)),
    ).resolves.toBe(0);

    const page = await withCurrentSite("default", () =>
      npGetShopWishlistPage(shop.runtime, member.memberId, 1),
    );
    expect(page).toMatchObject({
      page: 1,
      hasPrevious: false,
      hasNext: false,
      products: [{ id: productId, slug: "everyday-cup" }],
    });
    const metric = await withCurrentSite("default", () =>
      shop.plugin.actions?.countProductWishlistSaves?.handler(undefined, {} as never),
    );
    expect(metric).toMatchObject({ ok: true, data: { value: 1 } });
    const health = await withCurrentSite("default", () =>
      shop.plugin.actions?.wishlistHealth?.handler(undefined, {} as never),
    );
    expect(health).toMatchObject({ ok: true, data: { level: "ok" } });

    await db
      .update(shopProductsTable)
      .set({ status: "draft" })
      .where(eq(shopProductsTable.id, productId));
    await expect(
      withCurrentSite("default", () => npGetShopWishlistPage(shop.runtime, member.memberId, 1)),
    ).resolves.toMatchObject({ products: [] });

    await withCurrentSite("default", () =>
      unfollow({
        followerId: member.memberId,
        targetType: shop.runtime.collections.products,
        targetId: productId,
      }),
    );
    await expect(
      withCurrentSite("default", () => countFollows(shop.runtime.collections.products)),
    ).resolves.toBe(0);
  });

  it("delivers one member-owned restock notification and retains a dedupe receipt", async () => {
    const db = await getTestDb();
    const shop = createShop();
    await shop.plugin.setup?.({} as never);
    const member = await seedActiveMember({ handle: "restock-member" });
    await db
      .update(shopProductsTable)
      .set({ stockQuantity: 0, available: false, inventoryState: "out-of-stock" })
      .where(eq(shopProductsTable.id, productId));

    await expect(
      configuredShopCall(shop, "GET", "/restock-alerts", { query: { productId } }),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      configuredShopCall(shop, "POST", "/restock-alerts", {
        cookie: "np-mb-csrf=restock-csrf",
        member: { id: member.memberId },
        body: { productId, variantSku: null },
      }),
    ).resolves.toMatchObject({ status: 403 });

    const subscribed = await configuredShopCall(shop, "POST", "/restock-alerts", {
      cookie: "np-mb-csrf=restock-csrf",
      csrf: "restock-csrf",
      member: { id: member.memberId },
      body: { productId, variantSku: null },
    });
    expect(subscribed).toMatchObject({
      status: 200,
      body: { alert: { productId, variantSku: null } },
    });
    await expect(
      configuredShopCall(shop, "POST", "/restock-alerts", {
        cookie: "np-mb-csrf=restock-csrf",
        csrf: "restock-csrf",
        member: { id: member.memberId },
        body: { productId, variantSku: null },
      }),
    ).resolves.toMatchObject({ status: 200, body: { alert: { productId } } });
    await expect(
      configuredShopCall(shop, "GET", "/restock-alerts", {
        member: { id: member.memberId },
        query: { productId },
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { alerts: [{ productId, variantSku: null }] },
    });
    await expect(
      withCurrentSite("other-site", () => npProcessShopRestockAlerts(shop.runtime, { productId })),
    ).resolves.toMatchObject({ inspected: 0, notified: 0 });

    await db
      .update(shopProductsTable)
      .set({ stockQuantity: 4, available: true, inventoryState: "in-stock" })
      .where(eq(shopProductsTable.id, productId));
    await expect(
      withCurrentSite("default", () => npProcessShopRestockAlerts(shop.runtime, { productId })),
    ).resolves.toMatchObject({ inspected: 1, notified: 1, suppressed: 0 });
    await expect(
      withCurrentSite("default", () => npProcessShopRestockAlerts(shop.runtime, { productId })),
    ).resolves.toMatchObject({ inspected: 0, notified: 0 });

    const notifications = await db
      .select({ kind: npNotifications.kind, payload: npNotifications.payload })
      .from(npNotifications)
      .where(
        and(
          eq(npNotifications.siteId, "default"),
          eq(npNotifications.memberId, member.memberId),
          eq(npNotifications.kind, "shop.product-restocked"),
        ),
      );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.payload).toMatchObject({
      href: "/shop/products/everyday-cup",
      productId,
      variantSku: null,
    });
    const [receipt] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, `restock-alert:${productId}:%`),
        ),
      );
    expect(receipt?.value).toMatchObject({ status: "completed", outcome: "notified" });
  });

  it("delivers one member-owned price-drop notification below the exact baseline", async () => {
    const db = await getTestDb();
    const shop = createShop();
    await shop.plugin.setup?.({} as never);
    const member = await seedActiveMember({ handle: "price-alert-member" });

    await expect(
      configuredShopCall(shop, "GET", "/price-alerts", { query: { productId } }),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      configuredShopCall(shop, "POST", "/price-alerts", {
        cookie: "np-mb-csrf=price-alert-csrf",
        member: { id: member.memberId },
        body: { productId, variantSku: null },
      }),
    ).resolves.toMatchObject({ status: 403 });

    await expect(
      configuredShopCall(shop, "POST", "/price-alerts", {
        cookie: "np-mb-csrf=price-alert-csrf",
        csrf: "price-alert-csrf",
        member: { id: member.memberId },
        body: { productId, variantSku: null },
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        alert: {
          productId,
          variantSku: null,
          currency: "KRW",
          baselinePriceMinor: 25_000,
        },
      },
    });
    await expect(
      withCurrentSite("other-site", () => npProcessShopPriceAlerts(shop.runtime, { productId })),
    ).resolves.toMatchObject({ inspected: 0, notified: 0 });
    await expect(
      withCurrentSite("default", () => npProcessShopPriceAlerts(shop.runtime, { productId })),
    ).resolves.toMatchObject({ inspected: 1, notified: 0, unchanged: 1 });

    await db
      .update(shopProductsTable)
      .set({ currency: "USD", priceMinor: 22_000 })
      .where(eq(shopProductsTable.id, productId));
    await expect(
      withCurrentSite("default", () => npProcessShopPriceAlerts(shop.runtime, { productId })),
    ).resolves.toMatchObject({ inspected: 1, notified: 0, currencyMismatch: 1 });

    await db
      .update(shopProductsTable)
      .set({ currency: "KRW", priceMinor: 22_000 })
      .where(eq(shopProductsTable.id, productId));
    await expect(
      withCurrentSite("default", () => npProcessShopPriceAlerts(shop.runtime, { productId })),
    ).resolves.toMatchObject({ inspected: 1, notified: 1, suppressed: 0 });
    await expect(
      withCurrentSite("default", () => npProcessShopPriceAlerts(shop.runtime, { productId })),
    ).resolves.toMatchObject({ inspected: 0, notified: 0 });

    const notifications = await db
      .select({ payload: npNotifications.payload })
      .from(npNotifications)
      .where(
        and(
          eq(npNotifications.siteId, "default"),
          eq(npNotifications.memberId, member.memberId),
          eq(npNotifications.kind, "shop.product-price-dropped"),
        ),
      );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.payload).toMatchObject({
      href: "/shop/products/everyday-cup",
      productId,
      variantSku: null,
      currency: "KRW",
      previousPriceMinor: 25_000,
      currentPriceMinor: 22_000,
    });
    const [receipt] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, `price-alert:${productId}:%`),
        ),
      );
    expect(receipt?.value).toMatchObject({
      status: "completed",
      outcome: "notified",
      baselinePriceMinor: 25_000,
    });
  });

  it("projects exact PII-free review aggregates and rows", async () => {
    const db = await getTestDb();
    const runtime = createShop().runtime;
    const member = await seedActiveMember({ handle: "reviewer", displayName: "Verified reviewer" });
    await db.insert(shopProductReviewsTable).values([
      {
        product: productId,
        purchaseKey: "a".repeat(64),
        rating: 5,
        title: "Excellent",
        body: "The shipped item matched the catalog description.",
        verifiedPurchase: true,
        moderationHidden: false,
        memberAuthorId: member.memberId,
        status: "published",
      },
      {
        product: productId,
        purchaseKey: "b".repeat(64),
        rating: 1,
        title: "Hidden",
        body: "This row must stay out of public review totals.",
        verifiedPurchase: true,
        moderationHidden: true,
        memberAuthorId: member.memberId,
        status: "pending",
      },
      {
        product: productId,
        purchaseKey: "c".repeat(64),
        rating: 5,
        title: " ".repeat(121),
        body: "Malformed persisted text must fail closed before public projection.",
        verifiedPurchase: true,
        moderationHidden: false,
        memberAuthorId: member.memberId,
        status: "published",
      },
    ]);

    const aggregate = await withCurrentSite("default", () =>
      npReadShopProductReviewAggregate(runtime, productId),
    );
    expect(aggregate).toEqual({
      count: 1,
      ratingTotal: 5,
      averageRatingBasisPoints: 5_000,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
    });
    const page = await withCurrentSite("default", () =>
      npListShopProductReviews(runtime, productId, member.memberId, 1),
    );
    expect(page.reviews).toHaveLength(1);
    expect(page.reviews[0]).toMatchObject({
      title: "Excellent",
      verifiedPurchase: true,
      ownedByViewer: true,
      author: { displayName: "Verified reviewer", handle: "reviewer" },
    });
    expect(page.reviews[0]).not.toHaveProperty("memberAuthorId");
    expect(page.reviews[0]).not.toHaveProperty("purchaseKey");
    expect(page.reviews[0]).not.toHaveProperty("orderId");
  });

  it("issues shipped-line eligibility, stores only a purchase hash, and rejects replay", async () => {
    const db = await getTestDb();
    const member = await seedActiveMember({ handle: "buyer-reviewer" });
    const orderId = "333e4567-e89b-42d3-a456-426614174000";
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const paidAt = new Date("2026-01-01T01:00:00.000Z");
    const shippedAt = new Date("2026-01-01T02:00:00.000Z");
    const pendingExpiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1_000);
    const privateExpiresAt = new Date(paidAt.getTime() + 30 * 24 * 60 * 60 * 1_000);
    const purgeAt = new Date(createdAt.getTime() + 365 * 24 * 60 * 60 * 1_000);
    const lineKey = `${productId}:_`;
    const order = {
      contract: "np.shop-order-storage.v1",
      id: orderId,
      status: "paid",
      revision: 2,
      ownerSegment: `member:${member.memberId}`,
      sourceDraftId: "433e4567-e89b-42d3-a456-426614174000",
      checkoutIntentId: "533e4567-e89b-42d3-a456-426614174000",
      cartRevision: 1,
      cartFingerprint: "c".repeat(64),
      currency: "KRW",
      subtotalMinor: 25_000,
      discountMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: 25_000,
      totalUnits: 1,
      lines: [
        {
          key: lineKey,
          productId,
          productSlug: "everyday-cup",
          productName: "Everyday cup",
          variantSku: null,
          variantName: null,
          quantity: 1,
          unitPriceMinor: 25_000,
          lineTotalMinor: 25_000,
        },
      ],
      promotions: {
        contract: "np.shop-promotion-snapshot.v1",
        couponCodes: [],
        rejectedCouponCodes: [],
        applied: [],
        discountMinor: 0,
      },
      deliveryMethod: null,
      taxQuote: null,
      privateDataStatus: "redacted",
      inventoryReservationStatus: "consumed",
      inventoryReservationLineKeys: [lineKey],
      createdAt: createdAt.toISOString(),
      updatedAt: shippedAt.toISOString(),
      pendingExpiresAt: pendingExpiresAt.toISOString(),
      paymentProvider: "test-pay",
      paymentReference: "payment-1",
      paymentEventId: "event-1",
      paymentResolvedAt: paidAt.toISOString(),
      cancelledAt: null,
      cancellationReason: null,
      purgeAt: purgeAt.toISOString(),
    };
    const fulfillment = {
      contract: "np.shop-fulfillment-storage.v1",
      orderId,
      ownerSegment: `member:${member.memberId}`,
      status: "shipped",
      revision: 2,
      privateDataStatus: "redacted",
      carrier: "test-carrier",
      trackingNumber: "TRACK-1",
      operatorNote: null,
      createdAt: paidAt.toISOString(),
      updatedAt: shippedAt.toISOString(),
      privateExpiresAt: privateExpiresAt.toISOString(),
      shippedAt: shippedAt.toISOString(),
      purgeAt: purgeAt.toISOString(),
    };
    expect(npAnalyzeStoredShopOrder(order)).toEqual([]);
    expect(npAnalyzeStoredShopFulfillment(fulfillment)).toEqual([]);
    await db.insert(npPluginStorage).values([
      {
        pluginId: "shop",
        siteId: "default",
        key: `order:member:${member.memberId}:${orderId}`,
        value: order,
        expiresAt: purgeAt,
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `fulfillment:${orderId}`,
        value: fulfillment,
        expiresAt: purgeAt,
      },
    ]);

    const shop = createShop();
    const read = await configuredShopCall(shop, "GET", "/reviews", {
      query: { productId, page: "1" },
      member: { id: member.memberId },
    });
    const page = (read.body as { page: { eligibility: Array<{ purchaseToken: string }> } }).page;
    expect(page.eligibility).toHaveLength(1);
    const purchaseToken = page.eligibility[0]?.purchaseToken;
    expect(purchaseToken).toBeTypeOf("string");
    const mutation = {
      cookie: "np-mb-csrf=review-csrf",
      csrf: "review-csrf",
      member: { id: member.memberId },
      body: {
        productId,
        purchaseToken,
        rating: 4,
        title: "Verified delivery",
        body: "Created only after the fulfillment reached shipped.",
        photos: [],
      },
    };
    expect(await configuredShopCall(shop, "POST", "/reviews", mutation)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    const [stored] = await db
      .select({ id: shopProductReviewsTable.id, purchaseKey: shopProductReviewsTable.purchaseKey })
      .from(shopProductReviewsTable);
    if (!stored) throw new Error("Failed to read the created review.");
    expect(stored.purchaseKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(stored.purchaseKey).not.toBe(purchaseToken);
    expect(await configuredShopCall(shop, "POST", "/reviews", mutation)).toMatchObject({
      status: 409,
    });
    expect(
      await configuredShopCall(shop, "PATCH", "/reviews", {
        cookie: mutation.cookie,
        csrf: mutation.csrf,
        member: mutation.member,
        body: {
          reviewId: stored.id,
          rating: 5,
          title: "Updated verified delivery",
          body: "The member-owned review can be updated without changing its purchase proof.",
          photos: [],
        },
      }),
    ).toMatchObject({ status: 200, body: { ok: true } });
    await expect(
      withCurrentSite("default", () =>
        npListShopProductReviews(shop.runtime, productId, member.memberId, 1),
      ),
    ).resolves.toMatchObject({
      reviews: [{ id: stored.id, title: "Updated verified delivery", rating: 5 }],
    });
    expect(
      await configuredShopCall(shop, "DELETE", "/reviews", {
        cookie: mutation.cookie,
        csrf: mutation.csrf,
        member: mutation.member,
        body: { reviewId: stored.id },
      }),
    ).toMatchObject({ status: 200, body: { ok: true } });
    await expect(
      withCurrentSite("default", () => npReadShopProductReviewAggregate(shop.runtime, productId)),
    ).resolves.toMatchObject({ count: 0 });
  });

  it("hides and restores reviews only through exact direct-staff Admin actions", async () => {
    const db = await getTestDb();
    const member = await seedActiveMember({ handle: "moderated-reviewer" });
    const staff = await seedUser({ email: "review-moderator@example.com" });
    const [review] = await db
      .insert(shopProductReviewsTable)
      .values({
        product: productId,
        purchaseKey: "d".repeat(64),
        rating: 5,
        title: "Moderate this review",
        body: "A valid published review used to verify the moderation projection.",
        verifiedPurchase: true,
        moderationHidden: false,
        memberAuthorId: member.memberId,
        status: "published",
      })
      .returning({ id: shopProductReviewsTable.id });
    if (!review) throw new Error("Failed to seed review.");
    const shop = createShop();
    const context = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;

    const hidden = await withCurrentSite("default", () =>
      shop.plugin.actions?.hideProductReview?.handler(
        {
          row: { id: review.id, title: "Moderate this review" },
          values: { reason: "Contains a policy violation without personal data." },
        },
        context,
      ),
    );
    expect(hidden?.ok, JSON.stringify(hidden)).toBe(true);
    await expect(
      withCurrentSite("default", () => npReadShopProductReviewAggregate(shop.runtime, productId)),
    ).resolves.toMatchObject({ count: 0 });

    await expect(
      withCurrentSite("default", () =>
        shop.plugin.actions?.restoreProductReview?.handler(
          { row: { id: review.id, title: "Moderate this review" }, values: {} },
          context,
        ),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      withCurrentSite("default", () => npReadShopProductReviewAggregate(shop.runtime, productId)),
    ).resolves.toMatchObject({ count: 1 });
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

  it("freezes coupon discounts and atomically releases bounded usage on cancellation", async () => {
    const promotionId = "923e4567-e89b-42d3-a456-426614174000";
    const db = await getTestDb();
    await db.insert(shopPromotionsTable).values({
      id: promotionId,
      status: "published",
      visibility: "private",
      siteId: "default",
      name: "Welcome 5000",
      code: "WELCOME",
      automatic: false,
      kind: "fixed",
      currency: "KRW",
      value: 5_000,
      maximumDiscountMinor: null,
      minimumSubtotalMinor: 20_000,
      target: "order",
      priority: 10,
      stackable: false,
      totalUsageLimit: 1,
      perOwnerUsageLimit: 1,
      publishedAt: new Date(),
    });

    async function createDiscountedOrder(ids: {
      intentId: string;
      draftId: string;
      orderId: string;
    }) {
      const initial = await call("GET");
      const cookie = initial.headers?.["Set-Cookie"];
      const csrf = (initial.body as { csrfToken: string }).csrfToken;
      const added = await call("POST", {
        cookie,
        csrf,
        body: { productId, variantSku: null, quantity: 1, expectedRevision: 0 },
      });
      const addedQuote = (added.body as { quote: { revision: number } }).quote;
      const coupon = await call("PUT", {
        cookie,
        csrf,
        body: { couponCodes: ["welcome"], expectedRevision: addedQuote.revision },
      });
      const quote = (
        coupon.body as {
          quote: { revision: number; fingerprint: string; promotions: { discountMinor: number } };
        }
      ).quote;
      await checkoutCall("POST", {
        cookie,
        csrf,
        body: {
          idempotencyKey: ids.intentId,
          expectedRevision: quote.revision,
          expectedFingerprint: quote.fingerprint,
        },
      });
      await orderDraftCall("POST", {
        cookie,
        csrf,
        body: { idempotencyKey: ids.draftId, checkoutIntentId: ids.intentId },
      });
      await orderDraftCall("PATCH", {
        cookie,
        csrf,
        body: {
          draftId: ids.draftId,
          expectedRevision: 1,
          customer: {
            fullName: "Promotion Owner",
            email: "promotion@example.com",
            phone: "010-1234-5678",
          },
          shipping: {
            recipientName: "Promotion Owner",
            phone: "010-1234-5678",
            countryCode: "KR",
            postalCode: "04524",
            addressLine1: "1 Promotion Road",
            addressLine2: null,
            locality: "Seoul",
            administrativeArea: "Seoul",
          },
        },
      });
      const order = await orderCall("POST", {
        cookie,
        csrf,
        body: {
          idempotencyKey: ids.orderId,
          draftId: ids.draftId,
          expectedRevision: 2,
        },
      });
      return { cookie, csrf, quote, order };
    }

    const first = await createDiscountedOrder({
      intentId: "a33e4567-e89b-42d3-a456-426614174000",
      draftId: "a43e4567-e89b-42d3-a456-426614174000",
      orderId: "a53e4567-e89b-42d3-a456-426614174000",
    });
    expect(first.quote.promotions.discountMinor).toBe(5_000);
    expect(first.order).toMatchObject({
      status: 200,
      body: {
        order: {
          subtotalMinor: 25_000,
          discountMinor: 5_000,
          totalMinor: 20_000,
          promotions: { applied: [{ id: promotionId, code: "WELCOME" }] },
        },
        notifications: {
          contract: "np.shop-order-notification-list.v1",
          events: [{ kind: "order.created" }],
        },
      },
    });
    const noopLog = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await withCurrentSite("default", () => npProcessShopOrderNotifications("/shop"));
    } finally {
      noopLog.mockRestore();
    }
    expect(noopLog).not.toHaveBeenCalled();
    const [createdNotification] = await (
      await getTestDb()
    )
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(
            npPluginStorage.key,
            "order-notification:a53e4567-e89b-42d3-a456-426614174000:order.created",
          ),
        ),
      );
    expect(createdNotification?.value).toMatchObject({
      status: "completed",
      inboxStatus: "not-applicable",
      emailStatus: "suppressed",
    });

    const secondInitial = await call("GET");
    const secondCookie = secondInitial.headers?.["Set-Cookie"];
    const secondCsrf = (secondInitial.body as { csrfToken: string }).csrfToken;
    await call("POST", {
      cookie: secondCookie,
      csrf: secondCsrf,
      body: { productId, variantSku: null, quantity: 1, expectedRevision: 0 },
    });
    const exhausted = await call("PUT", {
      cookie: secondCookie,
      csrf: secondCsrf,
      body: { couponCodes: ["WELCOME"], expectedRevision: 1 },
    });
    expect(exhausted).toMatchObject({
      status: 200,
      body: {
        quote: {
          promotions: { discountMinor: 0, rejectedCouponCodes: ["WELCOME"] },
        },
      },
    });

    const cancelledOrder = await orderCall("DELETE", {
      cookie: first.cookie,
      csrf: first.csrf,
      body: {
        orderId: "a53e4567-e89b-42d3-a456-426614174000",
        expectedRevision: 1,
      },
    });
    expect(cancelledOrder).toMatchObject({
      status: 200,
      body: {
        notifications: {
          contract: "np.shop-order-notification-list.v1",
          events: [{ kind: "order.created" }, { kind: "order.cancelled" }],
        },
      },
    });
    const availableAgain = await call("GET", { cookie: secondCookie });
    expect(availableAgain).toMatchObject({
      status: 200,
      body: { quote: { promotions: { discountMinor: 5_000, rejectedCouponCodes: [] } } },
    });
    const availableQuote = (
      availableAgain.body as { quote: { revision: number; fingerprint: string } }
    ).quote;
    const secondIds = {
      intentId: "b33e4567-e89b-42d3-a456-426614174000",
      draftId: "b43e4567-e89b-42d3-a456-426614174000",
      orderId: "b53e4567-e89b-42d3-a456-426614174000",
    };
    await checkoutCall("POST", {
      cookie: secondCookie,
      csrf: secondCsrf,
      body: {
        idempotencyKey: secondIds.intentId,
        expectedRevision: availableQuote.revision,
        expectedFingerprint: availableQuote.fingerprint,
      },
    });
    await orderDraftCall("POST", {
      cookie: secondCookie,
      csrf: secondCsrf,
      body: { idempotencyKey: secondIds.draftId, checkoutIntentId: secondIds.intentId },
    });
    await orderDraftCall("PATCH", {
      cookie: secondCookie,
      csrf: secondCsrf,
      body: {
        draftId: secondIds.draftId,
        expectedRevision: 1,
        customer: {
          fullName: "Redeemed Owner",
          email: "redeemed@example.com",
          phone: "010-1234-5678",
        },
        shipping: {
          recipientName: "Redeemed Owner",
          phone: "010-1234-5678",
          countryCode: "KR",
          postalCode: "04524",
          addressLine1: "2 Promotion Road",
          addressLine2: null,
          locality: "Seoul",
          administrativeArea: "Seoul",
        },
      },
    });
    await orderCall("POST", {
      cookie: secondCookie,
      csrf: secondCsrf,
      body: {
        idempotencyKey: secondIds.orderId,
        draftId: secondIds.draftId,
        expectedRevision: 2,
      },
    });
    const paymentShop = createShop({
      payment: {
        adapter: {
          id: "promotion-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
    });
    const paymentHandler = paymentShop.plugin.routes?.find(
      (candidate) => candidate.path === "/payments/webhook",
    )?.handler;
    const paymentEvent = {
      contract: "np.shop-payment-event.v1",
      eventId: "promotion_payment_1",
      type: "payment.succeeded",
      orderId: secondIds.orderId,
      paymentReference: "promotion_payment_reference_1",
      currency: "KRW",
      amountMinor: 20_000,
      signedAt: new Date().toISOString(),
    };
    const rawBody = new TextEncoder().encode(JSON.stringify(paymentEvent));
    await expect(
      withCurrentSite("default", () =>
        paymentHandler?.(
          {
            method: "POST",
            path: "/payments/webhook",
            params: { pluginId: "shop" },
            query: {},
            bodyMode: "raw",
            body: undefined,
            rawBody,
            headers: {},
          },
          {} as never,
        ),
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { receipt: { outcome: "paid", orderStatus: "paid" } },
    });
    await expect(
      withCurrentSite("default", () =>
        shopPlugin.actions?.promotionHealth?.handler(undefined, {} as never),
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { level: "ok", message: expect.stringContaining("1 redeemed") },
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

  it("owns, revisions, masks, and immediately deletes private order drafts", async () => {
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
    const intentId = "a23e4567-e89b-42d3-a456-426614174000";
    const draftId = "b23e4567-e89b-42d3-a456-426614174000";
    await checkoutCall("POST", {
      cookie,
      csrf: addedBody.csrfToken,
      body: {
        idempotencyKey: intentId,
        expectedRevision: addedBody.quote.revision,
        expectedFingerprint: addedBody.quote.fingerprint,
      },
    });

    const createInput = {
      cookie,
      csrf: addedBody.csrfToken,
      body: { idempotencyKey: draftId, checkoutIntentId: intentId },
    };
    const [created, repeated] = await Promise.all([
      orderDraftCall("POST", createInput),
      orderDraftCall("POST", createInput),
    ]);
    expect(created.status).toBe(200);
    expect(repeated.body).toEqual(created.body);
    expect(created.body).toMatchObject({
      draft: {
        contract: "np.shop-order-draft.v1",
        id: draftId,
        status: "collecting",
        revision: 1,
        customer: null,
        shipping: null,
      },
    });
    const additionalDraftIds = [
      "c23e4567-e89b-42d3-a456-426614174000",
      "d23e4567-e89b-42d3-a456-426614174000",
    ];
    for (const idempotencyKey of additionalDraftIds) {
      expect(
        await orderDraftCall("POST", {
          cookie,
          csrf: addedBody.csrfToken,
          body: { idempotencyKey, checkoutIntentId: intentId },
        }),
      ).toMatchObject({ status: 200 });
    }
    expect(
      await orderDraftCall("POST", {
        cookie,
        csrf: addedBody.csrfToken,
        body: {
          idempotencyKey: "e23e4567-e89b-42d3-a456-426614174000",
          checkoutIntentId: intentId,
        },
      }),
    ).toMatchObject({ status: 400 });
    expect(
      await orderDraftCall("GET", {
        draftId,
        member: { id: memberId },
      }),
    ).toMatchObject({ status: 404 });

    const privateEmail = "private-buyer@example.com";
    const updateBody = {
      draftId,
      expectedRevision: 1,
      customer: {
        fullName: "홍길동",
        email: privateEmail,
        phone: "010-1234-5678",
      },
      shipping: {
        recipientName: "홍길동",
        phone: "010-1234-5678",
        countryCode: "KR",
        postalCode: "04524",
        addressLine1: "서울특별시 중구 세종대로 110",
        addressLine2: null,
        locality: "중구",
        administrativeArea: "서울특별시",
      },
    };
    const invalidPrivateInput = await orderDraftCall("PATCH", {
      cookie,
      csrf: addedBody.csrfToken,
      body: {
        ...updateBody,
        customer: { ...updateBody.customer, phone: "invalid" },
      },
    });
    expect(invalidPrivateInput.status).toBe(400);
    expect(JSON.stringify(invalidPrivateInput.body)).not.toContain(privateEmail);

    const updated = await orderDraftCall("PATCH", {
      cookie,
      csrf: addedBody.csrfToken,
      body: updateBody,
    });
    expect(updated.body).toMatchObject({
      draft: {
        status: "reviewable",
        revision: 2,
        customer: { email: privateEmail },
      },
    });
    const staleRevision = await orderDraftCall("PATCH", {
      cookie,
      csrf: addedBody.csrfToken,
      body: updateBody,
    });
    expect(staleRevision).toMatchObject({
      status: 409,
      body: { error: "order_draft_revision_conflict" },
    });
    expect(JSON.stringify(staleRevision.body)).not.toContain(privateEmail);
    const changedCart = await call("PATCH", {
      cookie,
      csrf: addedBody.csrfToken,
      body: {
        lineKey: `${productId}:_`,
        quantity: 2,
        expectedRevision: 1,
      },
    });
    expect(changedCart.status).toBe(200);
    expect(await orderDraftCall("GET", { cookie, draftId })).toMatchObject({
      status: 200,
      body: { draft: { status: "stale" } },
    });
    const staleSource = await orderDraftCall("PATCH", {
      cookie,
      csrf: addedBody.csrfToken,
      body: { ...updateBody, expectedRevision: 2 },
    });
    expect(staleSource).toMatchObject({
      status: 409,
      body: { error: "order_draft_source_stale" },
    });
    expect(JSON.stringify(staleSource.body)).not.toContain(privateEmail);

    const healthAction = shopPlugin.actions?.orderDraftHealth;
    expect(healthAction?.kind).toBe("status");
    const health = await withCurrentSite("default", () =>
      healthAction?.handler(undefined, {} as never),
    );
    expect(health).toMatchObject({ ok: true });
    expect(JSON.stringify(health)).not.toContain(privateEmail);

    const db = await getTestDb();
    const stored = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "order-draft:%"),
        ),
      );
    expect(JSON.stringify(stored)).toContain(privateEmail);
    const expiringDraftId = additionalDraftIds[0] as string;
    const expiringRow = stored.find((row) => row.key.endsWith(`:${expiringDraftId}`));
    const expiringDraft = npRequireShopOrderDraft(expiringRow?.value);
    const expiredAt = new Date(Date.now() - 60_000);
    const expiredCreatedAt = new Date(expiredAt.getTime() - 24 * 60 * 60 * 1_000);
    const expiredSourceCreatedAt = new Date(expiredCreatedAt.getTime() - 60_000);
    const expiredDraft = {
      ...expiringDraft,
      sourceCreatedAt: expiredSourceCreatedAt.toISOString(),
      sourceExpiresAt: new Date(expiredSourceCreatedAt.getTime() + 15 * 60 * 1_000).toISOString(),
      createdAt: expiredCreatedAt.toISOString(),
      updatedAt: expiredCreatedAt.toISOString(),
      expiresAt: expiredAt.toISOString(),
    };
    npRequireShopOrderDraft(expiredDraft);
    await db
      .update(npPluginStorage)
      .set({ value: expiredDraft, expiresAt: expiredAt })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, expiringRow?.key ?? ""),
        ),
      );
    expect(await orderDraftCall("GET", { cookie, draftId: expiringDraftId })).toMatchObject({
      status: 410,
      body: { error: "order_draft_expired" },
    });
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, expiringRow?.key ?? ""),
          ),
        ),
    ).toHaveLength(0);

    const deleted = await orderDraftCall("DELETE", {
      cookie,
      csrf: addedBody.csrfToken,
      body: { draftId },
    });
    expect(deleted).toMatchObject({ status: 200, body: { deleted: true } });
    const repeatedDelete = await orderDraftCall("DELETE", {
      cookie,
      csrf: addedBody.csrfToken,
      body: { draftId },
    });
    expect(repeatedDelete).toMatchObject({ status: 200, body: { deleted: true } });
    for (const additionalDraftId of additionalDraftIds) {
      await orderDraftCall("DELETE", {
        cookie,
        csrf: addedBody.csrfToken,
        body: { draftId: additionalDraftId },
      });
    }
    const remaining = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "order-draft:%"),
        ),
      );
    expect(remaining).toHaveLength(0);
    expect(JSON.stringify(remaining)).not.toContain(privateEmail);
  });

  it("composes local Korean base and postal surcharge policies into a frozen order total", async () => {
    const db = await getTestDb();
    const basePolicyId = "323e4567-e89b-42d3-a456-426614174010";
    const surchargePolicyId = "323e4567-e89b-42d3-a456-426614174011";
    await db.insert(shopShippingPoliciesTable).values([
      {
        id: basePolicyId,
        status: "published",
        visibility: "private",
        siteId: "default",
        name: "Korea standard delivery",
        methodCode: "standard",
        kind: "base",
        label: "Standard delivery",
        currency: "KRW",
        amountMinor: 3_000,
        freeThresholdMinor: 50_000,
        thresholdBasis: "discounted-subtotal",
        minimumDays: 1,
        maximumDays: 3,
        destinationScope: "country",
        countryCode: "KR",
        cartScope: "all",
        priority: 0,
        publishedAt: new Date(),
      },
      {
        id: surchargePolicyId,
        status: "published",
        visibility: "private",
        siteId: "default",
        name: "Jeju postal surcharge",
        methodCode: "standard",
        kind: "surcharge",
        label: "Jeju surcharge",
        currency: "KRW",
        amountMinor: 3_000,
        thresholdBasis: "discounted-subtotal",
        destinationScope: "postal-prefixes",
        countryCode: "KR",
        cartScope: "all",
        priority: 10,
        publishedAt: new Date(),
      },
    ]);
    await db.insert(shopShippingPoliciesPostalPrefixesTable).values({
      parentId: surchargePolicyId,
      order: 0,
      prefix: "63",
    });

    const cart = await call("GET");
    const cookie = cart.headers?.["Set-Cookie"];
    const csrf = (cart.body as { csrfToken: string }).csrfToken;
    const added = await call("POST", {
      cookie,
      csrf,
      body: { productId, variantSku: null, quantity: 1, expectedRevision: 0 },
    });
    const quote = (added.body as { quote: { revision: number; fingerprint: string } }).quote;
    const intentId = "323e4567-e89b-42d3-b456-426614174012";
    const draftId = "323e4567-e89b-42d3-b456-426614174013";
    const orderId = "323e4567-e89b-42d3-b456-426614174014";
    await checkoutCall("POST", {
      cookie,
      csrf,
      body: {
        idempotencyKey: intentId,
        expectedRevision: quote.revision,
        expectedFingerprint: quote.fingerprint,
      },
    });
    await orderDraftCall("POST", {
      cookie,
      csrf,
      body: { idempotencyKey: draftId, checkoutIntentId: intentId },
    });
    const quoted = await orderDraftCall("PATCH", {
      cookie,
      csrf,
      body: {
        draftId,
        expectedRevision: 1,
        customer: {
          fullName: "홍길동",
          email: "shipping-policy@example.com",
          phone: "010-1234-5678",
        },
        shipping: {
          recipientName: "홍길동",
          phone: "010-1234-5678",
          countryCode: "KR",
          postalCode: "63000",
          addressLine1: "제주특별자치도 제주시",
          addressLine2: null,
          locality: "제주시",
          administrativeArea: "제주특별자치도",
        },
      },
    });
    expect(quoted).toMatchObject({
      status: 200,
      body: {
        draft: {
          status: "shipping-selection-required",
          shippingQuote: {
            providerId: "shop-policy",
            methods: [{ id: "standard", amountMinor: 6_000 }],
          },
        },
      },
    });
    const selected = await orderDraftCall("PUT", {
      cookie,
      csrf,
      body: { draftId, expectedRevision: 2, methodId: "standard" },
    });
    expect(selected).toMatchObject({
      status: 200,
      body: {
        draft: {
          status: "reviewable",
          shippingMinor: 6_000,
          totalMinor: 31_000,
          deliveryMethod: { providerId: "shop-policy", methodId: "standard" },
        },
      },
    });
    expect(
      await orderCall("POST", {
        cookie,
        csrf,
        body: { idempotencyKey: orderId, draftId, expectedRevision: 3 },
      }),
    ).toMatchObject({
      status: 200,
      body: {
        order: {
          id: orderId,
          subtotalMinor: 25_000,
          shippingMinor: 6_000,
          totalMinor: 31_000,
          deliveryMethod: { providerId: "shop-policy", methodId: "standard" },
        },
      },
    });
  });

  it("freezes revision-safe shipping and tax quotes into payment and refund totals", async () => {
    const quoteShipping = vi.fn(() => ({
      contract: "np.shop-shipping-quote-result.v1" as const,
      quoteId: "quote_integration_1",
      methods: [
        {
          id: "parcel-standard",
          label: "Standard parcel",
          amountMinor: 3_000,
          estimatedDelivery: { minimumDays: 2, maximumDays: 4 },
        },
      ],
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
    }));
    const quoteTax = vi.fn((input: { maximumExpiresAt: string }) => ({
      contract: "np.shop-tax-quote-result.v1" as const,
      quoteId: "tax_quote_integration_1",
      components: [{ id: "vat", label: "VAT", amountMinor: 2_000 }],
      amountMinor: 2_000,
      expiresAt: input.maximumExpiresAt,
    }));
    const refundPayment = vi.fn(
      (input: {
        refundId: string;
        orderId: string;
        paymentReference: string;
        currency: "KRW";
        amountMinor: number;
      }) => ({
        contract: "np.shop-refund-result.v1" as const,
        refundId: input.refundId,
        orderId: input.orderId,
        paymentReference: input.paymentReference,
        refundReference: "shipping_total_refund",
        currency: input.currency,
        amountMinor: input.amountMinor,
        refundedAt: new Date().toISOString(),
      }),
    );
    const preparePayment = vi.fn((input: { amountMinor: number }) => ({
      kind: "client" as const,
      data: { publicAmount: input.amountMinor },
    }));
    const shippingShop = createShop({
      shipping: {
        adapter: {
          id: "test-shipping",
          quoteShipping: (input) => quoteShipping(input),
        },
      },
      tax: {
        adapter: {
          id: "test-tax",
          quoteTax: (input) => quoteTax(input),
        },
      },
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
          preparePayment: (input) => preparePayment(input),
          confirmPayment: () => {
            throw new Error("not called");
          },
          renderPaymentLauncher: () => null,
          refundPayment: (input) => refundPayment(input),
        },
      },
    });
    const initial = await configuredShopCall(shippingShop, "GET", "/cart");
    const cookie = initial.headers?.["Set-Cookie"];
    const csrf = (initial.body as { csrfToken: string }).csrfToken;
    const added = await configuredShopCall(shippingShop, "POST", "/cart", {
      cookie,
      csrf,
      body: { productId, variantSku: null, quantity: 1, expectedRevision: 0 },
    });
    const addedQuote = (
      added.body as {
        quote: { revision: number; fingerprint: string };
      }
    ).quote;
    const intentId = "123e4567-e89b-42d3-b456-426614174001";
    const draftId = "123e4567-e89b-42d3-b456-426614174002";
    const orderId = "123e4567-e89b-42d3-b456-426614174003";
    await configuredShopCall(shippingShop, "POST", "/checkout", {
      cookie,
      csrf,
      body: {
        idempotencyKey: intentId,
        expectedRevision: addedQuote.revision,
        expectedFingerprint: addedQuote.fingerprint,
      },
    });
    await configuredShopCall(shippingShop, "POST", "/order-drafts", {
      cookie,
      csrf,
      body: { idempotencyKey: draftId, checkoutIntentId: intentId },
    });
    const privateEmail = "shipping-private@example.com";
    const quoted = await configuredShopCall(shippingShop, "PATCH", "/order-drafts", {
      cookie,
      csrf,
      body: {
        draftId,
        expectedRevision: 1,
        customer: {
          fullName: "홍길동",
          email: privateEmail,
          phone: "010-1234-5678",
        },
        shipping: {
          recipientName: "홍길동",
          phone: "010-1234-5678",
          countryCode: "KR",
          postalCode: "04524",
          addressLine1: "서울특별시 중구 세종대로 110",
          addressLine2: null,
          locality: "중구",
          administrativeArea: "서울특별시",
        },
      },
    });
    expect(quoted).toMatchObject({ status: 200 });
    expect(quoteShipping).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: "np.shop-shipping-quote-request.v1",
        draftId,
        draftRevision: 1,
        subtotalMinor: 25_000,
        destination: expect.objectContaining({ postalCode: "04524" }),
      }),
    );
    expect(quoted).toMatchObject({
      status: 200,
      body: {
        draft: {
          status: "shipping-selection-required",
          revision: 2,
          shippingMinor: 0,
          taxMinor: 0,
          totalMinor: 25_000,
          shippingQuote: { providerId: "test-shipping", quoteId: "quote_integration_1" },
          deliveryMethod: null,
          taxQuote: null,
        },
      },
    });
    expect(quoteTax).not.toHaveBeenCalled();
    expect(
      await configuredShopCall(shippingShop, "POST", "/orders", {
        cookie,
        csrf,
        body: { idempotencyKey: orderId, draftId, expectedRevision: 2 },
      }),
    ).toMatchObject({ status: 409, body: { error: "order_source_stale" } });
    const selected = await configuredShopCall(shippingShop, "PUT", "/order-drafts", {
      cookie,
      csrf,
      body: { draftId, expectedRevision: 2, methodId: "parcel-standard" },
    });
    expect(quoteTax).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: "np.shop-tax-quote-request.v1",
        draftId,
        draftRevision: 2,
        subtotalMinor: 25_000,
        shippingMinor: 3_000,
        totalBeforeTaxMinor: 28_000,
        destination: expect.objectContaining({ postalCode: "04524" }),
        deliveryMethod: expect.objectContaining({ methodId: "parcel-standard" }),
      }),
    );
    expect(selected).toMatchObject({
      status: 200,
      body: {
        draft: {
          status: "reviewable",
          revision: 3,
          shippingMinor: 3_000,
          taxMinor: 2_000,
          totalMinor: 30_000,
          deliveryMethod: {
            providerId: "test-shipping",
            methodId: "parcel-standard",
            amountMinor: 3_000,
          },
          taxQuote: {
            providerId: "test-tax",
            quoteId: "tax_quote_integration_1",
            amountMinor: 2_000,
          },
        },
      },
    });
    const created = await configuredShopCall(shippingShop, "POST", "/orders", {
      cookie,
      csrf,
      body: { idempotencyKey: orderId, draftId, expectedRevision: 3 },
    });
    expect(created).toMatchObject({
      status: 200,
      body: {
        order: {
          id: orderId,
          subtotalMinor: 25_000,
          shippingMinor: 3_000,
          taxMinor: 2_000,
          totalMinor: 30_000,
          deliveryMethod: { methodId: "parcel-standard", amountMinor: 3_000 },
          taxQuote: { providerId: "test-tax", amountMinor: 2_000 },
        },
      },
    });
    expect(
      JSON.stringify((created.body as { order: { deliveryMethod: unknown } }).order.deliveryMethod),
    ).not.toContain(privateEmail);
    expect(
      await configuredShopCall(shippingShop, "POST", "/payments/attempts", {
        cookie,
        csrf,
        body: {
          orderId,
          idempotencyKey: "123e4567-e89b-42d3-b456-426614174006",
        },
      }),
    ).toMatchObject({
      status: 200,
      body: { attempt: { currency: "KRW", amountMinor: 30_000 } },
    });
    expect(preparePayment).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 30_000 }));
    expect(
      await payPendingOrder(shippingShop, {
        orderId,
        eventId: "evt_shipping_total",
        paymentReference: "pay_shipping_total",
        amountMinor: 30_000,
      }),
    ).toMatchObject({ status: 200, body: { receipt: { outcome: "paid" } } });
    const staff = await seedUser({ email: "shipping-refund-operator@example.com" });
    expect(
      await withCurrentSite("default", () =>
        shippingShop.plugin.actions?.refundOrder?.handler(
          {
            row: { id: orderId, revision: 2 },
            values: { reason: "Refund exact delivery total" },
          },
          { actionInvocation: { kind: "staff", userId: staff.userId } } as never,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({ orderId, currency: "KRW", amountMinor: 30_000 }),
    );
    expect(
      await withCurrentSite("default", () =>
        shippingShop.plugin.actions?.orderDraftHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });

    quoteShipping.mockImplementationOnce(() => {
      throw new Error(`provider rejected ${privateEmail}`);
    });
    const failedIntentId = "123e4567-e89b-42d3-b456-426614174004";
    const failedDraftId = "123e4567-e89b-42d3-b456-426614174005";
    await configuredShopCall(shippingShop, "POST", "/checkout", {
      cookie,
      csrf,
      body: {
        idempotencyKey: failedIntentId,
        expectedRevision: addedQuote.revision,
        expectedFingerprint: addedQuote.fingerprint,
      },
    });
    await configuredShopCall(shippingShop, "POST", "/order-drafts", {
      cookie,
      csrf,
      body: { idempotencyKey: failedDraftId, checkoutIntentId: failedIntentId },
    });
    const unavailable = await configuredShopCall(shippingShop, "PATCH", "/order-drafts", {
      cookie,
      csrf,
      body: {
        draftId: failedDraftId,
        expectedRevision: 1,
        customer: {
          fullName: "홍길동",
          email: privateEmail,
          phone: "010-1234-5678",
        },
        shipping: {
          recipientName: "홍길동",
          phone: "010-1234-5678",
          countryCode: "KR",
          postalCode: "04524",
          addressLine1: "서울특별시 중구 세종대로 110",
          addressLine2: null,
          locality: "중구",
          administrativeArea: "서울특별시",
        },
      },
    });
    expect(unavailable).toMatchObject({
      status: 503,
      body: { error: "shipping_unavailable" },
    });
    expect(JSON.stringify(unavailable)).not.toContain(privateEmail);
    const failedHealth = await withCurrentSite("default", () =>
      shippingShop.plugin.actions?.orderDraftHealth?.handler(undefined, {} as never),
    );
    expect(failedHealth).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("provider-error") },
    });
    expect(JSON.stringify(failedHealth)).not.toContain(privateEmail);

    const taxFailedIntentId = "123e4567-e89b-42d3-b456-426614174007";
    const taxFailedDraftId = "123e4567-e89b-42d3-b456-426614174008";
    await configuredShopCall(shippingShop, "POST", "/checkout", {
      cookie,
      csrf,
      body: {
        idempotencyKey: taxFailedIntentId,
        expectedRevision: addedQuote.revision,
        expectedFingerprint: addedQuote.fingerprint,
      },
    });
    await configuredShopCall(shippingShop, "POST", "/order-drafts", {
      cookie,
      csrf,
      body: { idempotencyKey: taxFailedDraftId, checkoutIntentId: taxFailedIntentId },
    });
    const taxQuoted = await configuredShopCall(shippingShop, "PATCH", "/order-drafts", {
      cookie,
      csrf,
      body: {
        draftId: taxFailedDraftId,
        expectedRevision: 1,
        customer: {
          fullName: "홍길동",
          email: privateEmail,
          phone: "010-1234-5678",
        },
        shipping: {
          recipientName: "홍길동",
          phone: "010-1234-5678",
          countryCode: "KR",
          postalCode: "04524",
          addressLine1: "서울특별시 중구 세종대로 110",
          addressLine2: null,
          locality: "중구",
          administrativeArea: "서울특별시",
        },
      },
    });
    expect(taxQuoted).toMatchObject({
      status: 200,
      body: { draft: { status: "shipping-selection-required", revision: 2 } },
    });
    quoteTax.mockImplementationOnce(() => {
      throw new Error(`tax provider rejected ${privateEmail}`);
    });
    const taxUnavailable = await configuredShopCall(shippingShop, "PUT", "/order-drafts", {
      cookie,
      csrf,
      body: {
        draftId: taxFailedDraftId,
        expectedRevision: 2,
        methodId: "parcel-standard",
      },
    });
    expect(taxUnavailable).toMatchObject({
      status: 503,
      body: { error: "tax_unavailable" },
    });
    expect(JSON.stringify(taxUnavailable)).not.toContain(privateEmail);
    const taxFailedHealth = await withCurrentSite("default", () =>
      shippingShop.plugin.actions?.orderDraftHealth?.handler(undefined, {} as never),
    );
    expect(taxFailedHealth).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("Tax quote provider test-tax") },
    });
    expect(JSON.stringify(taxFailedHealth)).not.toContain(privateEmail);

    quoteTax.mockClear();
    const taxOnlyShop = createShop({
      tax: {
        adapter: {
          id: "test-tax",
          quoteTax: (input) => quoteTax(input),
        },
      },
    });
    const taxOnlyIntentId = "123e4567-e89b-42d3-b456-426614174009";
    const taxOnlyDraftId = "123e4567-e89b-42d3-b456-426614174010";
    await configuredShopCall(taxOnlyShop, "POST", "/checkout", {
      cookie,
      csrf,
      body: {
        idempotencyKey: taxOnlyIntentId,
        expectedRevision: addedQuote.revision,
        expectedFingerprint: addedQuote.fingerprint,
      },
    });
    await configuredShopCall(taxOnlyShop, "POST", "/order-drafts", {
      cookie,
      csrf,
      body: { idempotencyKey: taxOnlyDraftId, checkoutIntentId: taxOnlyIntentId },
    });
    const taxOnlyQuoted = await configuredShopCall(taxOnlyShop, "PATCH", "/order-drafts", {
      cookie,
      csrf,
      body: {
        draftId: taxOnlyDraftId,
        expectedRevision: 1,
        customer: {
          fullName: "홍길동",
          email: privateEmail,
          phone: "010-1234-5678",
        },
        shipping: {
          recipientName: "홍길동",
          phone: "010-1234-5678",
          countryCode: "KR",
          postalCode: "04524",
          addressLine1: "서울특별시 중구 세종대로 110",
          addressLine2: null,
          locality: "중구",
          administrativeArea: "서울특별시",
        },
      },
    });
    expect(quoteTax).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: taxOnlyDraftId,
        draftRevision: 1,
        shippingMinor: 0,
        totalBeforeTaxMinor: 25_000,
        deliveryMethod: null,
      }),
    );
    expect(taxOnlyQuoted).toMatchObject({
      status: 200,
      body: {
        draft: {
          status: "reviewable",
          revision: 2,
          shippingMinor: 0,
          taxMinor: 2_000,
          totalMinor: 27_000,
          deliveryMethod: null,
          taxQuote: { providerId: "test-tax", amountMinor: 2_000 },
        },
      },
    });
  });

  it("cleans only expired private order-draft keys", async () => {
    const db = await getTestDb();
    const expiredAt = new Date(Date.now() - 60_000);
    await db.insert(npPluginStorage).values([
      {
        pluginId: "shop",
        siteId: "default",
        key: "order-draft:guest:expired",
        value: { private: "must disappear" },
        expiresAt: expiredAt,
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: "order-cache:expired",
        value: { private: "must remain" },
        expiresAt: expiredAt,
      },
    ]);
    const cleanup = shopPlugin.scheduled?.find(
      (task) => task.id === "cleanup-expired-order-drafts",
    );
    await withCurrentSite("default", () => cleanup?.handler({} as never));
    const remaining = await db
      .select({ key: npPluginStorage.key })
      .from(npPluginStorage)
      .where(and(eq(npPluginStorage.pluginId, "shop"), eq(npPluginStorage.siteId, "default")));
    expect(remaining.map((row) => row.key)).toContain("order-cache:expired");
    expect(remaining.some((row) => row.key.startsWith("order-draft:"))).toBe(false);
  });

  it("creates one durable pending order while isolating and deleting private data", async () => {
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
    const intentId = "a33e4567-e89b-42d3-a456-426614174000";
    const draftId = "b33e4567-e89b-42d3-a456-426614174000";
    const orderId = "c33e4567-e89b-42d3-a456-426614174000";
    await checkoutCall("POST", {
      cookie,
      csrf: addedBody.csrfToken,
      body: {
        idempotencyKey: intentId,
        expectedRevision: addedBody.quote.revision,
        expectedFingerprint: addedBody.quote.fingerprint,
      },
    });
    await orderDraftCall("POST", {
      cookie,
      csrf: addedBody.csrfToken,
      body: { idempotencyKey: draftId, checkoutIntentId: intentId },
    });
    const privateEmail = "durable-order@example.com";
    await orderDraftCall("PATCH", {
      cookie,
      csrf: addedBody.csrfToken,
      body: {
        draftId,
        expectedRevision: 1,
        customer: {
          fullName: "홍길동",
          email: privateEmail,
          phone: "010-1234-5678",
        },
        shipping: {
          recipientName: "홍길동",
          phone: "010-1234-5678",
          countryCode: "KR",
          postalCode: "04524",
          addressLine1: "서울특별시 중구 세종대로 110",
          addressLine2: null,
          locality: "중구",
          administrativeArea: "서울특별시",
        },
      },
    });

    const createInput = {
      cookie,
      csrf: addedBody.csrfToken,
      body: { idempotencyKey: orderId, draftId, expectedRevision: 2 },
    };
    const [created, repeated] = await Promise.all([
      orderCall("POST", createInput),
      orderCall("POST", createInput),
    ]);
    expect(created).toMatchObject({
      status: 200,
      body: {
        order: {
          contract: "np.shop-order.v1",
          id: orderId,
          status: "pending-payment",
          revision: 1,
          privateDataStatus: "retained",
          inventoryReservationStatus: "held",
          inventoryReservationLineKeys: [`${productId}:_`],
          customer: { email: privateEmail },
        },
      },
    });
    expect(repeated.body).toEqual(created.body);
    expect(await orderDraftCall("GET", { cookie, draftId })).toMatchObject({
      status: 404,
      body: { error: "order_draft_not_found" },
    });
    expect(await orderCall("GET", { orderId, member: { id: memberId } })).toMatchObject({
      status: 404,
      body: { error: "order_not_found" },
    });
    expect(await orderCall("GET", { cookie })).toMatchObject({
      status: 200,
      body: { list: { contract: "np.shop-order-list.v1", total: 1, orders: [{ id: orderId }] } },
    });

    const db = await getTestDb();
    const stored = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "order%:%"),
        ),
      );
    const commercial = stored.find((row) => row.key.startsWith("order:"));
    const privateSidecar = stored.find((row) => row.key.startsWith("order-private:"));
    const pendingMarker = stored.find((row) => row.key.startsWith("order-maintenance:"));
    const lookup = stored.find((row) => row.key.startsWith("order-lookup:"));
    expect(commercial).toBeDefined();
    expect(privateSidecar).toBeDefined();
    expect(pendingMarker).toBeDefined();
    expect(lookup).toBeDefined();
    expect(JSON.stringify(commercial)).not.toContain(privateEmail);
    expect(JSON.stringify(privateSidecar)).toContain(privateEmail);
    const [reservation] = await db
      .select({
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
      })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "inventory-reservation:%"),
        ),
      );
    expect(reservation).toMatchObject({
      key: `inventory-reservation:${productId}:_:${orderId}`,
      value: {
        contract: "np.shop-inventory-reservation.v1",
        orderId,
        productId,
        variantSku: null,
        quantity: 1,
      },
    });
    expect(JSON.stringify(reservation)).not.toContain(privateEmail);
    expect(await call("GET", { cookie })).toMatchObject({
      body: { quote: { lines: [{ stockQuantity: 7 }] } },
    });

    const recentAction = shopPlugin.actions?.recentOrders;
    const recent = await withCurrentSite("default", () =>
      recentAction?.handler(undefined, {} as never),
    );
    expect(recent).toMatchObject({
      ok: true,
      data: { total: 1, rows: [{ id: orderId, status: "pending-payment" }] },
    });
    expect(JSON.stringify(recent)).not.toContain(privateEmail);
    const orderHealth = await withCurrentSite("default", () =>
      shopPlugin.actions?.orderHealth?.handler(undefined, {} as never),
    );
    expect(orderHealth).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(JSON.stringify(orderHealth)).not.toContain(privateEmail);
    const inventoryHealth = await withCurrentSite("default", () =>
      shopPlugin.actions?.inventoryReservationHealth?.handler(undefined, {} as never),
    );
    expect(inventoryHealth).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(JSON.stringify(inventoryHealth)).not.toContain(privateEmail);
    await db.delete(npPluginStorage).where(eq(npPluginStorage.key, reservation?.key ?? ""));
    const missingInventoryHealth = await withCurrentSite("default", () =>
      shopPlugin.actions?.inventoryReservationHealth?.handler(undefined, {} as never),
    );
    expect(missingInventoryHealth).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 missing") },
    });
    await db.insert(npPluginStorage).values({
      pluginId: "shop",
      siteId: "default",
      key: reservation?.key ?? "",
      value: reservation?.value ?? {},
      expiresAt: reservation?.expiresAt,
    });

    const cancelled = await orderCall("DELETE", {
      cookie,
      csrf: addedBody.csrfToken,
      body: { orderId, expectedRevision: 1 },
    });
    expect(cancelled).toMatchObject({
      status: 200,
      body: {
        order: {
          id: orderId,
          status: "cancelled",
          revision: 2,
          privateDataStatus: "redacted",
          inventoryReservationStatus: "released",
          customer: null,
          shipping: null,
          cancellationReason: "customer",
        },
      },
    });
    const repeatedCancel = await orderCall("DELETE", {
      cookie,
      csrf: addedBody.csrfToken,
      body: { orderId, expectedRevision: 1 },
    });
    expect(repeatedCancel.body).toEqual(cancelled.body);
    const remainingPrivate = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "order-%"),
        ),
      );
    expect(
      remainingPrivate.filter(
        (row) => row.key.startsWith("order-private:") || row.key.startsWith("order-maintenance:"),
      ),
    ).toHaveLength(0);
    expect(remainingPrivate.some((row) => row.key.startsWith("order-lookup:"))).toBe(true);
    expect(JSON.stringify(remainingPrivate)).not.toContain(privateEmail);
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(like(npPluginStorage.key, "inventory-reservation:%")),
    ).toHaveLength(0);
    expect(await call("GET", { cookie })).toMatchObject({
      body: { quote: { lines: [{ stockQuantity: 8 }] } },
    });
    expect(await orderCall("GET", { cookie, orderId })).toMatchObject({
      body: { order: { status: "cancelled", privateDataStatus: "redacted" } },
    });

    const expiredPurgeAt = new Date(Date.now() - 1_000);
    const expiredCreatedAt = new Date(expiredPurgeAt.getTime() - 365 * 24 * 60 * 60 * 1_000);
    const expiredPendingAt = new Date(expiredCreatedAt.getTime() + 24 * 60 * 60 * 1_000);
    await db
      .update(npPluginStorage)
      .set({
        value: {
          ...((commercial?.value ?? {}) as Record<string, unknown>),
          status: "cancelled",
          revision: 2,
          privateDataStatus: "redacted",
          inventoryReservationStatus: "released",
          createdAt: expiredCreatedAt.toISOString(),
          updatedAt: expiredPendingAt.toISOString(),
          pendingExpiresAt: expiredPendingAt.toISOString(),
          cancelledAt: expiredPendingAt.toISOString(),
          cancellationReason: "customer",
          purgeAt: expiredPurgeAt.toISOString(),
        },
        expiresAt: expiredPurgeAt,
      })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, commercial?.key ?? ""),
        ),
      );
    expect(await orderCall("GET", { cookie })).toMatchObject({
      status: 200,
      body: { list: { total: 0, orders: [] } },
    });
  });

  it("serializes competing orders and allows only one reservation for the final unit", async () => {
    const db = await getTestDb();
    await db
      .update(shopProductsTable)
      .set({ stockQuantity: 1, lowStockThreshold: 0 })
      .where(eq(shopProductsTable.id, productId));

    async function prepareOrder(ids: { intentId: string; draftId: string; orderId: string }) {
      const initial = await call("GET");
      const cookie = initial.headers?.["Set-Cookie"];
      const csrfToken = (initial.body as { csrfToken: string }).csrfToken;
      const added = await call("POST", {
        cookie,
        csrf: csrfToken,
        body: { productId, variantSku: null, quantity: 1, expectedRevision: 0 },
      });
      const quote = (
        added.body as {
          quote: { revision: number; fingerprint: string };
        }
      ).quote;
      await checkoutCall("POST", {
        cookie,
        csrf: csrfToken,
        body: {
          idempotencyKey: ids.intentId,
          expectedRevision: quote.revision,
          expectedFingerprint: quote.fingerprint,
        },
      });
      await orderDraftCall("POST", {
        cookie,
        csrf: csrfToken,
        body: { idempotencyKey: ids.draftId, checkoutIntentId: ids.intentId },
      });
      await orderDraftCall("PATCH", {
        cookie,
        csrf: csrfToken,
        body: {
          draftId: ids.draftId,
          expectedRevision: 1,
          customer: {
            fullName: "Inventory customer",
            email: `${ids.orderId.slice(0, 8)}@example.com`,
            phone: "010-1234-5678",
          },
          shipping: {
            recipientName: "Inventory customer",
            phone: "010-1234-5678",
            countryCode: "KR",
            postalCode: "04524",
            addressLine1: "1 Sejong-daero",
            addressLine2: null,
            locality: "Jung-gu",
            administrativeArea: "Seoul",
          },
        },
      });
      return {
        cookie,
        csrf: csrfToken,
        body: {
          idempotencyKey: ids.orderId,
          draftId: ids.draftId,
          expectedRevision: 2,
        },
      };
    }

    const [first, second] = await Promise.all([
      prepareOrder({
        intentId: "a43e4567-e89b-42d3-a456-426614174000",
        draftId: "b43e4567-e89b-42d3-a456-426614174000",
        orderId: "c43e4567-e89b-42d3-a456-426614174000",
      }),
      prepareOrder({
        intentId: "a53e4567-e89b-42d3-a456-426614174000",
        draftId: "b53e4567-e89b-42d3-a456-426614174000",
        orderId: "c53e4567-e89b-42d3-a456-426614174000",
      }),
    ]);
    const responses = await Promise.all([orderCall("POST", first), orderCall("POST", second)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({
      error: "order_inventory_unavailable",
    });
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(like(npPluginStorage.key, "inventory-reservation:%")),
    ).toHaveLength(1);
  });

  it("idempotently resolves verified payment events and atomically consumes or releases stock", async () => {
    const successIds = {
      intentId: "133e4567-e89b-42d3-a456-426614174000",
      draftId: "233e4567-e89b-42d3-a456-426614174000",
      orderId: "333e4567-e89b-42d3-a456-426614174000",
    };
    const failedIds = {
      intentId: "433e4567-e89b-42d3-a456-426614174000",
      draftId: "533e4567-e89b-42d3-a456-426614174000",
      orderId: "633e4567-e89b-42d3-a456-426614174000",
    };
    const successOwner = await createPendingOrder(successIds, "paid-private@example.com");
    const paymentShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
          refundPayment: (input) => ({
            contract: "np.shop-refund-result.v1",
            refundId: input.refundId,
            orderId: input.orderId,
            paymentReference: input.paymentReference,
            refundReference: "refund_shipped_transaction",
            currency: input.currency,
            amountMinor: input.amountMinor,
            refundedAt: new Date().toISOString(),
          }),
        },
      },
    });
    const paymentHandler = paymentShop.plugin.routes?.find(
      (candidate) => candidate.path === "/payments/webhook",
    )?.handler;
    expect(paymentHandler).toBeDefined();
    async function paymentCall(event: Record<string, unknown>) {
      const rawBody = new TextEncoder().encode(JSON.stringify(event));
      return withCurrentSite("default", () =>
        paymentHandler?.(
          {
            method: "POST",
            path: "/payments/webhook",
            params: { pluginId: "shop" },
            query: {},
            bodyMode: "raw",
            body: undefined,
            rawBody,
            headers: { "x-test-signature": "verified-by-adapter" },
          },
          {} as never,
        ),
      );
    }
    const succeededEvent = {
      contract: "np.shop-payment-event.v1",
      eventId: "evt_success_1",
      type: "payment.succeeded",
      orderId: successIds.orderId,
      paymentReference: "pay_success_1",
      currency: "KRW",
      amountMinor: 25_000,
      signedAt: new Date().toISOString(),
    };
    const paid = await paymentCall(succeededEvent);
    expect(paid).toMatchObject({
      status: 200,
      body: {
        duplicate: false,
        receipt: { outcome: "paid", orderStatus: "paid", orderRevision: 2 },
      },
    });
    const repeated = await paymentCall(succeededEvent);
    expect(repeated).toMatchObject({
      status: 200,
      body: { duplicate: true, receipt: { outcome: "paid" } },
    });
    expect(
      await paymentCall({ ...succeededEvent, paymentReference: "pay_conflict" }),
    ).toMatchObject({
      status: 409,
      body: { error: "payment_event_conflict" },
    });
    const db = await getTestDb();
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(like(npPluginStorage.key, `inventory-reservation:%:${successIds.orderId}`)),
    ).toHaveLength(0);
    expect(await orderCall("GET", { ...successOwner, orderId: successIds.orderId })).toMatchObject({
      body: {
        order: {
          status: "paid",
          inventoryReservationStatus: "consumed",
          paymentProvider: "test-pay",
          fulfillment: {
            contract: "np.shop-fulfillment.v1",
            status: "awaiting",
            revision: 1,
            privateDataStatus: "retained",
          },
        },
      },
    });
    const paidStorage = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, `%${successIds.orderId}`),
        ),
      );
    const paidPrivate = paidStorage.find((row) => row.key.startsWith("order-private:"))?.value as
      { contract?: string; retainedAt?: string; expiresAt?: string } | undefined;
    const fulfillment = paidStorage.find((row) => row.key.startsWith("fulfillment:"))?.value as
      { contract?: string; createdAt?: string; privateExpiresAt?: string } | undefined;
    expect(paidPrivate).toMatchObject({ contract: "np.shop-order-private.v2" });
    expect(fulfillment).toMatchObject({ contract: "np.shop-fulfillment-storage.v1" });
    expect(paidPrivate?.retainedAt).toBe(fulfillment?.createdAt);
    expect(paidPrivate?.expiresAt).toBe(fulfillment?.privateExpiresAt);
    expect(
      new Date(paidPrivate?.expiresAt ?? 0).getTime() -
        new Date(paidPrivate?.retainedAt ?? 0).getTime(),
    ).toBe(30 * 24 * 60 * 60 * 1_000);
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.orderHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.fulfillmentHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    const staff = await seedUser({ email: "fulfillment@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    const row = { id: successIds.orderId, fulfillmentRevision: 1 };
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.readFulfillmentPrivate?.handler({ row, values: {} }, {
          actionInvocation: { kind: "plugin", pluginId: "test" },
        } as never),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("direct staff") });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.readFulfillmentPrivate?.handler({ row, values: {} }, {
          actionInvocation: {
            kind: "staff",
            userId: "a33e4567-e89b-42d3-a456-426614174000",
          },
        } as never),
      ),
    ).toMatchObject({ ok: false });
    const privateResult = await withCurrentSite("default", () =>
      paymentShop.plugin.actions?.readFulfillmentPrivate?.handler(
        { row, values: {} },
        actionContext,
      ),
    );
    expect(privateResult).toMatchObject({
      ok: true,
      data: {
        customer: { email: "paid-private@example.com" },
        shipping: { postalCode: "04524" },
      },
    });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.processFulfillment?.handler(
          { row, values: { operatorNote: "Packed without private values" } },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("revision 2") });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.shipFulfillment?.handler(
          {
            row,
            values: { carrier: "Parcel Co", trackingNumber: "TRACK-123", operatorNote: "" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("changed") });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.shipFulfillment?.handler(
          {
            row: { ...row, fulfillmentRevision: 2 },
            values: { carrier: "Parcel Co", trackingNumber: "TRACK-123", operatorNote: "" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("revision 3") });
    expect(await orderCall("GET", { ...successOwner, orderId: successIds.orderId })).toMatchObject({
      body: {
        order: {
          status: "paid",
          revision: 3,
          privateDataStatus: "redacted",
          customer: null,
          shipping: null,
          fulfillment: {
            status: "shipped",
            revision: 3,
            privateDataStatus: "redacted",
            carrier: "Parcel Co",
            trackingNumber: "TRACK-123",
          },
        },
      },
    });
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(like(npPluginStorage.key, `order-private:%:${successIds.orderId}`)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ action: npAuditEvents.action, targetId: npAuditEvents.targetId })
        .from(npAuditEvents)
        .where(eq(npAuditEvents.targetId, successIds.orderId)),
    ).toEqual(
      expect.arrayContaining([
        { action: "shop.fulfillment.private.read", targetId: successIds.orderId },
        { action: "shop.fulfillment.process", targetId: successIds.orderId },
        { action: "shop.fulfillment.ship", targetId: successIds.orderId },
      ]),
    );
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.recentFulfillments?.handler(undefined, {} as never),
      ),
    ).toMatchObject({
      ok: true,
      data: {
        rows: [
          {
            id: successIds.orderId,
            status: "shipped",
            operatorNote: "Packed without private values",
          },
        ],
      },
    });
    expect(
      await orderCall("DELETE", {
        ...successOwner,
        body: { orderId: successIds.orderId, expectedRevision: 2 },
      }),
    ).toMatchObject({ status: 409, body: { error: "order_not_cancellable" } });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.refundOrder?.handler(
          {
            row: { id: successIds.orderId, revision: 3 },
            values: { reason: "Customer requested post-shipment refund" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({
      ok: true,
      data: expect.stringContaining(
        "inventory not-applicable-shipped, fulfillment shipped-retained",
      ),
    });
    expect(await orderCall("GET", { ...successOwner, orderId: successIds.orderId })).toMatchObject({
      body: {
        order: {
          status: "refunded",
          revision: 4,
          fulfillment: { status: "shipped", revision: 3 },
          refund: {
            inventoryOutcome: "not-applicable-shipped",
            fulfillmentOutcome: "shipped-retained",
          },
        },
      },
    });
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);

    const failedOwner = await createPendingOrder(failedIds, "failed-private@example.com");
    expect(
      await paymentCall({
        ...succeededEvent,
        eventId: "evt_wrong_amount",
        orderId: failedIds.orderId,
        paymentReference: "pay_wrong_amount",
        amountMinor: 1,
        signedAt: new Date().toISOString(),
      }),
    ).toMatchObject({
      status: 409,
      body: { error: "payment_amount_mismatch" },
    });
    const failed = await paymentCall({
      ...succeededEvent,
      eventId: "evt_failed_1",
      type: "payment.failed",
      orderId: failedIds.orderId,
      paymentReference: "pay_failed_1",
      signedAt: new Date().toISOString(),
    });
    expect(failed).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "payment-failed", orderStatus: "payment-failed" } },
    });
    expect(await orderCall("GET", { ...failedOwner, orderId: failedIds.orderId })).toMatchObject({
      body: {
        order: {
          status: "payment-failed",
          privateDataStatus: "redacted",
          inventoryReservationStatus: "released",
          customer: null,
          shipping: null,
        },
      },
    });
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);
    const paymentRows = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(like(npPluginStorage.key, "payment-event:%"));
    expect(paymentRows).toHaveLength(2);
    expect(JSON.stringify(paymentRows)).not.toContain("paid-private@example.com");
    expect(JSON.stringify(paymentRows)).not.toContain("failed-private@example.com");
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.paymentEventHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });

    await db.insert(shopProductsVariantsTable).values({
      parentId: productId,
      order: 0,
      name: "Large",
      sku: "CUP-L",
      optionSummary: "500 ml",
      priceMinor: 30_000,
      stockQuantity: 3,
      enabled: true,
    });
    const variantIds = {
      intentId: "733e4567-e89b-42d3-a456-426614174000",
      draftId: "833e4567-e89b-42d3-a456-426614174000",
      orderId: "933e4567-e89b-42d3-a456-426614174000",
    };
    await createPendingOrder(variantIds, "variant-private@example.com", {
      variantSku: "CUP-L",
      quantity: 2,
    });
    expect(
      await paymentCall({
        ...succeededEvent,
        eventId: "evt_variant_success",
        orderId: variantIds.orderId,
        paymentReference: "pay_variant_success",
        amountMinor: 60_000,
        signedAt: new Date().toISOString(),
      }),
    ).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "paid", orderStatus: "paid" } },
    });
    expect(
      await db
        .select({
          sku: shopProductsVariantsTable.sku,
          stockQuantity: shopProductsVariantsTable.stockQuantity,
        })
        .from(shopProductsVariantsTable)
        .where(eq(shopProductsVariantsTable.parentId, productId)),
    ).toEqual([{ sku: "CUP-L", stockQuantity: 1 }]);
    expect(
      await db
        .select({
          available: shopProductsTable.available,
          inventoryState: shopProductsTable.inventoryState,
        })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ available: true, inventoryState: "low-stock" }]);
  });

  it("converges provider-initiated full reversals and blocks ambiguous partial adjustments", async () => {
    const fullIds = {
      intentId: "173e4567-e89b-42d3-a456-426614174000",
      draftId: "273e4567-e89b-42d3-a456-426614174000",
      orderId: "373e4567-e89b-42d3-a456-426614174000",
    };
    const partialIds = {
      intentId: "473e4567-e89b-42d3-a456-426614174000",
      draftId: "573e4567-e89b-42d3-a456-426614174000",
      orderId: "673e4567-e89b-42d3-a456-426614174000",
    };
    const fullOwner = await createPendingOrder(fullIds, "full-adjustment@example.com");
    const adjustmentShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
          refundPayment: (input) => ({
            contract: "np.shop-refund-result.v1" as const,
            refundId: input.refundId,
            orderId: input.orderId,
            paymentReference: input.paymentReference,
            refundReference: "unused_after_adjustment",
            currency: input.currency,
            amountMinor: input.amountMinor,
            refundedAt: new Date().toISOString(),
          }),
        },
      },
    });
    await payPendingOrder(adjustmentShop, {
      orderId: fullIds.orderId,
      eventId: "evt_full_adjustment_paid",
      paymentReference: "pay_full_adjustment",
    });
    const fullEvent = {
      contract: "np.shop-payment-adjustment-event.v1",
      eventId: "adjustment_full_1",
      orderId: fullIds.orderId,
      paymentReference: "pay_full_adjustment",
      currency: "KRW",
      originalAmountMinor: 25_000,
      remainingAmountMinor: 0,
      cancellations: [
        {
          reference: "provider_full_cancel_1",
          amountMinor: 25_000,
          cancelledAt: new Date().toISOString(),
        },
      ],
      signedAt: new Date().toISOString(),
    } as const;
    const applied = await configuredShopCall(adjustmentShop, "POST", "/payments/webhook", {
      rawBody: new TextEncoder().encode(JSON.stringify(fullEvent)),
    });
    expect(applied).toMatchObject({
      status: 200,
      body: {
        duplicate: false,
        adjustment: { outcome: "applied-full-reversal", orderStatus: "refunded" },
      },
    });
    expect(
      await configuredShopCall(adjustmentShop, "POST", "/payments/webhook", {
        rawBody: new TextEncoder().encode(JSON.stringify(fullEvent)),
      }),
    ).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(await orderCall("GET", { ...fullOwner, orderId: fullIds.orderId })).toMatchObject({
      body: {
        order: {
          status: "refunded",
          privateDataStatus: "redacted",
          fulfillment: { status: "cancelled" },
          refund: {
            status: "refunded",
            inventoryOutcome: "restocked",
            fulfillmentOutcome: "cancelled",
          },
          paymentAdjustment: {
            status: "applied-full-reversal",
            reversedAmountMinor: 25_000,
            remainingAmountMinor: 0,
            cancellationCount: 1,
          },
        },
      },
    });
    const db = await getTestDb();
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 8 }]);

    const partialOwner = await createPendingOrder(partialIds, "partial-adjustment@example.com");
    await payPendingOrder(adjustmentShop, {
      orderId: partialIds.orderId,
      eventId: "evt_partial_adjustment_paid",
      paymentReference: "pay_partial_adjustment",
    });
    expect(
      await configuredShopCall(adjustmentShop, "POST", "/payments/webhook", {
        rawBody: new TextEncoder().encode(
          JSON.stringify({
            ...fullEvent,
            eventId: "adjustment_partial_1",
            orderId: partialIds.orderId,
            paymentReference: "pay_partial_adjustment",
            remainingAmountMinor: 15_000,
            cancellations: [
              {
                reference: "provider_partial_cancel_1",
                amountMinor: 10_000,
                cancelledAt: new Date().toISOString(),
              },
            ],
            signedAt: new Date().toISOString(),
          }),
        ),
      }),
    ).toMatchObject({
      status: 200,
      body: {
        adjustment: { outcome: "manual-review", orderStatus: "paid", orderRevision: 2 },
      },
    });
    expect(await orderCall("GET", { ...partialOwner, orderId: partialIds.orderId })).toMatchObject({
      body: {
        order: {
          status: "paid",
          paymentAdjustment: {
            status: "manual-review",
            originalAmountMinor: 25_000,
            reversedAmountMinor: 10_000,
            remainingAmountMinor: 15_000,
            cancellationCount: 1,
          },
        },
      },
    });
    const staff = await seedUser({ email: "adjustment-operator@example.com" });
    const context = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    expect(
      await withCurrentSite("default", () =>
        adjustmentShop.plugin.actions?.processFulfillment?.handler(
          {
            row: { id: partialIds.orderId, fulfillmentRevision: 1 },
            values: { operatorNote: "must remain blocked" },
          },
          context,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("payment adjustment") });
    expect(
      await withCurrentSite("default", () =>
        adjustmentShop.plugin.actions?.refundOrder?.handler(
          {
            row: { id: partialIds.orderId, revision: 2 },
            values: { reason: "must remain blocked" },
          },
          context,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("payment adjustment") });
    expect(
      await withCurrentSite("default", () =>
        adjustmentShop.plugin.actions?.paymentAdjustmentHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "warn" } });
    expect(
      await withCurrentSite("default", () =>
        adjustmentShop.plugin.actions?.recentPaymentAdjustments?.handler(undefined, {} as never),
      ),
    ).toMatchObject({
      ok: true,
      data: {
        rows: [
          { orderId: partialIds.orderId, outcome: "manual-review" },
          { orderId: fullIds.orderId, outcome: "applied-full-reversal" },
        ],
      },
    });

    const knownIds = {
      intentId: "773e4567-e89b-42d3-a456-426614174000",
      draftId: "873e4567-e89b-42d3-a456-426614174000",
      orderId: "973e4567-e89b-42d3-a456-426614174000",
    };
    await createPendingOrder(knownIds, "known-adjustment@example.com");
    await payPendingOrder(adjustmentShop, {
      orderId: knownIds.orderId,
      eventId: "evt_known_adjustment_paid",
      paymentReference: "pay_known_adjustment",
    });
    expect(
      await withCurrentSite("default", () =>
        adjustmentShop.plugin.actions?.refundOrder?.handler(
          {
            row: { id: knownIds.orderId, revision: 2 },
            values: { reason: "Known provider refund" },
          },
          context,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    expect(
      await configuredShopCall(adjustmentShop, "POST", "/payments/webhook", {
        rawBody: new TextEncoder().encode(
          JSON.stringify({
            ...fullEvent,
            eventId: "adjustment_known_refund_1",
            orderId: knownIds.orderId,
            paymentReference: "pay_known_adjustment",
            cancellations: [
              {
                reference: "unused_after_adjustment",
                amountMinor: 25_000,
                cancelledAt: new Date().toISOString(),
              },
            ],
            signedAt: new Date().toISOString(),
          }),
        ),
      }),
    ).toMatchObject({
      status: 200,
      body: {
        adjustment: { outcome: "matched-refund", orderStatus: "refunded" },
      },
    });
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);

    const cancelledIds = {
      intentId: "a73e4567-e89b-42d3-a456-426614174000",
      draftId: "b73e4567-e89b-42d3-a456-426614174000",
      orderId: "c73e4567-e89b-42d3-a456-426614174000",
    };
    const cancelledOwner = await createPendingOrder(
      cancelledIds,
      "cancelled-adjustment@example.com",
    );
    expect(
      await orderCall("DELETE", {
        ...cancelledOwner,
        body: { orderId: cancelledIds.orderId, expectedRevision: 1 },
      }),
    ).toMatchObject({ body: { order: { status: "cancelled", revision: 2 } } });
    expect(
      await configuredShopCall(adjustmentShop, "POST", "/payments/webhook", {
        rawBody: new TextEncoder().encode(
          JSON.stringify({
            ...fullEvent,
            eventId: "adjustment_cancelled_order_1",
            orderId: cancelledIds.orderId,
            paymentReference: "pay_cancelled_adjustment",
            signedAt: new Date().toISOString(),
          }),
        ),
      }),
    ).toMatchObject({
      status: 200,
      body: {
        adjustment: { outcome: "closed-unpaid-order", orderStatus: "cancelled" },
      },
    });
    expect(
      await orderCall("GET", { ...cancelledOwner, orderId: cancelledIds.orderId }),
    ).toMatchObject({
      body: {
        order: {
          status: "cancelled",
          paymentProvider: null,
          paymentAdjustment: {
            status: "closed-unpaid-order",
            reversedAmountMinor: 25_000,
          },
        },
      },
    });
  });

  it("books one idempotent carrier shipment and atomically redacts its private destination", async () => {
    const ids = {
      intentId: "a13e4567-e89b-42d3-a456-426614174000",
      draftId: "b13e4567-e89b-42d3-a456-426614174000",
      orderId: "c13e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "carrier-private@example.com");
    let providerAttempts = 0;
    const bookShipmentWithParcels = vi.fn((request: NpShopCarrierParcelBookingRequest) => {
      providerAttempts += 1;
      if (providerAttempts === 1) {
        throw new NpShopCarrierProviderError(
          "provider-timeout",
          "private destination must never escape",
          { retryable: true },
        );
      }
      return {
        contract: "np.shop-carrier-booking-result.v1" as const,
        shipmentId: request.shipmentId,
        orderId: request.orderId,
        bookingReference: "booking_transaction_1",
        carrier: "Parcel Co",
        trackingNumber: "CARRIER-TRACK-1",
        bookedAt: request.requestedAt,
      };
    });
    let trackingProviderAttempts = 0;
    const readTracking = vi.fn(async (request: NpShopTrackingPollRequest) => {
      trackingProviderAttempts += 1;
      const providerDb = await getTestDb();
      const [leasedPoll] = await providerDb
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `tracking-poll:${request.orderId}`));
      expect(leasedPoll?.value).toMatchObject({
        contract: "np.shop-tracking-poll-storage.v1",
        orderId: request.orderId,
        shipmentId: request.shipmentId,
        providerId: "test-carrier",
        leaseId: expect.any(String),
        leaseExpiresAt: expect.any(String),
      });
      if (trackingProviderAttempts === 1) {
        throw new Error("carrier-private@example.com must never reach durable poll state");
      }
      const checkedAt = new Date().toISOString();
      return {
        contract: "np.shop-tracking-poll-result.v1" as const,
        shipmentId: request.shipmentId,
        orderId: request.orderId,
        checkedAt,
        event: {
          contract: "np.shop-tracking-event.v1" as const,
          eventId: "tracking_carrier_poll_1",
          shipmentId: request.shipmentId,
          orderId: request.orderId,
          bookingReference: request.bookingReference,
          trackingNumber: request.trackingNumber,
          status: "in-transit" as const,
          occurredAt: new Date(new Date(checkedAt).getTime() - 90_000).toISOString(),
          signedAt: checkedAt,
        },
      };
    });
    const readShippingLabel = vi.fn((request: NpShopCarrierLabelRequest) => ({
      contract: "np.shop-carrier-label-result.v1" as const,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      format: "pdf" as const,
      content: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      retrievedAt: request.requestedAt,
    }));
    let pickupProviderAttempts = 0;
    const schedulePickup = vi.fn((request: NpShopCarrierPickupRequest) => {
      pickupProviderAttempts += 1;
      if (pickupProviderAttempts === 1) {
        throw new NpShopCarrierProviderError(
          "pickup-timeout",
          "carrier-private@example.com must never reach durable pickup state",
          { retryable: true },
        );
      }
      return {
        contract: "np.shop-carrier-pickup-result.v1" as const,
        pickupId: request.pickupId,
        shipmentId: request.shipmentId,
        orderId: request.orderId,
        pickupReference: "pickup_transaction_1",
        readyAt: request.readyAt,
        closeAt: request.closeAt,
        scheduledAt: new Date().toISOString(),
      };
    });
    const cancelPickup = vi.fn((request: NpShopCarrierPickupCancelRequest) => ({
      contract: "np.shop-carrier-pickup-cancel-result.v1" as const,
      cancellationId: request.cancellationId,
      pickupId: request.pickupId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      cancelledAt: new Date().toISOString(),
    }));
    const carrierShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
      carrier: {
        pickupLocationReference: "warehouse-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("legacy booking must not be called")),
          bookShipmentWithParcels,
          readShippingLabel,
          readTracking,
          schedulePickup,
          cancelPickup,
          verifyTrackingWebhook: ({ rawBody }) =>
            JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
    });
    expect(
      await payPendingOrder(carrierShop, {
        orderId: ids.orderId,
        eventId: "evt_carrier_success_1",
        paymentReference: "pay_carrier_success_1",
      }),
    ).toMatchObject({ status: 200, body: { receipt: { outcome: "paid" } } });
    const staff = await seedUser({ email: "carrier-operator@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.processFulfillment?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 1 },
            values: { operatorNote: "Packed for carrier" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("revision 2") });
    const parcelJson = JSON.stringify([
      {
        id: "parcel-1",
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
        weightGrams: 1_500,
        items: [{ lineKey: `${productId}:_`, quantity: 1 }],
      },
    ]);
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.saveFulfillmentParcels?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 2, parcelRevision: null },
            values: {
              parcels: JSON.stringify([
                {
                  id: "parcel-1",
                  lengthMm: 300,
                  widthMm: 200,
                  heightMm: 100,
                  weightGrams: 1_500,
                  items: [{ lineKey: `${productId}:_`, quantity: 2 }],
                },
              ]),
            },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("exact quantity") });
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.saveFulfillmentParcels?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 2, parcelRevision: null },
            values: { parcels: parcelJson },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("parcel revision 1") });
    const carrierAction = {
      row: { id: ids.orderId, fulfillmentRevision: 2 },
      values: { operatorNote: "Handoff ready" },
    };
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.bookCarrierShipment?.handler(carrierAction, actionContext),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("temporarily unavailable"),
    });
    const db = await getTestDb();
    const [pendingCarrier] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `carrier-booking:${ids.orderId}`));
    expect(pendingCarrier?.value).toMatchObject({
      status: "pending",
      providerErrorCode: "provider-timeout",
    });
    expect(JSON.stringify(pendingCarrier)).not.toContain("private destination must never escape");
    const [lockedParcels] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `fulfillment-parcels:${ids.orderId}`));
    expect(lockedParcels?.value).toMatchObject({
      contract: "np.shop-fulfillment-parcels-storage.v1",
      orderId: ids.orderId,
      fulfillmentRevision: 2,
      revision: 1,
      lockedShipmentId: expect.any(String),
      parcels: [{ id: "parcel-1", weightGrams: 1_500 }],
    });
    expect(JSON.stringify(lockedParcels)).not.toContain("carrier-private@example.com");
    expect(JSON.stringify(lockedParcels)).not.toContain("세종대로");
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.saveFulfillmentParcels?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 2, parcelRevision: 1 },
            values: { parcels: parcelJson },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("locked") });
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.bookCarrierShipment?.handler(carrierAction, actionContext),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    expect(bookShipmentWithParcels).toHaveBeenCalledTimes(2);
    expect(bookShipmentWithParcels.mock.calls[1]?.[0]).toMatchObject({
      contract: "np.shop-carrier-booking-request.v2",
      shipmentId: expect.any(String),
      orderId: ids.orderId,
      fulfillmentRevision: 2,
      parcelRevision: 1,
      parcels: [
        {
          id: "parcel-1",
          lengthMm: 300,
          widthMm: 200,
          heightMm: 100,
          weightGrams: 1_500,
          items: [{ lineKey: `${productId}:_`, quantity: 1 }],
        },
      ],
      destination: { postalCode: "04524", addressLine1: "서울특별시 중구 세종대로 110" },
      items: [{ productId, productName: "Everyday cup", quantity: 1 }],
    });
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.bookCarrierShipment?.handler(carrierAction, actionContext),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("already reconciled") });
    expect(bookShipmentWithParcels).toHaveBeenCalledTimes(2);
    expect(bookShipmentWithParcels.mock.calls[0]?.[0].shipmentId).toBe(
      bookShipmentWithParcels.mock.calls[1]?.[0].shipmentId,
    );
    expect(await orderCall("GET", { ...owner, orderId: ids.orderId })).toMatchObject({
      body: {
        order: {
          status: "paid",
          revision: 3,
          privateDataStatus: "redacted",
          customer: null,
          shipping: null,
          fulfillment: {
            status: "shipped",
            revision: 3,
            carrier: "Parcel Co",
            trackingNumber: "CARRIER-TRACK-1",
          },
        },
      },
    });
    const carrierRows = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(like(npPluginStorage.key, "carrier-booking:%"));
    expect(carrierRows).toHaveLength(1);
    expect(carrierRows[0]?.value).toMatchObject({
      contract: "np.shop-carrier-booking-storage.v1",
      orderId: ids.orderId,
      providerId: "test-carrier",
      status: "completed",
      carrier: "Parcel Co",
      trackingNumber: "CARRIER-TRACK-1",
      operatorNote: "Handoff ready",
    });
    expect(JSON.stringify(carrierRows)).not.toContain("carrier-private@example.com");
    expect(JSON.stringify(carrierRows)).not.toContain("세종대로");
    const trackingBase = new Date();
    trackingBase.setMilliseconds(0);
    const shipmentId = bookShipmentWithParcels.mock.calls[1]?.[0].shipmentId;
    if (!shipmentId) throw new Error("Missing durable carrier shipment id.");
    const labelResponse = await configuredShopCall(carrierShop, "GET", "/carrier/shipping-label", {
      query: { orderId: ids.orderId, shipmentId },
      user: {
        id: staff.userId,
        email: "carrier-operator@example.com",
        role: "admin",
      },
    });
    expect(labelResponse).toMatchObject({
      status: 200,
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store",
      },
    });
    expect(readShippingLabel).toHaveBeenCalledWith({
      contract: "np.shop-carrier-label-request.v1",
      shipmentId,
      orderId: ids.orderId,
      bookingReference: "booking_transaction_1",
      carrier: "Parcel Co",
      trackingNumber: "CARRIER-TRACK-1",
      requestedAt: expect.any(String),
    });
    expect(JSON.stringify(readShippingLabel.mock.calls[0]?.[0])).not.toContain(
      "carrier-private@example.com",
    );
    const readyAt = new Date(Date.now() + 60 * 60 * 1_000);
    readyAt.setMilliseconds(0);
    const closeAt = new Date(readyAt.getTime() + 3 * 60 * 60 * 1_000);
    const pickupAction = {
      row: { id: ids.orderId, shipmentId, pickupRevision: 0 },
      values: { readyAt: readyAt.toISOString(), closeAt: closeAt.toISOString() },
    };
    const pickupScheduleResult = await withCurrentSite("default", () =>
      carrierShop.plugin.actions?.scheduleCarrierPickup?.handler(pickupAction, actionContext),
    );
    expect(pickupScheduleResult).toMatchObject({
      ok: false,
      error: expect.stringContaining("temporarily unavailable"),
    });
    const [pendingPickup] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `carrier-pickup:${ids.orderId}`));
    expect(pendingPickup?.value).toMatchObject({
      status: "pending",
      revision: 2,
      providerErrorCode: "pickup-timeout",
    });
    expect(JSON.stringify(pendingPickup)).not.toContain("carrier-private@example.com");
    const pendingPickupId = (pendingPickup?.value as { id?: unknown } | undefined)?.id;
    if (typeof pendingPickupId !== "string") {
      throw new Error("Missing pending durable carrier pickup id.");
    }
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.resumeCarrierPickup?.handler(
          {
            row: { id: ids.orderId, pickupId: pendingPickupId, pickupRevision: 2 },
            values: {},
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("revision 4") });
    expect(schedulePickup).toHaveBeenCalledTimes(2);
    expect(schedulePickup.mock.calls[1]?.[0]).toMatchObject({
      contract: "np.shop-carrier-pickup-request.v1",
      shipmentId,
      orderId: ids.orderId,
      bookingReference: "booking_transaction_1",
      carrier: "Parcel Co",
      trackingNumber: "CARRIER-TRACK-1",
      locationReference: "warehouse-seoul-1",
      readyAt: readyAt.toISOString(),
      closeAt: closeAt.toISOString(),
      parcelRevision: 1,
      packages: [
        {
          id: "parcel-1",
          lengthMm: 300,
          widthMm: 200,
          heightMm: 100,
          weightGrams: 1_500,
        },
      ],
      requestedAt: expect.any(String),
    });
    expect(schedulePickup.mock.calls[0]?.[0].pickupId).toBe(
      schedulePickup.mock.calls[1]?.[0].pickupId,
    );
    expect(JSON.stringify(schedulePickup.mock.calls[1]?.[0])).not.toContain(
      "carrier-private@example.com",
    );
    expect(JSON.stringify(schedulePickup.mock.calls[1]?.[0])).not.toContain("세종대로");
    const [scheduledPickup] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `carrier-pickup:${ids.orderId}`));
    expect(scheduledPickup?.value).toMatchObject({
      contract: "np.shop-carrier-pickup-storage.v1",
      orderId: ids.orderId,
      shipmentId,
      providerId: "test-carrier",
      status: "scheduled",
      revision: 4,
      locationReference: "warehouse-seoul-1",
      parcelRevision: 1,
      pickupReference: "pickup_transaction_1",
    });
    expect(JSON.stringify(scheduledPickup)).not.toContain("carrier-private@example.com");
    const pickupId = (scheduledPickup?.value as { id?: unknown } | undefined)?.id;
    if (typeof pickupId !== "string") throw new Error("Missing durable carrier pickup id.");
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.cancelCarrierPickup?.handler(
          {
            row: { id: ids.orderId, pickupId, pickupRevision: 4 },
            values: {},
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("revision 7") });
    expect(cancelPickup).toHaveBeenCalledTimes(1);
    expect(cancelPickup.mock.calls[0]?.[0]).toMatchObject({
      contract: "np.shop-carrier-pickup-cancel-request.v1",
      pickupId,
      shipmentId,
      orderId: ids.orderId,
      pickupReference: "pickup_transaction_1",
      requestedAt: expect.any(String),
    });
    const [cancelledPickup] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `carrier-pickup:${ids.orderId}`));
    expect(cancelledPickup?.value).toMatchObject({
      status: "cancelled",
      revision: 7,
      cancellationId: expect.any(String),
      cancelledAt: expect.any(String),
    });
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.carrierPickupHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    const trackingAction = {
      row: { id: ids.orderId, shipmentId },
      values: {},
    };
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.reconcileCarrierTracking?.handler(
          trackingAction,
          actionContext,
        ),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("failure and retry backoff were persisted"),
    });
    expect(readTracking).toHaveBeenCalledTimes(1);
    expect(readTracking.mock.calls[0]?.[0]).toMatchObject({
      contract: "np.shop-tracking-poll-request.v1",
      shipmentId,
      orderId: ids.orderId,
      bookingReference: "booking_transaction_1",
      trackingNumber: "CARRIER-TRACK-1",
      current: null,
      requestedAt: expect.any(String),
    });
    expect(JSON.stringify(readTracking.mock.calls[0]?.[0])).not.toContain(
      "carrier-private@example.com",
    );
    expect(JSON.stringify(readTracking.mock.calls[0]?.[0])).not.toContain("세종대로");
    const [failedPollRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `tracking-poll:${ids.orderId}`));
    expect(failedPollRow?.value).toMatchObject({
      consecutiveFailures: 1,
      lastSuccessAt: null,
      lastErrorCode: "provider-error",
      leaseId: null,
      leaseExpiresAt: null,
    });
    expect(JSON.stringify(failedPollRow)).not.toContain("carrier-private@example.com");
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.reconcileCarrierTracking?.handler(
          trackingAction,
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("1 advanced") });
    expect(readTracking).toHaveBeenCalledTimes(2);
    const [pollRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `tracking-poll:${ids.orderId}`));
    expect(pollRow?.value).toMatchObject({
      consecutiveFailures: 0,
      lastSuccessAt: expect.any(String),
      lastErrorCode: null,
      leaseId: null,
      leaseExpiresAt: null,
    });
    await withCurrentSite("default", async () => {
      await carrierShop.plugin.scheduled
        ?.find((task) => task.id === "reconcile-carrier-tracking")
        ?.handler();
    });
    expect(readTracking).toHaveBeenCalledTimes(2);
    const [pollCursor] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, "tracking-poll-cursor"));
    expect(pollCursor?.value).toMatchObject({
      contract: "np.shop-tracking-poll-cursor.v1",
      providerId: "test-carrier",
      lastBookingKey: null,
      updatedAt: expect.any(String),
    });
    const trackingEvent = {
      contract: "np.shop-tracking-event.v1",
      eventId: "tracking_carrier_1",
      shipmentId,
      orderId: ids.orderId,
      bookingReference: "booking_transaction_1",
      trackingNumber: "CARRIER-TRACK-1",
      status: "in-transit",
      occurredAt: new Date(trackingBase.getTime() - 60_000).toISOString(),
      signedAt: trackingBase.toISOString(),
    };
    const trackingCall = (payload: Record<string, unknown>) =>
      configuredShopCall(carrierShop, "POST", "/carrier/tracking/webhook", {
        rawBody: new TextEncoder().encode(JSON.stringify(payload)),
        headers: { "x-carrier-signature": "valid" },
      });
    expect(await trackingCall(trackingEvent)).toMatchObject({
      status: 200,
      body: {
        receipt: { outcome: "advanced", trackingStatus: "in-transit" },
        duplicate: false,
      },
    });
    expect(
      await trackingCall({ ...trackingEvent, signedAt: new Date().toISOString() }),
    ).toMatchObject({
      status: 200,
      body: { duplicate: true },
    });
    expect(
      await trackingCall({
        ...trackingEvent,
        eventId: "tracking_carrier_stale",
        status: "out-for-delivery",
        occurredAt: new Date(trackingBase.getTime() - 120_000).toISOString(),
      }),
    ).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "ignored-stale", trackingStatus: "in-transit" } },
    });
    expect(
      await trackingCall({
        ...trackingEvent,
        eventId: "tracking_carrier_out",
        status: "out-for-delivery",
        occurredAt: new Date(trackingBase.getTime() - 30_000).toISOString(),
      }),
    ).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "advanced", trackingStatus: "out-for-delivery" } },
    });
    expect(
      await trackingCall({
        ...trackingEvent,
        eventId: "tracking_carrier_regression",
        occurredAt: new Date(trackingBase.getTime() - 10_000).toISOString(),
      }),
    ).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "ignored-regression", trackingStatus: "out-for-delivery" } },
    });
    expect(
      await trackingCall({
        ...trackingEvent,
        eventId: "tracking_carrier_delivered",
        status: "delivered",
        occurredAt: new Date(trackingBase.getTime() - 30_000).toISOString(),
      }),
    ).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "advanced", trackingStatus: "delivered" } },
    });
    expect(
      await trackingCall({
        ...trackingEvent,
        eventId: "tracking_carrier_terminal",
        status: "exception",
        occurredAt: trackingBase.toISOString(),
      }),
    ).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "ignored-terminal", trackingStatus: "delivered" } },
    });
    expect(await trackingCall({ ...trackingEvent, status: "exception" })).toMatchObject({
      status: 409,
      body: { error: "tracking_event_conflict" },
    });
    expect(await orderCall("GET", { ...owner, orderId: ids.orderId })).toMatchObject({
      status: 200,
      body: {
        order: {
          fulfillment: { status: "shipped" },
          tracking: {
            contract: "np.shop-tracking.v1",
            shipmentId,
            status: "delivered",
            deliveredAt: new Date(trackingBase.getTime() - 30_000).toISOString(),
          },
        },
      },
    });
    const trackingRows = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(like(npPluginStorage.key, "tracking%"));
    expect(trackingRows).toHaveLength(10);
    expect(JSON.stringify(trackingRows)).not.toContain("carrier-private@example.com");
    expect(JSON.stringify(trackingRows)).not.toContain("세종대로");
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.trackingEventHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(like(npPluginStorage.key, `order-private:%:${ids.orderId}`)),
    ).toHaveLength(0);
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.carrierBookingHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.fulfillmentParcelHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(
      await withCurrentSite("default", () =>
        carrierShop.plugin.actions?.recentFulfillmentParcels?.handler(undefined, {} as never),
      ),
    ).toMatchObject({
      ok: true,
      data: {
        total: 1,
        rows: [
          expect.objectContaining({
            id: ids.orderId,
            status: "locked",
            parcelCount: 1,
            units: 1,
            weightGrams: 1_500,
          }),
        ],
      },
    });
    expect(
      await db
        .select({ action: npAuditEvents.action })
        .from(npAuditEvents)
        .where(eq(npAuditEvents.targetId, ids.orderId)),
    ).toEqual(
      expect.arrayContaining([
        { action: "shop.carrier.booking.request" },
        { action: "shop.carrier.booking.confirm" },
        { action: "shop.carrier.label.read" },
        { action: "shop.carrier.label.deliver" },
        { action: "shop.carrier.pickup.request" },
        { action: "shop.carrier.pickup.confirm" },
        { action: "shop.carrier.pickup.schedule" },
        { action: "shop.carrier.pickup.cancel.request" },
        { action: "shop.carrier.pickup.cancel.confirm" },
        { action: "shop.carrier.pickup.cancel" },
        { action: "shop.carrier.tracking.poll" },
        { action: "shop.fulfillment.parcels.save" },
        { action: "shop.fulfillment.ship" },
      ]),
    );
  });

  it("keeps v1 carrier booking independent from an unlocked parcel snapshot", async () => {
    const ids = {
      intentId: "d23e4567-e89b-42d3-a456-426614174000",
      draftId: "e23e4567-e89b-42d3-a456-426614174000",
      orderId: "f23e4567-e89b-42d3-a456-426614174000",
    };
    await createPendingOrder(ids, "carrier-v1-private@example.com");
    const bookShipment = vi.fn((request: NpShopCarrierBookingRequest) => ({
      contract: "np.shop-carrier-booking-result.v1" as const,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      bookingReference: "booking_v1_1",
      carrier: "Legacy Parcel Co",
      trackingNumber: "LEGACY-TRACK-1",
      bookedAt: request.requestedAt,
    }));
    const legacyCarrierShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
      carrier: { adapter: { id: "legacy-carrier", bookShipment } },
    });
    expect(legacyCarrierShop.runtime.carrierParcelAdapter).toBeNull();
    expect(
      await payPendingOrder(legacyCarrierShop, {
        orderId: ids.orderId,
        eventId: "evt_carrier_v1_success_1",
        paymentReference: "pay_carrier_v1_success_1",
      }),
    ).toMatchObject({ status: 200, body: { receipt: { outcome: "paid" } } });
    const staff = await seedUser({ email: "carrier-v1-operator@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    expect(
      await withCurrentSite("default", () =>
        legacyCarrierShop.plugin.actions?.processFulfillment?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 1 },
            values: { operatorNote: "Packed for legacy carrier" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await withCurrentSite("default", () =>
        legacyCarrierShop.plugin.actions?.saveFulfillmentParcels?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 2, parcelRevision: null },
            values: {
              parcels: JSON.stringify([
                {
                  id: "parcel-1",
                  lengthMm: 300,
                  widthMm: 200,
                  heightMm: 100,
                  weightGrams: 1_500,
                  items: [{ lineKey: `${productId}:_`, quantity: 1 }],
                },
              ]),
            },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await withCurrentSite("default", () =>
        legacyCarrierShop.plugin.actions?.bookCarrierShipment?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 2 },
            values: { operatorNote: "Legacy handoff" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    expect(bookShipment).toHaveBeenCalledOnce();
    expect(bookShipment.mock.calls[0]?.[0]).toMatchObject({
      contract: "np.shop-carrier-booking-request.v1",
      orderId: ids.orderId,
    });
    expect(bookShipment.mock.calls[0]?.[0]).not.toHaveProperty("parcels");
    const v1Db = await getTestDb();
    const [v1Snapshot] = await v1Db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `fulfillment-parcels:${ids.orderId}`));
    expect(v1Snapshot?.value).toMatchObject({ lockedShipmentId: null });
    expect(
      await withCurrentSite("default", () =>
        legacyCarrierShop.plugin.actions?.fulfillmentParcelHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(
      await withCurrentSite("default", () =>
        legacyCarrierShop.plugin.actions?.recentFulfillmentParcels?.handler(undefined, {} as never),
      ),
    ).toMatchObject({
      ok: true,
      data: { rows: [expect.objectContaining({ id: ids.orderId, status: "frozen" })] },
    });
  });

  it("finishes a durable provider-confirmed shipment after its carrier adapter is removed", async () => {
    const ids = {
      intentId: "a23e4567-e89b-42d3-a456-426614174000",
      draftId: "b23e4567-e89b-42d3-a456-426614174000",
      orderId: "c23e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "carrier-resume-private@example.com");
    const paymentOnlyShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
    });
    expect(
      await payPendingOrder(paymentOnlyShop, {
        orderId: ids.orderId,
        eventId: "evt_carrier_resume_1",
        paymentReference: "pay_carrier_resume_1",
      }),
    ).toMatchObject({ status: 200, body: { receipt: { outcome: "paid" } } });
    const staff = await seedUser({ email: "carrier-resume-operator@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    expect(
      await withCurrentSite("default", () =>
        paymentOnlyShop.plugin.actions?.processFulfillment?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 1 },
            values: { operatorNote: "Provider confirmation recovery" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true });
    const db = await getTestDb();
    const [fulfillmentRow] = await db
      .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `fulfillment:${ids.orderId}`));
    expect(fulfillmentRow?.expiresAt).not.toBeNull();
    if (!fulfillmentRow?.expiresAt) throw new Error("Missing carrier recovery fulfillment.");
    const purgeAt = fulfillmentRow.expiresAt;
    const bookedAt = new Date();
    bookedAt.setMilliseconds(0);
    const bookedAtIso = bookedAt.toISOString();
    const shipmentId = "d23e4567-e89b-42d3-a456-426614174000";
    await db.insert(npPluginStorage).values({
      pluginId: "shop",
      siteId: "default",
      key: `carrier-booking:${ids.orderId}`,
      value: {
        contract: "np.shop-carrier-booking-storage.v1",
        id: shipmentId,
        orderId: ids.orderId,
        providerId: "removed-carrier",
        status: "provider-confirmed",
        fulfillmentRevision: 2,
        operatorNote: "Provider confirmation recovery",
        bookingReference: "booking_recovery_1",
        carrier: "Parcel Co",
        trackingNumber: "RECOVERY-TRACK-1",
        providerErrorCode: null,
        requestedAt: bookedAtIso,
        updatedAt: bookedAtIso,
        bookedAt: bookedAtIso,
        purgeAt: purgeAt.toISOString(),
      },
      expiresAt: purgeAt,
      updatedAt: bookedAt,
    });
    await db.insert(npPluginStorage).values({
      pluginId: "shop",
      siteId: "default",
      key: `fulfillment-parcels:${ids.orderId}`,
      value: {
        contract: "np.shop-fulfillment-parcels-storage.v1",
        orderId: ids.orderId,
        fulfillmentRevision: 2,
        revision: 1,
        parcels: [
          {
            id: "parcel-1",
            lengthMm: 300,
            widthMm: 200,
            heightMm: 100,
            weightGrams: 1_500,
            items: [{ lineKey: `${productId}:_`, quantity: 1 }],
          },
        ],
        lockedShipmentId: shipmentId,
        createdAt: bookedAtIso,
        updatedAt: bookedAtIso,
        purgeAt: purgeAt.toISOString(),
      },
      expiresAt: purgeAt,
      updatedAt: bookedAt,
    });
    expect(paymentOnlyShop.runtime.carrierAdapter).toBeNull();
    expect(paymentOnlyShop.runtime.carrierParcelAdapter).toBeNull();
    expect(
      await withCurrentSite("default", () =>
        paymentOnlyShop.plugin.actions?.bookCarrierShipment?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 2 },
            values: { operatorNote: "Recovered without provider call" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    expect(await orderCall("GET", { ...owner, orderId: ids.orderId })).toMatchObject({
      body: {
        order: {
          privateDataStatus: "redacted",
          fulfillment: {
            status: "shipped",
            carrier: "Parcel Co",
            trackingNumber: "RECOVERY-TRACK-1",
          },
        },
      },
    });
    const [completedBooking] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `carrier-booking:${ids.orderId}`));
    expect(completedBooking?.value).toMatchObject({
      status: "completed",
      operatorNote: "Recovered without provider call",
    });
    expect(
      await withCurrentSite("default", () =>
        paymentOnlyShop.plugin.actions?.carrierBookingHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(
      await withCurrentSite("default", () =>
        paymentOnlyShop.plugin.actions?.fulfillmentParcelHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
  });

  it("fully refunds an unshipped paid order and atomically restores exact inventory", async () => {
    const ids = {
      intentId: "143e4567-e89b-42d3-a456-426614174000",
      draftId: "243e4567-e89b-42d3-a456-426614174000",
      orderId: "343e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "refund-private@example.com");
    const refundPayment = vi.fn(
      (input: {
        refundId: string;
        orderId: string;
        paymentReference: string;
        currency: "KRW";
        amountMinor: number;
      }) => ({
        contract: "np.shop-refund-result.v1" as const,
        refundId: input.refundId,
        orderId: input.orderId,
        paymentReference: input.paymentReference,
        refundReference: "refund_transaction_1",
        currency: input.currency,
        amountMinor: input.amountMinor,
        refundedAt: new Date().toISOString(),
      }),
    );
    const refundShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
          refundPayment,
        },
      },
    });
    const paymentHandler = refundShop.plugin.routes?.find(
      (candidate) => candidate.path === "/payments/webhook",
    )?.handler;
    const paidAt = new Date().toISOString();
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        contract: "np.shop-payment-event.v1",
        eventId: "evt_refund_success_1",
        type: "payment.succeeded",
        orderId: ids.orderId,
        paymentReference: "pay_refund_success_1",
        currency: "KRW",
        amountMinor: 25_000,
        signedAt: paidAt,
      }),
    );
    expect(
      await withCurrentSite("default", () =>
        paymentHandler?.(
          {
            method: "POST",
            path: "/payments/webhook",
            params: { pluginId: "shop" },
            query: {},
            bodyMode: "raw",
            body: undefined,
            rawBody,
            headers: {},
          },
          {} as never,
        ),
      ),
    ).toMatchObject({ status: 200, body: { receipt: { outcome: "paid" } } });
    const db = await getTestDb();
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);

    const staff = await seedUser({ email: "refund-operator@example.com" });
    const payload = {
      row: { id: ids.orderId, revision: 2 },
      values: { reason: "Customer requested cancellation" },
    };
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.refundOrder?.handler(payload, {
          actionInvocation: { kind: "plugin", pluginId: "test" },
        } as never),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("direct staff") });
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.refundOrder?.handler(payload, actionContext),
      ),
    ).toMatchObject({
      ok: true,
      data: expect.stringContaining("inventory restocked, fulfillment cancelled"),
    });
    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ids.orderId,
        paymentReference: "pay_refund_success_1",
        currency: "KRW",
        amountMinor: 25_000,
        reason: "Customer requested cancellation",
        refundId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      }),
    );
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 8 }]);
    expect(await orderCall("GET", { ...owner, orderId: ids.orderId })).toMatchObject({
      body: {
        order: {
          status: "refunded",
          revision: 3,
          privateDataStatus: "redacted",
          inventoryReservationStatus: "consumed",
          customer: null,
          shipping: null,
          fulfillment: { status: "cancelled", revision: 2, privateDataStatus: "redacted" },
          refund: {
            status: "refunded",
            amountMinor: 25_000,
            inventoryOutcome: "restocked",
            fulfillmentOutcome: "cancelled",
          },
        },
      },
    });
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(like(npPluginStorage.key, `order-private:%:${ids.orderId}`)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ action: npAuditEvents.action })
        .from(npAuditEvents)
        .where(eq(npAuditEvents.targetId, ids.orderId)),
    ).toEqual(
      expect.arrayContaining([
        { action: "shop.refund.request" },
        { action: "shop.refund.complete" },
      ]),
    );
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.refundOrder?.handler(payload, actionContext),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("already reconciled") });
    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.refundHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
  });

  it("completes the provider refund without partially compensating drifted inventory", async () => {
    const ids = {
      intentId: "153e4567-e89b-42d3-a456-426614174000",
      draftId: "253e4567-e89b-42d3-a456-426614174000",
      orderId: "353e4567-e89b-42d3-a456-426614174000",
    };
    await createPendingOrder(ids, "refund-drift@example.com");
    const refundShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
          refundPayment: (input) => ({
            contract: "np.shop-refund-result.v1",
            refundId: input.refundId,
            orderId: input.orderId,
            paymentReference: input.paymentReference,
            refundReference: "refund_drift_transaction",
            currency: input.currency,
            amountMinor: input.amountMinor,
            refundedAt: new Date().toISOString(),
          }),
        },
      },
    });
    expect(
      await payPendingOrder(refundShop, {
        orderId: ids.orderId,
        eventId: "evt_refund_drift",
        paymentReference: "pay_refund_drift",
      }),
    ).toMatchObject({ status: 200, body: { receipt: { outcome: "paid" } } });
    const db = await getTestDb();
    await db
      .update(shopProductsTable)
      .set({ trackInventory: false })
      .where(eq(shopProductsTable.id, productId));
    const staff = await seedUser({ email: "refund-drift-operator@example.com" });
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.refundOrder?.handler(
          {
            row: { id: ids.orderId, revision: 2 },
            values: { reason: "Customer requested cancellation" },
          },
          {
            actionInvocation: { kind: "staff", userId: staff.userId },
          } as never,
        ),
      ),
    ).toMatchObject({
      ok: true,
      data: expect.stringContaining("inventory manual-required, fulfillment cancelled"),
    });
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.recentRefunds?.handler(undefined, {} as never),
      ),
    ).toMatchObject({
      ok: true,
      data: { rows: [{ orderId: ids.orderId, status: "refunded", inventory: "manual-required" }] },
    });
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.refundHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "warn" } });
  });

  it("fails closed on a mismatched provider refund and blocks fulfillment", async () => {
    const ids = {
      intentId: "173e4567-e89b-42d3-a456-426614174000",
      draftId: "273e4567-e89b-42d3-a456-426614174000",
      orderId: "373e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "refund-mismatch@example.com");
    const refundShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
          refundPayment: (input) => ({
            contract: "np.shop-refund-result.v1",
            refundId: input.refundId,
            orderId: input.orderId,
            paymentReference: input.paymentReference,
            refundReference: "refund_mismatch_transaction",
            currency: input.currency,
            amountMinor: input.amountMinor - 1,
            refundedAt: new Date().toISOString(),
          }),
        },
      },
    });
    await payPendingOrder(refundShop, {
      orderId: ids.orderId,
      eventId: "evt_refund_mismatch",
      paymentReference: "pay_refund_mismatch",
    });
    const staff = await seedUser({ email: "refund-mismatch-operator@example.com" });
    const context = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.refundOrder?.handler(
          {
            row: { id: ids.orderId, revision: 2 },
            values: { reason: "Customer requested cancellation" },
          },
          context,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("does not match") });
    expect(await orderCall("GET", { ...owner, orderId: ids.orderId })).toMatchObject({
      body: {
        order: {
          status: "paid",
          inventoryReservationStatus: "consumed",
          fulfillment: { status: "awaiting", revision: 1 },
          refund: { status: "manual-review", inventoryOutcome: "pending" },
        },
      },
    });
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.processFulfillment?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 1 },
            values: { operatorNote: "Must remain blocked" },
          },
          context,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("operator reconciliation") });
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.recentRefunds?.handler(undefined, {} as never),
      ),
    ).toMatchObject({
      ok: true,
      data: {
        rows: [
          {
            orderId: ids.orderId,
            status: "manual-review",
            providerError: "provider-result-mismatch",
          },
        ],
      },
    });
  });

  it("resumes local reconciliation from a durable provider-confirmed refund", async () => {
    const ids = {
      intentId: "163e4567-e89b-42d3-a456-426614174000",
      draftId: "263e4567-e89b-42d3-a456-426614174000",
      orderId: "363e4567-e89b-42d3-a456-426614174000",
    };
    await createPendingOrder(ids, "refund-resume@example.com");
    const refundPayment = vi.fn(
      (input: {
        refundId: string;
        orderId: string;
        paymentReference: string;
        currency: "KRW";
        amountMinor: number;
      }) => ({
        contract: "np.shop-refund-result.v1" as const,
        refundId: input.refundId,
        orderId: input.orderId,
        paymentReference: input.paymentReference,
        refundReference: "refund_resume_transaction",
        currency: input.currency,
        amountMinor: input.amountMinor,
        refundedAt: new Date().toISOString(),
      }),
    );
    const refundShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
          refundPayment,
        },
      },
    });
    await payPendingOrder(refundShop, {
      orderId: ids.orderId,
      eventId: "evt_refund_resume",
      paymentReference: "pay_refund_resume",
    });
    const db = await getTestDb();
    const [fulfillmentRow] = await db
      .select({
        pluginId: npPluginStorage.pluginId,
        siteId: npPluginStorage.siteId,
        key: npPluginStorage.key,
        value: npPluginStorage.value,
        expiresAt: npPluginStorage.expiresAt,
        updatedAt: npPluginStorage.updatedAt,
      })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `fulfillment:${ids.orderId}`))
      .limit(1);
    expect(fulfillmentRow).toBeDefined();
    if (!fulfillmentRow) throw new Error("Missing paid-order fulfillment fixture.");
    await db.delete(npPluginStorage).where(eq(npPluginStorage.key, `fulfillment:${ids.orderId}`));
    const staff = await seedUser({ email: "refund-resume-operator@example.com" });
    const payload = {
      row: { id: ids.orderId, revision: 2 },
      values: { reason: "Customer requested cancellation" },
    };
    const context = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.refundOrder?.handler(payload, context),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("fulfillment") });
    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(
      await withCurrentSite("default", () =>
        refundShop.plugin.actions?.recentRefunds?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { rows: [{ status: "provider-confirmed" }] } });
    await db.insert(npPluginStorage).values(fulfillmentRow);
    const recoveryShop = createShop();
    expect(
      await withCurrentSite("default", () =>
        recoveryShop.plugin.actions?.refundOrder?.handler(payload, context),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    expect(refundPayment).toHaveBeenCalledTimes(1);
  });

  it("prepares and server-confirms idempotent payment attempts against the stored order", async () => {
    const ids = {
      intentId: "a63e4567-e89b-42d3-a456-426614174000",
      draftId: "b63e4567-e89b-42d3-a456-426614174000",
      orderId: "c63e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "attempt-private@example.com");
    const preparePayment = vi.fn((input: { attemptId: string; amountMinor: number }) => ({
      kind: "client" as const,
      data: { clientKey: "public-test-key", amountMinor: input.amountMinor },
    }));
    const confirmPayment = vi.fn(
      (input: {
        attempt: { id: string; orderId: string; currency: string; amountMinor: number };
        confirmation: Readonly<Record<string, unknown>>;
        receivedAt: string;
      }) => {
        if (input.confirmation.paymentKey === "pay_transient") {
          throw new NpShopPaymentProviderError(
            "provider_unavailable",
            "The provider is temporarily unavailable.",
            true,
          );
        }
        if (
          input.confirmation.paymentKey !== "pay_attempt_1" ||
          input.confirmation.orderId !== input.attempt.orderId ||
          input.confirmation.amount !== input.attempt.amountMinor
        ) {
          throw new Error("provider confirmation mismatch");
        }
        return {
          contract: "np.shop-payment-event.v1" as const,
          eventId: `confirm:${input.confirmation.paymentKey}`,
          type: "payment.succeeded" as const,
          orderId: input.attempt.orderId,
          paymentReference: input.confirmation.paymentKey,
          currency: input.attempt.currency,
          amountMinor: input.attempt.amountMinor,
          signedAt: input.receivedAt,
        };
      },
    );
    const paymentShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: () => null,
          preparePayment,
          confirmPayment,
          renderPaymentLauncher: () => null,
        },
      },
    });
    const attemptHandler = paymentShop.plugin.routes?.find(
      (candidate) => candidate.path === "/payments/attempts",
    )?.handler;
    expect(attemptHandler).toBeDefined();
    async function attemptCall(
      method: "GET" | "POST" | "PATCH",
      input: { body?: unknown; attemptId?: string } = {},
    ) {
      return withCurrentSite("default", () =>
        attemptHandler?.(
          {
            method,
            path: "/payments/attempts",
            params: { pluginId: "shop" },
            query: input.attemptId ? { orderId: ids.orderId, attemptId: input.attemptId } : {},
            body: input.body,
            headers: {
              cookie: owner.cookie ?? "",
              "x-csrf-token": owner.csrf,
            },
          },
          {} as never,
        ),
      );
    }

    const attemptId = "d63e4567-e89b-42d3-a456-426614174000";
    const prepared = await attemptCall("POST", {
      body: { orderId: ids.orderId, idempotencyKey: attemptId },
    });
    expect(prepared).toMatchObject({
      status: 200,
      body: {
        attempt: {
          id: attemptId,
          orderId: ids.orderId,
          providerId: "test-pay",
          status: "prepared",
          amountMinor: 25_000,
          handoff: {
            kind: "client",
            data: { clientKey: "public-test-key", amountMinor: 25_000 },
          },
        },
      },
    });
    expect(JSON.stringify(prepared)).not.toContain("attempt-private@example.com");
    expect(
      await attemptCall("POST", {
        body: { orderId: ids.orderId, idempotencyKey: attemptId },
      }),
    ).toMatchObject({ status: 200, body: { attempt: { id: attemptId } } });
    expect(preparePayment).toHaveBeenCalledOnce();
    expect(await attemptCall("GET", { attemptId })).toMatchObject({
      status: 200,
      body: { attempt: { id: attemptId, status: "prepared" } },
    });

    const foreign = await call("GET");
    expect(
      await withCurrentSite("default", () =>
        attemptHandler?.(
          {
            method: "GET",
            path: "/payments/attempts",
            params: { pluginId: "shop" },
            query: { orderId: ids.orderId, attemptId },
            body: undefined,
            headers: { cookie: foreign.headers?.["Set-Cookie"] ?? "" },
          },
          {} as never,
        ),
      ),
    ).toMatchObject({ status: 404 });

    expect(
      await attemptCall("PATCH", {
        body: {
          attemptId,
          orderId: ids.orderId,
          confirmation: {
            paymentKey: "pay_transient",
            orderId: ids.orderId,
            amount: 25_000,
          },
        },
      }),
    ).toMatchObject({ status: 502, body: { error: "provider_unavailable" } });
    expect(await orderCall("GET", { cookie: owner.cookie, orderId: ids.orderId })).toMatchObject({
      status: 200,
      body: {
        order: { status: "pending-payment", inventoryReservationStatus: "held" },
      },
    });

    const confirmed = await attemptCall("PATCH", {
      body: {
        attemptId,
        orderId: ids.orderId,
        confirmation: {
          paymentKey: "pay_attempt_1",
          orderId: ids.orderId,
          amount: 25_000,
        },
      },
    });
    expect(confirmed).toMatchObject({
      status: 200,
      body: {
        duplicate: false,
        attempt: { status: "confirmed", paymentReference: "pay_attempt_1" },
        order: { status: "paid", inventoryReservationStatus: "consumed" },
      },
    });
    expect(confirmPayment).toHaveBeenCalledTimes(2);
    expect(
      await attemptCall("PATCH", {
        body: {
          attemptId,
          orderId: ids.orderId,
          confirmation: {
            paymentKey: "pay_attempt_1",
            orderId: ids.orderId,
            amount: 25_000,
          },
        },
      }),
    ).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(confirmPayment).toHaveBeenCalledTimes(2);

    const db = await getTestDb();
    const [confirmedAttemptRow] = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(like(npPluginStorage.key, "payment-attempt:%"));
    expect(confirmedAttemptRow).toBeDefined();
    await db
      .update(npPluginStorage)
      .set({
        value: {
          ...(confirmedAttemptRow?.value as Record<string, unknown>),
          status: "prepared",
          confirmedAt: null,
          paymentReference: null,
          eventId: null,
        },
      })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, confirmedAttemptRow!.key),
        ),
      );
    expect(
      await attemptCall("PATCH", {
        body: {
          attemptId,
          orderId: ids.orderId,
          confirmation: {
            paymentKey: "pay_attempt_1",
            orderId: ids.orderId,
            amount: 25_000,
          },
        },
      }),
    ).toMatchObject({
      status: 200,
      body: { duplicate: true, attempt: { status: "confirmed" }, order: { status: "paid" } },
    });
    expect(confirmPayment).toHaveBeenCalledTimes(3);

    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);
    const attemptRows = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(like(npPluginStorage.key, "payment-attempt:%"));
    expect(attemptRows).toHaveLength(1);
    expect(attemptRows[0]).toMatchObject({ value: { status: "confirmed" } });
    expect(JSON.stringify(attemptRows)).not.toContain("attempt-private@example.com");
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.paymentAttemptHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    await db
      .update(npPluginStorage)
      .set({
        value: {
          ...(attemptRows[0]?.value as Record<string, unknown>),
          expiresAt: "not-a-timestamp",
        },
      })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, attemptRows[0]!.key),
        ),
      );
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.paymentAttemptHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "error" } });
  });

  it("runs owner-scoped item returns through audited receipt and atomic inventory restoration", async () => {
    const ids = {
      intentId: "a83e4567-e89b-42d3-a456-426614174000",
      draftId: "b83e4567-e89b-42d3-a456-426614174000",
      orderId: "c83e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "return-owner@example.com", {
      variantSku: null,
      quantity: 2,
    });
    const refundPaymentPartially = vi.fn(
      (input: {
        refundId: string;
        orderId: string;
        returnId: string;
        paymentReference: string;
        currency: "KRW";
        amountMinor: number;
      }) => ({
        contract: "np.shop-partial-refund-result.v1" as const,
        refundId: input.refundId,
        orderId: input.orderId,
        returnId: input.returnId,
        paymentReference: input.paymentReference,
        refundReference: "partial_refund_return_1",
        currency: input.currency,
        amountMinor: input.amountMinor,
        refundedAt: new Date().toISOString(),
      }),
    );
    const refundPayment = vi.fn(() => {
      throw new Error("full refund must remain blocked after a partial refund");
    });
    const paymentShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
          refundPayment,
          refundPaymentPartially,
        },
      },
    });
    expect(
      await payPendingOrder(paymentShop, {
        orderId: ids.orderId,
        eventId: "evt_return_success",
        paymentReference: "pay_return_success",
        amountMinor: 50_000,
      }),
    ).toMatchObject({ status: 200, body: { receipt: { outcome: "paid" } } });
    const staff = await seedUser({ email: "return-operator@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.shipFulfillment?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 1 },
            values: { carrier: "Parcel Co", trackingNumber: "RETURN-TRACK", operatorNote: "" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true });
    const shipped = await orderCall("GET", { ...owner, orderId: ids.orderId });
    const shippedOrder = (
      shipped.body as { order: { revision: number; lines: Array<{ key: string }> } }
    ).order;
    expect(
      await returnCall("POST", {
        ...owner,
        body: {
          orderId: ids.orderId,
          expectedOrderRevision: shippedOrder.revision,
          lines: [{ lineKey: shippedOrder.lines[0]!.key, quantity: 1 }],
          reason: "defective",
          detail: "Handle is cracked",
        },
      }),
    ).toMatchObject({
      status: 200,
      body: { returnRequest: { status: "requested", revision: 1, inventoryOutcome: "pending" } },
    });
    expect(
      await returnCall("POST", {
        ...owner,
        body: {
          orderId: ids.orderId,
          expectedOrderRevision: shippedOrder.revision,
          lines: [{ lineKey: shippedOrder.lines[0]!.key, quantity: 1 }],
          reason: "defective",
          detail: null,
        },
      }),
    ).toMatchObject({ status: 409, body: { error: "return_already_exists" } });
    const foreignOwner = await call("GET");
    expect(
      await returnCall("DELETE", {
        cookie: foreignOwner.headers?.["Set-Cookie"],
        csrf: (foreignOwner.body as { csrfToken: string }).csrfToken,
        body: { orderId: ids.orderId, expectedRevision: 1 },
      }),
    ).toMatchObject({ status: 409, body: { error: "return_not_found" } });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.approveReturn?.handler(
          {
            row: { id: ids.orderId, returnRevision: 1 },
            values: { operatorNote: "Inspect on receipt" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("revision 2") });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.receiveReturn?.handler(
          {
            row: { id: ids.orderId, returnRevision: 1 },
            values: { operatorNote: "Received intact package" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("changed") });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.receiveReturn?.handler(
          {
            row: { id: ids.orderId, returnRevision: 2 },
            values: { operatorNote: "Received intact package" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("inventory restocked") });
    expect(await orderCall("GET", { ...owner, orderId: ids.orderId })).toMatchObject({
      body: {
        order: {
          status: "paid",
          fulfillment: { status: "shipped" },
          returnRequest: {
            status: "received",
            revision: 3,
            inventoryOutcome: "restocked",
            lines: [{ quantity: 1 }],
          },
        },
      },
    });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.partialRefundReturn?.handler(
          {
            row: {
              id: ids.orderId,
              orderRevision: shippedOrder.revision,
              returnId: "423e4567-e89b-42d3-a456-426614174000",
              returnRevision: 3,
            },
            values: {
              shippingMinor: "0",
              taxMinor: "0",
              reason: "Received defective return",
            },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false });
    const receivedOrderResponse = await orderCall("GET", {
      ...owner,
      orderId: ids.orderId,
    });
    const receivedOrder = (
      receivedOrderResponse.body as {
        order: { revision: number; returnRequest: { id: string; revision: number } };
      }
    ).order;
    const partialRefundPayload = {
      row: {
        id: ids.orderId,
        orderRevision: receivedOrder.revision,
        returnId: receivedOrder.returnRequest.id,
        returnRevision: receivedOrder.returnRequest.revision,
      },
      values: {
        shippingMinor: "0",
        taxMinor: "0",
        reason: "Received defective return",
      },
    };
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.partialRefundReturn?.handler(
          partialRefundPayload,
          actionContext,
        ),
      ),
    ).toMatchObject({
      ok: true,
      data: expect.stringContaining("KRW 25000"),
    });
    expect(refundPaymentPartially).toHaveBeenCalledOnce();
    expect(refundPaymentPartially).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ids.orderId,
        returnId: receivedOrder.returnRequest.id,
        paymentReference: "pay_return_success",
        currency: "KRW",
        amountMinor: 25_000,
        allocation: {
          lines: [{ lineKey: shippedOrder.lines[0]!.key, quantity: 1, amountMinor: 25_000 }],
          itemAmountMinor: 25_000,
          shippingMinor: 0,
          taxMinor: 0,
        },
      }),
    );
    expect(await orderCall("GET", { ...owner, orderId: ids.orderId })).toMatchObject({
      body: {
        order: {
          status: "paid",
          revision: receivedOrder.revision + 1,
          fulfillment: { status: "shipped" },
          returnRequest: { status: "received", inventoryOutcome: "restocked" },
          partialRefund: {
            status: "refunded",
            returnId: receivedOrder.returnRequest.id,
            amountMinor: 25_000,
            allocation: { itemAmountMinor: 25_000, shippingMinor: 0, taxMinor: 0 },
          },
        },
      },
    });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.partialRefundReturn?.handler(
          partialRefundPayload,
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("already reconciled") });
    expect(refundPaymentPartially).toHaveBeenCalledOnce();
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.refundOrder?.handler(
          {
            row: { id: ids.orderId, revision: receivedOrder.revision + 1 },
            values: { reason: "Attempt unsafe full refund" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false });
    expect(refundPayment).not.toHaveBeenCalled();
    const db = await getTestDb();
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.partialRefundHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.returnHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.recentReturns?.handler(undefined, {} as never),
      ),
    ).toMatchObject({
      ok: true,
      data: { rows: [{ id: ids.orderId, status: "received", inventory: "restocked" }] },
    });
    expect(
      await db
        .select({ action: npAuditEvents.action })
        .from(npAuditEvents)
        .where(eq(npAuditEvents.targetId, ids.orderId)),
    ).toEqual(
      expect.arrayContaining([
        { action: "shop.return.approve" },
        { action: "shop.return.receive" },
        { action: "shop.partial-refund.request" },
        { action: "shop.partial-refund.complete" },
      ]),
    );
  });

  it("creates, labels, projects, and cancels owner-scoped return logistics while deleting origin PII", async () => {
    const ids = {
      intentId: "ad3e4567-e89b-42d3-a456-426614174000",
      draftId: "bd3e4567-e89b-42d3-a456-426614174000",
      orderId: "cd3e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "return-logistics@example.com");
    let providerAttempts = 0;
    const createReturnShipment = vi.fn(async (request: NpShopReturnLogisticsRequest) => {
      providerAttempts += 1;
      const providerDb = await getTestDb();
      const commercial = await providerDb
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `return-logistics:${request.orderId}`));
      const privateData = await providerDb
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `return-logistics-private:${request.orderId}`));
      expect(JSON.stringify(commercial)).not.toContain(request.origin.addressLine1);
      expect(privateData).toHaveLength(1);
      if (providerAttempts === 1) {
        throw new NpShopCarrierProviderError("return-timeout", "private provider detail", {
          retryable: true,
        });
      }
      return {
        contract: "np.shop-return-logistics-result.v1" as const,
        logisticsId: request.logisticsId,
        returnId: request.returnId,
        orderId: request.orderId,
        returnReference: "return_transaction_1",
        carrier: "Parcel Co",
        trackingNumber: "RETURN-TRACK-1",
        readyAt: null,
        closeAt: null,
        confirmedAt: new Date().toISOString(),
      };
    });
    const cancelReturnShipment = vi.fn((request: NpShopReturnLogisticsCancelRequest) => ({
      contract: "np.shop-return-logistics-cancel-result.v1" as const,
      cancellationId: request.cancellationId,
      logisticsId: request.logisticsId,
      returnId: request.returnId,
      orderId: request.orderId,
      cancelledAt: new Date().toISOString(),
    }));
    const readReturnLabel = vi.fn((request: NpShopReturnLogisticsLabelRequest) => ({
      contract: "np.shop-return-logistics-label-result.v1" as const,
      logisticsId: request.logisticsId,
      returnId: request.returnId,
      orderId: request.orderId,
      format: "pdf" as const,
      content: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      retrievedAt: request.requestedAt,
    }));
    const quoteReturnShipping = vi.fn(() => Promise.reject(new Error("not called")));
    const createQuotedReturnShipment = vi.fn(() => Promise.reject(new Error("not called")));
    const returnShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
      carrier: {
        returnLocationReference: "returns-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: (request) => ({
            contract: "np.shop-carrier-booking-result.v1" as const,
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            bookingReference: "booking_return_1",
            carrier: "Parcel Co",
            trackingNumber: "OUTBOUND-TRACK-1",
            bookedAt: request.requestedAt,
          }),
          createReturnShipment,
          cancelReturnShipment,
          readReturnLabel,
          quoteReturnShipping,
          createQuotedReturnShipment,
        },
      },
    });
    await payPendingOrder(returnShop, {
      orderId: ids.orderId,
      eventId: "evt_return_logistics",
      paymentReference: "pay_return_logistics",
    });
    const staff = await seedUser({ email: "return-logistics-operator@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    await withCurrentSite("default", () =>
      returnShop.plugin.actions?.processFulfillment?.handler(
        {
          row: { id: ids.orderId, fulfillmentRevision: 1 },
          values: { operatorNote: "Packed" },
        },
        actionContext,
      ),
    );
    expect(
      await withCurrentSite("default", () =>
        returnShop.plugin.actions?.bookCarrierShipment?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 2 },
            values: { operatorNote: "Booked" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true });
    const shipped = await configuredShopCall(returnShop, "GET", "/orders", {
      ...owner,
      id: ids.orderId,
    });
    const shippedOrder = (
      shipped.body as { order: { revision: number; lines: Array<{ key: string }> } }
    ).order;
    const requested = await configuredShopCall(returnShop, "POST", "/returns", {
      ...owner,
      body: {
        orderId: ids.orderId,
        expectedOrderRevision: shippedOrder.revision,
        lines: [{ lineKey: shippedOrder.lines[0]!.key, quantity: 1 }],
        reason: "defective",
        detail: null,
      },
    });
    const returnId = (requested.body as { returnRequest: { id: string } }).returnRequest.id;
    await withCurrentSite("default", () =>
      returnShop.plugin.actions?.approveReturn?.handler(
        {
          row: { id: ids.orderId, returnRevision: 1 },
          values: { operatorNote: "Approved" },
        },
        actionContext,
      ),
    );
    const origin = {
      recipientName: "Return Sender",
      phone: "+82-10-0000-0000",
      countryCode: "KR",
      postalCode: "04524",
      addressLine1: "1 Return Street",
      addressLine2: null,
      locality: "Seoul",
      administrativeArea: null,
    };
    const createBody = {
      orderId: ids.orderId,
      returnId,
      expectedReturnRevision: 2,
      mode: "dropoff",
      origin,
      readyAt: null,
      closeAt: null,
    };
    expect(
      await configuredShopCall(returnShop, "POST", "/returns/logistics", {
        ...owner,
        body: createBody,
      }),
    ).toMatchObject({ status: 503, body: { error: "return_logistics_provider_unavailable" } });
    const pendingOrderResponse = await configuredShopCall(returnShop, "GET", "/orders", {
      ...owner,
      id: ids.orderId,
    });
    expect(pendingOrderResponse).toMatchObject({
      body: {
        order: {
          returnRequest: {
            logistics: { status: "pending", revision: 2 },
          },
        },
      },
    });
    const pendingLogistics = (
      pendingOrderResponse.body as {
        order: { returnRequest: { logistics: { id: string; revision: number } } };
      }
    ).order.returnRequest.logistics;
    expect(
      await configuredShopCall(returnShop, "POST", "/returns/logistics", {
        ...owner,
        body: createBody,
      }),
    ).toMatchObject({ status: 409, body: { error: "return_logistics_state_conflict" } });
    const created = await configuredShopCall(returnShop, "PATCH", "/returns/logistics", {
      ...owner,
      body: {
        orderId: ids.orderId,
        returnId,
        logisticsId: pendingLogistics.id,
        expectedRevision: pendingLogistics.revision,
      },
    });
    expect(created).toMatchObject({
      status: 200,
      body: { logistics: { status: "active", mode: "dropoff", revision: 4 } },
    });
    const logistics = (created.body as { logistics: { id: string; revision: number } }).logistics;
    const db = await getTestDb();
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `return-logistics-private:${ids.orderId}`)),
    ).toEqual([]);
    expect(
      await configuredShopCall(returnShop, "GET", "/orders", { ...owner, id: ids.orderId }),
    ).toMatchObject({
      body: {
        order: {
          returnRequest: {
            status: "approved",
            logistics: {
              id: logistics.id,
              status: "active",
              carrier: "Parcel Co",
              trackingNumber: "RETURN-TRACK-1",
            },
          },
        },
      },
    });
    expect(
      await configuredShopCall(returnShop, "GET", "/returns/logistics/label", {
        ...owner,
        query: { orderId: ids.orderId, returnId, logisticsId: logistics.id },
      }),
    ).toMatchObject({
      status: 200,
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      headers: { "Content-Type": "application/pdf" },
    });
    expect(
      await configuredShopCall(returnShop, "DELETE", "/returns/logistics", {
        ...owner,
        body: {
          orderId: ids.orderId,
          returnId,
          logisticsId: logistics.id,
          expectedRevision: logistics.revision,
        },
      }),
    ).toMatchObject({ status: 200, body: { logistics: { status: "cancelled", revision: 7 } } });
    expect(createReturnShipment).toHaveBeenCalledTimes(2);
    expect(cancelReturnShipment).toHaveBeenCalledTimes(1);
    expect(readReturnLabel).toHaveBeenCalledTimes(1);
    expect(quoteReturnShipping).not.toHaveBeenCalled();
    expect(createQuotedReturnShipment).not.toHaveBeenCalled();
    const expiredOrderId = "dd3e4567-e89b-42d3-a456-426614174000";
    const expiredLogisticsId = "ed3e4567-e89b-42d3-a456-426614174000";
    const expiredReturnId = "fd3e4567-e89b-42d3-a456-426614174000";
    const malformedOrderId = "1e3e4567-e89b-42d3-a456-426614174000";
    const malformedLogisticsId = "2e3e4567-e89b-42d3-a456-426614174000";
    const malformedReturnId = "3e3e4567-e89b-42d3-a456-426614174000";
    const expiredAt = new Date(Date.now() - 60_000);
    const requestedAt = new Date(expiredAt.getTime() - 60_000).toISOString();
    const purgeAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    await db.insert(npPluginStorage).values([
      {
        pluginId: "shop",
        siteId: "default",
        key: `return-logistics:${expiredOrderId}`,
        value: {
          contract: "np.shop-return-logistics-storage.v1",
          id: expiredLogisticsId,
          returnId: expiredReturnId,
          orderId: expiredOrderId,
          ownerSegment: `guest:${"0".repeat(64)}`,
          providerId: "test-carrier",
          status: "pending",
          revision: 1,
          mode: "dropoff",
          originalShipmentId: "0d3e4567-e89b-42d3-a456-426614174000",
          originalBookingReference: "expired_booking",
          returnReference: null,
          carrier: null,
          trackingNumber: null,
          readyAt: null,
          closeAt: null,
          providerErrorCode: null,
          cancellationId: null,
          requestedAt,
          confirmedAt: null,
          cancelRequestedAt: null,
          cancelledAt: null,
          updatedAt: requestedAt,
          purgeAt,
        },
        expiresAt: new Date(purgeAt),
        updatedAt: new Date(requestedAt),
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `return-logistics-private:${expiredOrderId}`,
        value: {
          contract: "np.shop-return-logistics-private.v1",
          logisticsId: expiredLogisticsId,
          returnId: expiredReturnId,
          orderId: expiredOrderId,
          ownerSegment: `guest:${"0".repeat(64)}`,
          origin,
          createdAt: requestedAt,
          expiresAt: expiredAt.toISOString(),
        },
        expiresAt: expiredAt,
        updatedAt: new Date(requestedAt),
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `return-logistics:${malformedOrderId}`,
        value: { contract: "malformed-commercial-row" },
        expiresAt: new Date(purgeAt),
        updatedAt: new Date(requestedAt),
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `return-logistics-private:${malformedOrderId}`,
        value: {
          contract: "np.shop-return-logistics-private.v1",
          logisticsId: malformedLogisticsId,
          returnId: malformedReturnId,
          orderId: malformedOrderId,
          ownerSegment: `guest:${"1".repeat(64)}`,
          origin,
          createdAt: requestedAt,
          expiresAt: expiredAt.toISOString(),
        },
        expiresAt: expiredAt,
        updatedAt: new Date(requestedAt),
      },
    ]);
    await withCurrentSite("default", async () => {
      await returnShop.plugin.scheduled
        ?.find((task) => task.id === "cleanup-expired-return-logistics-private")
        ?.handler();
    });
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `return-logistics-private:${expiredOrderId}`)),
    ).toEqual([]);
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `return-logistics-private:${malformedOrderId}`)),
    ).toEqual([]);
    expect(
      await db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `return-logistics:${expiredOrderId}`)),
    ).toEqual([
      {
        value: expect.objectContaining({
          status: "manual-review",
          providerErrorCode: "private-expired",
        }),
      },
    ]);
    await db
      .delete(npPluginStorage)
      .where(eq(npPluginStorage.key, `return-logistics:${expiredOrderId}`));
    await db
      .delete(npPluginStorage)
      .where(eq(npPluginStorage.key, `return-logistics:${malformedOrderId}`));
    expect(
      await withCurrentSite("default", () =>
        returnShop.plugin.actions?.returnLogisticsHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
  });

  it("quotes and freezes one return-postage method before creating v2 return logistics", async () => {
    const ids = {
      intentId: "413e4567-e89b-42d3-a456-426614174000",
      draftId: "423e4567-e89b-42d3-a456-426614174000",
      orderId: "433e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "return-postage@example.com");
    const quoteReturnShipping = vi.fn(async (request: NpShopReturnPostageQuoteRequest) => {
      const providerDb = await getTestDb();
      expect(
        await providerDb
          .select({ key: npPluginStorage.key })
          .from(npPluginStorage)
          .where(like(npPluginStorage.key, `return-postage%:${request.orderId}`)),
      ).toEqual([]);
      expect(request.origin.addressLine1).toBe("1 Return Quote Street");
      expect(request.returnLocationReference).toBe("returns-seoul-1");
      return {
        contract: "np.shop-return-postage-quote-result.v1" as const,
        quoteId: request.quoteId,
        methods: [
          {
            id: "dropoff-standard",
            label: "Standard return",
            amountMinor: 4_000,
            estimatedTransit: { minimumDays: 1, maximumDays: 3 },
          },
          {
            id: "dropoff-express",
            label: "Express return",
            amountMinor: 6_000,
            estimatedTransit: { minimumDays: 1, maximumDays: 1 },
          },
        ],
        expiresAt: request.maximumExpiresAt,
      };
    });
    const createQuotedReturnShipment = vi.fn(
      async (request: NpShopQuotedReturnLogisticsRequest) => {
        const providerDb = await getTestDb();
        expect(
          await providerDb
            .select({ key: npPluginStorage.key })
            .from(npPluginStorage)
            .where(like(npPluginStorage.key, `return-postage%:${request.orderId}`)),
        ).toEqual([]);
        expect(request.origin.addressLine1).toBe("1 Return Quote Street");
        expect(request.postageMethod).toMatchObject({
          providerId: "test-carrier",
          methodId: "dropoff-standard",
          currency: "KRW",
          amountMinor: 4_000,
        });
        return {
          contract: "np.shop-return-logistics-result.v1" as const,
          logisticsId: request.logisticsId,
          returnId: request.returnId,
          orderId: request.orderId,
          returnReference: "return_quoted_1",
          carrier: "Parcel Co",
          trackingNumber: "RETURN-QUOTED-1",
          readyAt: request.readyAt,
          closeAt: request.closeAt,
          confirmedAt: request.requestedAt,
        };
      },
    );
    const refundReturnSettlement = vi.fn(
      (input: {
        refundId: string;
        orderId: string;
        returnId: string;
        paymentReference: string;
        currency: "KRW";
        amountMinor: number;
      }) => ({
        contract: "np.shop-partial-refund-result.v1" as const,
        refundId: input.refundId,
        orderId: input.orderId,
        returnId: input.returnId,
        paymentReference: input.paymentReference,
        refundReference: "return_postage_settlement_1",
        currency: input.currency,
        amountMinor: input.amountMinor,
        refundedAt: new Date().toISOString(),
      }),
    );
    const returnShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
          refundReturnSettlement,
        },
      },
      carrier: {
        returnLocationReference: "returns-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: (request) => ({
            contract: "np.shop-carrier-booking-result.v1" as const,
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            bookingReference: "booking_return_quote_1",
            carrier: "Parcel Co",
            trackingNumber: "OUTBOUND-RETURN-QUOTE-1",
            bookedAt: request.requestedAt,
          }),
          createReturnShipment: () => Promise.reject(new Error("v1 must not be called")),
          cancelReturnShipment: () => Promise.reject(new Error("not called")),
          quoteReturnShipping,
          createQuotedReturnShipment,
        },
      },
    });
    await payPendingOrder(returnShop, {
      orderId: ids.orderId,
      eventId: "evt_return_postage",
      paymentReference: "pay_return_postage",
    });
    const staff = await seedUser({ email: "return-postage-operator@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    await withCurrentSite("default", () =>
      returnShop.plugin.actions?.processFulfillment?.handler(
        {
          row: { id: ids.orderId, fulfillmentRevision: 1 },
          values: { operatorNote: "Packed" },
        },
        actionContext,
      ),
    );
    await withCurrentSite("default", () =>
      returnShop.plugin.actions?.bookCarrierShipment?.handler(
        {
          row: { id: ids.orderId, fulfillmentRevision: 2 },
          values: { operatorNote: "Booked" },
        },
        actionContext,
      ),
    );
    const shipped = await configuredShopCall(returnShop, "GET", "/orders", {
      ...owner,
      id: ids.orderId,
    });
    const shippedOrder = (
      shipped.body as {
        order: { revision: number; totalMinor: number; lines: Array<{ key: string }> };
      }
    ).order;
    const requested = await configuredShopCall(returnShop, "POST", "/returns", {
      ...owner,
      body: {
        orderId: ids.orderId,
        expectedOrderRevision: shippedOrder.revision,
        lines: [{ lineKey: shippedOrder.lines[0]!.key, quantity: 1 }],
        reason: "defective",
        detail: null,
      },
    });
    const returnId = (requested.body as { returnRequest: { id: string } }).returnRequest.id;
    await withCurrentSite("default", () =>
      returnShop.plugin.actions?.approveReturn?.handler(
        {
          row: { id: ids.orderId, returnRevision: 1 },
          values: { operatorNote: "Approved" },
        },
        actionContext,
      ),
    );
    const quoted = await configuredShopCall(returnShop, "POST", "/returns/postage", {
      ...owner,
      body: {
        orderId: ids.orderId,
        returnId,
        expectedReturnRevision: 2,
        mode: "dropoff",
        origin: {
          recipientName: "Return Sender",
          phone: "+82-10-0000-0000",
          countryCode: "KR",
          postalCode: "04524",
          addressLine1: "1 Return Quote Street",
          addressLine2: null,
          locality: "Seoul",
          administrativeArea: null,
        },
        readyAt: null,
        closeAt: null,
      },
    });
    expect(quoted).toMatchObject({
      status: 200,
      body: {
        quote: {
          status: "quoted",
          revision: 1,
          currency: "KRW",
          methods: [
            { id: "dropoff-standard", amountMinor: 4_000 },
            { id: "dropoff-express", amountMinor: 6_000 },
          ],
        },
      },
    });
    const quote = (quoted.body as { quote: { id: string; revision: number } }).quote;
    const selected = await configuredShopCall(returnShop, "PATCH", "/returns/postage", {
      ...owner,
      body: {
        orderId: ids.orderId,
        returnId,
        quoteId: quote.id,
        expectedRevision: quote.revision,
        methodId: "dropoff-standard",
      },
    });
    expect(selected).toMatchObject({
      status: 200,
      body: {
        quote: {
          status: "selected",
          revision: 2,
          selectedMethod: { methodId: "dropoff-standard", amountMinor: 4_000 },
        },
      },
    });
    const selectedQuote = (selected.body as { quote: { id: string; revision: number } }).quote;
    const created = await configuredShopCall(returnShop, "POST", "/returns/logistics", {
      ...owner,
      body: {
        orderId: ids.orderId,
        returnId,
        expectedReturnRevision: 2,
        postageQuoteId: selectedQuote.id,
        expectedPostageRevision: selectedQuote.revision,
      },
    });
    expect(created).toMatchObject({
      status: 200,
      body: {
        logistics: {
          status: "active",
          postageMethod: { methodId: "dropoff-standard", amountMinor: 4_000 },
        },
      },
    });
    expect(
      await withCurrentSite("default", () =>
        returnShop.plugin.actions?.receiveReturn?.handler(
          {
            row: { id: ids.orderId, returnRevision: 2 },
            values: { operatorNote: "Quoted shipment received" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true });
    const received = await configuredShopCall(returnShop, "GET", "/orders", {
      ...owner,
      id: ids.orderId,
    });
    const receivedOrder = (
      received.body as {
        order: { revision: number; returnRequest: { id: string; revision: number } };
      }
    ).order;
    expect(
      await withCurrentSite("default", () =>
        returnShop.plugin.actions?.returnPostageSettlementRefund?.handler(
          {
            row: {
              id: ids.orderId,
              orderRevision: receivedOrder.revision,
              returnId: receivedOrder.returnRequest.id,
              returnRevision: receivedOrder.returnRequest.revision,
            },
            values: {
              responsibility: "customer",
              shippingMinor: "0",
              taxMinor: "0",
              reason: "Received changed-mind return",
            },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("KRW 21000 net") });
    expect(refundReturnSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ids.orderId,
        returnId,
        amountMinor: 21_000,
        postageSettlement: expect.objectContaining({
          responsibility: "customer",
          deductionMinor: 4_000,
          method: expect.objectContaining({ amountMinor: 4_000, methodId: "dropoff-standard" }),
        }),
      }),
    );
    expect(
      await configuredShopCall(returnShop, "GET", "/orders", { ...owner, id: ids.orderId }),
    ).toMatchObject({
      body: {
        order: {
          partialRefund: {
            status: "refunded",
            amountMinor: 21_000,
            postageSettlement: {
              responsibility: "customer",
              deductionMinor: 4_000,
              method: { amountMinor: 4_000, methodId: "dropoff-standard" },
            },
          },
        },
      },
    });
    const db = await getTestDb();
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(like(npPluginStorage.key, `return-postage%:${ids.orderId}`)),
    ).toEqual([]);
    expect(
      await configuredShopCall(returnShop, "GET", "/orders", { ...owner, id: ids.orderId }),
    ).toMatchObject({ body: { order: { totalMinor: shippedOrder.totalMinor } } });
    expect(
      await withCurrentSite("default", () =>
        returnShop.plugin.actions?.partialRefundHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({
      ok: true,
      data: { level: "ok", message: expect.stringContaining("1 customer-responsibility") },
    });
    expect(
      await db
        .select({ action: npAuditEvents.action })
        .from(npAuditEvents)
        .where(eq(npAuditEvents.targetId, ids.orderId)),
    ).toEqual(
      expect.arrayContaining([
        { action: "shop.return-settlement-refund.request" },
        { action: "shop.return-settlement-refund.complete" },
      ]),
    );
    expect(quoteReturnShipping).toHaveBeenCalledTimes(1);
    expect(createQuotedReturnShipment).toHaveBeenCalledTimes(1);
  });

  it("tracks an active reverse shipment without receiving, restocking, or refunding the return", async () => {
    const ids = {
      intentId: "4e3e4567-e89b-42d3-a456-426614174000",
      draftId: "5e3e4567-e89b-42d3-a456-426614174000",
      orderId: "6e3e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "return-tracking@example.com");
    const readReturnTracking = vi.fn((request: NpShopReturnTrackingPollRequest) => ({
      contract: "np.shop-return-tracking-poll-result.v1" as const,
      logisticsId: request.logisticsId,
      returnId: request.returnId,
      orderId: request.orderId,
      checkedAt: request.requestedAt,
      event: {
        contract: "np.shop-return-tracking-event.v1" as const,
        eventId: "return_tracking_poll_delivered",
        logisticsId: request.logisticsId,
        returnId: request.returnId,
        orderId: request.orderId,
        returnReference: request.returnReference,
        trackingNumber: request.trackingNumber,
        status: "delivered" as const,
        occurredAt: request.requestedAt,
        signedAt: request.requestedAt,
      },
    }));
    const returnShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
      carrier: {
        returnLocationReference: "returns-seoul-1",
        adapter: {
          id: "test-carrier",
          bookShipment: (request) => ({
            contract: "np.shop-carrier-booking-result.v1" as const,
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            bookingReference: "booking_return_tracking_1",
            carrier: "Parcel Co",
            trackingNumber: "OUTBOUND-RETURN-TRACK-1",
            bookedAt: request.requestedAt,
          }),
          createReturnShipment: (request) => ({
            contract: "np.shop-return-logistics-result.v1" as const,
            logisticsId: request.logisticsId,
            returnId: request.returnId,
            orderId: request.orderId,
            returnReference: "return_tracking_ref_1",
            carrier: "Parcel Co",
            trackingNumber: "REVERSE-TRACK-1",
            readyAt: request.readyAt,
            closeAt: request.closeAt,
            confirmedAt: request.requestedAt,
          }),
          cancelReturnShipment: (request) => ({
            contract: "np.shop-return-logistics-cancel-result.v1" as const,
            cancellationId: request.cancellationId,
            logisticsId: request.logisticsId,
            returnId: request.returnId,
            orderId: request.orderId,
            cancelledAt: request.requestedAt,
          }),
          verifyReturnTrackingWebhook: ({ rawBody }) =>
            JSON.parse(new TextDecoder().decode(rawBody)) as never,
          readReturnTracking,
        },
      },
    });
    await payPendingOrder(returnShop, {
      orderId: ids.orderId,
      eventId: "evt_return_tracking",
      paymentReference: "pay_return_tracking",
    });
    const staff = await seedUser({ email: "return-tracking-operator@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    await withCurrentSite("default", () =>
      returnShop.plugin.actions?.processFulfillment?.handler(
        {
          row: { id: ids.orderId, fulfillmentRevision: 1 },
          values: { operatorNote: "Packed" },
        },
        actionContext,
      ),
    );
    await withCurrentSite("default", () =>
      returnShop.plugin.actions?.bookCarrierShipment?.handler(
        {
          row: { id: ids.orderId, fulfillmentRevision: 2 },
          values: { operatorNote: "Booked" },
        },
        actionContext,
      ),
    );
    const shipped = await configuredShopCall(returnShop, "GET", "/orders", {
      ...owner,
      id: ids.orderId,
    });
    const shippedOrder = (
      shipped.body as { order: { revision: number; lines: Array<{ key: string }> } }
    ).order;
    const requested = await configuredShopCall(returnShop, "POST", "/returns", {
      ...owner,
      body: {
        orderId: ids.orderId,
        expectedOrderRevision: shippedOrder.revision,
        lines: [{ lineKey: shippedOrder.lines[0]!.key, quantity: 1 }],
        reason: "defective",
        detail: null,
      },
    });
    const returnId = (requested.body as { returnRequest: { id: string } }).returnRequest.id;
    await withCurrentSite("default", () =>
      returnShop.plugin.actions?.approveReturn?.handler(
        {
          row: { id: ids.orderId, returnRevision: 1 },
          values: { operatorNote: "Approved" },
        },
        actionContext,
      ),
    );
    const created = await configuredShopCall(returnShop, "POST", "/returns/logistics", {
      ...owner,
      body: {
        orderId: ids.orderId,
        returnId,
        expectedReturnRevision: 2,
        mode: "dropoff",
        origin: {
          recipientName: "Return Sender",
          phone: "+82-10-0000-0000",
          countryCode: "KR",
          postalCode: "04524",
          addressLine1: "1 Private Return Street",
          addressLine2: null,
          locality: "Seoul",
          administrativeArea: null,
        },
        readyAt: null,
        closeAt: null,
      },
    });
    const logistics = (created.body as { logistics: { id: string; revision: number } }).logistics;
    const signedAt = new Date();
    signedAt.setMilliseconds(0);
    const reverseEvent = {
      contract: "np.shop-return-tracking-event.v1",
      eventId: "return_tracking_webhook_1",
      logisticsId: logistics.id,
      returnId,
      orderId: ids.orderId,
      returnReference: "return_tracking_ref_1",
      trackingNumber: "REVERSE-TRACK-1",
      status: "in-transit",
      occurredAt: new Date(signedAt.getTime() - 1_000).toISOString(),
      signedAt: signedAt.toISOString(),
    };
    const webhook = () =>
      configuredShopCall(returnShop, "POST", "/carrier/return-tracking/webhook", {
        rawBody: new TextEncoder().encode(JSON.stringify(reverseEvent)),
      });
    expect(await webhook()).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "advanced", trackingStatus: "in-transit" }, duplicate: false },
    });
    reverseEvent.signedAt = new Date(signedAt.getTime() + 1_000).toISOString();
    expect(await webhook()).toMatchObject({ status: 200, body: { duplicate: true } });

    const beforePoll = await configuredShopCall(returnShop, "GET", "/orders", {
      ...owner,
      id: ids.orderId,
    });
    expect(beforePoll).toMatchObject({
      body: {
        order: {
          status: "paid",
          returnRequest: {
            status: "approved",
            inventoryOutcome: "pending",
            logistics: { tracking: { status: "in-transit" } },
          },
        },
      },
    });
    const db = await getTestDb();
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);

    expect(
      await withCurrentSite("default", () =>
        returnShop.plugin.actions?.reconcileCarrierReturnTracking?.handler(
          { row: { id: ids.orderId, returnId, logisticsId: logistics.id }, values: {} },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("1 advanced") });
    expect(readReturnTracking).toHaveBeenCalledTimes(1);
    expect(
      await configuredShopCall(returnShop, "GET", "/orders", { ...owner, id: ids.orderId }),
    ).toMatchObject({
      body: {
        order: {
          status: "paid",
          returnRequest: {
            status: "approved",
            inventoryOutcome: "pending",
            logistics: { status: "active", tracking: { status: "delivered" } },
          },
        },
      },
    });
    expect(
      await configuredShopCall(returnShop, "DELETE", "/returns/logistics", {
        ...owner,
        body: {
          orderId: ids.orderId,
          returnId,
          logisticsId: logistics.id,
          expectedRevision: logistics.revision,
        },
      }),
    ).toMatchObject({ status: 409, body: { error: "return_logistics_tracking_started" } });
    expect(
      await withCurrentSite("default", () =>
        returnShop.plugin.actions?.returnTrackingEventHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(
      await withCurrentSite("default", () =>
        returnShop.plugin.actions?.recentReturnTrackingEvents?.handler(undefined, {} as never),
      ),
    ).toMatchObject({
      ok: true,
      data: {
        total: 2,
        rows: expect.arrayContaining([expect.objectContaining({ orderId: ids.orderId })]),
      },
    });
    expect(
      await withCurrentSite("default", () =>
        returnShop.plugin.actions?.receiveReturn?.handler(
          {
            row: { id: ids.orderId, returnRevision: 2 },
            values: { operatorNote: "Warehouse inspected the item" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("inventory restocked") });
    expect(
      await configuredShopCall(returnShop, "GET", "/orders", { ...owner, id: ids.orderId }),
    ).toMatchObject({
      body: {
        order: {
          returnRequest: {
            status: "received",
            inventoryOutcome: "restocked",
            logistics: { tracking: { status: "delivered" } },
          },
        },
      },
    });
    const stored = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(like(npPluginStorage.key, "return-tracking%"));
    expect(JSON.stringify(stored)).not.toContain("Private Return Street");
    expect(
      await db
        .select({ action: npAuditEvents.action })
        .from(npAuditEvents)
        .where(eq(npAuditEvents.targetId, returnId)),
    ).toEqual(expect.arrayContaining([{ action: "shop.carrier.return-tracking.poll" }]));
  });

  it("lets only the owner cancel a return that still awaits review", async () => {
    const ids = {
      intentId: "aa3e4567-e89b-42d3-a456-426614174000",
      draftId: "ba3e4567-e89b-42d3-a456-426614174000",
      orderId: "ca3e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "return-cancel@example.com");
    const paymentShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
    });
    await payPendingOrder(paymentShop, {
      orderId: ids.orderId,
      eventId: "evt_return_cancel",
      paymentReference: "pay_return_cancel",
    });
    const staff = await seedUser({ email: "return-cancel-operator@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    await withCurrentSite("default", () =>
      paymentShop.plugin.actions?.shipFulfillment?.handler(
        {
          row: { id: ids.orderId, fulfillmentRevision: 1 },
          values: { carrier: "Parcel Co", trackingNumber: "CANCEL-TRACK", operatorNote: "" },
        },
        actionContext,
      ),
    );
    const shipped = await orderCall("GET", { ...owner, orderId: ids.orderId });
    const shippedOrder = (
      shipped.body as { order: { revision: number; lines: Array<{ key: string }> } }
    ).order;
    expect(
      await returnCall("POST", {
        ...owner,
        body: {
          orderId: ids.orderId,
          expectedOrderRevision: shippedOrder.revision,
          lines: [{ lineKey: shippedOrder.lines[0]!.key, quantity: 1 }],
          reason: "changed-mind",
          detail: null,
        },
      }),
    ).toMatchObject({ status: 200, body: { returnRequest: { status: "requested", revision: 1 } } });
    expect(
      await returnCall("DELETE", {
        ...owner,
        body: { orderId: ids.orderId, expectedRevision: 1 },
      }),
    ).toMatchObject({
      status: 200,
      body: {
        returnRequest: {
          status: "cancelled",
          revision: 2,
          inventoryOutcome: "not-required",
          decidedAt: expect.any(String),
        },
      },
    });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.approveReturn?.handler(
          {
            row: { id: ids.orderId, returnRevision: 2 },
            values: { operatorNote: "Too late" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("requested") });
    expect(await orderCall("GET", { ...owner, orderId: ids.orderId })).toMatchObject({
      body: {
        order: {
          status: "paid",
          fulfillment: { status: "shipped" },
          returnRequest: { status: "cancelled", inventoryOutcome: "not-required" },
        },
      },
    });
  });

  it("consumes and restores exact replacement inventory for one same-item exchange", async () => {
    const ids = {
      intentId: "aa3e4567-e89b-42d3-a456-426614174000",
      draftId: "ba3e4567-e89b-42d3-a456-426614174000",
      orderId: "ca3e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "exchange-owner@example.com");
    const exchangeBookingRequests: NpShopExchangeCarrierBookingRequest[] = [];
    const exchangeCancellationRequests: NpShopExchangeCarrierCancelRequest[] = [];
    const paymentShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
    });
    const exchangeCarrierShop = createShop({
      carrier: {
        adapter: {
          id: "test-carrier",
          bookShipment: () => Promise.reject(new Error("not called")),
          bookExchangeShipment: (request) => {
            exchangeBookingRequests.push(request);
            if (exchangeBookingRequests.length === 1) {
              throw new NpShopCarrierProviderError("exchange-timeout", "private provider detail", {
                retryable: true,
              });
            }
            return {
              contract: "np.shop-exchange-carrier-booking-result.v1",
              shipmentId: request.shipmentId,
              orderId: request.orderId,
              exchangeId: request.exchangeId,
              bookingReference: "replacement_booking_123",
              carrier: "Parcel Co",
              trackingNumber: "EXCHANGE-REPLACEMENT",
              bookedAt: request.requestedAt,
            };
          },
          cancelExchangeShipment: (request) => {
            exchangeCancellationRequests.push(request);
            if (exchangeCancellationRequests.length === 1) {
              throw new NpShopCarrierProviderError(
                "exchange-cancel-timeout",
                "private provider detail",
                { retryable: true },
              );
            }
            return {
              contract: "np.shop-exchange-carrier-cancel-result.v1",
              cancellationId: request.cancellationId,
              shipmentId: request.shipmentId,
              orderId: request.orderId,
              exchangeId: request.exchangeId,
              cancelledAt: request.requestedAt,
            };
          },
        },
      },
    });
    await payPendingOrder(paymentShop, {
      orderId: ids.orderId,
      eventId: "evt_exchange",
      paymentReference: "pay_exchange",
    });
    const staff = await seedUser({ email: "exchange-operator@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.shipFulfillment?.handler(
          {
            row: { id: ids.orderId, fulfillmentRevision: 1 },
            values: { carrier: "Parcel Co", trackingNumber: "EXCHANGE-ORIGINAL", operatorNote: "" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true });
    const shipped = await orderCall("GET", { ...owner, orderId: ids.orderId });
    const shippedOrder = (
      shipped.body as { order: { revision: number; lines: Array<{ key: string }> } }
    ).order;
    const requested = await returnCall("POST", {
      ...owner,
      body: {
        orderId: ids.orderId,
        expectedOrderRevision: shippedOrder.revision,
        lines: [{ lineKey: shippedOrder.lines[0]!.key, quantity: 1 }],
        reason: "defective",
        detail: null,
      },
    });
    expect(requested).toMatchObject({
      status: 200,
      body: { returnRequest: { id: expect.any(String) } },
    });
    const returnId = (requested.body as { returnRequest: { id: string } }).returnRequest.id;
    await withCurrentSite("default", () =>
      paymentShop.plugin.actions?.approveReturn?.handler(
        {
          row: { id: ids.orderId, returnRevision: 1 },
          values: { operatorNote: "Approved" },
        },
        actionContext,
      ),
    );
    await withCurrentSite("default", () =>
      paymentShop.plugin.actions?.receiveReturn?.handler(
        {
          row: { id: ids.orderId, returnRevision: 2 },
          values: { operatorNote: "Inspected" },
        },
        actionContext,
      ),
    );
    const received = await orderCall("GET", { ...owner, orderId: ids.orderId });
    const receivedOrder = (received.body as { order: { revision: number } }).order;
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.createExchange?.handler(
          {
            row: {
              id: ids.orderId,
              orderRevision: receivedOrder.revision,
              returnId,
              returnRevision: 3,
            },
            values: { operatorNote: "Exact replacement" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("inventory consumed") });
    const db = await getTestDb();
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);
    const created = await orderCall("GET", { ...owner, orderId: ids.orderId });
    const createdBody = created.body as {
      order: {
        revision: number;
        exchange: {
          id: string;
          revision: number;
          status: string;
          destinationStatus: string;
          destinationRevision: number;
        };
      };
      exchangeDestinationAuthority: {
        exchangeId: string;
        orderRevision: number;
        exchangeRevision: number;
        destinationRevision: number;
        token: string;
      };
    };
    const createdOrder = createdBody.order;
    expect(createdOrder.exchange).toMatchObject({
      status: "awaiting",
      revision: 1,
      destinationStatus: "awaiting",
      destinationRevision: 0,
    });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.shipExchange?.handler(
          {
            row: {
              id: ids.orderId,
              exchangeId: createdOrder.exchange.id,
              exchangeRevision: createdOrder.exchange.revision,
              orderRevision: createdOrder.revision,
            },
            values: {
              carrier: "Parcel Co",
              trackingNumber: "EXCHANGE-REPLACEMENT",
              operatorNote: "Skipped processing",
            },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("processing") });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.processExchange?.handler(
          {
            row: {
              id: ids.orderId,
              exchangeId: createdOrder.exchange.id,
              exchangeRevision: 1,
              orderRevision: createdOrder.revision,
            },
            values: { operatorNote: "Packing" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("destination") });
    const replacementDestination = {
      recipientName: "김교환",
      phone: "010-9876-5432",
      countryCode: "KR",
      postalCode: "06236",
      addressLine1: "서울특별시 강남구 테헤란로 123",
      addressLine2: "교환동 7층",
      locality: "강남구",
      administrativeArea: "서울특별시",
    };
    expect(
      await exchangeDestinationCall({
        ...owner,
        body: {
          orderId: ids.orderId,
          exchangeId: createdBody.exchangeDestinationAuthority.exchangeId,
          orderRevision: createdBody.exchangeDestinationAuthority.orderRevision,
          exchangeRevision: createdBody.exchangeDestinationAuthority.exchangeRevision,
          destinationRevision: createdBody.exchangeDestinationAuthority.destinationRevision,
          authorityToken: createdBody.exchangeDestinationAuthority.token,
          destination: replacementDestination,
        },
      }),
    ).toMatchObject({
      status: 200,
      body: {
        exchange: { revision: 2, destinationStatus: "submitted", destinationRevision: 1 },
      },
    });
    expect(
      await exchangeDestinationCall({
        ...owner,
        body: {
          orderId: ids.orderId,
          exchangeId: createdBody.exchangeDestinationAuthority.exchangeId,
          orderRevision: createdBody.exchangeDestinationAuthority.orderRevision,
          exchangeRevision: createdBody.exchangeDestinationAuthority.exchangeRevision,
          destinationRevision: createdBody.exchangeDestinationAuthority.destinationRevision,
          authorityToken: createdBody.exchangeDestinationAuthority.token,
          destination: replacementDestination,
        },
      }),
    ).toMatchObject({ status: 409 });
    const destinationRows = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, `exchange-destination-private:${ids.orderId}`),
        ),
      );
    expect(destinationRows).toHaveLength(1);
    expect(destinationRows[0]!.value).toMatchObject({
      contract: "np.shop-exchange-destination-private.v1",
      destination: replacementDestination,
      accessedAt: null,
    });
    const submittedOrderResponse = await orderCall("GET", { ...owner, orderId: ids.orderId });
    const submittedOrder = (
      submittedOrderResponse.body as {
        order: {
          revision: number;
          exchange: { id: string; revision: number; destinationRevision: number };
        };
      }
    ).order;
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.readExchangeDestination?.handler(
          {
            row: {
              id: ids.orderId,
              exchangeId: submittedOrder.exchange.id,
              orderRevision: submittedOrder.revision,
              exchangeRevision: submittedOrder.exchange.revision,
              destinationRevision: submittedOrder.exchange.destinationRevision,
            },
            values: {},
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: { destination: replacementDestination } });
    expect(
      await withCurrentSite("default", () =>
        exchangeCarrierShop.plugin.actions?.bookExchangeCarrier?.handler(
          {
            row: {
              id: ids.orderId,
              exchangeId: submittedOrder.exchange.id,
              exchangeRevision: submittedOrder.exchange.revision,
              orderRevision: submittedOrder.revision,
              destinationRevision: submittedOrder.exchange.destinationRevision,
            },
            values: { operatorNote: "Provider booking" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("temporarily unavailable") });
    const pendingBookingRows = await withCurrentSite("default", () =>
      exchangeCarrierShop.plugin.actions?.recentExchanges?.handler(undefined, {} as never),
    );
    const pendingBookingRow = (
      pendingBookingRows as {
        data: {
          rows: Array<{
            bookingId: string;
            bookingRevision: number;
          }>;
        };
      }
    ).data.rows[0]!;
    expect(pendingBookingRows).toMatchObject({
      ok: true,
      data: { rows: [expect.objectContaining({ carrierBooking: "pending" })] },
    });
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `exchange-destination-private:${ids.orderId}`)),
    ).toHaveLength(1);
    expect(
      await withCurrentSite("default", () =>
        exchangeCarrierShop.plugin.actions?.resumeExchangeCarrier?.handler(
          {
            row: {
              id: ids.orderId,
              exchangeId: submittedOrder.exchange.id,
              exchangeRevision: submittedOrder.exchange.revision,
              orderRevision: submittedOrder.revision,
              bookingId: pendingBookingRow.bookingId,
              bookingRevision: pendingBookingRow.bookingRevision,
            },
            values: { operatorNote: "Provider booking resumed" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    expect(exchangeBookingRequests).toHaveLength(2);
    expect(exchangeBookingRequests[1]).toEqual(exchangeBookingRequests[0]);
    expect(exchangeBookingRequests[0]).toMatchObject({
      contract: "np.shop-exchange-carrier-booking-request.v1",
      orderId: ids.orderId,
      exchangeId: submittedOrder.exchange.id,
      exchangeRevision: submittedOrder.exchange.revision,
      destinationRevision: submittedOrder.exchange.destinationRevision,
      destination: replacementDestination,
      items: [
        {
          productId,
          quantity: 1,
        },
      ],
    });
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `exchange-destination-private:${ids.orderId}`)),
    ).toEqual([]);
    const processing = await orderCall("GET", { ...owner, orderId: ids.orderId });
    const processingOrder = (
      processing.body as {
        order: {
          revision: number;
          exchange: {
            id: string;
            revision: number;
            status: string;
            carrier: string;
            trackingNumber: string;
          };
        };
      }
    ).order;
    expect(processingOrder.exchange).toMatchObject({
      status: "processing",
      carrier: "Parcel Co",
      trackingNumber: "EXCHANGE-REPLACEMENT",
    });
    const exchangeRowsResult = await withCurrentSite("default", () =>
      exchangeCarrierShop.plugin.actions?.recentExchanges?.handler(undefined, {} as never),
    );
    expect(exchangeRowsResult).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            carrierBooking: "completed",
            provider: "test-carrier",
          }),
        ],
      },
    });
    const exchangeBookingRow = (
      exchangeRowsResult as {
        data: {
          rows: Array<{
            bookingId: string;
            bookingRevision: number;
          }>;
        };
      }
    ).data.rows[0]!;
    expect(
      await withCurrentSite("default", () =>
        exchangeCarrierShop.plugin.actions?.cancelExchangeCarrier?.handler(
          {
            row: {
              id: ids.orderId,
              exchangeId: processingOrder.exchange.id,
              exchangeRevision: processingOrder.exchange.revision,
              orderRevision: processingOrder.revision,
              bookingId: exchangeBookingRow.bookingId,
              bookingRevision: exchangeBookingRow.bookingRevision,
            },
            values: { operatorNote: "Provider cancellation" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("temporarily unavailable") });
    const cancellingRows = await withCurrentSite("default", () =>
      exchangeCarrierShop.plugin.actions?.recentExchanges?.handler(undefined, {} as never),
    );
    const cancellingRow = (
      cancellingRows as {
        data: {
          rows: Array<{
            bookingId: string;
            bookingRevision: number;
          }>;
        };
      }
    ).data.rows[0]!;
    expect(cancellingRows).toMatchObject({
      ok: true,
      data: { rows: [expect.objectContaining({ carrierBooking: "cancel-pending" })] },
    });
    expect(
      await withCurrentSite("default", () =>
        exchangeCarrierShop.plugin.actions?.cancelExchangeCarrier?.handler(
          {
            row: {
              id: ids.orderId,
              exchangeId: processingOrder.exchange.id,
              exchangeRevision: processingOrder.exchange.revision,
              orderRevision: processingOrder.revision,
              bookingId: cancellingRow.bookingId,
              bookingRevision: cancellingRow.bookingRevision,
            },
            values: { operatorNote: "Provider cancellation resumed" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    expect(exchangeCancellationRequests).toHaveLength(2);
    expect(exchangeCancellationRequests[1]).toEqual(exchangeCancellationRequests[0]);
    expect(exchangeCancellationRequests[0]).toMatchObject({
      contract: "np.shop-exchange-carrier-cancel-request.v1",
      shipmentId: exchangeBookingRow.bookingId,
      orderId: ids.orderId,
      exchangeId: processingOrder.exchange.id,
      bookingReference: "replacement_booking_123",
    });
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 8 }]);
    const cancelled = await orderCall("GET", { ...owner, orderId: ids.orderId });
    expect(cancelled).toMatchObject({
      body: {
        order: {
          exchange: {
            status: "cancelled",
            inventoryOutcome: "restocked",
          },
        },
      },
    });
    expect((cancelled.body as { order: { exchange: unknown } }).order.exchange).not.toHaveProperty(
      "operatorNote",
    );
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.recentExchanges?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { total: 1 } });
    expect(
      await withCurrentSite("default", () =>
        exchangeCarrierShop.plugin.actions?.exchangeHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "ok" } });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.exchangeHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("provider-mismatched") },
    });
    expect(
      await db
        .select({ action: npAuditEvents.action })
        .from(npAuditEvents)
        .where(eq(npAuditEvents.targetId, ids.orderId)),
    ).toEqual(
      expect.arrayContaining([
        { action: "shop.exchange.create" },
        { action: "shop.exchange.destination.submit" },
        { action: "shop.exchange.destination.private.read" },
        { action: "shop.exchange.carrier.booking.prepare" },
        { action: "shop.exchange.carrier.booking.confirm" },
        { action: "shop.exchange.carrier.booking.complete" },
        { action: "shop.exchange.carrier.cancellation.prepare" },
        { action: "shop.exchange.carrier.cancellation.confirm" },
        { action: "shop.exchange.carrier.cancellation.complete" },
      ]),
    );
  });

  it("receives a return without partially restoring drifted catalog inventory", async () => {
    const ids = {
      intentId: "a93e4567-e89b-42d3-a456-426614174000",
      draftId: "b93e4567-e89b-42d3-a456-426614174000",
      orderId: "c93e4567-e89b-42d3-a456-426614174000",
    };
    const owner = await createPendingOrder(ids, "return-drift@example.com");
    const paymentShop = createShop({
      payment: {
        adapter: {
          id: "test-pay",
          verifyWebhook: ({ rawBody }) => JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
    });
    await payPendingOrder(paymentShop, {
      orderId: ids.orderId,
      eventId: "evt_return_drift",
      paymentReference: "pay_return_drift",
    });
    const staff = await seedUser({ email: "return-drift-operator@example.com" });
    const actionContext = {
      actionInvocation: { kind: "staff" as const, userId: staff.userId },
    } as never;
    await withCurrentSite("default", () =>
      paymentShop.plugin.actions?.shipFulfillment?.handler(
        {
          row: { id: ids.orderId, fulfillmentRevision: 1 },
          values: { carrier: "Parcel Co", trackingNumber: "DRIFT-TRACK", operatorNote: "" },
        },
        actionContext,
      ),
    );
    const shipped = await orderCall("GET", { ...owner, orderId: ids.orderId });
    const shippedOrder = (
      shipped.body as { order: { revision: number; lines: Array<{ key: string }> } }
    ).order;
    await returnCall("POST", {
      ...owner,
      body: {
        orderId: ids.orderId,
        expectedOrderRevision: shippedOrder.revision,
        lines: [{ lineKey: shippedOrder.lines[0]!.key, quantity: 1 }],
        reason: "damaged",
        detail: null,
      },
    });
    await withCurrentSite("default", () =>
      paymentShop.plugin.actions?.approveReturn?.handler(
        {
          row: { id: ids.orderId, returnRevision: 1 },
          values: { operatorNote: "Awaiting inspection" },
        },
        actionContext,
      ),
    );
    const db = await getTestDb();
    await db
      .update(shopProductsTable)
      .set({ trackInventory: false, inventoryState: "untracked" })
      .where(eq(shopProductsTable.id, productId));
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.receiveReturn?.handler(
          {
            row: { id: ids.orderId, returnRevision: 2 },
            values: { operatorNote: "Catalog tracking changed" },
          },
          actionContext,
        ),
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("inventory manual-required") });
    expect(
      await db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId)),
    ).toEqual([{ stockQuantity: 7 }]);
    expect(await orderCall("GET", { ...owner, orderId: ids.orderId })).toMatchObject({
      body: {
        order: { returnRequest: { status: "received", inventoryOutcome: "manual-required" } },
      },
    });
    expect(
      await withCurrentSite("default", () =>
        paymentShop.plugin.actions?.returnHealth?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { level: "warn" } });
  });

  it("cancels expired pending orders and purges old commercial snapshots in bounded passes", async () => {
    const db = await getTestDb();
    const now = new Date();
    const createdAt = new Date(now.getTime() - 48 * 60 * 60 * 1_000);
    const pendingExpiresAt = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    const purgeAt = new Date(createdAt.getTime() + 365 * 24 * 60 * 60 * 1_000);
    const ownerSegment = `guest:${"a".repeat(64)}`;
    const orderId = "d33e4567-e89b-42d3-a456-426614174000";
    const draftId = "e33e4567-e89b-42d3-a456-426614174000";
    const intentId = "f33e4567-e89b-42d3-a456-426614174000";
    const order = {
      contract: "np.shop-order-storage.v1",
      id: orderId,
      status: "pending-payment",
      revision: 1,
      ownerSegment,
      sourceDraftId: draftId,
      checkoutIntentId: intentId,
      cartRevision: 1,
      cartFingerprint: "b".repeat(64),
      currency: "KRW",
      subtotalMinor: 25_000,
      discountMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: 25_000,
      totalUnits: 1,
      lines: [
        {
          key: `${productId}:_`,
          productId,
          productSlug: "everyday-cup",
          productName: "Everyday cup",
          variantSku: null,
          variantName: null,
          quantity: 1,
          unitPriceMinor: 25_000,
          lineTotalMinor: 25_000,
        },
      ],
      promotions: {
        contract: "np.shop-promotion-snapshot.v1",
        couponCodes: [],
        rejectedCouponCodes: [],
        applied: [],
        discountMinor: 0,
      },
      deliveryMethod: null,
      taxQuote: null,
      privateDataStatus: "retained",
      inventoryReservationStatus: "held",
      inventoryReservationLineKeys: [`${productId}:_`],
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      pendingExpiresAt: pendingExpiresAt.toISOString(),
      paymentProvider: null,
      paymentReference: null,
      paymentEventId: null,
      paymentResolvedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      purgeAt: purgeAt.toISOString(),
    };
    expect(npAnalyzeStoredShopOrder(order)).toEqual([]);
    await db.insert(npPluginStorage).values([
      {
        pluginId: "shop",
        siteId: "default",
        key: `order:${ownerSegment}:${orderId}`,
        value: order,
        expiresAt: purgeAt,
        updatedAt: createdAt,
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `inventory-reservation:${productId}:_:${orderId}`,
        value: {
          contract: "np.shop-inventory-reservation.v1",
          orderId,
          ownerSegment,
          productId,
          variantSku: null,
          quantity: 1,
          createdAt: createdAt.toISOString(),
          expiresAt: pendingExpiresAt.toISOString(),
        },
        expiresAt: pendingExpiresAt,
        updatedAt: createdAt,
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `order-private:${ownerSegment}:${orderId}`,
        value: {
          contract: "np.shop-order-private.v1",
          orderId,
          customer: {
            fullName: "홍길동",
            email: "expired-private@example.com",
            phone: "010-1234-5678",
          },
          shipping: {
            recipientName: "홍길동",
            phone: "010-1234-5678",
            countryCode: "KR",
            postalCode: "04524",
            addressLine1: "서울특별시 중구 세종대로 110",
            addressLine2: null,
            locality: "중구",
            administrativeArea: "서울특별시",
          },
          createdAt: createdAt.toISOString(),
          expiresAt: pendingExpiresAt.toISOString(),
        },
        expiresAt: pendingExpiresAt,
        updatedAt: createdAt,
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `order-maintenance:${ownerSegment}:${orderId}`,
        value: {
          contract: "np.shop-order-maintenance.v1",
          orderId,
          ownerSegment,
          dueAt: pendingExpiresAt.toISOString(),
        },
        expiresAt: pendingExpiresAt,
        updatedAt: createdAt,
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `order-lookup:${orderId}`,
        value: {
          contract: "np.shop-order-lookup.v1",
          orderId,
          ownerSegment,
          purgeAt: purgeAt.toISOString(),
        },
        expiresAt: purgeAt,
        updatedAt: createdAt,
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `exchange-destination-private:${orderId}`,
        value: {
          contract: "np.shop-exchange-destination-private.v1",
          orderId,
          exchangeId: "da3e4567-e89b-42d3-a456-426614174000",
          ownerSegment,
          exchangeRevision: 1,
          destinationRevision: 1,
          destination: {
            recipientName: "만료 배송지",
            phone: "010-1234-5678",
            countryCode: "KR",
            postalCode: "04524",
            addressLine1: "서울특별시 중구 세종대로 110",
            addressLine2: null,
            locality: "중구",
            administrativeArea: "서울특별시",
          },
          submittedAt: new Date(now.getTime() - 23 * 60 * 60 * 1_000).toISOString(),
          accessedAt: null,
          updatedAt: new Date(now.getTime() - 23 * 60 * 60 * 1_000).toISOString(),
          expiresAt: new Date(now.getTime() - 60_000).toISOString(),
        },
        expiresAt: new Date(now.getTime() - 60_000),
        updatedAt: new Date(now.getTime() - 23 * 60 * 60 * 1_000),
      },
    ]);
    const maintenance = shopPlugin.scheduled?.find((task) => task.id === "maintain-orders");
    expect(maintenance).toBeDefined();
    await withCurrentSite("default", () => maintenance?.handler({} as never));
    const afterCancellation = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "order%:%"),
        ),
      );
    const cancelledOrder = afterCancellation.find((row) => row.key.startsWith("order:"));
    expect(cancelledOrder).toMatchObject({
      key: `order:${ownerSegment}:${orderId}`,
      value: {
        status: "cancelled",
        privateDataStatus: "redacted",
        inventoryReservationStatus: "released",
        cancellationReason: "payment-timeout",
      },
    });
    expect(JSON.stringify(afterCancellation)).not.toContain("expired-private@example.com");
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `exchange-destination-private:${orderId}`)),
    ).toEqual([]);

    const expiredPurgeAt = new Date(now.getTime() - 1_000);
    const expiredCreatedAt = new Date(expiredPurgeAt.getTime() - 365 * 24 * 60 * 60 * 1_000);
    const expiredPendingAt = new Date(expiredCreatedAt.getTime() + 24 * 60 * 60 * 1_000);
    await db
      .update(npPluginStorage)
      .set({
        value: {
          ...(cancelledOrder?.value as Record<string, unknown>),
          createdAt: expiredCreatedAt.toISOString(),
          pendingExpiresAt: expiredPendingAt.toISOString(),
          purgeAt: expiredPurgeAt.toISOString(),
        },
        expiresAt: expiredPurgeAt,
      })
      .where(eq(npPluginStorage.key, `order:${ownerSegment}:${orderId}`));
    await db.insert(npPluginStorage).values({
      pluginId: "shop",
      siteId: "default",
      key: `tracking-poll:${orderId}`,
      value: {
        contract: "np.shop-tracking-poll-storage.v1",
        orderId,
        shipmentId: "a43e4567-e89b-42d3-a456-426614174000",
        providerId: "retired-carrier",
        consecutiveFailures: 0,
        lastAttemptAt: expiredCreatedAt.toISOString(),
        lastSuccessAt: expiredCreatedAt.toISOString(),
        nextAttemptAt: expiredPurgeAt.toISOString(),
        lastErrorCode: null,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: expiredCreatedAt.toISOString(),
        purgeAt: expiredPurgeAt.toISOString(),
      },
      expiresAt: expiredPurgeAt,
      updatedAt: expiredCreatedAt,
    });
    const expiredReturnId = "b43e4567-e89b-42d3-a456-426614174000";
    const expiredLogisticsId = "c43e4567-e89b-42d3-a456-426614174000";
    const expiredReturnEvent = {
      contract: "np.shop-return-tracking-event.v1",
      eventId: "expired-return-event",
      logisticsId: expiredLogisticsId,
      returnId: expiredReturnId,
      orderId,
      returnReference: "expired-return-reference",
      trackingNumber: "EXPIRED-RETURN-TRACK",
      status: "in-transit",
      occurredAt: expiredCreatedAt.toISOString(),
      signedAt: expiredCreatedAt.toISOString(),
    };
    await db.insert(npPluginStorage).values([
      {
        pluginId: "shop",
        siteId: "default",
        key: `return-tracking:${orderId}`,
        value: {
          contract: "np.shop-return-tracking-storage.v1",
          orderId,
          returnId: expiredReturnId,
          logisticsId: expiredLogisticsId,
          providerId: "retired-carrier",
          returnReference: expiredReturnEvent.returnReference,
          trackingNumber: expiredReturnEvent.trackingNumber,
          status: "in-transit",
          latestEventId: expiredReturnEvent.eventId,
          occurredAt: expiredCreatedAt.toISOString(),
          deliveredAt: null,
          updatedAt: expiredCreatedAt.toISOString(),
          purgeAt: expiredPurgeAt.toISOString(),
        },
        expiresAt: expiredPurgeAt,
        updatedAt: expiredCreatedAt,
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `return-tracking-poll:${orderId}`,
        value: {
          contract: "np.shop-return-tracking-poll-storage.v1",
          orderId,
          returnId: expiredReturnId,
          logisticsId: expiredLogisticsId,
          providerId: "retired-carrier",
          consecutiveFailures: 0,
          lastAttemptAt: expiredCreatedAt.toISOString(),
          lastSuccessAt: expiredCreatedAt.toISOString(),
          nextAttemptAt: expiredPurgeAt.toISOString(),
          lastErrorCode: null,
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: expiredCreatedAt.toISOString(),
          purgeAt: expiredPurgeAt.toISOString(),
        },
        expiresAt: expiredPurgeAt,
        updatedAt: expiredCreatedAt,
      },
      {
        pluginId: "shop",
        siteId: "default",
        key: `return-tracking-event:retired-carrier:${"d".repeat(64)}`,
        value: {
          contract: "np.shop-return-tracking-receipt.v1",
          providerId: "retired-carrier",
          event: expiredReturnEvent,
          eventDigest: "e".repeat(64),
          outcome: "advanced",
          trackingStatus: "in-transit",
          processedAt: expiredCreatedAt.toISOString(),
          purgeAt: expiredPurgeAt.toISOString(),
        },
        expiresAt: expiredPurgeAt,
        updatedAt: expiredCreatedAt,
      },
    ]);
    await db.insert(npPluginStorage).values({
      pluginId: "shop",
      siteId: "default",
      key: `fulfillment-parcels:${orderId}`,
      value: {
        contract: "np.shop-fulfillment-parcels-storage.v1",
        orderId,
        fulfillmentRevision: 1,
        revision: 1,
        parcels: [
          {
            id: "parcel-1",
            lengthMm: 300,
            widthMm: 200,
            heightMm: 100,
            weightGrams: 1_500,
            items: [{ lineKey: `${productId}:_`, quantity: 1 }],
          },
        ],
        lockedShipmentId: null,
        createdAt: expiredCreatedAt.toISOString(),
        updatedAt: expiredCreatedAt.toISOString(),
        purgeAt: expiredPurgeAt.toISOString(),
      },
      expiresAt: expiredPurgeAt,
      updatedAt: expiredCreatedAt,
    });
    await withCurrentSite("default", () => maintenance?.handler({} as never));
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `order:${ownerSegment}:${orderId}`)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(like(npPluginStorage.key, `return-tracking%${orderId}%`)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(
          and(
            like(npPluginStorage.key, "return-tracking-event:%"),
            sql`${npPluginStorage.value}->'event'->>'orderId' = ${orderId}`,
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `tracking-poll:${orderId}`)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `fulfillment-parcels:${orderId}`)),
    ).toHaveLength(0);
  });
});
