import { npAuditEvents, npPluginStorage, withCurrentSite } from "@nexpress/core";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import {
  createShop,
  NpShopPaymentProviderError,
  npRequireShopOrderDraft,
  shopCollections,
  shopPlugin,
} from "@nexpress/plugin-shop";
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
  seedUser,
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
    await withCurrentSite("default", () => maintenance?.handler({} as never));
    expect(
      await db
        .select({ key: npPluginStorage.key })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `order:${ownerSegment}:${orderId}`)),
    ).toHaveLength(0);
  });
});
