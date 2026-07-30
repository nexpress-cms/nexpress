import { npPluginStorage, withCurrentSite } from "@nexpress/core";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import { npRequireShopOrderDraft, shopCollections, shopPlugin } from "@nexpress/plugin-shop";
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
});
