import { randomUUID } from "node:crypto";

import { npAuditEvents, npPluginStorage, withCurrentSite } from "@nexpress/core";
import { npCreateEmptyRichTextContent } from "@nexpress/core/fields";
import {
  createShop,
  npCreateShopPackingWorkCancelResult,
  npCreateShopPackingWorkCreateResult,
  NpShopCarrierProviderError,
  NpShopPackingWorkConflictError,
  NpShopPackingWorkProviderError,
  shopCollections,
  shopPlugin,
  type NpShopCarrierPickupCancelRequest,
  type NpShopCarrierPickupRequest,
  type NpShopPackingWorkCancelRequest,
  type NpShopCarrierParcelBookingRequest,
  type NpShopPackingWorkCreateRequest,
  type NpShopExchangeCarrierCancelRequest,
  type NpShopExchangeCarrierParcelBookingRequest,
  type NpShopStoredPackingWork,
} from "@nexpress/plugin-shop";
import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  shopCategoriesTable,
  shopProductReviewsPhotosTable,
  shopProductReviewsTable,
  shopProductsCategoriesTable,
  shopProductsGalleryTable,
  shopProductsTable,
  shopProductsVariantsTable,
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
  seedUser,
  skipIfNoTestDb,
  truncateAll,
} from "./harness.js";

const productId = "123e4567-e89b-42d3-a456-426614174000";
const privateMarkers =
  /packing-private@example\.com|홍길동|010-1234-5678|세종대로|Everyday cup|unitPrice|priceMinor|customer|shipping|address/u;

type Shop = ReturnType<typeof createShop>;
type ShopMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type RouteHandler = NonNullable<typeof shopPlugin.routes>[number]["handler"];
type ActionContext = { actionInvocation: { kind: "staff"; userId: string } };

interface OrderIds {
  readonly intentId: string;
  readonly draftId: string;
  readonly orderId: string;
}

interface OwnerSession {
  readonly cookie: string | undefined;
  readonly csrf: string;
}

function route(method: ShopMethod, path: string): RouteHandler {
  const registration = shopPlugin.routes?.find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  if (!registration) throw new Error(`Missing ${method} Shop route ${path}.`);
  return registration.handler;
}

async function routeCall(
  method: ShopMethod,
  path: string,
  input: {
    cookie?: string;
    csrf?: string;
    body?: unknown;
    query?: Record<string, string>;
    rawBody?: Uint8Array;
  } = {},
) {
  return withCurrentSite("default", () =>
    route(method, path)(
      {
        method,
        path,
        params: { pluginId: "shop" },
        query: input.query ?? {},
        body: input.body,
        bodyMode: input.rawBody ? "raw" : "json",
        rawBody: input.rawBody,
        headers: {
          ...(input.cookie ? { cookie: input.cookie } : {}),
          ...(input.csrf ? { "x-csrf-token": input.csrf } : {}),
        },
      },
      {} as never,
    ),
  );
}

function ids(): OrderIds {
  return { intentId: randomUUID(), draftId: randomUUID(), orderId: randomUUID() };
}

async function createPendingOrder(orderIds: OrderIds): Promise<OwnerSession> {
  const initial = await routeCall("GET", "/cart");
  const cookie = initial.headers?.["Set-Cookie"];
  const csrf = (initial.body as { csrfToken: string }).csrfToken;
  const added = await routeCall("POST", "/cart", {
    cookie,
    csrf,
    body: { productId, variantSku: null, quantity: 1, expectedRevision: 0 },
  });
  const addedBody = added.body as {
    csrfToken: string;
    quote: { revision: number; fingerprint: string };
  };
  await routeCall("POST", "/checkout", {
    cookie,
    csrf: addedBody.csrfToken,
    body: {
      idempotencyKey: orderIds.intentId,
      expectedRevision: addedBody.quote.revision,
      expectedFingerprint: addedBody.quote.fingerprint,
    },
  });
  await routeCall("POST", "/order-drafts", {
    cookie,
    csrf: addedBody.csrfToken,
    body: { idempotencyKey: orderIds.draftId, checkoutIntentId: orderIds.intentId },
  });
  await routeCall("PATCH", "/order-drafts", {
    cookie,
    csrf: addedBody.csrfToken,
    body: {
      draftId: orderIds.draftId,
      expectedRevision: 1,
      customer: {
        fullName: "홍길동",
        email: "packing-private@example.com",
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
  const created = await routeCall("POST", "/orders", {
    cookie,
    csrf: addedBody.csrfToken,
    body: {
      idempotencyKey: orderIds.orderId,
      draftId: orderIds.draftId,
      expectedRevision: 2,
    },
  });
  expect(created).toMatchObject({
    status: 200,
    body: { order: { id: orderIds.orderId, status: "pending-payment" } },
  });
  return { cookie, csrf: addedBody.csrfToken };
}

function paymentAdapter() {
  return {
    id: "test-pay",
    verifyWebhook: ({ rawBody }: { rawBody: Uint8Array }) =>
      JSON.parse(new TextDecoder().decode(rawBody)) as never,
    refundPayment: (input: {
      refundId: string;
      orderId: string;
      paymentReference: string;
      currency: "KRW";
      amountMinor: number;
      requestedAt: string;
    }) => ({
      contract: "np.shop-refund-result.v1" as const,
      refundId: input.refundId,
      orderId: input.orderId,
      paymentReference: input.paymentReference,
      refundReference: `refund_${input.refundId}`,
      currency: input.currency,
      amountMinor: input.amountMinor,
      refundedAt: input.requestedAt,
    }),
  };
}

async function payOrder(shop: Shop, orderId: string): Promise<void> {
  const handler = shop.plugin.routes?.find(
    (candidate) => candidate.method === "POST" && candidate.path === "/payments/webhook",
  )?.handler;
  if (!handler) throw new Error("Missing configured payment webhook.");
  const now = new Date().toISOString();
  const result = await withCurrentSite("default", () =>
    handler(
      {
        method: "POST",
        path: "/payments/webhook",
        params: { pluginId: "shop" },
        query: {},
        body: undefined,
        bodyMode: "raw",
        rawBody: new TextEncoder().encode(
          JSON.stringify({
            contract: "np.shop-payment-event.v1",
            eventId: `pay_${orderId}`,
            type: "payment.succeeded",
            orderId,
            paymentReference: `payment_${orderId}`,
            currency: "KRW",
            amountMinor: 25_000,
            signedAt: now,
          }),
        ),
        headers: {},
      },
      {} as never,
    ),
  );
  expect(result).toMatchObject({ status: 200, body: { receipt: { outcome: "paid" } } });
}

async function invokeAction(shop: Shop, actionId: string, data: unknown, context: ActionContext) {
  const registration = shop.plugin.actions?.[actionId];
  if (!registration || registration.kind !== "action") {
    throw new Error(`Missing Shop action ${actionId}.`);
  }
  return withCurrentSite("default", () => registration.handler(data, context as never));
}

async function invokeReadAction(shop: Shop, actionId: string) {
  const registration = shop.plugin.actions?.[actionId];
  if (!registration || registration.kind === "action") {
    throw new Error(`Missing Shop read action ${actionId}.`);
  }
  return withCurrentSite("default", () => registration.handler(undefined, {} as never));
}

async function invokePackingStatusCallback(shop: Shop, event: Record<string, unknown>) {
  const handler = shop.plugin.routes?.find(
    (candidate) => candidate.method === "POST" && candidate.path === "/packing/status/webhook",
  )?.handler;
  if (!handler) throw new Error("Missing configured packing status callback.");
  return withCurrentSite("default", () =>
    handler(
      {
        method: "POST",
        path: "/packing/status/webhook",
        params: { pluginId: "shop" },
        query: {},
        body: undefined,
        bodyMode: "raw",
        rawBody: new TextEncoder().encode(JSON.stringify(event)),
        headers: { "x-wms-signature": "verified-by-adapter" },
      },
      {} as never,
    ),
  );
}

function parcels(id = "parcel-1") {
  return [
    {
      id,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      weightGrams: 1_500,
      items: [{ lineKey: `${productId}:_`, quantity: 1 }],
    },
  ];
}

async function prepareOutbound(shop: Shop, context: ActionContext) {
  const orderIds = ids();
  const owner = await createPendingOrder(orderIds);
  await payOrder(shop, orderIds.orderId);
  expect(
    await invokeAction(
      shop,
      "processFulfillment",
      {
        row: { id: orderIds.orderId, fulfillmentRevision: 1 },
        values: { operatorNote: "Prepare exact packing snapshot" },
      },
      context,
    ),
  ).toMatchObject({ ok: true, data: expect.stringContaining("revision 2") });
  expect(
    await invokeAction(
      shop,
      "saveFulfillmentParcels",
      {
        row: { id: orderIds.orderId, fulfillmentRevision: 2, parcelRevision: null },
        values: { parcels: JSON.stringify(parcels()) },
      },
      context,
    ),
  ).toMatchObject({ ok: true, data: expect.stringContaining("revision 1") });
  return { orderIds, owner };
}

async function readOwnerOrder(owner: OwnerSession, orderId: string) {
  const result = await routeCall("GET", "/orders", {
    ...owner,
    query: { id: orderId },
  });
  expect(result.status).toBe(200);
  return result.body as {
    order: {
      id: string;
      status: string;
      revision: number;
      lines: Array<{ key: string }>;
      exchange: {
        id: string;
        revision: number;
        status: string;
        destinationRevision: number;
      } | null;
      fulfillment: { status: string; revision: number } | null;
    };
    exchangeDestinationAuthority?: {
      exchangeId: string;
      orderRevision: number;
      exchangeRevision: number;
      destinationRevision: number;
      token: string;
    };
  };
}

async function prepareAwaitingExchange(shop: Shop, context: ActionContext) {
  const orderIds = ids();
  const owner = await createPendingOrder(orderIds);
  const manualShop = createShop({ payment: { adapter: paymentAdapter() } });
  await payOrder(manualShop, orderIds.orderId);

  expect(
    await invokeAction(
      shop,
      "processFulfillment",
      {
        row: { id: orderIds.orderId, fulfillmentRevision: 1 },
        values: { operatorNote: "Prepare original packing work" },
      },
      context,
    ),
  ).toMatchObject({ ok: true });
  expect(
    await invokeAction(
      shop,
      "saveFulfillmentParcels",
      {
        row: { id: orderIds.orderId, fulfillmentRevision: 2, parcelRevision: null },
        values: { parcels: JSON.stringify(parcels("original-parcel")) },
      },
      context,
    ),
  ).toMatchObject({ ok: true });
  expect(
    await invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(orderIds.orderId),
      context,
    ),
  ).toMatchObject({ ok: true, data: expect.stringContaining("active") });
  expect(
    await invokeAction(
      manualShop,
      "shipFulfillment",
      {
        row: { id: orderIds.orderId, fulfillmentRevision: 2 },
        values: {
          carrier: "Parcel Co",
          trackingNumber: "ORIGINAL-SHIPMENT",
          operatorNote: "Manual shipment consumes packing work",
        },
      },
      context,
    ),
  ).toMatchObject({ ok: true });
  expect(await readPackingWork(orderIds.orderId)).toMatchObject({
    status: "consumed",
    attachedShipmentId: null,
  });

  const shipped = await readOwnerOrder(owner, orderIds.orderId);
  const lineKey = shipped.order.lines[0]?.key;
  if (!lineKey) throw new Error("Missing immutable order line.");
  const requested = await routeCall("POST", "/returns", {
    ...owner,
    body: {
      orderId: orderIds.orderId,
      expectedOrderRevision: shipped.order.revision,
      lines: [{ lineKey, quantity: 1 }],
      reason: "defective",
      detail: null,
    },
  });
  expect(requested).toMatchObject({ status: 200, body: { returnRequest: { revision: 1 } } });
  const returnId = (requested.body as { returnRequest: { id: string } }).returnRequest.id;
  expect(
    await invokeAction(
      manualShop,
      "approveReturn",
      {
        row: { id: orderIds.orderId, returnRevision: 1 },
        values: { operatorNote: "Approve exact replacement" },
      },
      context,
    ),
  ).toMatchObject({ ok: true });
  expect(
    await invokeAction(
      manualShop,
      "receiveReturn",
      {
        row: { id: orderIds.orderId, returnRevision: 2 },
        values: { operatorNote: "Received original item" },
      },
      context,
    ),
  ).toMatchObject({ ok: true });
  const received = await readOwnerOrder(owner, orderIds.orderId);
  expect(
    await invokeAction(
      manualShop,
      "createExchange",
      {
        row: {
          id: orderIds.orderId,
          orderRevision: received.order.revision,
          returnId,
          returnRevision: 3,
        },
        values: { operatorNote: "Create same-item replacement" },
      },
      context,
    ),
  ).toMatchObject({ ok: true });
  const created = await readOwnerOrder(owner, orderIds.orderId);
  const authority = created.exchangeDestinationAuthority;
  if (!authority || !created.order.exchange) throw new Error("Missing exchange authority.");
  expect(
    await routeCall("POST", "/exchanges/destination", {
      ...owner,
      body: {
        orderId: orderIds.orderId,
        exchangeId: authority.exchangeId,
        orderRevision: authority.orderRevision,
        exchangeRevision: authority.exchangeRevision,
        destinationRevision: authority.destinationRevision,
        authorityToken: authority.token,
        destination: {
          recipientName: "김교환",
          phone: "010-9876-5432",
          countryCode: "KR",
          postalCode: "06236",
          addressLine1: "서울특별시 강남구 테헤란로 123",
          addressLine2: null,
          locality: "강남구",
          administrativeArea: "서울특별시",
        },
      },
    }),
  ).toMatchObject({ status: 200 });
  const submitted = await readOwnerOrder(owner, orderIds.orderId);
  const exchange = submitted.order.exchange;
  if (!exchange) throw new Error("Missing submitted exchange.");
  expect(
    await invokeAction(
      manualShop,
      "readExchangeDestination",
      {
        row: {
          id: orderIds.orderId,
          exchangeId: exchange.id,
          orderRevision: submitted.order.revision,
          exchangeRevision: exchange.revision,
          destinationRevision: exchange.destinationRevision,
        },
        values: {},
      },
      context,
    ),
  ).toMatchObject({ ok: true });
  return {
    orderIds,
    owner,
    lineKey,
    orderRevision: submitted.order.revision,
    exchangeId: exchange.id,
    exchangeRevision: exchange.revision,
    destinationRevision: exchange.destinationRevision,
  };
}

async function readPackingWork(
  orderId: string,
  target: "outbound" | "replacement" = "outbound",
  siteId = "default",
): Promise<NpShopStoredPackingWork> {
  const db = await getTestDb();
  const [row] = await db
    .select({ value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, "shop"),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, `packing-work:${target}:${orderId}`),
      ),
    );
  if (!row) throw new Error(`Missing ${target} packing work for ${orderId}.`);
  return row.value as NpShopStoredPackingWork;
}

function createInput(orderId: string, workRevision: number | null = null) {
  return {
    row: {
      id: orderId,
      fulfillmentRevision: 2,
      parcelRevision: 1,
      packingWorkRevision: workRevision,
    },
    values: {},
  };
}

function existingInput(work: NpShopStoredPackingWork) {
  return {
    row: {
      id: work.orderId,
      packingWorkTarget: work.target,
      exchangeId: work.exchangeId,
      packingWorkId: work.workId,
      packingWorkRevision: work.revision,
    },
    values: {},
  };
}

function shiftIsoDates(value: unknown, milliseconds: number): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return new Date(new Date(value).getTime() + milliseconds).toISOString();
  }
  if (Array.isArray(value)) return value.map((item) => shiftIsoDates(item, milliseconds));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, shiftIsoDates(item, milliseconds)]),
  );
}

async function expireCommercialRows(orderId: string): Promise<void> {
  const db = await getTestDb();
  const rows = await db
    .select({ key: npPluginStorage.key, value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(and(eq(npPluginStorage.pluginId, "shop"), eq(npPluginStorage.siteId, "default")));
  const shift = -366 * 24 * 60 * 60 * 1_000;
  for (const row of rows) {
    const record =
      typeof row.value === "object" && row.value !== null
        ? (row.value as Record<string, unknown>)
        : null;
    if (
      !record ||
      typeof record.purgeAt !== "string" ||
      !(
        row.key.endsWith(orderId) ||
        record.orderId === orderId ||
        (record.id === orderId && row.key.startsWith("order:"))
      )
    ) {
      continue;
    }
    const shifted = shiftIsoDates(record, shift) as Record<string, unknown>;
    if (typeof shifted.purgeAt !== "string") throw new Error("Missing shifted purgeAt.");
    await db
      .update(npPluginStorage)
      .set({ value: shifted, expiresAt: new Date(shifted.purgeAt) })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, row.key),
        ),
      );
  }
}

async function storageKeysForOrder(orderId: string): Promise<string[]> {
  const db = await getTestDb();
  const rows = await db
    .select({ key: npPluginStorage.key, value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(and(eq(npPluginStorage.pluginId, "shop"), eq(npPluginStorage.siteId, "default")));
  return rows
    .filter((row) => row.key.includes(orderId) || JSON.stringify(row.value).includes(orderId))
    .map((row) => row.key);
}

describe.skipIf(skipIfNoTestDb())("shop durable packing work", () => {
  beforeAll(async () => {
    await ensureMigrated();
    registerTestCollections();
    const { registerCollection } = await import("@nexpress/core");
    registerCollection("shop-categories", shopCategoriesTable, shopCollections[0]);
    registerCollection("shop-products", shopProductsTable, shopCollections[1], {
      childTables: { gallery: shopProductsGalleryTable, variants: shopProductsVariantsTable },
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
    vi.stubEnv("NP_SECRET", "shop-packing-work-integration-secret-32-bytes");
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

  it("keeps create and cancel retries stable, exact, PII-free, and site-scoped", async () => {
    const createRequests: NpShopPackingWorkCreateRequest[] = [];
    const cancelRequests: NpShopPackingWorkCancelRequest[] = [];
    const cancelledWorkIds = new Set<string>();
    let createAttempts = 0;
    let cancelAttempts = 0;
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "test-packing",
          createPackingWork: (request) => {
            createRequests.push(request);
            createAttempts += 1;
            if (cancelledWorkIds.has(request.workId)) {
              throw new NpShopPackingWorkProviderError(
                "cancel-tombstone",
                "A cancelled work id must never recreate provider state.",
                { retryable: false },
              );
            }
            if (createAttempts === 1) {
              throw new NpShopPackingWorkProviderError(
                "packing-timeout",
                "provider-secret-create-value",
                { retryable: true },
              );
            }
            return npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            });
          },
          cancelPackingWork: (request) => {
            cancelRequests.push(request);
            cancelAttempts += 1;
            if (cancelAttempts === 1) {
              throw new NpShopPackingWorkProviderError(
                "cancel-timeout",
                "provider-secret-cancel-value",
                { retryable: true },
              );
            }
            cancelledWorkIds.add(request.workId);
            return npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            });
          },
        },
      },
    });
    const staff = await seedUser({ email: "packing-operator@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const { orderIds } = await prepareOutbound(shop, context);

    const first = await invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(orderIds.orderId),
      context,
    );
    expect(first).toEqual({
      ok: false,
      error: "Packing work provider is temporarily unavailable.",
    });
    const pending = await readPackingWork(orderIds.orderId);
    expect(pending).toMatchObject({
      target: "outbound",
      exchangeId: null,
      providerId: "test-packing",
      status: "pending",
      revision: 1,
      providerErrorCode: null,
    });
    expect(await invokeReadAction(shop, "recentOrders")).toMatchObject({
      ok: true,
      data: {
        rows: [expect.objectContaining({ id: orderIds.orderId, refundEligible: false })],
      },
    });
    expect(await invokeReadAction(shop, "recentFulfillments")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: orderIds.orderId,
            packingWorkStatus: "pending",
            parcelMutationEligible: false,
            manualShipmentEligible: false,
            carrierShipmentEligible: false,
          }),
        ],
      },
    });
    expect(JSON.stringify(pending)).not.toMatch(privateMarkers);
    expect(await invokeReadAction(shop, "recentPackingWork")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: orderIds.orderId,
            provider: "test-packing",
            status: "pending",
            providerRetryEligible: true,
            providerCancelEligible: true,
          }),
        ],
      },
    });

    const second = await invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(orderIds.orderId, pending.revision),
      context,
    );
    expect(second).toMatchObject({ ok: true, data: expect.stringContaining("active") });
    expect(createRequests).toHaveLength(2);
    expect(createRequests[1]).toEqual(createRequests[0]);
    expect(createRequests[0]).toMatchObject({
      contract: "np.shop-packing-work-create-request.v1",
      workId: pending.workId,
      orderId: orderIds.orderId,
      target: "outbound",
      exchangeId: null,
      sourceRevision: 2,
      parcelRevision: 1,
      parcelFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      lines: [
        {
          lineKey: `${productId}:_`,
          productId,
          productSlug: "everyday-cup",
          variantSku: null,
          quantity: 1,
        },
      ],
      parcels: parcels(),
      requestedAt: expect.any(String),
    });
    expect(Object.keys(createRequests[0]!).sort()).toEqual(
      [
        "contract",
        "exchangeId",
        "lines",
        "orderId",
        "parcelFingerprint",
        "parcelRevision",
        "parcels",
        "requestedAt",
        "sourceRevision",
        "target",
        "workId",
      ].sort(),
    );
    expect(Object.isFrozen(createRequests[0])).toBe(true);
    expect(Object.isFrozen(createRequests[0]?.lines)).toBe(true);
    expect(Object.isFrozen(createRequests[0]?.parcels[0]?.items)).toBe(true);
    expect(JSON.stringify(createRequests[0])).not.toMatch(privateMarkers);

    const active = await readPackingWork(orderIds.orderId);
    expect(active).toMatchObject({ status: "active", revision: 3 });
    expect(await invokeAction(shop, "cancelPackingWork", existingInput(active), context)).toEqual({
      ok: false,
      error: "Packing work provider is temporarily unavailable.",
    });
    const cancelPending = await readPackingWork(orderIds.orderId);
    expect(cancelPending).toMatchObject({
      status: "cancel-pending",
      revision: 4,
      cancellationId: expect.any(String),
    });
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(cancelPending), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    expect(cancelRequests).toHaveLength(2);
    expect(cancelRequests[1]).toEqual(cancelRequests[0]);
    expect(cancelRequests[0]).toMatchObject({
      contract: "np.shop-packing-work-cancel-request.v1",
      cancellationId: cancelPending.cancellationId,
      workId: active.workId,
      providerWorkReference: active.providerWorkReference,
    });
    expect(JSON.stringify(cancelRequests)).not.toMatch(privateMarkers);

    const cancelled = await readPackingWork(orderIds.orderId);
    expect(cancelled).toMatchObject({ status: "cancelled", revision: 6 });
    await expect(
      Promise.resolve().then(() =>
        shop.runtime.packingWorkAdapter?.createPackingWork(createRequests[0]!),
      ),
    ).rejects.toMatchObject({ code: "cancel-tombstone", retryable: false });
    const createRequestCountAfterProviderTombstone = createRequests.length;
    expect(
      await invokeAction(
        shop,
        "saveFulfillmentParcels",
        {
          row: { id: orderIds.orderId, fulfillmentRevision: 2, parcelRevision: 1 },
          values: { parcels: JSON.stringify(parcels("parcel-after-cancel")) },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("revision 2") });

    const retainedTombstone = await readPackingWork(orderIds.orderId);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        {
          row: {
            id: orderIds.orderId,
            fulfillmentRevision: 2,
            parcelRevision: 2,
            packingWorkRevision: retainedTombstone.revision,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("terminal cancellation tombstone"),
    });
    expect(await readPackingWork(orderIds.orderId)).toEqual(retainedTombstone);
    expect(createRequests).toHaveLength(createRequestCountAfterProviderTombstone);

    expect(await invokeReadAction(shop, "countPackingWork")).toMatchObject({
      ok: true,
      data: { value: 1 },
    });
    expect(await invokeReadAction(shop, "recentPackingWork")).toMatchObject({
      ok: true,
      data: { total: 1, rows: [{ id: orderIds.orderId, status: "cancelled" }] },
    });
    expect(
      await withCurrentSite("other-site", () =>
        shop.plugin.actions?.countPackingWork?.handler(undefined, {} as never),
      ),
    ).toMatchObject({ ok: true, data: { value: 0 } });

    const db = await getTestDb();
    const audits = await db
      .select({ action: npAuditEvents.action, payload: npAuditEvents.payload })
      .from(npAuditEvents)
      .where(eq(npAuditEvents.targetId, orderIds.orderId));
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "shop.packing-work.create.request",
        "shop.packing-work.create.confirm",
        "shop.packing-work.activate",
        "shop.packing-work.cancel.request",
        "shop.packing-work.cancel.confirm",
        "shop.packing-work.cancel",
      ]),
    );
    expect(JSON.stringify(audits)).not.toMatch(privateMarkers);
    expect(JSON.stringify(audits)).not.toContain("provider-secret");
  });

  it("stores monotonic verified packing evidence without completing shipment", async () => {
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "test-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
          verifyPackingStatusWebhook: ({ rawBody }) =>
            JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
    });
    const staff = await seedUser({ email: "packing-status-operator@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const { orderIds } = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("active") });
    const active = await readPackingWork(orderIds.orderId);
    const callback = shop.plugin.routes?.find(
      (candidate) => candidate.method === "POST" && candidate.path === "/packing/status/webhook",
    )?.handler;
    if (!callback || !active.providerWorkReference) {
      throw new Error("Missing packing status callback or provider work reference.");
    }
    const callbackAt = new Date();
    const send = async (
      eventId: string,
      status: "accepted" | "picking" | "failed" | "packed",
      occurredAt: Date,
    ) =>
      withCurrentSite("default", () =>
        callback(
          {
            method: "POST",
            path: "/packing/status/webhook",
            params: { pluginId: "shop" },
            query: {},
            body: undefined,
            bodyMode: "raw",
            rawBody: new TextEncoder().encode(
              JSON.stringify({
                contract: "np.shop-packing-status-event.v1",
                eventId,
                workId: active.workId,
                orderId: orderIds.orderId,
                target: "outbound",
                exchangeId: null,
                providerWorkReference: active.providerWorkReference,
                status,
                occurredAt: occurredAt.toISOString(),
                signedAt: callbackAt.toISOString(),
              }),
            ),
            headers: { "x-wms-signature": "verified-by-adapter" },
          },
          {} as never,
        ),
      );

    expect(await send("packing-picking", "picking", callbackAt)).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "advanced", packingStatus: "picking" }, duplicate: false },
    });
    expect(
      await send("packing-stale-accepted", "accepted", new Date(callbackAt.getTime() - 1_000)),
    ).toMatchObject({
      status: 200,
      body: {
        receipt: { outcome: "ignored-stale", packingStatus: "picking" },
        duplicate: false,
      },
    });
    const packed = await send("packing-packed", "packed", new Date(callbackAt.getTime() + 1_000));
    expect(packed).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "advanced", packingStatus: "packed" }, duplicate: false },
    });
    expect(
      await send("packing-packed", "packed", new Date(callbackAt.getTime() + 1_000)),
    ).toMatchObject({
      status: 200,
      body: { receipt: { outcome: "advanced", packingStatus: "packed" }, duplicate: true },
    });
    expect(
      await send("packing-packed", "failed", new Date(callbackAt.getTime() + 1_000)),
    ).toMatchObject({
      status: 409,
      body: { error: "packing_status_event_conflict" },
    });

    const db = await getTestDb();
    const statusRows = await db
      .select({ key: npPluginStorage.key, value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "packing-status:%"),
        ),
      );
    expect(statusRows).toHaveLength(1);
    expect(statusRows[0]?.value).toMatchObject({
      workId: active.workId,
      orderId: orderIds.orderId,
      status: "packed",
      latestEventId: "packing-packed",
      packedAt: new Date(callbackAt.getTime() + 1_000).toISOString(),
    });
    expect(JSON.stringify(statusRows)).not.toMatch(privateMarkers);
    expect(await readPackingWork(orderIds.orderId)).toEqual(active);
    expect(await invokeReadAction(shop, "packingStatusHealth")).toMatchObject({
      ok: true,
      data: { level: "ok", message: expect.stringContaining("3 verified event receipt") },
    });
    expect(await invokeReadAction(shop, "recentPackingStatusEvents")).toMatchObject({
      ok: true,
      data: {
        total: 3,
        rows: expect.arrayContaining([expect.objectContaining({ status: "packed" })]),
      },
    });
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(active), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    expect(await invokeReadAction(shop, "packingStatusHealth")).toMatchObject({
      ok: true,
      data: { level: "warn", message: expect.stringContaining("1 picking or packed evidence") },
    });
    await db
      .update(npPluginStorage)
      .set({
        value: {
          ...(statusRows[0]?.value as Record<string, unknown>),
          providerId: "different-packing",
        },
      })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, `packing-status:outbound:${orderIds.orderId}`),
        ),
      );
    expect(await invokeReadAction(shop, "packingStatusHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("provider-mismatched") },
    });
  });

  it("fails closed before provider I/O when a retryable snapshot is tampered", async () => {
    const createPackingWork = vi.fn(() => {
      throw new NpShopPackingWorkProviderError(
        "retryable-tamper-test",
        "provider-secret-tamper-value",
        { retryable: true },
      );
    });
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "tamper-packing",
          createPackingWork,
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-tamper-operator@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const { orderIds } = await prepareOutbound(shop, context);

    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(orderIds.orderId),
        context,
      ),
    ).toEqual({ ok: false, error: "Packing work provider is temporarily unavailable." });
    const pending = await readPackingWork(orderIds.orderId);
    expect(pending).toMatchObject({ status: "pending", revision: 1 });
    expect(createPackingWork).toHaveBeenCalledTimes(1);
    const mismatchedShop = createShop({
      packing: {
        adapter: {
          id: "different-packing",
          createPackingWork,
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    expect(await invokeReadAction(mismatchedShop, "recentPackingWork")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: orderIds.orderId,
            provider: "tamper-packing",
            status: "pending",
            providerRetryEligible: false,
            providerCancelEligible: false,
          }),
        ],
      },
    });
    expect(createPackingWork).toHaveBeenCalledTimes(1);

    const finalizePending = await invokeAction(
      shop,
      "finalizePackingWork",
      existingInput(pending),
      context,
    );
    expect(finalizePending).toEqual({
      ok: false,
      error:
        "Only a provider-confirmed packing-work transition can be finalized without provider I/O.",
    });
    expect(createPackingWork).toHaveBeenCalledTimes(1);
    expect(await readPackingWork(orderIds.orderId)).toEqual(pending);

    const tampered = {
      ...pending,
      lines: pending.lines.map((line) => ({
        ...line,
        productSlug: "internally-valid-tampered-product",
      })),
      parcels: pending.parcels.map((parcel) => ({
        ...parcel,
        lengthMm: parcel.lengthMm + 1,
        items: parcel.items.map((item) => ({ ...item })),
      })),
    } satisfies NpShopStoredPackingWork;
    const db = await getTestDb();
    await db
      .update(npPluginStorage)
      .set({ value: tampered })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, `packing-work:outbound:${orderIds.orderId}`),
        ),
      );
    expect(await invokeReadAction(shop, "recentPackingWork")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: orderIds.orderId,
            localFinalizeEligible: false,
            providerRetryEligible: false,
            providerCancelEligible: false,
          }),
        ],
      },
    });

    const retry = await invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(orderIds.orderId, pending.revision),
      context,
    );
    expect(retry).toEqual({
      ok: false,
      error:
        "The durable packing-work snapshot no longer matches its canonical fingerprint or source.",
    });
    expect(createPackingWork).toHaveBeenCalledTimes(1);
    const review = await readPackingWork(orderIds.orderId);
    expect(review).toMatchObject({
      status: "manual-review",
      revision: 2,
      parcelFingerprint: pending.parcelFingerprint,
      providerErrorCode: "local-state-conflict",
      lines: [{ productSlug: "internally-valid-tampered-product" }],
      parcels: [{ lengthMm: 301 }],
    });

    const audits = await db
      .select({ action: npAuditEvents.action, payload: npAuditEvents.payload })
      .from(npAuditEvents)
      .where(eq(npAuditEvents.targetId, orderIds.orderId));
    expect(audits.map((audit) => audit.action)).toContain("shop.packing-work.create.manual-review");
    expect(JSON.stringify({ finalizePending, retry, review, audits })).not.toMatch(privateMarkers);
    expect(JSON.stringify({ finalizePending, retry, review, audits })).not.toContain(
      "provider-secret-tamper-value",
    );

    const relationOrder = await prepareOutbound(shop, context);
    const parcelKey = `fulfillment-parcels:${relationOrder.orderIds.orderId}`;
    const [parcelRow] = await db
      .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, parcelKey),
        ),
      );
    const parcelSnapshot = parcelRow?.value as
      { fulfillmentRevision: number; purgeAt: string; [key: string]: unknown } | undefined;
    if (!parcelSnapshot || !parcelRow?.expiresAt) {
      throw new Error("Missing fulfillment parcel snapshot for relation tamper coverage.");
    }
    const unrelatedPurgeAt = new Date(
      new Date(parcelSnapshot.purgeAt).getTime() + 24 * 60 * 60 * 1_000,
    ).toISOString();
    await db
      .update(npPluginStorage)
      .set({
        value: {
          ...parcelSnapshot,
          fulfillmentRevision: parcelSnapshot.fulfillmentRevision + 1,
          purgeAt: unrelatedPurgeAt,
        },
        expiresAt: new Date(unrelatedPurgeAt),
      })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, parcelKey),
        ),
      );

    const relationResult = await invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(relationOrder.orderIds.orderId),
      context,
    );
    expect(relationResult).toEqual({
      ok: false,
      error: "The parcel snapshot no longer matches its retained order and source revision.",
    });
    expect(createPackingWork).toHaveBeenCalledTimes(1);
    const [relationPackingRow] = await db
      .select({ key: npPluginStorage.key })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, `packing-work:outbound:${relationOrder.orderIds.orderId}`),
        ),
      );
    expect(relationPackingRow).toBeUndefined();
    expect(JSON.stringify(relationResult)).not.toMatch(privateMarkers);
    expect(JSON.stringify(relationResult)).not.toContain("provider-secret-tamper-value");
  });

  it("fails closed before provider I/O when an order is named by a noncanonical target key", async () => {
    const createPackingWork = vi.fn((request: NpShopPackingWorkCreateRequest) =>
      npCreateShopPackingWorkCreateResult(request, {
        providerWorkReference: `provider_${request.workId}`,
        confirmedAt: request.requestedAt,
      }),
    );
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "noncanonical-key-packing",
          createPackingWork,
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-noncanonical-key@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const source = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(source.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const sourceWork = await readPackingWork(source.orderIds.orderId);

    const target = await prepareOutbound(shop, context);
    const noncanonical = {
      ...sourceWork,
      orderId: target.orderIds.orderId,
    } satisfies NpShopStoredPackingWork;
    const db = await getTestDb();
    await db.insert(npPluginStorage).values({
      pluginId: "shop",
      siteId: "default",
      key: `packing-work:replacement:${target.orderIds.orderId}`,
      value: noncanonical,
      expiresAt: new Date(noncanonical.purgeAt),
      updatedAt: new Date(noncanonical.updatedAt),
    });
    createPackingWork.mockClear();

    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(target.orderIds.orderId),
        context,
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("noncanonical packing-work row"),
    });
    expect(createPackingWork).not.toHaveBeenCalled();
    expect(await invokeReadAction(shop, "recentFulfillments")).toMatchObject({
      ok: true,
      data: {
        rows: expect.arrayContaining([
          expect.objectContaining({
            id: target.orderIds.orderId,
            packingWorkStatus: "invalid",
            parcelMutationEligible: false,
            manualShipmentEligible: false,
            carrierShipmentEligible: false,
          }),
        ]),
      },
    });
    await db.insert(npPluginStorage).values({
      pluginId: "shop",
      siteId: "default",
      key: `packing-work:noncanonical:${source.orderIds.orderId}`,
      value: sourceWork,
      expiresAt: new Date(sourceWork.purgeAt),
      updatedAt: new Date(sourceWork.updatedAt),
    });
    expect(await invokeReadAction(shop, "recentPackingWork")).toMatchObject({
      ok: true,
      data: {
        rows: expect.arrayContaining([
          expect.objectContaining({
            id: source.orderIds.orderId,
            localFinalizeEligible: false,
            providerRetryEligible: false,
            providerCancelEligible: false,
          }),
        ]),
      },
    });
  });

  it("blocks carrier fallback before provider I/O when a cancelled tombstone is corrupt", async () => {
    const bookShipmentWithParcels = vi.fn((request: NpShopCarrierParcelBookingRequest) => ({
      contract: "np.shop-carrier-booking-result.v1" as const,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      bookingReference: `booking_${request.shipmentId}`,
      carrier: "Parcel Co",
      trackingNumber: "CORRUPT-TOMBSTONE-1",
      bookedAt: request.requestedAt,
    }));
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "corrupt-tombstone-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
      carrier: {
        adapter: {
          id: "corrupt-tombstone-carrier",
          bookShipment: () => Promise.reject(new Error("v1 must not be called")),
          bookShipmentWithParcels,
        },
      },
    });
    const staff = await seedUser({ email: "packing-corrupt-tombstone@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(prepared.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const active = await readPackingWork(prepared.orderIds.orderId);
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(active), context),
    ).toMatchObject({ ok: true });
    const cancelled = await readPackingWork(prepared.orderIds.orderId);
    const corrupt = {
      ...cancelled,
      lines: cancelled.lines.map((line) => ({ ...line, productSlug: "corrupt-tombstone" })),
    } satisfies NpShopStoredPackingWork;
    const db = await getTestDb();
    await db
      .update(npPluginStorage)
      .set({ value: corrupt })
      .where(eq(npPluginStorage.key, `packing-work:outbound:${prepared.orderIds.orderId}`));

    expect(
      await invokeAction(
        shop,
        "bookCarrierShipment",
        {
          row: { id: prepared.orderIds.orderId, fulfillmentRevision: 2 },
          values: { operatorNote: "Corrupt tombstone must stay closed" },
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("packing-work") });
    expect(bookShipmentWithParcels).not.toHaveBeenCalled();
    expect(await invokeReadAction(shop, "recentFulfillments")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            packingWorkStatus: "cancelled",
            parcelMutationEligible: false,
            manualShipmentEligible: false,
            carrierShipmentEligible: false,
          }),
        ],
      },
    });
  });

  it("omits malformed recent packing rows without hiding healthy operator actions", async () => {
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "malformed-recent-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "malformed-recent-packing@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const malformed = await prepareOutbound(shop, context);
    const healthy = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(malformed.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(healthy.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });

    const malformedWork = await readPackingWork(malformed.orderIds.orderId);
    const db = await getTestDb();
    await db
      .update(npPluginStorage)
      .set({ value: { ...malformedWork, rawProviderSecret: "must-never-reach-admin" } })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, `packing-work:outbound:${malformed.orderIds.orderId}`),
        ),
      );
    const recent = await invokeReadAction(shop, "recentPackingWork");
    expect(recent).toMatchObject({
      ok: true,
      data: {
        total: 2,
        rows: [
          expect.objectContaining({
            id: healthy.orderIds.orderId,
            status: "active",
            providerRetryEligible: false,
            providerCancelEligible: true,
          }),
        ],
      },
    });
    expect(JSON.stringify(recent)).not.toContain("must-never-reach-admin");
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 malformed") },
    });
    expect(await invokeReadAction(shop, "recentOrders")).toMatchObject({
      ok: true,
      data: {
        rows: expect.arrayContaining([
          expect.objectContaining({
            id: malformed.orderIds.orderId,
            refundEligible: false,
          }),
        ]),
      },
    });
    expect(await invokeReadAction(shop, "recentFulfillments")).toMatchObject({
      ok: true,
      data: {
        rows: expect.arrayContaining([
          expect.objectContaining({
            id: malformed.orderIds.orderId,
            packingWorkStatus: "invalid",
            parcelMutationEligible: false,
            manualShipmentEligible: false,
            carrierShipmentEligible: false,
          }),
          expect.objectContaining({
            id: healthy.orderIds.orderId,
            packingWorkStatus: "active",
            manualShipmentEligible: true,
          }),
        ]),
      },
    });
  });

  it("keeps provider confirmation resumable after a transient local activation failure", async () => {
    const createPackingWork = vi.fn((request: NpShopPackingWorkCreateRequest) =>
      npCreateShopPackingWorkCreateResult(request, {
        providerWorkReference: `provider_${request.workId}`,
        confirmedAt: request.requestedAt,
      }),
    );
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "activation-retry-packing",
          createPackingWork,
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-activation-retry@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareOutbound(shop, context);
    const db = await getTestDb();
    const triggerName = "np_test_fail_packing_activation_audit";
    const functionName = "np_test_fail_packing_activation_audit_fn";
    await db.execute(sql.raw(`drop trigger if exists ${triggerName} on np_audit_events`));
    await db.execute(sql.raw(`drop function if exists ${functionName}()`));
    await db.execute(
      sql.raw(`
      create function ${functionName}() returns trigger language plpgsql as $$
      begin
        if new.action = 'shop.packing-work.activate' then
          raise exception 'transient packing activation audit failure';
        end if;
        return new;
      end
      $$
    `),
    );
    await db.execute(
      sql.raw(`
        create trigger ${triggerName}
        before insert on np_audit_events
        for each row execute function ${functionName}()
      `),
    );
    try {
      expect(
        await invokeAction(
          shop,
          "createFulfillmentPackingWork",
          createInput(prepared.orderIds.orderId),
          context,
        ),
      ).toMatchObject({ ok: false });
    } finally {
      await db.execute(sql.raw(`drop trigger if exists ${triggerName} on np_audit_events`));
      await db.execute(sql.raw(`drop function if exists ${functionName}()`));
    }

    const confirmed = await readPackingWork(prepared.orderIds.orderId);
    expect(confirmed).toMatchObject({
      status: "provider-confirmed",
      providerErrorCode: null,
    });
    expect(createPackingWork).toHaveBeenCalledTimes(1);
    expect(
      await invokeAction(shop, "finalizePackingWork", existingInput(confirmed), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("active") });
    expect(createPackingWork).toHaveBeenCalledTimes(1);
  });

  it("sanitizes public conflicts and hostile provider errors without changing retry state", async () => {
    const secrets = [
      "provider-secret-create-conflict",
      "provider-secret-create-accessor",
      "provider-secret-create-accessor-trap",
      "provider-secret-cancel-conflict",
      "provider-secret-cancel-proxy",
      "provider-secret-cancel-proxy-trap",
    ] as const;
    let createAttempt = 0;
    let cancelAttempt = 0;
    const createPackingWork = vi.fn((request: NpShopPackingWorkCreateRequest) => {
      createAttempt += 1;
      if (createAttempt === 1) {
        throw new NpShopPackingWorkConflictError("packing_work_state_conflict", secrets[0]);
      }
      if (createAttempt === 2) {
        const hostileAccessor = new NpShopPackingWorkProviderError(
          "accessor-terminal",
          secrets[1],
          { retryable: false },
        );
        Object.defineProperty(hostileAccessor, "code", {
          configurable: true,
          enumerable: true,
          get: () => {
            throw new Error(secrets[2]);
          },
        });
        throw hostileAccessor;
      }
      return npCreateShopPackingWorkCreateResult(request, {
        providerWorkReference: `provider_${request.workId}`,
        confirmedAt: request.requestedAt,
      });
    });
    const cancelPackingWork = vi.fn((request: NpShopPackingWorkCancelRequest) => {
      cancelAttempt += 1;
      if (cancelAttempt === 1) {
        throw new NpShopPackingWorkConflictError("packing_work_state_conflict", secrets[3]);
      }
      if (cancelAttempt === 2) {
        const hostileProxy = new Proxy(
          new NpShopPackingWorkProviderError("proxy-terminal", secrets[4], {
            retryable: false,
          }),
          {
            getOwnPropertyDescriptor: () => {
              throw new Error(secrets[5]);
            },
          },
        );
        throw hostileProxy;
      }
      return npCreateShopPackingWorkCancelResult(request, {
        cancelledAt: request.requestedAt,
      });
    });
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: { id: "hostile-error-packing", createPackingWork, cancelPackingWork },
      },
    });
    const staff = await seedUser({ email: "packing-hostile-error-operator@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const { orderIds } = await prepareOutbound(shop, context);
    const unavailable = { ok: false, error: "Packing work provider is temporarily unavailable." };
    const actionResults: unknown[] = [];

    actionResults.push(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(orderIds.orderId),
        context,
      ),
    );
    expect(actionResults.at(-1)).toEqual(unavailable);
    const firstPending = await readPackingWork(orderIds.orderId);
    expect(firstPending).toMatchObject({ status: "pending", revision: 1 });

    actionResults.push(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(orderIds.orderId, firstPending.revision),
        context,
      ),
    );
    expect(actionResults.at(-1)).toEqual(unavailable);
    expect(await readPackingWork(orderIds.orderId)).toEqual(firstPending);

    actionResults.push(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(orderIds.orderId, firstPending.revision),
        context,
      ),
    );
    expect(actionResults.at(-1)).toMatchObject({
      ok: true,
      data: expect.stringContaining("active"),
    });
    expect(createPackingWork).toHaveBeenCalledTimes(3);
    const active = await readPackingWork(orderIds.orderId);

    actionResults.push(
      await invokeAction(shop, "cancelPackingWork", existingInput(active), context),
    );
    expect(actionResults.at(-1)).toEqual(unavailable);
    const firstCancelPending = await readPackingWork(orderIds.orderId);
    expect(firstCancelPending).toMatchObject({ status: "cancel-pending", revision: 4 });

    const finalizeCancelPending = await invokeAction(
      shop,
      "finalizePackingWork",
      existingInput(firstCancelPending),
      context,
    );
    actionResults.push(finalizeCancelPending);
    expect(finalizeCancelPending).toEqual({
      ok: false,
      error:
        "Only a provider-confirmed packing-work transition can be finalized without provider I/O.",
    });
    expect(cancelPackingWork).toHaveBeenCalledTimes(1);
    expect(await readPackingWork(orderIds.orderId)).toEqual(firstCancelPending);

    actionResults.push(
      await invokeAction(shop, "cancelPackingWork", existingInput(firstCancelPending), context),
    );
    expect(actionResults.at(-1)).toEqual(unavailable);
    expect(cancelPackingWork).toHaveBeenCalledTimes(2);
    expect(await readPackingWork(orderIds.orderId)).toEqual(firstCancelPending);

    actionResults.push(
      await invokeAction(shop, "cancelPackingWork", existingInput(firstCancelPending), context),
    );
    expect(actionResults.at(-1)).toMatchObject({
      ok: true,
      data: expect.stringContaining("cancelled"),
    });
    expect(cancelPackingWork).toHaveBeenCalledTimes(3);
    const cancelled = await readPackingWork(orderIds.orderId);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      revision: 6,
      providerErrorCode: null,
    });

    const db = await getTestDb();
    const audits = await db
      .select({ action: npAuditEvents.action, payload: npAuditEvents.payload })
      .from(npAuditEvents)
      .where(eq(npAuditEvents.targetId, orderIds.orderId));
    const adminRows = await invokeReadAction(shop, "recentPackingWork");
    const exposed = JSON.stringify({ actionResults, cancelled, audits, adminRows });
    expect(exposed).not.toMatch(privateMarkers);
    for (const secret of secrets) expect(exposed).not.toContain(secret);
  });

  it("closes malformed provider results and locally finalizes durable confirmations without an adapter", async () => {
    const malformedShop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "malformed-packing",
          createPackingWork: (request) => ({
            ...npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: "provider_malformed",
              confirmedAt: request.requestedAt,
            }),
            unsupportedSecret: "provider-secret-must-not-persist",
          }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-malformed-operator@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const malformedOrder = await prepareOutbound(malformedShop, context);
    expect(
      await invokeAction(
        malformedShop,
        "createFulfillmentPackingWork",
        createInput(malformedOrder.orderIds.orderId),
        context,
      ),
    ).toEqual({ ok: false, error: "Packing work provider is temporarily unavailable." });
    const manualReview = await readPackingWork(malformedOrder.orderIds.orderId);
    expect(manualReview).toMatchObject({
      status: "manual-review",
      revision: 2,
      providerErrorCode: "invalid-result",
    });
    expect(JSON.stringify(manualReview)).not.toContain("provider-secret");
    expect(await invokeReadAction(malformedShop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "warn" },
    });

    const terminalShop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "terminal-packing",
          createPackingWork: () => {
            throw new NpShopPackingWorkProviderError(
              "provider-terminal",
              "terminal-provider-secret-must-not-persist",
              { retryable: false },
            );
          },
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const terminalOrder = await prepareOutbound(terminalShop, context);
    expect(
      await invokeAction(
        terminalShop,
        "createFulfillmentPackingWork",
        createInput(terminalOrder.orderIds.orderId),
        context,
      ),
    ).toEqual({ ok: false, error: "Packing work provider is temporarily unavailable." });
    const terminalReview = await readPackingWork(terminalOrder.orderIds.orderId);
    expect(terminalReview).toMatchObject({
      status: "manual-review",
      providerErrorCode: "provider-terminal",
    });
    expect(JSON.stringify(terminalReview)).not.toContain("terminal-provider-secret");

    const successShop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "removable-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const localOrder = await prepareOutbound(successShop, context);
    expect(
      await invokeAction(
        successShop,
        "createFulfillmentPackingWork",
        createInput(localOrder.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const active = await readPackingWork(localOrder.orderIds.orderId);
    const db = await getTestDb();
    const packingKey = `packing-work:outbound:${localOrder.orderIds.orderId}`;
    const providerConfirmed = {
      ...active,
      status: "provider-confirmed" as const,
      revision: 2,
      activatedAt: null,
      updatedAt: active.confirmedAt!,
    };
    await db
      .update(npPluginStorage)
      .set({ value: providerConfirmed })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, packingKey),
        ),
      );

    const adapterRemovedShop = createShop();
    expect(await invokeReadAction(adapterRemovedShop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "warn", message: expect.stringContaining("no provider is configured") },
    });
    expect(
      await invokeAction(
        adapterRemovedShop,
        "finalizePackingWork",
        existingInput(providerConfirmed),
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("active") });

    const locallyActive = await readPackingWork(localOrder.orderIds.orderId);
    const cancellationAt = new Date(
      Math.max(Date.now(), new Date(locallyActive.updatedAt).getTime()) + 1_000,
    ).toISOString();
    const cancelConfirmed = {
      ...locallyActive,
      status: "cancel-confirmed" as const,
      revision: 5,
      cancellationId: randomUUID(),
      cancelRequestedAt: cancellationAt,
      cancelledAt: cancellationAt,
      updatedAt: cancellationAt,
    };
    await db
      .update(npPluginStorage)
      .set({ value: cancelConfirmed })
      .where(eq(npPluginStorage.key, packingKey));
    expect(
      await invokeAction(
        adapterRemovedShop,
        "finalizePackingWork",
        existingInput(cancelConfirmed),
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    expect(await readPackingWork(localOrder.orderIds.orderId)).toMatchObject({
      status: "cancelled",
      revision: 6,
    });
  });

  it("closes an invalid packing provider error code instead of retrying forever", async () => {
    const createPackingWork = vi.fn(() => {
      throw new NpShopPackingWorkProviderError(
        "INVALID PROVIDER CODE",
        "invalid provider error details must not escape",
        { retryable: true },
      );
    });
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "invalid-error-code-packing",
          createPackingWork,
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-invalid-error-code@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareOutbound(shop, context);

    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(prepared.orderIds.orderId),
        context,
      ),
    ).toEqual({ ok: false, error: "Packing work provider is temporarily unavailable." });
    const review = await readPackingWork(prepared.orderIds.orderId);
    expect(review).toMatchObject({
      status: "manual-review",
      revision: 2,
      providerErrorCode: "invalid-result",
    });
    expect(JSON.stringify(review)).not.toContain("invalid provider error details");
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(prepared.orderIds.orderId, review.revision),
        context,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("cancelled or reconciled") });
    expect(createPackingWork).toHaveBeenCalledTimes(1);
  });

  it("finishes attached carrier confirmations after both carrier adapters are removed", async () => {
    const packingAdapter = {
      id: "removed-carrier-recovery-packing",
      createPackingWork: (request: NpShopPackingWorkCreateRequest) =>
        npCreateShopPackingWorkCreateResult(request, {
          providerWorkReference: `provider_${request.workId}`,
          confirmedAt: request.requestedAt,
        }),
      cancelPackingWork: (request: NpShopPackingWorkCancelRequest) =>
        npCreateShopPackingWorkCancelResult(request, {
          cancelledAt: request.requestedAt,
        }),
    };
    const setupShop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: { adapter: packingAdapter },
    });
    const staff = await seedUser({ email: "packing-carrier-recovery@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const db = await getTestDb();

    const outbound = await prepareOutbound(setupShop, context);
    expect(
      await invokeAction(
        setupShop,
        "createFulfillmentPackingWork",
        createInput(outbound.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const outboundWork = await readPackingWork(outbound.orderIds.orderId);
    const outboundShipmentId = randomUUID();
    const outboundConfirmedAt = new Date(
      Math.max(Date.now(), new Date(outboundWork.updatedAt).getTime()),
    ).toISOString();
    const outboundBooking = {
      contract: "np.shop-carrier-booking-storage.v1",
      id: outboundShipmentId,
      orderId: outbound.orderIds.orderId,
      providerId: "removed-outbound-carrier",
      status: "provider-confirmed",
      fulfillmentRevision: 2,
      operatorNote: "Recover outbound confirmation",
      bookingReference: `booking_${outboundShipmentId}`,
      carrier: "Parcel Co",
      trackingNumber: "RECOVERED-OUTBOUND-1",
      providerErrorCode: null,
      requestedAt: outboundConfirmedAt,
      updatedAt: outboundConfirmedAt,
      bookedAt: outboundConfirmedAt,
      purgeAt: outboundWork.purgeAt,
    };
    const outboundParcelKey = `fulfillment-parcels:${outbound.orderIds.orderId}`;
    const [outboundParcelRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, outboundParcelKey));
    const outboundParcel = outboundParcelRow?.value as Record<string, unknown> | undefined;
    if (!outboundParcel) throw new Error("Missing outbound recovery parcel snapshot.");
    await Promise.all([
      db.insert(npPluginStorage).values({
        pluginId: "shop",
        siteId: "default",
        key: `carrier-booking:${outbound.orderIds.orderId}`,
        value: outboundBooking,
        expiresAt: new Date(outboundWork.purgeAt),
        updatedAt: new Date(outboundConfirmedAt),
      }),
      db
        .update(npPluginStorage)
        .set({
          value: {
            ...outboundParcel,
            lockedShipmentId: outboundShipmentId,
            updatedAt: outboundConfirmedAt,
          },
          updatedAt: new Date(outboundConfirmedAt),
        })
        .where(eq(npPluginStorage.key, outboundParcelKey)),
      db
        .update(npPluginStorage)
        .set({
          value: {
            ...outboundWork,
            revision: outboundWork.revision + 1,
            attachedShipmentId: outboundShipmentId,
            updatedAt: outboundConfirmedAt,
          },
          updatedAt: new Date(outboundConfirmedAt),
        })
        .where(eq(npPluginStorage.key, `packing-work:outbound:${outbound.orderIds.orderId}`)),
    ]);

    const adapterRemovedShop = createShop();
    expect(adapterRemovedShop.runtime.carrierAdapter).toBeNull();
    expect(adapterRemovedShop.runtime.carrierParcelAdapter).toBeNull();
    expect(
      await invokeAction(
        adapterRemovedShop,
        "bookCarrierShipment",
        {
          row: { id: outbound.orderIds.orderId, fulfillmentRevision: 2 },
          values: { operatorNote: "Recover outbound confirmation" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    expect(await readPackingWork(outbound.orderIds.orderId)).toMatchObject({
      status: "consumed",
      attachedShipmentId: outboundShipmentId,
    });

    const replacement = await prepareAwaitingExchange(setupShop, context);
    const replacementParcels = [
      {
        id: "recovered-replacement-parcel",
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
        weightGrams: 1_500,
        items: [{ lineKey: replacement.lineKey, quantity: 1 }],
      },
    ];
    expect(
      await invokeAction(
        setupShop,
        "saveExchangeParcels",
        {
          row: {
            id: replacement.orderIds.orderId,
            exchangeId: replacement.exchangeId,
            exchangeRevision: replacement.exchangeRevision,
            parcelRevision: null,
          },
          values: { parcels: JSON.stringify(replacementParcels) },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        setupShop,
        "createExchangePackingWork",
        {
          row: {
            id: replacement.orderIds.orderId,
            exchangeId: replacement.exchangeId,
            exchangeRevision: replacement.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    const replacementWork = await readPackingWork(replacement.orderIds.orderId, "replacement");
    const replacementShipmentId = randomUUID();
    const replacementConfirmedAt = new Date(
      Math.max(Date.now(), new Date(replacementWork.updatedAt).getTime()),
    ).toISOString();
    const replacementBooking = {
      contract: "np.shop-exchange-carrier-booking-storage.v1",
      id: replacementShipmentId,
      orderId: replacement.orderIds.orderId,
      exchangeId: replacement.exchangeId,
      providerId: "removed-replacement-carrier",
      status: "provider-confirmed",
      revision: 2,
      sourceOrderRevision: replacement.orderRevision,
      sourceExchangeRevision: replacement.exchangeRevision,
      destinationRevision: replacement.destinationRevision,
      completedOrderRevision: null,
      completedExchangeRevision: null,
      operatorNote: "Recover replacement confirmation",
      bookingReference: `replacement_${replacementShipmentId}`,
      carrier: "Parcel Co",
      trackingNumber: "RECOVERED-REPLACEMENT-1",
      providerErrorCode: null,
      cancellationId: null,
      requestedAt: replacementConfirmedAt,
      confirmedAt: replacementConfirmedAt,
      cancelRequestedAt: null,
      cancelledAt: null,
      updatedAt: replacementConfirmedAt,
      purgeAt: replacementWork.purgeAt,
    };
    const replacementParcelKey = `exchange-parcels:${replacement.orderIds.orderId}`;
    const [replacementParcelRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, replacementParcelKey));
    const replacementParcel = replacementParcelRow?.value as Record<string, unknown> | undefined;
    if (!replacementParcel) throw new Error("Missing replacement recovery parcel snapshot.");
    await Promise.all([
      db.insert(npPluginStorage).values({
        pluginId: "shop",
        siteId: "default",
        key: `exchange-carrier-booking:${replacement.orderIds.orderId}`,
        value: replacementBooking,
        expiresAt: new Date(replacementWork.purgeAt),
        updatedAt: new Date(replacementConfirmedAt),
      }),
      db
        .update(npPluginStorage)
        .set({
          value: {
            ...replacementParcel,
            lockedShipmentId: replacementShipmentId,
            updatedAt: replacementConfirmedAt,
          },
          updatedAt: new Date(replacementConfirmedAt),
        })
        .where(eq(npPluginStorage.key, replacementParcelKey)),
      db
        .update(npPluginStorage)
        .set({
          value: {
            ...replacementWork,
            revision: replacementWork.revision + 1,
            attachedShipmentId: replacementShipmentId,
            updatedAt: replacementConfirmedAt,
          },
          updatedAt: new Date(replacementConfirmedAt),
        })
        .where(eq(npPluginStorage.key, `packing-work:replacement:${replacement.orderIds.orderId}`)),
      db
        .delete(npPluginStorage)
        .where(
          eq(npPluginStorage.key, `exchange-destination-private:${replacement.orderIds.orderId}`),
        ),
    ]);

    expect(adapterRemovedShop.runtime.carrierExchangeAdapter).toBeNull();
    expect(
      await invokeAction(
        adapterRemovedShop,
        "resumeExchangeCarrier",
        {
          row: {
            id: replacement.orderIds.orderId,
            exchangeId: replacement.exchangeId,
            orderRevision: replacement.orderRevision,
            exchangeRevision: replacement.exchangeRevision,
            bookingId: replacementShipmentId,
            bookingRevision: replacementBooking.revision,
          },
          values: { operatorNote: replacementBooking.operatorNote },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });

    const [completedBookingRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `exchange-carrier-booking:${replacement.orderIds.orderId}`));
    const completedBooking = completedBookingRow?.value as
      | (typeof replacementBooking & {
          status: "completed";
          revision: number;
          completedOrderRevision: number;
          completedExchangeRevision: number;
        })
      | undefined;
    if (!completedBooking) throw new Error("Missing completed replacement recovery booking.");
    const attachedReplacement = await readPackingWork(replacement.orderIds.orderId, "replacement");
    expect(attachedReplacement).toMatchObject({
      status: "active",
      attachedShipmentId: replacementShipmentId,
    });
    expect(
      await invokeAction(
        setupShop,
        "cancelPackingWork",
        existingInput(attachedReplacement),
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });

    const cancellationAt = new Date(
      Math.max(Date.now(), new Date(completedBooking.updatedAt).getTime()),
    ).toISOString();
    const cancelConfirmedBooking = {
      ...completedBooking,
      status: "cancel-confirmed" as const,
      revision: completedBooking.revision + 2,
      cancellationId: randomUUID(),
      cancelRequestedAt: cancellationAt,
      cancelledAt: cancellationAt,
      updatedAt: cancellationAt,
    };
    await db
      .update(npPluginStorage)
      .set({ value: cancelConfirmedBooking, updatedAt: new Date(cancellationAt) })
      .where(eq(npPluginStorage.key, `exchange-carrier-booking:${replacement.orderIds.orderId}`));
    expect(
      await invokeAction(
        adapterRemovedShop,
        "cancelExchangeCarrier",
        {
          row: {
            id: replacement.orderIds.orderId,
            exchangeId: replacement.exchangeId,
            orderRevision: completedBooking.completedOrderRevision,
            exchangeRevision: completedBooking.completedExchangeRevision,
            bookingId: completedBooking.id,
            bookingRevision: cancelConfirmedBooking.revision,
          },
          values: { operatorNote: cancelConfirmedBooking.operatorNote },
        },
        context,
      ),
    ).toMatchObject({
      ok: true,
      data: expect.stringContaining("booking cancelled; exchange cancelled"),
    });
    expect(await readOwnerOrder(replacement.owner, replacement.orderIds.orderId)).toMatchObject({
      order: { exchange: { status: "cancelled" } },
    });
    expect(await readPackingWork(replacement.orderIds.orderId, "replacement")).toMatchObject({
      status: "cancelled",
      attachedShipmentId: replacementShipmentId,
    });
  });

  it("retries only local replacement carrier completion after transient audit failures", async () => {
    const bookExchangeShipmentWithParcels = vi.fn(
      (request: NpShopExchangeCarrierParcelBookingRequest) => ({
        contract: "np.shop-exchange-carrier-booking-result.v1" as const,
        shipmentId: request.shipmentId,
        orderId: request.orderId,
        exchangeId: request.exchangeId,
        bookingReference: `replacement_${request.shipmentId}`,
        carrier: "Parcel Co",
        trackingNumber: "TRANSIENT-LOCAL-RECOVERY-1",
        bookedAt: request.requestedAt,
      }),
    );
    const cancelExchangeShipment = vi.fn((request: NpShopExchangeCarrierCancelRequest) => ({
      contract: "np.shop-exchange-carrier-cancel-result.v1" as const,
      cancellationId: request.cancellationId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      exchangeId: request.exchangeId,
      cancelledAt: request.requestedAt,
    }));
    const cancelPackingWork = vi.fn((request: NpShopPackingWorkCancelRequest) =>
      npCreateShopPackingWorkCancelResult(request, {
        cancelledAt: request.requestedAt,
      }),
    );
    const shop = createShop({
      packing: {
        adapter: {
          id: "transient-local-recovery-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork,
        },
      },
      carrier: {
        adapter: {
          id: "transient-local-recovery-carrier",
          bookShipment: () => Promise.reject(new Error("Outbound booking is not used.")),
          bookExchangeShipment: () =>
            Promise.reject(new Error("Replacement v1 booking is not used.")),
          bookExchangeShipmentWithParcels,
          cancelExchangeShipment,
        },
      },
    });
    const adapterRemovedShop = createShop();
    const staff = await seedUser({ email: "packing-transient-local-recovery@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    const replacementParcels = [
      {
        id: "transient-local-recovery-parcel",
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
        weightGrams: 1_500,
        items: [{ lineKey: prepared.lineKey, quantity: 1 }],
      },
    ];
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: { parcels: JSON.stringify(replacementParcels) },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true });

    const db = await getTestDb();
    const readBooking = async () => {
      const [row] = await db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `exchange-carrier-booking:${prepared.orderIds.orderId}`));
      const booking = row?.value as
        | {
            id: string;
            status: string;
            revision: number;
            completedOrderRevision: number | null;
            completedExchangeRevision: number | null;
          }
        | undefined;
      if (!booking) throw new Error("Missing transient recovery carrier booking.");
      return booking;
    };
    const installAuditFailure = async (name: string, action: string) => {
      const triggerName = `np_test_fail_${name}_audit`;
      const functionName = `np_test_fail_${name}_audit_fn`;
      await db.execute(sql.raw(`drop trigger if exists ${triggerName} on np_audit_events`));
      await db.execute(sql.raw(`drop function if exists ${functionName}()`));
      await db.execute(
        sql.raw(`
          create function ${functionName}() returns trigger language plpgsql as $$
          begin
            if new.action = '${action}' then
              raise exception 'transient ${name} audit failure';
            end if;
            return new;
          end
          $$
        `),
      );
      await db.execute(
        sql.raw(`
          create trigger ${triggerName}
          before insert on np_audit_events
          for each row execute function ${functionName}()
        `),
      );
      return async () => {
        await db.execute(sql.raw(`drop trigger if exists ${triggerName} on np_audit_events`));
        await db.execute(sql.raw(`drop function if exists ${functionName}()`));
      };
    };

    const bookingInput = {
      row: {
        id: prepared.orderIds.orderId,
        exchangeId: prepared.exchangeId,
        orderRevision: prepared.orderRevision,
        exchangeRevision: prepared.exchangeRevision,
        destinationRevision: prepared.destinationRevision,
      },
      values: { operatorNote: "Recover only local booking completion" },
    };
    const removeBookingFailure = await installAuditFailure(
      "exchange_booking_complete",
      "shop.exchange.carrier.booking.complete",
    );
    try {
      expect(await invokeAction(shop, "bookExchangeCarrier", bookingInput, context)).toMatchObject({
        ok: false,
        error: expect.stringContaining("shop.exchange.carrier.booking.complete"),
      });
    } finally {
      await removeBookingFailure();
    }
    expect(bookExchangeShipmentWithParcels).toHaveBeenCalledTimes(1);
    const providerConfirmed = await readBooking();
    expect(providerConfirmed).toMatchObject({
      status: "provider-confirmed",
      revision: 2,
      completedOrderRevision: null,
      completedExchangeRevision: null,
    });
    expect(
      await invokeAction(
        adapterRemovedShop,
        "resumeExchangeCarrier",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            orderRevision: prepared.orderRevision,
            exchangeRevision: prepared.exchangeRevision,
            bookingId: providerConfirmed.id,
            bookingRevision: providerConfirmed.revision,
          },
          values: { operatorNote: "Recover only local booking completion" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    expect(bookExchangeShipmentWithParcels).toHaveBeenCalledTimes(1);
    const completed = await readBooking();
    expect(completed).toMatchObject({
      status: "completed",
      revision: 3,
      completedOrderRevision: expect.any(Number),
      completedExchangeRevision: expect.any(Number),
    });

    const attached = await readPackingWork(prepared.orderIds.orderId, "replacement");
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(attached), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    expect(cancelPackingWork).toHaveBeenCalledTimes(1);
    if (completed.completedOrderRevision === null || completed.completedExchangeRevision === null) {
      throw new Error("Missing completed replacement source revisions.");
    }
    const cancellationInput = {
      row: {
        id: prepared.orderIds.orderId,
        exchangeId: prepared.exchangeId,
        orderRevision: completed.completedOrderRevision,
        exchangeRevision: completed.completedExchangeRevision,
        bookingId: completed.id,
        bookingRevision: completed.revision,
      },
      values: { operatorNote: "Recover only local cancellation completion" },
    };
    const removeCancellationFailure = await installAuditFailure(
      "exchange_cancellation_complete",
      "shop.exchange.carrier.cancellation.complete",
    );
    try {
      expect(
        await invokeAction(shop, "cancelExchangeCarrier", cancellationInput, context),
      ).toMatchObject({
        ok: false,
        error: expect.stringContaining("shop.exchange.carrier.cancellation.complete"),
      });
    } finally {
      await removeCancellationFailure();
    }
    expect(cancelExchangeShipment).toHaveBeenCalledTimes(1);
    const cancelConfirmed = await readBooking();
    expect(cancelConfirmed).toMatchObject({
      status: "cancel-confirmed",
      revision: completed.revision + 2,
      completedOrderRevision: completed.completedOrderRevision,
      completedExchangeRevision: completed.completedExchangeRevision,
    });
    expect(
      await invokeAction(
        adapterRemovedShop,
        "cancelExchangeCarrier",
        {
          row: {
            ...cancellationInput.row,
            bookingRevision: cancelConfirmed.revision,
          },
          values: cancellationInput.values,
        },
        context,
      ),
    ).toMatchObject({
      ok: true,
      data: expect.stringContaining("booking cancelled; exchange cancelled"),
    });
    expect(cancelExchangeShipment).toHaveBeenCalledTimes(1);
    expect(await readBooking()).toMatchObject({
      status: "cancelled",
      revision: cancelConfirmed.revision + 1,
    });
    expect(await readOwnerOrder(prepared.owner, prepared.orderIds.orderId)).toMatchObject({
      order: { exchange: { status: "cancelled" } },
    });
  });

  it("serializes provider-confirmed pickup finalization before a concurrent staff cancellation", async () => {
    const bookShipmentWithParcels = vi.fn((request: NpShopCarrierParcelBookingRequest) => ({
      contract: "np.shop-carrier-booking-result.v1" as const,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      bookingReference: `booking_${request.shipmentId}`,
      carrier: "Parcel Co",
      trackingNumber: "PICKUP-LOCK-ORDER-1",
      bookedAt: request.requestedAt,
    }));
    const schedulePickup = vi.fn((request: NpShopCarrierPickupRequest) => ({
      contract: "np.shop-carrier-pickup-result.v1" as const,
      pickupId: request.pickupId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      pickupReference: `pickup_${request.pickupId}`,
      readyAt: request.readyAt,
      closeAt: request.closeAt,
      scheduledAt: request.requestedAt,
    }));
    const cancelPickup = vi.fn((request: NpShopCarrierPickupCancelRequest) => ({
      contract: "np.shop-carrier-pickup-cancel-result.v1" as const,
      cancellationId: request.cancellationId,
      pickupId: request.pickupId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      cancelledAt: request.requestedAt,
    }));
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "pickup-lock-order-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
      carrier: {
        pickupLocationReference: "warehouse-lock-order",
        adapter: {
          id: "pickup-lock-order-carrier",
          bookShipment: () => Promise.reject(new Error("Outbound v1 booking is not used.")),
          bookShipmentWithParcels,
          schedulePickup,
          cancelPickup,
        },
      },
    });
    const staff = await seedUser({ email: "packing-pickup-lock-order@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(prepared.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "bookCarrierShipment",
        {
          row: { id: prepared.orderIds.orderId, fulfillmentRevision: 2 },
          values: { operatorNote: "Prepare pickup lock ordering" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    const shipmentId = bookShipmentWithParcels.mock.calls[0]?.[0].shipmentId;
    if (!shipmentId) throw new Error("Missing pickup lock-order shipment.");

    const db = await getTestDb();
    const failingTrigger = "np_test_fail_pickup_local_schedule_audit";
    const failingFunction = "np_test_fail_pickup_local_schedule_audit_fn";
    await db.execute(sql.raw(`drop trigger if exists ${failingTrigger} on np_audit_events`));
    await db.execute(sql.raw(`drop function if exists ${failingFunction}()`));
    await db.execute(
      sql.raw(`
        create function ${failingFunction}() returns trigger language plpgsql as $$
        begin
          if new.action = 'shop.carrier.pickup.schedule' then
            raise exception 'transient pickup local schedule audit failure';
          end if;
          return new;
        end
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        create trigger ${failingTrigger}
        before insert on np_audit_events
        for each row execute function ${failingFunction}()
      `),
    );
    const readyAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
    const closeAt = new Date(Date.now() + 3 * 60 * 60 * 1_000).toISOString();
    try {
      expect(
        await invokeAction(
          shop,
          "scheduleCarrierPickup",
          {
            row: {
              id: prepared.orderIds.orderId,
              shipmentId,
              pickupTarget: "outbound",
              exchangeId: null,
              pickupRevision: 0,
            },
            values: { readyAt, closeAt },
          },
          context,
        ),
      ).toMatchObject({
        ok: false,
        error: expect.stringContaining("shop.carrier.pickup.schedule"),
      });
    } finally {
      await db.execute(sql.raw(`drop trigger if exists ${failingTrigger} on np_audit_events`));
      await db.execute(sql.raw(`drop function if exists ${failingFunction}()`));
    }
    expect(schedulePickup).toHaveBeenCalledTimes(1);
    const pickupKey = `carrier-pickup:${shipmentId}`;
    const readPickup = async () => {
      const [row] = await db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, pickupKey));
      const pickup = row?.value as
        | { id: string; status: string; revision: number; pickupReference: string | null }
        | undefined;
      if (!pickup) throw new Error("Missing pickup lock-order state.");
      return pickup;
    };
    const providerConfirmed = await readPickup();
    expect(providerConfirmed).toMatchObject({
      status: "provider-confirmed",
      revision: 2,
      pickupReference: expect.any(String),
    });

    const barrierName = "np:test:shop-pickup-order-before-row";
    const blockingTrigger = "np_test_block_pickup_local_schedule_audit";
    const blockingFunction = "np_test_block_pickup_local_schedule_audit_fn";
    await db.execute(sql.raw(`drop trigger if exists ${blockingTrigger} on np_audit_events`));
    await db.execute(sql.raw(`drop function if exists ${blockingFunction}()`));
    await db.execute(
      sql.raw(`
        create function ${blockingFunction}() returns trigger language plpgsql as $$
        begin
          if new.action = 'shop.carrier.pickup.schedule' then
            perform pg_advisory_xact_lock(hashtextextended('${barrierName}', 0));
          end if;
          return new;
        end
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        create trigger ${blockingTrigger}
        before insert on np_audit_events
        for each row execute function ${blockingFunction}()
      `),
    );
    const resumeInput = {
      row: {
        id: prepared.orderIds.orderId,
        shipmentId,
        pickupTarget: "outbound",
        exchangeId: null,
        pickupId: providerConfirmed.id,
        pickupRevision: providerConfirmed.revision,
      },
      values: {},
    };
    const cancelInput = {
      row: {
        ...resumeInput.row,
        pickupRevision: providerConfirmed.revision + 1,
      },
      values: {},
    };
    let resume!: ReturnType<typeof invokeAction>;
    let cancel!: ReturnType<typeof invokeAction>;
    try {
      await db.transaction(async (tx) => {
        const waitForAdvisoryWaiters = async (minimum: number) => {
          for (let attempt = 0; attempt < 200; attempt += 1) {
            const result = await tx.execute(
              sql`select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted`,
            );
            const waiting = Number(
              (
                result as unknown as {
                  rows: Array<{ waiting: number | string }>;
                }
              ).rows[0]?.waiting ?? 0,
            );
            if (waiting >= minimum) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
          }
          throw new Error(`Timed out waiting for ${minimum.toString()} advisory lock waiter(s).`);
        };
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${barrierName}, 0))`);
        resume = invokeAction(shop, "resumeCarrierPickup", resumeInput, context);
        await waitForAdvisoryWaiters(1);
        cancel = invokeAction(shop, "cancelCarrierPickup", cancelInput, context);
        await waitForAdvisoryWaiters(2);
      });
      const [resumeResult, cancelResult] = await Promise.all([resume, cancel]);
      expect(resumeResult).toMatchObject({
        ok: true,
        data: expect.stringContaining("scheduled at revision 3"),
      });
      expect(cancelResult).toMatchObject({
        ok: true,
        data: expect.stringContaining("cancelled at revision 6"),
      });
    } finally {
      await db.execute(sql.raw(`drop trigger if exists ${blockingTrigger} on np_audit_events`));
      await db.execute(sql.raw(`drop function if exists ${blockingFunction}()`));
    }
    expect(schedulePickup).toHaveBeenCalledTimes(1);
    expect(cancelPickup).toHaveBeenCalledTimes(1);
    expect(await readPickup()).toMatchObject({ status: "cancelled", revision: 6 });
  });

  it("serializes replacement pickup cancellation finalization before carrier cancellation", async () => {
    const schedulePickup = vi.fn((request: NpShopCarrierPickupRequest) => ({
      contract: "np.shop-carrier-pickup-result.v1" as const,
      pickupId: request.pickupId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      pickupReference: `pickup_${request.pickupId}`,
      readyAt: request.readyAt,
      closeAt: request.closeAt,
      scheduledAt: request.requestedAt,
    }));
    const cancelPickup = vi.fn((request: NpShopCarrierPickupCancelRequest) => ({
      contract: "np.shop-carrier-pickup-cancel-result.v1" as const,
      cancellationId: request.cancellationId,
      pickupId: request.pickupId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      cancelledAt: request.requestedAt,
    }));
    const cancelExchangeShipment = vi.fn((request: NpShopExchangeCarrierCancelRequest) => ({
      contract: "np.shop-exchange-carrier-cancel-result.v1" as const,
      cancellationId: request.cancellationId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      exchangeId: request.exchangeId,
      cancelledAt: request.requestedAt,
    }));
    const shop = createShop({
      packing: {
        adapter: {
          id: "pickup-carrier-lock-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
      carrier: {
        pickupLocationReference: "warehouse-pickup-carrier-lock",
        adapter: {
          id: "pickup-carrier-lock-carrier",
          bookShipment: () => Promise.reject(new Error("Outbound booking is not used.")),
          bookExchangeShipment: () => Promise.reject(new Error("Replacement v1 is not used.")),
          bookExchangeShipmentWithParcels: (request) => ({
            contract: "np.shop-exchange-carrier-booking-result.v1",
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            exchangeId: request.exchangeId,
            bookingReference: `replacement_${request.shipmentId}`,
            carrier: "Parcel Co",
            trackingNumber: "PICKUP-CARRIER-LOCK-1",
            bookedAt: request.requestedAt,
          }),
          schedulePickup,
          cancelPickup,
          cancelExchangeShipment,
        },
      },
    });
    const staff = await seedUser({ email: "replacement-pickup-carrier-lock@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: {
            parcels: JSON.stringify([
              {
                id: "pickup-carrier-lock-parcel",
                lengthMm: 300,
                widthMm: 200,
                heightMm: 100,
                weightGrams: 1_500,
                items: [{ lineKey: prepared.lineKey, quantity: 1 }],
              },
            ]),
          },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "bookExchangeCarrier",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            orderRevision: prepared.orderRevision,
            exchangeRevision: prepared.exchangeRevision,
            destinationRevision: prepared.destinationRevision,
          },
          values: { operatorNote: "Prepare replacement pickup cancellation lock ordering" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });

    const db = await getTestDb();
    const [bookingRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, `exchange-carrier-booking:${prepared.orderIds.orderId}`),
        ),
      );
    const booking = bookingRow?.value as
      | {
          id: string;
          revision: number;
          completedOrderRevision: number | null;
          completedExchangeRevision: number | null;
        }
      | undefined;
    if (
      !booking ||
      booking.completedOrderRevision === null ||
      booking.completedExchangeRevision === null
    ) {
      throw new Error("Missing completed replacement pickup carrier booking.");
    }
    const readyAt = new Date(Date.now() + 60 * 60 * 1_000);
    readyAt.setMilliseconds(0);
    const closeAt = new Date(readyAt.getTime() + 3 * 60 * 60 * 1_000);
    expect(
      await invokeAction(
        shop,
        "scheduleCarrierPickup",
        {
          row: {
            id: prepared.orderIds.orderId,
            shipmentId: booking.id,
            pickupTarget: "replacement",
            exchangeId: prepared.exchangeId,
            pickupRevision: 0,
          },
          values: { readyAt: readyAt.toISOString(), closeAt: closeAt.toISOString() },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("scheduled at revision 3") });
    expect(schedulePickup).toHaveBeenCalledTimes(1);

    const pickupKey = `carrier-pickup:${booking.id}`;
    const readPickup = async () => {
      const [row] = await db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, pickupKey));
      const pickup = row?.value as
        { id: string; status: string; revision: number; cancellationId: string | null } | undefined;
      if (!pickup) throw new Error("Missing replacement pickup cancellation state.");
      return pickup;
    };
    const scheduled = await readPickup();
    const attached = await readPackingWork(prepared.orderIds.orderId, "replacement");
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(attached), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });

    const failingTrigger = "np_test_fail_replacement_pickup_cancel_audit";
    const failingFunction = "np_test_fail_replacement_pickup_cancel_audit_fn";
    await db.execute(sql.raw(`drop trigger if exists ${failingTrigger} on np_audit_events`));
    await db.execute(sql.raw(`drop function if exists ${failingFunction}()`));
    await db.execute(
      sql.raw(`
        create function ${failingFunction}() returns trigger language plpgsql as $$
        begin
          if new.action = 'shop.carrier.pickup.cancel' then
            raise exception 'transient replacement pickup local cancellation audit failure';
          end if;
          return new;
        end
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        create trigger ${failingTrigger}
        before insert on np_audit_events
        for each row execute function ${failingFunction}()
      `),
    );
    const pickupActionRow = {
      id: prepared.orderIds.orderId,
      shipmentId: booking.id,
      pickupTarget: "replacement" as const,
      exchangeId: prepared.exchangeId,
      pickupId: scheduled.id,
      pickupRevision: scheduled.revision,
    };
    try {
      expect(
        await invokeAction(
          shop,
          "cancelCarrierPickup",
          { row: pickupActionRow, values: {} },
          context,
        ),
      ).toMatchObject({
        ok: false,
        error: expect.stringContaining("shop.carrier.pickup.cancel"),
      });
    } finally {
      await db.execute(sql.raw(`drop trigger if exists ${failingTrigger} on np_audit_events`));
      await db.execute(sql.raw(`drop function if exists ${failingFunction}()`));
    }
    expect(cancelPickup).toHaveBeenCalledTimes(1);
    const cancelConfirmed = await readPickup();
    expect(cancelConfirmed).toMatchObject({
      status: "cancel-confirmed",
      revision: scheduled.revision + 2,
      cancellationId: expect.any(String),
    });

    const barrierName = "np:test:replacement-pickup-before-carrier-cancel";
    const blockingTrigger = "np_test_block_replacement_pickup_cancel_audit";
    const blockingFunction = "np_test_block_replacement_pickup_cancel_audit_fn";
    await db.execute(sql.raw(`drop trigger if exists ${blockingTrigger} on np_audit_events`));
    await db.execute(sql.raw(`drop function if exists ${blockingFunction}()`));
    await db.execute(
      sql.raw(`
        create function ${blockingFunction}() returns trigger language plpgsql as $$
        begin
          if new.action = 'shop.carrier.pickup.cancel' then
            perform pg_advisory_xact_lock(hashtextextended('${barrierName}', 0));
          end if;
          return new;
        end
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        create trigger ${blockingTrigger}
        before insert on np_audit_events
        for each row execute function ${blockingFunction}()
      `),
    );
    let finalizePickup!: ReturnType<typeof invokeAction>;
    let cancelCarrier!: ReturnType<typeof invokeAction>;
    try {
      await db.transaction(async (tx) => {
        const waitForAdvisoryWaiters = async (minimum: number) => {
          for (let attempt = 0; attempt < 200; attempt += 1) {
            const result = await tx.execute(
              sql`select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted`,
            );
            const waiting = Number(
              (
                result as unknown as {
                  rows: Array<{ waiting: number | string }>;
                }
              ).rows[0]?.waiting ?? 0,
            );
            if (waiting >= minimum) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
          }
          throw new Error(`Timed out waiting for ${minimum.toString()} advisory lock waiter(s).`);
        };
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${barrierName}, 0))`);
        finalizePickup = invokeAction(
          shop,
          "cancelCarrierPickup",
          {
            row: { ...pickupActionRow, pickupRevision: cancelConfirmed.revision },
            values: {},
          },
          context,
        );
        await waitForAdvisoryWaiters(1);
        cancelCarrier = invokeAction(
          shop,
          "cancelExchangeCarrier",
          {
            row: {
              id: prepared.orderIds.orderId,
              exchangeId: prepared.exchangeId,
              orderRevision: booking.completedOrderRevision,
              exchangeRevision: booking.completedExchangeRevision,
              bookingId: booking.id,
              bookingRevision: booking.revision,
            },
            values: { operatorNote: "Cancel after exact pickup cancellation" },
          },
          context,
        );
        await waitForAdvisoryWaiters(2);
      });
      const [pickupResult, carrierResult] = await Promise.all([finalizePickup, cancelCarrier]);
      expect(pickupResult).toMatchObject({
        ok: true,
        data: expect.stringContaining("cancelled at revision 6"),
      });
      expect(carrierResult).toMatchObject({
        ok: true,
        data: expect.stringContaining("booking cancelled; exchange cancelled"),
      });
    } finally {
      await db.execute(sql.raw(`drop trigger if exists ${blockingTrigger} on np_audit_events`));
      await db.execute(sql.raw(`drop function if exists ${blockingFunction}()`));
    }
    expect(cancelPickup).toHaveBeenCalledTimes(1);
    expect(cancelExchangeShipment).toHaveBeenCalledTimes(1);
    expect(await readPickup()).toMatchObject({ status: "cancelled", revision: 6 });
    expect(await readOwnerOrder(prepared.owner, prepared.orderIds.orderId)).toMatchObject({
      order: { exchange: { status: "cancelled" } },
    });
  });

  it("lets the durable pending intent win parcel and proposal races and blocks refund while active", async () => {
    let startProvider!: () => void;
    let releaseProvider!: () => void;
    const started = new Promise<void>((resolve) => {
      startProvider = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const proposeParcels = vi.fn(() => {
      throw new Error("Proposal provider must not run after packing work owns the snapshot.");
    });
    const refundPayment = vi.fn(paymentAdapter().refundPayment);
    const shop = createShop({
      payment: { adapter: { ...paymentAdapter(), refundPayment } },
      packaging: { adapter: { id: "race-packaging", proposeParcels } },
      packing: {
        adapter: {
          id: "race-packing",
          createPackingWork: async (request) => {
            startProvider();
            await release;
            return npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            });
          },
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-race-operator@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const { orderIds } = await prepareOutbound(shop, context);
    const creating = invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(orderIds.orderId),
      context,
    );
    await started;
    const pending = await readPackingWork(orderIds.orderId);
    expect(pending.status).toBe("pending");

    const parcelRace = await invokeAction(
      shop,
      "saveFulfillmentParcels",
      {
        row: { id: orderIds.orderId, fulfillmentRevision: 2, parcelRevision: 1 },
        values: { parcels: JSON.stringify(parcels("race-parcel")) },
      },
      context,
    );
    expect(parcelRace).toMatchObject({
      ok: false,
      error: expect.stringContaining("durable packing work"),
    });
    const proposalRace = await invokeAction(
      shop,
      "proposeFulfillmentParcels",
      {
        row: { id: orderIds.orderId, fulfillmentRevision: 2, parcelRevision: 1 },
        values: {},
      },
      context,
    );
    expect(proposalRace).toMatchObject({
      ok: false,
      error: expect.stringContaining("durable packing work"),
    });
    expect(proposeParcels).not.toHaveBeenCalled();
    releaseProvider();
    expect(await creating).toMatchObject({ ok: true, data: expect.stringContaining("active") });
    const active = await readPackingWork(orderIds.orderId);
    expect(
      await invokeAction(
        shop,
        "processFulfillment",
        {
          row: { id: orderIds.orderId, fulfillmentRevision: 2 },
          values: { operatorNote: "Must not rewrite the packing-work source revision" },
        },
        context,
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("processing once"),
    });
    expect(await readPackingWork(orderIds.orderId)).toEqual(active);

    expect(
      await invokeAction(
        shop,
        "refundOrder",
        {
          row: { id: orderIds.orderId, revision: 2 },
          values: { reason: "Packing work must be cancelled first" },
        },
        context,
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Packing work must be cancelled"),
    });
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("reuses the original cancellation identity after a terminal provider failure", async () => {
    const cancelRequests: NpShopPackingWorkCancelRequest[] = [];
    let cancelAttempt = 0;
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "terminal-cancel-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) => {
            cancelRequests.push(request);
            cancelAttempt += 1;
            if (cancelAttempt === 1) {
              throw new NpShopPackingWorkProviderError(
                "cancel-terminal",
                "provider-secret-terminal-cancel-value",
                { retryable: false },
              );
            }
            return npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            });
          },
        },
      },
    });
    const staff = await seedUser({ email: "packing-terminal-cancel@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const { orderIds } = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });

    const active = await readPackingWork(orderIds.orderId);
    expect(await invokeAction(shop, "cancelPackingWork", existingInput(active), context)).toEqual({
      ok: false,
      error: "Packing work provider is temporarily unavailable.",
    });
    const review = await readPackingWork(orderIds.orderId);
    expect(review).toMatchObject({
      status: "manual-review",
      providerErrorCode: "cancel-terminal",
      cancellationId: expect.any(String),
      cancelRequestedAt: expect.any(String),
    });
    expect(JSON.stringify(review)).not.toContain("provider-secret-terminal-cancel-value");

    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(review), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    expect(cancelRequests).toHaveLength(2);
    expect(cancelRequests[1]).toEqual(cancelRequests[0]);
    expect(cancelRequests[1]).toMatchObject({
      cancellationId: review.cancellationId,
      requestedAt: review.cancelRequestedAt,
    });
    expect(await readPackingWork(orderIds.orderId)).toMatchObject({
      status: "cancelled",
      providerErrorCode: null,
      cancellationId: review.cancellationId,
      cancelRequestedAt: review.cancelRequestedAt,
    });
  });

  it("durably closes conflicting concurrent cancellation results", async () => {
    let markConcurrentStarted!: () => void;
    let releaseConcurrent!: () => void;
    const concurrentStarted = new Promise<void>((resolve) => {
      markConcurrentStarted = resolve;
    });
    const concurrentRelease = new Promise<void>((resolve) => {
      releaseConcurrent = resolve;
    });
    const cancelRequests: NpShopPackingWorkCancelRequest[] = [];
    let cancelAttempt = 0;
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "conflicting-cancel-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: async (request) => {
            cancelRequests.push(request);
            cancelAttempt += 1;
            const attempt = cancelAttempt;
            if (attempt === 1) {
              throw new NpShopPackingWorkProviderError(
                "cancel-retryable",
                "first retryable cancel",
                { retryable: true },
              );
            }
            if (attempt === 3) markConcurrentStarted();
            await concurrentRelease;
            return npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: new Date(
                new Date(request.requestedAt).getTime() + (attempt === 3 ? 1 : 0),
              ).toISOString(),
            });
          },
        },
      },
    });
    const staff = await seedUser({ email: "packing-conflicting-cancel@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const { orderIds } = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const active = await readPackingWork(orderIds.orderId);
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(active), context),
    ).toMatchObject({ ok: false });
    const cancelPending = await readPackingWork(orderIds.orderId);
    expect(cancelPending).toMatchObject({ status: "cancel-pending" });
    const first = invokeAction(shop, "cancelPackingWork", existingInput(cancelPending), context);
    const second = invokeAction(shop, "cancelPackingWork", existingInput(cancelPending), context);
    await concurrentStarted;
    releaseConcurrent();
    const results = await Promise.all([first, second]);
    expect(results.some((result) => !result.ok)).toBe(true);
    expect(cancelRequests).toHaveLength(3);
    expect(cancelRequests[1]).toEqual(cancelRequests[0]);
    expect(cancelRequests[2]).toEqual(cancelRequests[0]);
    expect(await readPackingWork(orderIds.orderId)).toMatchObject({
      status: "manual-review",
      providerErrorCode: "provider-result-mismatch",
      cancellationId: cancelPending.cancellationId,
      cancelRequestedAt: cancelPending.cancelRequestedAt,
    });
  });

  it("persists provider refund confirmation but blocks compensation after a packing race", async () => {
    let markCreateStarted!: () => void;
    let releaseCreate!: () => void;
    let markRefundStarted!: () => void;
    let releaseRefund!: () => void;
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });
    const createRelease = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const refundStarted = new Promise<void>((resolve) => {
      markRefundStarted = resolve;
    });
    const refundRelease = new Promise<void>((resolve) => {
      releaseRefund = resolve;
    });
    const basePayment = paymentAdapter();
    const refundPayment = vi.fn(async (...args: Parameters<typeof basePayment.refundPayment>) => {
      markRefundStarted();
      await refundRelease;
      return basePayment.refundPayment(...args);
    });
    const shop = createShop({
      payment: { adapter: { ...basePayment, refundPayment } },
      packing: {
        adapter: {
          id: "late-create-packing",
          createPackingWork: async (request) => {
            markCreateStarted();
            await createRelease;
            return npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            });
          },
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-late-create@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const { orderIds, owner } = await prepareOutbound(shop, context);
    const creating = invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(orderIds.orderId),
      context,
    );
    await createStarted;
    const pending = await readPackingWork(orderIds.orderId);
    expect(pending).toMatchObject({ status: "pending", revision: 1 });
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(pending), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    const cancelled = await readPackingWork(orderIds.orderId);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      workId: pending.workId,
      cancellationId: expect.any(String),
      cancelledAt: expect.any(String),
    });

    const refundInput = {
      row: { id: orderIds.orderId, revision: 2 },
      values: { reason: "Late create cannot be treated as safely cancelled" },
    };
    const refunding = invokeAction(shop, "refundOrder", refundInput, context);
    await refundStarted;
    expect(refundPayment).toHaveBeenCalledTimes(1);

    releaseCreate();
    expect(await creating).toMatchObject({
      ok: false,
      error: expect.stringContaining("recreated packing work"),
    });
    const review = await readPackingWork(orderIds.orderId);
    expect(review).toMatchObject({
      status: "manual-review",
      workId: pending.workId,
      providerErrorCode: "cancellation-dominance-violation",
      cancellationId: cancelled.cancellationId,
      cancelledAt: cancelled.cancelledAt,
    });

    releaseRefund();
    expect(await refunding).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        "provider refunded the payment, but packing work changed before local compensation",
      ),
    });

    const db = await getTestDb();
    const [refundRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, `refund:${orderIds.orderId}`),
        ),
      );
    expect(refundRow?.value).toMatchObject({
      status: "provider-confirmed",
      inventoryOutcome: "pending",
      fulfillmentOutcome: "pending",
      refundReference: expect.any(String),
      refundedAt: expect.any(String),
    });
    const ownerOrder = await readOwnerOrder(owner, orderIds.orderId);
    expect(ownerOrder.order).toMatchObject({
      status: "paid",
      revision: 2,
      fulfillment: { status: "processing", revision: 2 },
    });
    const [product] = await db
      .select({ stockQuantity: shopProductsTable.stockQuantity })
      .from(shopProductsTable)
      .where(and(eq(shopProductsTable.siteId, "default"), eq(shopProductsTable.id, productId)));
    expect(product?.stockQuantity).toBe(7);
    const refundAudits = await db
      .select({ action: npAuditEvents.action })
      .from(npAuditEvents)
      .where(eq(npAuditEvents.targetId, orderIds.orderId));
    expect(refundAudits.map((audit) => audit.action)).not.toContain("shop.refund.complete");

    expect(await invokeAction(shop, "refundOrder", refundInput, context)).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        "provider refunded the payment, but packing work changed before local compensation",
      ),
    });
    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(await readPackingWork(orderIds.orderId)).toEqual(review);
    const resumedOwnerOrder = await readOwnerOrder(owner, orderIds.orderId);
    expect(resumedOwnerOrder.order).toMatchObject({
      status: "paid",
      revision: 2,
      fulfillment: { status: "processing", revision: 2 },
    });
    const [resumedProduct] = await db
      .select({ stockQuantity: shopProductsTable.stockQuantity })
      .from(shopProductsTable)
      .where(and(eq(shopProductsTable.siteId, "default"), eq(shopProductsTable.id, productId)));
    expect(resumedProduct?.stockQuantity).toBe(7);
  });

  it("durably closes conflicting concurrent create results", async () => {
    let markConcurrentStarted!: () => void;
    let releaseConcurrent!: () => void;
    const concurrentStarted = new Promise<void>((resolve) => {
      markConcurrentStarted = resolve;
    });
    const concurrentRelease = new Promise<void>((resolve) => {
      releaseConcurrent = resolve;
    });
    const createRequests: NpShopPackingWorkCreateRequest[] = [];
    const refundPayment = vi.fn(paymentAdapter().refundPayment);
    let providerAttempt = 0;
    const shop = createShop({
      payment: { adapter: { ...paymentAdapter(), refundPayment } },
      packing: {
        adapter: {
          id: "conflicting-create-packing",
          createPackingWork: async (request) => {
            createRequests.push(request);
            providerAttempt += 1;
            const attempt = providerAttempt;
            if (attempt === 1) {
              throw new NpShopPackingWorkProviderError(
                "create-retryable",
                "first retryable create",
                { retryable: true },
              );
            }
            if (attempt === 3) markConcurrentStarted();
            await concurrentRelease;
            return npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_attempt_${attempt.toString()}`,
              confirmedAt: request.requestedAt,
            });
          },
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-conflicting-create@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const { orderIds } = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: false });
    const pending = await readPackingWork(orderIds.orderId);
    const first = invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(orderIds.orderId, pending.revision),
      context,
    );
    const second = invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(orderIds.orderId, pending.revision),
      context,
    );
    await concurrentStarted;
    releaseConcurrent();
    const results = await Promise.all([first, second]);
    expect(results.some((result) => !result.ok)).toBe(true);
    expect(createRequests).toHaveLength(3);
    expect(createRequests[1]).toEqual(createRequests[0]);
    expect(createRequests[2]).toEqual(createRequests[0]);
    expect(await readPackingWork(orderIds.orderId)).toMatchObject({
      status: "manual-review",
      workId: pending.workId,
      providerErrorCode: "provider-result-mismatch",
    });
    expect(
      await invokeAction(
        shop,
        "refundOrder",
        {
          row: { id: orderIds.orderId, revision: 2 },
          values: { reason: "Conflicting provider result requires review" },
        },
        context,
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Packing work must be cancelled"),
    });
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("keeps cancellation terminal when an in-flight create returns the exact cached result", async () => {
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondRelease = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const createRequests: NpShopPackingWorkCreateRequest[] = [];
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "cached-create-packing",
          createPackingWork: async (request) => {
            createRequests.push(request);
            const attempt = createRequests.length;
            if (attempt === 1) {
              markFirstStarted();
              await firstRelease;
            } else {
              markSecondStarted();
              await secondRelease;
            }
            return npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            });
          },
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-cached-create@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const { orderIds } = await prepareOutbound(shop, context);

    const first = invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(orderIds.orderId),
      context,
    );
    await firstStarted;
    const pending = await readPackingWork(orderIds.orderId);
    expect(pending).toMatchObject({ status: "pending", revision: 1 });
    const second = invokeAction(
      shop,
      "createFulfillmentPackingWork",
      createInput(orderIds.orderId, pending.revision),
      context,
    );
    await secondStarted;
    expect(createRequests).toHaveLength(2);
    expect(createRequests[1]).toEqual(createRequests[0]);

    releaseFirst();
    expect(await first).toMatchObject({ ok: true, data: expect.stringContaining("active") });
    const active = await readPackingWork(orderIds.orderId);
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(active), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    const cancelled = await readPackingWork(orderIds.orderId);

    releaseSecond();
    expect(await second).toMatchObject({
      ok: false,
      error: expect.stringContaining("cancellation won"),
    });
    expect(await readPackingWork(orderIds.orderId)).toEqual(cancelled);
    expect(cancelled).toMatchObject({
      status: "cancelled",
      providerErrorCode: null,
      providerWorkReference: `provider_${cancelled.workId}`,
    });
  });

  it("requires a parcel-aware carrier and consumes exact outbound packing work on shipment", async () => {
    const v1Book = vi.fn(() => {
      throw new Error("Legacy carrier booking must fail before provider I/O.");
    });
    const v1Shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "v1-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
      carrier: { adapter: { id: "legacy-carrier", bookShipment: v1Book } },
    });
    const staff = await seedUser({ email: "packing-carrier-operator@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const legacyOrder = await prepareOutbound(v1Shop, context);
    expect(
      await invokeAction(
        v1Shop,
        "createFulfillmentPackingWork",
        createInput(legacyOrder.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        v1Shop,
        "bookCarrierShipment",
        {
          row: { id: legacyOrder.orderIds.orderId, fulfillmentRevision: 2 },
          values: { operatorNote: "Must use v2" },
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("parcel-aware") });
    expect(v1Book).not.toHaveBeenCalled();
    expect(await readPackingWork(legacyOrder.orderIds.orderId)).toMatchObject({
      status: "active",
      attachedShipmentId: null,
    });

    const v2Book = vi.fn((request) => ({
      contract: "np.shop-carrier-booking-result.v1" as const,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      bookingReference: `booking_${request.shipmentId}`,
      carrier: "Parcel Co",
      trackingNumber: "PACKING-OUTBOUND-1",
      bookedAt: request.requestedAt,
    }));
    const v2Shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "v2-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
      carrier: {
        adapter: {
          id: "parcel-carrier",
          bookShipment: () => Promise.reject(new Error("v1 must not be called")),
          bookShipmentWithParcels: v2Book,
        },
      },
    });
    const outbound = await prepareOutbound(v2Shop, context);
    expect(
      await invokeAction(
        v2Shop,
        "createFulfillmentPackingWork",
        createInput(outbound.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        v2Shop,
        "bookCarrierShipment",
        {
          row: { id: outbound.orderIds.orderId, fulfillmentRevision: 2 },
          values: { operatorNote: "Exact packing handoff" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    expect(v2Book).toHaveBeenCalledTimes(1);
    expect(v2Book.mock.calls[0]?.[0]).toMatchObject({
      contract: "np.shop-carrier-booking-request.v2",
      orderId: outbound.orderIds.orderId,
      fulfillmentRevision: 2,
      parcelRevision: 1,
      parcels: parcels(),
    });
    const consumed = await readPackingWork(outbound.orderIds.orderId);
    expect(consumed).toMatchObject({
      status: "consumed",
      revision: 5,
      attachedShipmentId: v2Book.mock.calls[0]?.[0].shipmentId,
      consumedAt: expect.any(String),
    });
    const consumedReview = {
      ...consumed,
      status: "manual-review" as const,
      revision: consumed.revision + 1,
      providerErrorCode: "local-state-conflict",
      updatedAt: new Date(
        Math.max(Date.now(), new Date(consumed.consumedAt ?? 0).getTime() + 1_000),
      ).toISOString(),
    } satisfies NpShopStoredPackingWork;
    const db = await getTestDb();
    await db
      .update(npPluginStorage)
      .set({ value: consumedReview, updatedAt: new Date(consumedReview.updatedAt) })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, `packing-work:outbound:${outbound.orderIds.orderId}`),
        ),
      );
    expect(await readPackingWork(outbound.orderIds.orderId)).toMatchObject({
      status: "manual-review",
      consumedAt: consumed.consumedAt,
      providerErrorCode: "local-state-conflict",
    });
    expect(await invokeReadAction(v2Shop, "recentPackingWork")).toMatchObject({
      ok: true,
      data: {
        rows: expect.arrayContaining([
          expect.objectContaining({
            id: outbound.orderIds.orderId,
            provider: "v2-packing",
            status: "manual-review",
            providerRetryEligible: false,
            providerCancelEligible: false,
          }),
        ]),
      },
    });
  });

  it("blocks attached outbound packing cancellation before provider I/O and completes its carrier booking", async () => {
    let markCarrierStarted!: () => void;
    let releaseCarrier!: () => void;
    const carrierStarted = new Promise<void>((resolve) => {
      markCarrierStarted = resolve;
    });
    const carrierRelease = new Promise<void>((resolve) => {
      releaseCarrier = resolve;
    });
    const carrierRequests: NpShopCarrierParcelBookingRequest[] = [];
    const cancelPackingWork = vi.fn((request: NpShopPackingWorkCancelRequest) =>
      npCreateShopPackingWorkCancelResult(request, {
        cancelledAt: request.requestedAt,
      }),
    );
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "carrier-cancel-race-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork,
        },
      },
      carrier: {
        adapter: {
          id: "carrier-cancel-race",
          bookShipment: () => Promise.reject(new Error("v1 must not be called")),
          bookShipmentWithParcels: async (request) => {
            carrierRequests.push(request);
            markCarrierStarted();
            await carrierRelease;
            return {
              contract: "np.shop-carrier-booking-result.v1" as const,
              shipmentId: request.shipmentId,
              orderId: request.orderId,
              bookingReference: `booking_${request.shipmentId}`,
              carrier: "Parcel Co",
              trackingNumber: "CANCEL-WON-1",
              bookedAt: request.requestedAt,
            };
          },
        },
      },
    });
    const staff = await seedUser({ email: "packing-carrier-cancel@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(prepared.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const bookingInput = {
      row: { id: prepared.orderIds.orderId, fulfillmentRevision: 2 },
      values: { operatorNote: "Cancellation may win after exact attachment" },
    };
    const booking = invokeAction(shop, "bookCarrierShipment", bookingInput, context);
    await carrierStarted;
    expect(carrierRequests).toHaveLength(1);
    const shipmentId = carrierRequests[0]?.shipmentId;
    expect(shipmentId).toEqual(expect.any(String));
    const attached = await readPackingWork(prepared.orderIds.orderId);
    expect(attached).toMatchObject({
      status: "active",
      attachedShipmentId: shipmentId,
      consumedAt: null,
    });
    expect(await invokeReadAction(shop, "recentOrders")).toMatchObject({
      ok: true,
      data: {
        rows: [expect.objectContaining({ id: prepared.orderIds.orderId, refundEligible: false })],
      },
    });
    expect(await invokeReadAction(shop, "recentFulfillments")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            packingWorkStatus: "active",
            parcelMutationEligible: false,
            manualShipmentEligible: false,
            carrierShipmentEligible: true,
          }),
        ],
      },
    });
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(attached), context),
    ).toMatchObject({ ok: false, error: expect.stringContaining("exact carrier booking") });
    expect(cancelPackingWork).not.toHaveBeenCalled();
    expect(await readPackingWork(prepared.orderIds.orderId)).toMatchObject({
      status: "active",
      attachedShipmentId: shipmentId,
      consumedAt: null,
    });
    expect(await invokeReadAction(shop, "recentOrders")).toMatchObject({
      ok: true,
      data: {
        rows: [expect.objectContaining({ id: prepared.orderIds.orderId, refundEligible: false })],
      },
    });
    expect(await invokeReadAction(shop, "recentFulfillments")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            packingWorkStatus: "active",
            parcelMutationEligible: false,
            manualShipmentEligible: false,
            carrierShipmentEligible: true,
          }),
        ],
      },
    });
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "warn" },
    });
    const db = await getTestDb();
    const fulfillmentKey = `fulfillment:${prepared.orderIds.orderId}`;
    const [fulfillmentRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, fulfillmentKey));
    const fulfillmentSource = fulfillmentRow?.value as Record<string, unknown> | undefined;
    if (!fulfillmentSource || typeof fulfillmentSource.revision !== "number") {
      throw new Error("Missing outbound source lifecycle fixture.");
    }
    await db
      .update(npPluginStorage)
      .set({ value: { ...fulfillmentSource, revision: fulfillmentSource.revision + 2 } })
      .where(eq(npPluginStorage.key, fulfillmentKey));
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 source-mismatched") },
    });
    await db
      .update(npPluginStorage)
      .set({ value: fulfillmentSource })
      .where(eq(npPluginStorage.key, fulfillmentKey));
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "warn" },
    });

    releaseCarrier();
    expect(await booking).toMatchObject({
      ok: true,
      data: expect.stringContaining("completed"),
    });
    expect(carrierRequests).toHaveLength(1);
    expect(cancelPackingWork).not.toHaveBeenCalled();
    expect(await readPackingWork(prepared.orderIds.orderId)).toMatchObject({
      status: "consumed",
      attachedShipmentId: shipmentId,
      consumedAt: expect.any(String),
    });
    expect(await readOwnerOrder(prepared.owner, prepared.orderIds.orderId)).toMatchObject({
      order: { fulfillment: { status: "shipped", revision: 3 } },
    });
  });

  it("keeps a cancellation-won replacement carrier result available for exact cancellation", async () => {
    let markCarrierStarted!: () => void;
    let releaseCarrier!: () => void;
    const carrierStarted = new Promise<void>((resolve) => {
      markCarrierStarted = resolve;
    });
    const carrierRelease = new Promise<void>((resolve) => {
      releaseCarrier = resolve;
    });
    const bookingRequests: NpShopExchangeCarrierParcelBookingRequest[] = [];
    const cancellationRequests: NpShopExchangeCarrierCancelRequest[] = [];
    const shop = createShop({
      packing: {
        adapter: {
          id: "replacement-carrier-race-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
      carrier: {
        adapter: {
          id: "replacement-carrier-race",
          bookShipment: () => Promise.reject(new Error("Outbound booking is not used.")),
          bookExchangeShipment: () => Promise.reject(new Error("Replacement v1 is not used.")),
          bookExchangeShipmentWithParcels: async (request) => {
            bookingRequests.push(request);
            markCarrierStarted();
            await carrierRelease;
            return {
              contract: "np.shop-exchange-carrier-booking-result.v1" as const,
              shipmentId: request.shipmentId,
              orderId: request.orderId,
              exchangeId: request.exchangeId,
              bookingReference: `replacement_${request.shipmentId}`,
              carrier: "Parcel Co",
              trackingNumber: "PACKING-CANCEL-WON-1",
              bookedAt: request.requestedAt,
            };
          },
          cancelExchangeShipment: (request) => {
            cancellationRequests.push(request);
            return {
              contract: "np.shop-exchange-carrier-cancel-result.v1" as const,
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
    const staff = await seedUser({ email: "replacement-carrier-race@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: {
            parcels: JSON.stringify([
              {
                id: "replacement-race-parcel",
                lengthMm: 300,
                widthMm: 200,
                heightMm: 100,
                weightGrams: 1_500,
                items: [{ lineKey: prepared.lineKey, quantity: 1 }],
              },
            ]),
          },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true });

    const bookingResult = invokeAction(
      shop,
      "bookExchangeCarrier",
      {
        row: {
          id: prepared.orderIds.orderId,
          exchangeId: prepared.exchangeId,
          orderRevision: prepared.orderRevision,
          exchangeRevision: prepared.exchangeRevision,
          destinationRevision: prepared.destinationRevision,
        },
        values: { operatorNote: "Packing cancellation may win after attachment" },
      },
      context,
    );
    await carrierStarted;
    expect(bookingRequests).toHaveLength(1);
    const attached = await readPackingWork(prepared.orderIds.orderId, "replacement");
    expect(attached).toMatchObject({
      status: "active",
      attachedShipmentId: bookingRequests[0]?.shipmentId,
    });
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(attached), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    releaseCarrier();
    expect(await bookingResult).toMatchObject({
      ok: true,
      data: expect.stringContaining("completed"),
    });

    const [bookingRow] = await (
      await getTestDb()
    )
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, `exchange-carrier-booking:${prepared.orderIds.orderId}`),
        ),
      );
    const booking = bookingRow?.value as
      | {
          id: string;
          revision: number;
          completedOrderRevision: number;
          completedExchangeRevision: number;
        }
      | undefined;
    if (!booking) throw new Error("Missing cancellation-won replacement booking.");
    expect(await readPackingWork(prepared.orderIds.orderId, "replacement")).toMatchObject({
      status: "cancelled",
      attachedShipmentId: booking.id,
      consumedAt: null,
    });
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            carrierBooking: "completed",
            packingWorkStatus: "cancelled",
            pickupAction: "—",
            labelAction: "—",
            carrierShipEligible: false,
            carrierCancelEligible: true,
          }),
        ],
      },
    });
    expect(
      await invokeAction(
        shop,
        "cancelExchangeCarrier",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            orderRevision: booking.completedOrderRevision,
            exchangeRevision: booking.completedExchangeRevision,
            bookingId: booking.id,
            bookingRevision: booking.revision,
          },
          values: { operatorNote: "Cancel only the exact interrupted shipment" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    expect(cancellationRequests).toHaveLength(1);
    expect(cancellationRequests[0]).toMatchObject({
      shipmentId: booking.id,
      orderId: prepared.orderIds.orderId,
      exchangeId: prepared.exchangeId,
    });
    expect(await readOwnerOrder(prepared.owner, prepared.orderIds.orderId)).toMatchObject({
      order: { exchange: { status: "cancelled" } },
    });
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "ok" },
    });
    const db = await getTestDb();
    const exchangeKey = `exchange:${prepared.orderIds.orderId}`;
    const [exchangeRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, exchangeKey));
    const exchangeSource = exchangeRow?.value as Record<string, unknown> | undefined;
    if (!exchangeSource || typeof exchangeSource.revision !== "number") {
      throw new Error("Missing replacement source lifecycle fixture.");
    }
    await db
      .update(npPluginStorage)
      .set({ value: { ...exchangeSource, revision: exchangeSource.revision + 1 } })
      .where(eq(npPluginStorage.key, exchangeKey));
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 source-mismatched") },
    });
    await db
      .update(npPluginStorage)
      .set({ value: exchangeSource })
      .where(eq(npPluginStorage.key, exchangeKey));
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "ok" },
    });
  });

  it("keeps exact active replacement work eligible through processing and manual shipment", async () => {
    const shop = createShop({
      packing: {
        adapter: {
          id: "replacement-manual-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-replacement-manual-shipment@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: {
            parcels: JSON.stringify([
              {
                id: "manual-replacement-parcel",
                lengthMm: 300,
                widthMm: 200,
                heightMm: 100,
                weightGrams: 1_500,
                items: [{ lineKey: prepared.lineKey, quantity: 1 }],
              },
            ]),
          },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("active") });
    expect(
      await invokeAction(
        shop,
        "processExchange",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            orderRevision: prepared.orderRevision,
          },
          values: { operatorNote: "Process exact active replacement work" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("processing") });
    const processed = await readOwnerOrder(prepared.owner, prepared.orderIds.orderId);
    if (!processed.order.exchange) throw new Error("Missing processed replacement exchange.");
    expect(processed.order.exchange).toMatchObject({
      status: "processing",
      revision: prepared.exchangeRevision + 1,
    });
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            packingWorkStatus: "active",
            processEligible: false,
            manualShipEligible: true,
          }),
        ],
      },
    });

    const active = await readPackingWork(prepared.orderIds.orderId, "replacement");
    const corrupt = {
      ...active,
      lines: active.lines.map((line) => ({
        ...line,
        productSlug: "corrupt-active-replacement-source",
      })),
    } satisfies NpShopStoredPackingWork;
    const db = await getTestDb();
    const workKey = `packing-work:replacement:${prepared.orderIds.orderId}`;
    await db
      .update(npPluginStorage)
      .set({ value: corrupt })
      .where(eq(npPluginStorage.key, workKey));
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            packingWorkStatus: "active",
            manualShipEligible: false,
          }),
        ],
      },
    });
    await db.update(npPluginStorage).set({ value: active }).where(eq(npPluginStorage.key, workKey));

    expect(
      await invokeAction(
        shop,
        "shipExchange",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: processed.order.exchange.revision,
            orderRevision: processed.order.revision,
          },
          values: {
            carrier: "Parcel Co",
            trackingNumber: "MANUAL-REPLACEMENT-1",
            operatorNote: "Complete exact active replacement work",
          },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("shipped") });
    expect(await readPackingWork(prepared.orderIds.orderId, "replacement")).toMatchObject({
      status: "consumed",
      attachedShipmentId: null,
      consumedAt: expect.any(String),
    });
  });

  it("resubmits an expired replacement destination without changing its packing source", async () => {
    const shop = createShop({
      packing: {
        adapter: {
          id: "destination-resubmission-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-destination-resubmission@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: {
            parcels: JSON.stringify([
              {
                id: "destination-resubmission-parcel",
                lengthMm: 300,
                widthMm: 200,
                heightMm: 100,
                weightGrams: 1_500,
                items: [{ lineKey: prepared.lineKey, quantity: 1 }],
              },
            ]),
          },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("active") });
    const active = await readPackingWork(prepared.orderIds.orderId, "replacement");

    const db = await getTestDb();
    const [destinationRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `exchange-destination-private:${prepared.orderIds.orderId}`));
    const destination = destinationRow?.value as { expiresAt?: unknown } | undefined;
    if (typeof destination?.expiresAt !== "string") {
      throw new Error("Missing retained replacement destination expiry.");
    }

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(destination.expiresAt).getTime() + 1);
    try {
      const expired = await readOwnerOrder(prepared.owner, prepared.orderIds.orderId);
      const authority = expired.exchangeDestinationAuthority;
      const expiredExchange = expired.order.exchange;
      if (!authority || !expiredExchange) {
        throw new Error("Missing expired replacement destination authority.");
      }
      expect(expired.order).toMatchObject({
        revision: prepared.orderRevision,
        exchange: {
          revision: prepared.exchangeRevision,
          destinationRevision: prepared.destinationRevision,
        },
      });
      expect(
        await routeCall("POST", "/exchanges/destination", {
          ...prepared.owner,
          body: {
            orderId: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            orderRevision: authority.orderRevision,
            exchangeRevision: authority.exchangeRevision,
            destinationRevision: authority.destinationRevision,
            authorityToken: authority.token,
            destination: {
              recipientName: "재제출 수령인",
              phone: "010-2222-3333",
              countryCode: "KR",
              postalCode: "04524",
              addressLine1: "서울특별시 중구 새 배송지 1",
              addressLine2: null,
              locality: "중구",
              administrativeArea: "서울특별시",
            },
          },
        }),
      ).toMatchObject({ status: 200 });

      const resubmitted = await readOwnerOrder(prepared.owner, prepared.orderIds.orderId);
      const resubmittedExchange = resubmitted.order.exchange;
      if (!resubmittedExchange) throw new Error("Missing resubmitted replacement exchange.");
      expect(resubmitted.order).toMatchObject({
        revision: prepared.orderRevision,
        exchange: {
          revision: prepared.exchangeRevision,
          destinationRevision: prepared.destinationRevision + 1,
        },
      });
      expect(await readPackingWork(prepared.orderIds.orderId, "replacement")).toEqual(active);
      expect(
        await invokeAction(
          shop,
          "readExchangeDestination",
          {
            row: {
              id: prepared.orderIds.orderId,
              exchangeId: prepared.exchangeId,
              orderRevision: prepared.orderRevision,
              exchangeRevision: prepared.exchangeRevision,
              destinationRevision: prepared.destinationRevision + 1,
            },
            values: {},
          },
          context,
        ),
      ).toMatchObject({ ok: true });
      expect(
        await invokeAction(
          shop,
          "processExchange",
          {
            row: {
              id: prepared.orderIds.orderId,
              exchangeId: prepared.exchangeId,
              exchangeRevision: prepared.exchangeRevision,
              orderRevision: prepared.orderRevision,
            },
            values: { operatorNote: "Process after privacy-only destination resubmission" },
          },
          context,
        ),
      ).toMatchObject({ ok: true, data: expect.stringContaining("processing") });
      const processed = await readOwnerOrder(prepared.owner, prepared.orderIds.orderId);
      if (!processed.order.exchange) throw new Error("Missing processed resubmitted exchange.");
      expect(
        await invokeAction(
          shop,
          "shipExchange",
          {
            row: {
              id: prepared.orderIds.orderId,
              exchangeId: prepared.exchangeId,
              exchangeRevision: processed.order.exchange.revision,
              orderRevision: processed.order.revision,
            },
            values: {
              carrier: "Parcel Co",
              trackingNumber: "DESTINATION-RESUBMISSION-1",
              operatorNote: "Ship unchanged packing source after resubmission",
            },
          },
          context,
        ),
      ).toMatchObject({ ok: true, data: expect.stringContaining("shipped") });
      expect(await readPackingWork(prepared.orderIds.orderId, "replacement")).toMatchObject({
        status: "consumed",
        sourceRevision: prepared.exchangeRevision,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("coexists with outbound work and consumes replacement work only at booked shipment", async () => {
    const packingCancellations: NpShopPackingWorkCancelRequest[] = [];
    const replacementBookings: NpShopExchangeCarrierParcelBookingRequest[] = [];
    const replacementCancellations: NpShopExchangeCarrierCancelRequest[] = [];
    const shop = createShop({
      packing: {
        adapter: {
          id: "exchange-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) => {
            packingCancellations.push(request);
            return npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            });
          },
        },
      },
      carrier: {
        adapter: {
          id: "exchange-carrier",
          bookShipment: () => Promise.reject(new Error("Outbound v1 must not be called")),
          bookExchangeShipment: () =>
            Promise.reject(new Error("Replacement v1 must not be called")),
          bookExchangeShipmentWithParcels: (request) => {
            replacementBookings.push(request);
            return {
              contract: "np.shop-exchange-carrier-booking-result.v1",
              shipmentId: request.shipmentId,
              orderId: request.orderId,
              exchangeId: request.exchangeId,
              bookingReference: `replacement_${request.shipmentId}`,
              carrier: "Parcel Co",
              trackingNumber: "PACKING-REPLACEMENT-1",
              bookedAt: request.requestedAt,
            };
          },
          cancelExchangeShipment: (request) => {
            replacementCancellations.push(request);
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
    const staff = await seedUser({ email: "replacement-packing-operator@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    const replacementParcels = [
      {
        id: "replacement-parcel",
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
        weightGrams: 1_500,
        items: [{ lineKey: prepared.lineKey, quantity: 1 }],
      },
    ];
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: { parcels: JSON.stringify(replacementParcels) },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("revision 1") });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("active") });
    const outbound = await readPackingWork(prepared.orderIds.orderId, "outbound");
    const replacement = await readPackingWork(prepared.orderIds.orderId, "replacement");
    expect(outbound.status).toBe("consumed");
    expect(replacement).toMatchObject({
      target: "replacement",
      exchangeId: prepared.exchangeId,
      status: "active",
      attachedShipmentId: null,
    });
    expect(JSON.stringify(replacement)).not.toMatch(privateMarkers);
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            parcelMutationEligible: false,
            processEligible: true,
            manualShipEligible: false,
            cancelEligible: false,
            carrierBookEligible: true,
            carrierResumeEligible: false,
            carrierShipEligible: false,
            carrierCancelEligible: false,
          }),
        ],
      },
    });
    expect(
      await invokeAction(
        shop,
        "cancelExchange",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            orderRevision: prepared.orderRevision,
          },
          values: { operatorNote: "Must cancel packing first" },
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("packing-work cancellation") });
    expect(replacementCancellations).toHaveLength(0);

    expect(
      await invokeAction(
        shop,
        "bookExchangeCarrier",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            orderRevision: prepared.orderRevision,
            exchangeRevision: prepared.exchangeRevision,
            destinationRevision: prepared.destinationRevision,
          },
          values: { operatorNote: "Attach exact replacement packing" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    expect(replacementBookings).toHaveLength(1);
    expect(replacementBookings[0]).toMatchObject({
      contract: "np.shop-exchange-carrier-booking-request.v2",
      orderId: prepared.orderIds.orderId,
      exchangeId: prepared.exchangeId,
      exchangeRevision: prepared.exchangeRevision,
      parcelRevision: 1,
      parcels: replacementParcels,
    });
    const attached = await readPackingWork(prepared.orderIds.orderId, "replacement");
    expect(attached).toMatchObject({
      status: "active",
      attachedShipmentId: replacementBookings[0]?.shipmentId,
      consumedAt: null,
    });
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            parcelMutationEligible: false,
            processEligible: false,
            manualShipEligible: false,
            cancelEligible: false,
            carrierBookEligible: false,
            carrierResumeEligible: false,
            carrierShipEligible: true,
            carrierCancelEligible: false,
          }),
        ],
      },
    });

    const db = await getTestDb();
    const [bookingRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `exchange-carrier-booking:${prepared.orderIds.orderId}`));
    const booking = bookingRow?.value as
      | {
          id: string;
          revision: number;
          completedOrderRevision: number;
          completedExchangeRevision: number;
          providerId: string;
          bookingReference: string;
          trackingNumber: string;
          purgeAt: string;
        }
      | undefined;
    if (!booking) throw new Error("Missing completed replacement booking.");
    const trackedAt = new Date().toISOString();
    await db.insert(npPluginStorage).values({
      pluginId: "shop",
      siteId: "default",
      key: `exchange-tracking:${prepared.orderIds.orderId}`,
      value: {
        contract: "np.shop-tracking-storage.v1",
        orderId: prepared.orderIds.orderId,
        shipmentId: booking.id,
        providerId: booking.providerId,
        bookingReference: booking.bookingReference,
        trackingNumber: booking.trackingNumber,
        status: "in-transit",
        latestEventId: "packing-tracking-started",
        occurredAt: trackedAt,
        deliveredAt: null,
        updatedAt: trackedAt,
        purgeAt: booking.purgeAt,
      },
      expiresAt: new Date(booking.purgeAt),
      updatedAt: new Date(trackedAt),
    });
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(attached), context),
    ).toMatchObject({ ok: false, error: expect.stringContaining("verified tracking") });
    expect(packingCancellations).toHaveLength(0);
    expect(await invokeReadAction(shop, "recentPackingWork")).toMatchObject({
      ok: true,
      data: {
        rows: expect.arrayContaining([
          expect.objectContaining({
            packingWorkTarget: "replacement",
            providerCancelEligible: false,
          }),
        ]),
      },
    });
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            carrierShipEligible: true,
            carrierCancelEligible: false,
          }),
        ],
      },
    });
    expect(
      await invokeAction(
        shop,
        "shipBookedExchange",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            orderRevision: booking.completedOrderRevision,
            exchangeRevision: booking.completedExchangeRevision,
            bookingId: booking.id,
            bookingRevision: booking.revision,
          },
          values: { operatorNote: "Provider handoff completed" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("shipped") });
    expect(await readPackingWork(prepared.orderIds.orderId, "replacement")).toMatchObject({
      status: "consumed",
      attachedShipmentId: booking.id,
      consumedAt: expect.any(String),
    });
    expect(await invokeReadAction(shop, "recentPackingWork")).toMatchObject({
      ok: true,
      data: {
        total: 2,
        rows: expect.arrayContaining([
          expect.objectContaining({ packingWorkTarget: "outbound", status: "consumed" }),
          expect.objectContaining({ packingWorkTarget: "replacement", status: "consumed" }),
        ]),
      },
    });
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "ok" },
    });

    const exchangeKey = `exchange:${prepared.orderIds.orderId}`;
    const returnKey = `return:${prepared.orderIds.orderId}`;
    const [exchangeSourceRow, returnSourceRow] = await Promise.all([
      db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, exchangeKey),
          ),
        )
        .then((rows) => rows[0]),
      db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, returnKey),
          ),
        )
        .then((rows) => rows[0]),
    ]);
    const exchangeSource = exchangeSourceRow?.value as Record<string, unknown> | undefined;
    const returnSource = returnSourceRow?.value as Record<string, unknown> | undefined;
    const ownerSegment = exchangeSource?.ownerSegment;
    if (!exchangeSource || !returnSource || typeof ownerSegment !== "string") {
      throw new Error("Missing canonical replacement health sources.");
    }
    const orderKey = `order:${ownerSegment}:${prepared.orderIds.orderId}`;
    const [orderSourceRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, orderKey),
        ),
      );
    const orderSource = orderSourceRow?.value as Record<string, unknown> | undefined;
    if (!orderSource) throw new Error("Missing canonical replacement order source.");

    const hiddenReturnKey = `return-health-hidden:${prepared.orderIds.orderId}`;
    await db
      .update(npPluginStorage)
      .set({ key: hiddenReturnKey })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, returnKey),
        ),
      );
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 orphan") },
    });
    await db
      .update(npPluginStorage)
      .set({ key: returnKey })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, hiddenReturnKey),
        ),
      );

    await db
      .update(npPluginStorage)
      .set({ value: { ...returnSource, id: randomUUID() } })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, returnKey),
        ),
      );
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 source-mismatched") },
    });
    await db
      .update(npPluginStorage)
      .set({ value: returnSource })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, returnKey),
        ),
      );

    await db
      .update(npPluginStorage)
      .set({ value: { ...exchangeSource, ownerSegment: `member:${randomUUID()}` } })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, exchangeKey),
        ),
      );
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 source-mismatched") },
    });
    await db
      .update(npPluginStorage)
      .set({ value: exchangeSource })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, exchangeKey),
        ),
      );

    const exchangeRevision = exchangeSource.revision;
    const orderRevision = orderSource.revision;
    if (typeof exchangeRevision !== "number" || typeof orderRevision !== "number") {
      throw new Error("Missing canonical replacement source revisions.");
    }
    await Promise.all([
      db
        .update(npPluginStorage)
        .set({
          value: {
            ...exchangeSource,
            revision: exchangeRevision + 1,
            orderRevision: orderRevision + 1,
          },
        })
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, exchangeKey),
          ),
        ),
      db
        .update(npPluginStorage)
        .set({ value: { ...orderSource, revision: orderRevision + 1 } })
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, orderKey),
          ),
        ),
    ]);
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 source-mismatched") },
    });
    await Promise.all([
      db
        .update(npPluginStorage)
        .set({ value: exchangeSource })
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, exchangeKey),
          ),
        ),
      db
        .update(npPluginStorage)
        .set({ value: orderSource })
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, orderKey),
          ),
        ),
    ]);
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "ok" },
    });
    const malformedWork = await readPackingWork(prepared.orderIds.orderId, "replacement");
    await db
      .update(npPluginStorage)
      .set({ value: { ...malformedWork, rawProviderSecret: "hidden-invalid-replacement" } })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, `packing-work:replacement:${prepared.orderIds.orderId}`),
        ),
      );
    const recentExchanges = await invokeReadAction(shop, "recentExchanges");
    expect(recentExchanges).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            packingWorkStatus: "invalid",
            parcelMutationEligible: false,
            processEligible: false,
            manualShipEligible: false,
            cancelEligible: false,
            carrierBookEligible: false,
            carrierResumeEligible: false,
            carrierShipEligible: false,
            carrierCancelEligible: false,
          }),
        ],
      },
    });
    expect(JSON.stringify(recentExchanges)).not.toContain("hidden-invalid-replacement");
  });

  it("fails closed on coherent replacement booking revision drift before ship or cancellation", async () => {
    const packingCancellation = vi.fn((request: NpShopPackingWorkCancelRequest) =>
      npCreateShopPackingWorkCancelResult(request, { cancelledAt: request.requestedAt }),
    );
    const carrierCancellation = vi.fn((request: NpShopExchangeCarrierCancelRequest) => ({
      contract: "np.shop-exchange-carrier-cancel-result.v1" as const,
      cancellationId: request.cancellationId,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      exchangeId: request.exchangeId,
      cancelledAt: request.requestedAt,
    }));
    const acquireShippingLabel = vi.fn(() =>
      Promise.reject(new Error("Label acquisition must fail before provider I/O.")),
    );
    const schedulePickup = vi.fn(() =>
      Promise.reject(new Error("Pickup scheduling must fail before provider I/O.")),
    );
    const shop = createShop({
      packing: {
        adapter: {
          id: "revision-drift-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: packingCancellation,
        },
      },
      carrier: {
        pickupLocationReference: "warehouse-revision-drift",
        adapter: {
          id: "revision-drift-carrier",
          bookShipment: () => Promise.reject(new Error("Outbound booking is not used.")),
          bookExchangeShipment: () => Promise.reject(new Error("Replacement v1 is not used.")),
          bookExchangeShipmentWithParcels: (request) => ({
            contract: "np.shop-exchange-carrier-booking-result.v1",
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            exchangeId: request.exchangeId,
            bookingReference: `replacement_${request.shipmentId}`,
            carrier: "Parcel Co",
            trackingNumber: "REPLACEMENT-REVISION-DRIFT-1",
            bookedAt: request.requestedAt,
          }),
          acquireShippingLabel,
          readShippingLabel: () => Promise.reject(new Error("Label read is not used.")),
          schedulePickup,
          cancelPickup: (request) => ({
            contract: "np.shop-carrier-pickup-cancel-result.v1",
            cancellationId: request.cancellationId,
            pickupId: request.pickupId,
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            cancelledAt: request.requestedAt,
          }),
          cancelExchangeShipment: carrierCancellation,
        },
      },
    });
    const staff = await seedUser({ email: "replacement-revision-drift@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: {
            parcels: JSON.stringify([
              {
                id: "revision-drift-parcel",
                lengthMm: 300,
                widthMm: 200,
                heightMm: 100,
                weightGrams: 1_500,
                items: [{ lineKey: prepared.lineKey, quantity: 1 }],
              },
            ]),
          },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "bookExchangeCarrier",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            orderRevision: prepared.orderRevision,
            exchangeRevision: prepared.exchangeRevision,
            destinationRevision: prepared.destinationRevision,
          },
          values: { operatorNote: "Establish exact completed replacement booking" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });

    const db = await getTestDb();
    const bookingKey = `exchange-carrier-booking:${prepared.orderIds.orderId}`;
    const exchangeKey = `exchange:${prepared.orderIds.orderId}`;
    const [bookingRow, exchangeRow] = await Promise.all([
      db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, bookingKey),
          ),
        )
        .then((rows) => rows[0]),
      db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, exchangeKey),
          ),
        )
        .then((rows) => rows[0]),
    ]);
    const bookingSource = bookingRow?.value as Record<string, unknown> | undefined;
    const exchangeSource = exchangeRow?.value as Record<string, unknown> | undefined;
    const ownerSegment = exchangeSource?.ownerSegment;
    const bookingId = bookingSource?.id;
    const bookingRevision = bookingSource?.revision;
    const sourceOrderRevision = bookingSource?.sourceOrderRevision;
    const sourceExchangeRevision = bookingSource?.sourceExchangeRevision;
    const completedOrderRevision = bookingSource?.completedOrderRevision;
    const completedExchangeRevision = bookingSource?.completedExchangeRevision;
    if (
      !bookingSource ||
      !exchangeSource ||
      typeof ownerSegment !== "string" ||
      typeof bookingId !== "string" ||
      typeof bookingRevision !== "number" ||
      typeof sourceOrderRevision !== "number" ||
      typeof sourceExchangeRevision !== "number" ||
      typeof completedOrderRevision !== "number" ||
      typeof completedExchangeRevision !== "number"
    ) {
      throw new Error("Missing completed replacement carrier revision sources.");
    }
    const orderKey = `order:${ownerSegment}:${prepared.orderIds.orderId}`;
    const [orderRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, orderKey),
        ),
      );
    const orderSource = orderRow?.value as Record<string, unknown> | undefined;
    if (
      !orderSource ||
      orderSource.revision !== completedOrderRevision ||
      exchangeSource.revision !== completedExchangeRevision ||
      exchangeSource.orderRevision !== completedOrderRevision
    ) {
      throw new Error("Missing exact completed replacement commercial revisions.");
    }
    expect(completedOrderRevision).toBe(sourceOrderRevision + 1);
    expect(completedExchangeRevision).toBe(sourceExchangeRevision + 1);

    const shiftedBooking = {
      ...bookingSource,
      sourceOrderRevision: sourceOrderRevision + 1,
      sourceExchangeRevision: sourceExchangeRevision + 1,
      completedOrderRevision: completedOrderRevision + 1,
      completedExchangeRevision: completedExchangeRevision + 1,
    };
    const shiftedOrder = { ...orderSource, revision: completedOrderRevision + 1 };
    const shiftedExchange = {
      ...exchangeSource,
      revision: completedExchangeRevision + 1,
      orderRevision: completedOrderRevision + 1,
    };
    expect(shiftedBooking.completedOrderRevision).toBe(shiftedBooking.sourceOrderRevision + 1);
    expect(shiftedBooking.completedExchangeRevision).toBe(
      shiftedBooking.sourceExchangeRevision + 1,
    );

    const updateStoredValue = (key: string, value: Record<string, unknown>) =>
      db
        .update(npPluginStorage)
        .set({ value })
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, key),
          ),
        );
    const setSources = (
      booking: Record<string, unknown>,
      order: Record<string, unknown>,
      exchange: Record<string, unknown>,
    ) =>
      Promise.all([
        updateStoredValue(bookingKey, booking),
        updateStoredValue(orderKey, order),
        updateStoredValue(exchangeKey, exchange),
      ]);
    const readSources = () =>
      Promise.all(
        [bookingKey, orderKey, exchangeKey].map((key) =>
          db
            .select({ value: npPluginStorage.value })
            .from(npPluginStorage)
            .where(
              and(
                eq(npPluginStorage.pluginId, "shop"),
                eq(npPluginStorage.siteId, "default"),
                eq(npPluginStorage.key, key),
              ),
            )
            .then((rows) => rows[0]?.value),
        ),
      );
    const shiftedActionRow = {
      id: prepared.orderIds.orderId,
      exchangeId: prepared.exchangeId,
      orderRevision: completedOrderRevision + 1,
      exchangeRevision: completedExchangeRevision + 1,
      bookingId,
      bookingRevision,
    };

    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            pickupAction: "schedule",
            labelAction: "purchase",
            carrierShipEligible: true,
            carrierCancelEligible: false,
          }),
        ],
      },
    });
    await setSources(shiftedBooking, shiftedOrder, shiftedExchange);
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            pickupAction: "—",
            labelAction: "—",
            carrierShipEligible: false,
            carrierCancelEligible: false,
          }),
        ],
      },
    });
    expect(
      await invokeAction(
        shop,
        "acquireCarrierShippingLabel",
        {
          row: {
            id: prepared.orderIds.orderId,
            shipmentId: bookingId,
            target: "replacement",
            exchangeId: prepared.exchangeId,
            expectedRevision: 0,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: false });
    const readyAt = new Date(Date.now() + 60 * 60 * 1_000);
    readyAt.setMilliseconds(0);
    const closeAt = new Date(readyAt.getTime() + 3 * 60 * 60 * 1_000);
    expect(
      await invokeAction(
        shop,
        "scheduleCarrierPickup",
        {
          row: {
            id: prepared.orderIds.orderId,
            shipmentId: bookingId,
            pickupTarget: "replacement",
            exchangeId: prepared.exchangeId,
            pickupRevision: 0,
          },
          values: { readyAt: readyAt.toISOString(), closeAt: closeAt.toISOString() },
        },
        context,
      ),
    ).toMatchObject({ ok: false });
    expect(acquireShippingLabel).not.toHaveBeenCalled();
    expect(schedulePickup).not.toHaveBeenCalled();
    const [labelRow, pickupRow] = await Promise.all([
      db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `carrier-label-acquisition:${bookingId}`))
        .then((rows) => rows[0]),
      db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `carrier-pickup:${bookingId}`))
        .then((rows) => rows[0]),
    ]);
    expect(labelRow).toBeUndefined();
    expect(pickupRow).toBeUndefined();
    expect(
      await invokeAction(
        shop,
        "shipBookedExchange",
        {
          row: shiftedActionRow,
          values: { operatorNote: "Reject shifted replacement source" },
        },
        context,
      ),
    ).toMatchObject({ ok: false });
    expect(await readSources()).toEqual([shiftedBooking, shiftedOrder, shiftedExchange]);

    await setSources(bookingSource, orderSource, exchangeSource);
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            carrierShipEligible: true,
            carrierCancelEligible: false,
          }),
        ],
      },
    });
    const attached = await readPackingWork(prepared.orderIds.orderId, "replacement");
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(attached), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    expect(packingCancellation).toHaveBeenCalledTimes(1);
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            carrierShipEligible: false,
            carrierCancelEligible: true,
          }),
        ],
      },
    });

    await setSources(shiftedBooking, shiftedOrder, shiftedExchange);
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            carrierShipEligible: false,
            carrierCancelEligible: false,
          }),
        ],
      },
    });
    expect(
      await invokeAction(
        shop,
        "cancelExchangeCarrier",
        {
          row: shiftedActionRow,
          values: { operatorNote: "Reject shifted replacement cancellation source" },
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("packing-work cancellation") });
    expect(carrierCancellation).not.toHaveBeenCalled();
    expect(await readSources()).toEqual([shiftedBooking, shiftedOrder, shiftedExchange]);

    await setSources(bookingSource, orderSource, exchangeSource);
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            carrierBooking: "completed",
            packingWorkStatus: "cancelled",
            carrierShipEligible: false,
            carrierCancelEligible: true,
          }),
        ],
      },
    });
    expect(await readOwnerOrder(prepared.owner, prepared.orderIds.orderId)).toMatchObject({
      order: {
        revision: completedOrderRevision,
        exchange: { revision: completedExchangeRevision, status: "processing" },
      },
    });
  });

  it("blocks outbound label and pickup effects when private-data lifecycle states diverge", async () => {
    const acquireShippingLabel = vi.fn(() =>
      Promise.reject(new Error("Label acquisition must fail before provider I/O.")),
    );
    const schedulePickup = vi.fn(() =>
      Promise.reject(new Error("Pickup scheduling must fail before provider I/O.")),
    );
    const bookShipmentWithParcels = vi.fn((request: NpShopCarrierParcelBookingRequest) => ({
      contract: "np.shop-carrier-booking-result.v1" as const,
      shipmentId: request.shipmentId,
      orderId: request.orderId,
      bookingReference: `booking_${request.shipmentId}`,
      carrier: "Parcel Co",
      trackingNumber: "PRIVATE-STATE-MISMATCH-1",
      bookedAt: request.requestedAt,
    }));
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "private-state-mismatch-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
      carrier: {
        pickupLocationReference: "warehouse-private-state-mismatch",
        adapter: {
          id: "private-state-mismatch-carrier",
          bookShipment: () => Promise.reject(new Error("Outbound v1 booking is not used.")),
          bookShipmentWithParcels,
          acquireShippingLabel,
          readShippingLabel: () => Promise.reject(new Error("Label read is not used.")),
          schedulePickup,
          cancelPickup: (request: NpShopCarrierPickupCancelRequest) => ({
            contract: "np.shop-carrier-pickup-cancel-result.v1" as const,
            cancellationId: request.cancellationId,
            pickupId: request.pickupId,
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            cancelledAt: request.requestedAt,
          }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-private-state-mismatch@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(prepared.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "bookCarrierShipment",
        {
          row: { id: prepared.orderIds.orderId, fulfillmentRevision: 2 },
          values: { operatorNote: "Create exact outbound label and pickup source" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    const shipmentId = bookShipmentWithParcels.mock.calls[0]?.[0].shipmentId;
    if (!shipmentId) throw new Error("Missing private-state mismatch shipment id.");

    expect(await invokeReadAction(shop, "recentCarrierBookings")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            shipmentId,
            labelAction: "purchase",
            pickupAction: "schedule",
          }),
        ],
      },
    });

    const db = await getTestDb();
    const [fulfillmentRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, `fulfillment:${prepared.orderIds.orderId}`));
    const fulfillment = fulfillmentRow?.value as Record<string, unknown> | undefined;
    const ownerSegment = fulfillment?.ownerSegment;
    if (
      !fulfillment ||
      fulfillment.privateDataStatus !== "redacted" ||
      typeof ownerSegment !== "string"
    ) {
      throw new Error("Missing redacted outbound fulfillment source.");
    }
    const orderKey = `order:${ownerSegment}:${prepared.orderIds.orderId}`;
    const [orderRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, orderKey));
    const order = orderRow?.value as Record<string, unknown> | undefined;
    if (!order || order.privateDataStatus !== "redacted") {
      throw new Error("Missing redacted outbound order source.");
    }
    await db
      .update(npPluginStorage)
      .set({ value: { ...order, privateDataStatus: "retained" } })
      .where(eq(npPluginStorage.key, orderKey));

    expect(await invokeReadAction(shop, "recentCarrierBookings")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            shipmentId,
            labelAction: "—",
            pickupAction: "—",
          }),
        ],
      },
    });
    expect(
      await invokeAction(
        shop,
        "acquireCarrierShippingLabel",
        {
          row: {
            id: prepared.orderIds.orderId,
            shipmentId,
            target: "outbound",
            exchangeId: null,
            expectedRevision: 0,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: false });
    const readyAt = new Date(Date.now() + 60 * 60 * 1_000);
    readyAt.setMilliseconds(0);
    const closeAt = new Date(readyAt.getTime() + 3 * 60 * 60 * 1_000);
    expect(
      await invokeAction(
        shop,
        "scheduleCarrierPickup",
        {
          row: {
            id: prepared.orderIds.orderId,
            shipmentId,
            pickupTarget: "outbound",
            exchangeId: null,
            pickupRevision: 0,
          },
          values: { readyAt: readyAt.toISOString(), closeAt: closeAt.toISOString() },
        },
        context,
      ),
    ).toMatchObject({ ok: false });
    expect(acquireShippingLabel).not.toHaveBeenCalled();
    expect(schedulePickup).not.toHaveBeenCalled();
    const [labelRow, pickupRow] = await Promise.all([
      db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `carrier-label-acquisition:${shipmentId}`))
        .then((rows) => rows[0]),
      db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, `carrier-pickup:${shipmentId}`))
        .then((rows) => rows[0]),
    ]);
    expect(labelRow).toBeUndefined();
    expect(pickupRow).toBeUndefined();
  });

  it("blocks replacement inventory restoration when an attached cancelled work loses its carrier row", async () => {
    const shop = createShop({
      packing: {
        adapter: {
          id: "attached-cancelled-replacement",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
      carrier: {
        adapter: {
          id: "attached-cancelled-carrier",
          bookShipment: () => Promise.reject(new Error("Outbound booking is not used.")),
          bookExchangeShipment: () => Promise.reject(new Error("Replacement v1 is not used.")),
          bookExchangeShipmentWithParcels: (request) => ({
            contract: "np.shop-exchange-carrier-booking-result.v1",
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            exchangeId: request.exchangeId,
            bookingReference: `replacement_${request.shipmentId}`,
            carrier: "Parcel Co",
            trackingNumber: "ATTACHED-CANCELLED-1",
            bookedAt: request.requestedAt,
          }),
          cancelExchangeShipment: (request) => ({
            contract: "np.shop-exchange-carrier-cancel-result.v1",
            cancellationId: request.cancellationId,
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            exchangeId: request.exchangeId,
            cancelledAt: request.requestedAt,
          }),
        },
      },
    });
    const staff = await seedUser({ email: "attached-cancelled-replacement@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: {
            parcels: JSON.stringify([
              {
                id: "attached-cancelled-parcel",
                lengthMm: 300,
                widthMm: 200,
                heightMm: 100,
                weightGrams: 1_500,
                items: [{ lineKey: prepared.lineKey, quantity: 1 }],
              },
            ]),
          },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "bookExchangeCarrier",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            orderRevision: prepared.orderRevision,
            exchangeRevision: prepared.exchangeRevision,
            destinationRevision: prepared.destinationRevision,
          },
          values: { operatorNote: "Attach before packing cancellation" },
        },
        context,
      ),
    ).toMatchObject({ ok: true });

    const attached = await readPackingWork(prepared.orderIds.orderId, "replacement");
    const db = await getTestDb();
    const bookingKey = `exchange-carrier-booking:${prepared.orderIds.orderId}`;
    const parcelKey = `exchange-parcels:${prepared.orderIds.orderId}`;
    const [bookingRow, parcelRow, stockBeforeRow] = await Promise.all([
      db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, bookingKey),
          ),
        )
        .then((rows) => rows[0]),
      db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, parcelKey),
          ),
        )
        .then((rows) => rows[0]),
      db
        .select({ stockQuantity: shopProductsTable.stockQuantity })
        .from(shopProductsTable)
        .where(eq(shopProductsTable.id, productId))
        .then((rows) => rows[0]),
    ]);
    const booking = bookingRow?.value as
      | {
          id: string;
          revision: number;
          completedOrderRevision: number;
          completedExchangeRevision: number;
        }
      | undefined;
    const parcelSource = parcelRow?.value as Record<string, unknown> | undefined;
    const parcelSourceRevision = parcelSource?.exchangeRevision;
    const parcelSourceParcels = parcelSource?.parcels;
    const firstParcel = Array.isArray(parcelSourceParcels)
      ? (parcelSourceParcels[0] as Record<string, unknown> | undefined)
      : undefined;
    if (
      !booking ||
      !parcelSource ||
      typeof parcelSourceRevision !== "number" ||
      !firstParcel ||
      typeof firstParcel.weightGrams !== "number" ||
      stockBeforeRow?.stockQuantity === undefined
    ) {
      throw new Error("Missing attached replacement carrier state.");
    }
    expect(attached).toMatchObject({
      status: "active",
      attachedShipmentId: booking.id,
    });
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(attached), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: {
        level: "warn",
        message: expect.stringContaining("unresolved attached cancellation"),
      },
    });

    const updateParcelSource = (value: Record<string, unknown>) =>
      db
        .update(npPluginStorage)
        .set({ value })
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, parcelKey),
          ),
        );
    await updateParcelSource({
      ...parcelSource,
      exchangeRevision: parcelSourceRevision + 1,
    });
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 parcel-mismatched") },
    });
    await updateParcelSource(parcelSource);

    await updateParcelSource({
      ...parcelSource,
      parcels: [
        {
          ...firstParcel,
          weightGrams: firstParcel.weightGrams + 1,
        },
      ],
    });
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 fingerprint-mismatched") },
    });
    await updateParcelSource(parcelSource);

    await updateParcelSource({ ...parcelSource, lockedShipmentId: null });
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 shipment-mismatched") },
    });
    await updateParcelSource(parcelSource);

    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            packingWorkStatus: "cancelled",
            parcelMutationEligible: false,
            processEligible: false,
            manualShipEligible: false,
            cancelEligible: false,
            carrierBookEligible: false,
            carrierResumeEligible: false,
            carrierShipEligible: false,
            carrierCancelEligible: true,
          }),
        ],
      },
    });

    await db
      .delete(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, bookingKey),
        ),
      );
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 shipment-mismatched") },
    });
    expect(await invokeReadAction(shop, "recentExchanges")).toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({
            id: prepared.orderIds.orderId,
            packingWorkStatus: "cancelled",
            cancelEligible: false,
            carrierBookEligible: false,
            carrierResumeEligible: false,
            carrierShipEligible: false,
            carrierCancelEligible: false,
          }),
        ],
      },
    });
    expect(
      await invokeAction(
        shop,
        "cancelExchange",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: booking.completedExchangeRevision,
            orderRevision: booking.completedOrderRevision,
          },
          values: { operatorNote: "Must not restock without carrier reconciliation" },
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("packing-work cancellation") });
    const [stockAfterRow] = await db
      .select({ stockQuantity: shopProductsTable.stockQuantity })
      .from(shopProductsTable)
      .where(eq(shopProductsTable.id, productId));
    expect(stockAfterRow?.stockQuantity).toBe(stockBeforeRow.stockQuantity);
    expect(await readOwnerOrder(prepared.owner, prepared.orderIds.orderId)).toMatchObject({
      order: { exchange: { status: "processing", revision: booking.completedExchangeRevision } },
    });
  });

  it("keeps cancelled replacement tombstones healthy after the manual fallback changes parcels", async () => {
    const shop = createShop({
      packing: {
        adapter: {
          id: "cancelled-replacement-health",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "cancelled-replacement-health@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    const replacementParcels = [
      {
        id: "replacement-before-cancel",
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
        weightGrams: 1_500,
        items: [{ lineKey: prepared.lineKey, quantity: 1 }],
      },
    ];
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: { parcels: JSON.stringify(replacementParcels) },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    const active = await readPackingWork(prepared.orderIds.orderId, "replacement");
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(active), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
          },
          values: {
            parcels: JSON.stringify([{ ...replacementParcels[0], id: "replacement-after-cancel" }]),
          },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("revision 2") });

    const db = await getTestDb();
    const returnKey = `return:${prepared.orderIds.orderId}`;
    await db
      .update(npPluginStorage)
      .set({ key: `return-cancelled-hidden:${prepared.orderIds.orderId}` })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, returnKey),
        ),
      );
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "ok" },
    });
  });

  it("retains an expired attached replacement cancellation until carrier reconciliation finishes", async () => {
    let cancellationAttempt = 0;
    const cancelExchangeShipment = vi.fn((request: NpShopExchangeCarrierCancelRequest) => {
      cancellationAttempt += 1;
      if (cancellationAttempt === 1) {
        throw new NpShopCarrierProviderError(
          "replacement-cancel-timeout",
          "provider cancellation timeout",
          { retryable: true },
        );
      }
      return {
        contract: "np.shop-exchange-carrier-cancel-result.v1" as const,
        cancellationId: request.cancellationId,
        shipmentId: request.shipmentId,
        orderId: request.orderId,
        exchangeId: request.exchangeId,
        cancelledAt: request.requestedAt,
      };
    });
    const shop = createShop({
      packing: {
        adapter: {
          id: "expired-repl-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
      carrier: {
        adapter: {
          id: "expired-repl-carrier",
          bookShipment: () => Promise.reject(new Error("Outbound booking is not used.")),
          bookExchangeShipment: () => Promise.reject(new Error("Replacement v1 is not used.")),
          bookExchangeShipmentWithParcels: (request) => ({
            contract: "np.shop-exchange-carrier-booking-result.v1" as const,
            shipmentId: request.shipmentId,
            orderId: request.orderId,
            exchangeId: request.exchangeId,
            bookingReference: `replacement_${request.shipmentId}`,
            carrier: "Parcel Co",
            trackingNumber: "EXPIRED-ATTACHED-REPLACEMENT-1",
            bookedAt: request.requestedAt,
          }),
          cancelExchangeShipment,
        },
      },
    });
    const staff = await seedUser({ email: "packing-expired-attached-replacement@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: {
            parcels: JSON.stringify([
              {
                id: "expired-repl-parcel",
                lengthMm: 300,
                widthMm: 200,
                heightMm: 100,
                weightGrams: 1_500,
                items: [{ lineKey: prepared.lineKey, quantity: 1 }],
              },
            ]),
          },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "bookExchangeCarrier",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            orderRevision: prepared.orderRevision,
            exchangeRevision: prepared.exchangeRevision,
            destinationRevision: prepared.destinationRevision,
          },
          values: { operatorNote: "Attach replacement before cancellation" },
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("completed") });
    const attached = await readPackingWork(prepared.orderIds.orderId, "replacement");
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(attached), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });

    const db = await getTestDb();
    const bookingKey = `exchange-carrier-booking:${prepared.orderIds.orderId}`;
    const readBooking = async () => {
      const [row] = await db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, bookingKey));
      const booking = row?.value as
        | {
            id: string;
            status: string;
            revision: number;
            completedOrderRevision: number;
            completedExchangeRevision: number;
          }
        | undefined;
      if (!booking) throw new Error("Missing expired replacement carrier booking.");
      return booking;
    };
    const completed = await readBooking();
    expect(completed).toMatchObject({ status: "completed" });
    await expireCommercialRows(prepared.orderIds.orderId);

    const expectRetained = async (status: string) => {
      expect(await readBooking()).toMatchObject({ status });
      expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
        ok: true,
        data: {
          level: "warn",
          message: expect.stringContaining("retained past commercial purge"),
        },
      });
      expect(await invokeAction(shop, "maintainOrders", undefined, context)).toMatchObject({
        ok: true,
        data: expect.stringContaining("purged 0 expired commercial snapshot"),
      });
      expect(await storageKeysForOrder(prepared.orderIds.orderId)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("order:"),
          `packing-work:replacement:${prepared.orderIds.orderId}`,
          bookingKey,
        ]),
      );
    };
    await expectRetained("completed");

    const cancellationInput = (bookingRevision: number) => ({
      row: {
        id: prepared.orderIds.orderId,
        exchangeId: prepared.exchangeId,
        orderRevision: completed.completedOrderRevision,
        exchangeRevision: completed.completedExchangeRevision,
        bookingId: completed.id,
        bookingRevision,
      },
      values: { operatorNote: "Finish the exact expired replacement cancellation" },
    });
    expect(
      await invokeAction(
        shop,
        "cancelExchangeCarrier",
        cancellationInput(completed.revision),
        context,
      ),
    ).toMatchObject({ ok: false });
    const cancelPending = await readBooking();
    await expectRetained("cancel-pending");

    const triggerName = "np_test_fail_expired_exchange_cancel_audit";
    const functionName = "np_test_fail_expired_exchange_cancel_audit_fn";
    await db.execute(sql.raw(`drop trigger if exists ${triggerName} on np_audit_events`));
    await db.execute(sql.raw(`drop function if exists ${functionName}()`));
    await db.execute(
      sql.raw(`
        create function ${functionName}() returns trigger language plpgsql as $$
        begin
          if new.action = 'shop.exchange.carrier.cancellation.complete' then
            raise exception 'transient expired exchange cancellation audit failure';
          end if;
          return new;
        end
        $$
      `),
    );
    await db.execute(
      sql.raw(`
        create trigger ${triggerName}
        before insert on np_audit_events
        for each row execute function ${functionName}()
      `),
    );
    try {
      expect(
        await invokeAction(
          shop,
          "cancelExchangeCarrier",
          cancellationInput(cancelPending.revision),
          context,
        ),
      ).toMatchObject({
        ok: false,
        error: expect.stringContaining("shop.exchange.carrier.cancellation.complete"),
      });
    } finally {
      await db.execute(sql.raw(`drop trigger if exists ${triggerName} on np_audit_events`));
      await db.execute(sql.raw(`drop function if exists ${functionName}()`));
    }
    const cancelConfirmed = await readBooking();
    await expectRetained("cancel-confirmed");
    expect(cancelExchangeShipment).toHaveBeenCalledTimes(2);

    expect(
      await invokeAction(
        shop,
        "cancelExchangeCarrier",
        cancellationInput(cancelConfirmed.revision),
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("exchange cancelled") });
    expect(cancelExchangeShipment).toHaveBeenCalledTimes(2);
    expect(await readBooking()).toMatchObject({ status: "cancelled" });
    expect(await invokeAction(shop, "maintainOrders", undefined, context)).toMatchObject({
      ok: true,
      data: expect.stringContaining("purged 1 expired commercial snapshot"),
    });
    expect(await storageKeysForOrder(prepared.orderIds.orderId)).toEqual([]);
  });

  it("preserves unresolved work past commercial retention and purges terminal work with its order", async () => {
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "retention-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
          verifyPackingStatusWebhook: ({ rawBody }) =>
            JSON.parse(new TextDecoder().decode(rawBody)) as never,
        },
      },
    });
    const staff = await seedUser({ email: "packing-retention-operator@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };

    const unresolved = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(unresolved.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const terminal = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(terminal.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const activeTerminal = await readPackingWork(terminal.orderIds.orderId);
    const statusAt = new Date().toISOString();
    expect(
      await invokePackingStatusCallback(shop, {
        contract: "np.shop-packing-status-event.v1",
        eventId: "terminal-retention-status",
        workId: activeTerminal.workId,
        orderId: terminal.orderIds.orderId,
        target: "outbound",
        exchangeId: null,
        providerWorkReference: activeTerminal.providerWorkReference,
        status: "picking",
        occurredAt: statusAt,
        signedAt: statusAt,
      }),
    ).toMatchObject({ status: 200, body: { receipt: { outcome: "advanced" } } });
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(activeTerminal), context),
    ).toMatchObject({ ok: true, data: expect.stringContaining("cancelled") });

    await expireCommercialRows(unresolved.orderIds.orderId);
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: {
        level: "warn",
        message: expect.stringContaining("1 retained past commercial purge"),
      },
    });
    await expireCommercialRows(terminal.orderIds.orderId);
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: { level: "error", message: expect.stringContaining("1 expired") },
    });
    expect(await invokeAction(shop, "maintainOrders", undefined, context)).toMatchObject({
      ok: true,
      data: expect.stringContaining("purged 1 expired commercial snapshot"),
    });

    const unresolvedKeys = await storageKeysForOrder(unresolved.orderIds.orderId);
    expect(unresolvedKeys).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`order:`),
        `packing-work:outbound:${unresolved.orderIds.orderId}`,
      ]),
    );
    expect(await readPackingWork(unresolved.orderIds.orderId)).toMatchObject({ status: "active" });
    expect(await storageKeysForOrder(terminal.orderIds.orderId)).toEqual([]);
  });

  it("treats an expired terminal sibling as retained while replacement work is unresolved", async () => {
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "sibling-retention-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-sibling-retention@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareAwaitingExchange(shop, context);
    const replacementParcels = [
      {
        id: "replacement-retained-past-purge",
        lengthMm: 300,
        widthMm: 200,
        heightMm: 100,
        weightGrams: 1_500,
        items: [{ lineKey: prepared.lineKey, quantity: 1 }],
      },
    ];
    expect(
      await invokeAction(
        shop,
        "saveExchangeParcels",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: null,
          },
          values: { parcels: JSON.stringify(replacementParcels) },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await invokeAction(
        shop,
        "createExchangePackingWork",
        {
          row: {
            id: prepared.orderIds.orderId,
            exchangeId: prepared.exchangeId,
            exchangeRevision: prepared.exchangeRevision,
            parcelRevision: 1,
            packingWorkRevision: null,
          },
          values: {},
        },
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("active") });
    expect(await readPackingWork(prepared.orderIds.orderId)).toMatchObject({
      status: "consumed",
    });
    expect(await readPackingWork(prepared.orderIds.orderId, "replacement")).toMatchObject({
      status: "active",
    });

    await expireCommercialRows(prepared.orderIds.orderId);
    expect(await invokeReadAction(shop, "packingWorkHealth")).toMatchObject({
      ok: true,
      data: {
        level: "warn",
        message: expect.stringContaining("2 retained past commercial purge"),
      },
    });
    expect(await readPackingWork(prepared.orderIds.orderId)).toMatchObject({
      status: "consumed",
    });
    expect(await readPackingWork(prepared.orderIds.orderId, "replacement")).toMatchObject({
      status: "active",
    });
  });

  it("commits due privacy redaction before malformed fulfillment projection on reads and idempotent creates", async () => {
    const shop = createShop({ payment: { adapter: paymentAdapter() } });
    const readFixture = { orderIds: ids() };
    const createFixture = { orderIds: ids() };
    const readOwner = await createPendingOrder(readFixture.orderIds);
    const createOwner = await createPendingOrder(createFixture.orderIds);
    await payOrder(shop, readFixture.orderIds.orderId);
    await payOrder(shop, createFixture.orderIds.orderId);

    const db = await getTestDb();
    const fixtures = await Promise.all(
      [readFixture, createFixture].map(async ({ orderIds }) => {
        const [fulfillmentRow] = await db
          .select({ value: npPluginStorage.value })
          .from(npPluginStorage)
          .where(eq(npPluginStorage.key, `fulfillment:${orderIds.orderId}`));
        const fulfillment = fulfillmentRow?.value as Record<string, unknown> | undefined;
        if (
          !fulfillment ||
          typeof fulfillment.ownerSegment !== "string" ||
          typeof fulfillment.privateExpiresAt !== "string"
        ) {
          throw new Error("Missing post-commit privacy projection fixture.");
        }
        await db
          .update(npPluginStorage)
          .set({ value: { ...fulfillment, malformed: "projection-after-privacy-commit" } })
          .where(eq(npPluginStorage.key, `fulfillment:${orderIds.orderId}`));
        return {
          ...orderIds,
          ownerSegment: fulfillment.ownerSegment,
          privateExpiresAt: fulfillment.privateExpiresAt,
        };
      }),
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(
      Math.max(...fixtures.map((fixture) => new Date(fixture.privateExpiresAt).getTime())) + 1,
    );
    try {
      await expect(
        routeCall("GET", "/orders", {
          ...readOwner,
          query: { id: readFixture.orderIds.orderId },
        }),
      ).rejects.toThrow("Invalid stored fulfillment");
      await expect(
        routeCall("POST", "/orders", {
          ...createOwner,
          body: {
            idempotencyKey: createFixture.orderIds.orderId,
            draftId: createFixture.orderIds.draftId,
            expectedRevision: 2,
          },
        }),
      ).rejects.toThrow("Invalid stored fulfillment");

      for (const fixture of fixtures) {
        const [orderRow, fulfillmentRow] = await Promise.all([
          db
            .select({ value: npPluginStorage.value })
            .from(npPluginStorage)
            .where(eq(npPluginStorage.key, `order:${fixture.ownerSegment}:${fixture.orderId}`))
            .then((rows) => rows[0]),
          db
            .select({ value: npPluginStorage.value })
            .from(npPluginStorage)
            .where(eq(npPluginStorage.key, `fulfillment:${fixture.orderId}`))
            .then((rows) => rows[0]),
        ]);
        expect(orderRow?.value).toMatchObject({
          revision: 2,
          privateDataStatus: "redacted",
        });
        expect(fulfillmentRow?.value).toMatchObject({
          revision: 1,
          privateDataStatus: "retained",
          malformed: "projection-after-privacy-commit",
        });
        const keys = await storageKeysForOrder(fixture.orderId);
        expect(keys.some((key) => key.startsWith("order-private:"))).toBe(false);
        expect(keys.some((key) => key.startsWith("order-maintenance:"))).toBe(false);
        expect(keys.some((key) => key.startsWith("order-notification-private:"))).toBe(false);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("redacts 30-day private data without changing an active outbound packing source", async () => {
    const createPackingWork = vi.fn((request: NpShopPackingWorkCreateRequest) =>
      npCreateShopPackingWorkCreateResult(request, {
        providerWorkReference: `provider_${request.workId}`,
        confirmedAt: request.requestedAt,
      }),
    );
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "private-retention-packing",
          createPackingWork,
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-private-retention@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const prepared = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(prepared.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true, data: expect.stringContaining("active") });

    const active = await readPackingWork(prepared.orderIds.orderId);
    expect(active).toMatchObject({ status: "active", sourceRevision: 2 });
    expect(createPackingWork).toHaveBeenCalledTimes(1);

    const db = await getTestDb();
    const readCommercialSource = async () => {
      const [orderRow] = await db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            like(npPluginStorage.key, "order:%"),
            sql`${npPluginStorage.value}->>'id' = ${prepared.orderIds.orderId}`,
          ),
        )
        .limit(1);
      const [fulfillmentRow] = await db
        .select({ value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, "shop"),
            eq(npPluginStorage.siteId, "default"),
            eq(npPluginStorage.key, `fulfillment:${prepared.orderIds.orderId}`),
          ),
        )
        .limit(1);
      if (!orderRow || !fulfillmentRow) throw new Error("Missing packing commercial source.");
      return {
        order: orderRow.value as {
          revision: number;
          privateDataStatus: string;
        },
        fulfillment: fulfillmentRow.value as {
          revision: number;
          privateDataStatus: string;
          privateExpiresAt: string;
        },
      };
    };

    const before = await readCommercialSource();
    expect(before).toMatchObject({
      order: { revision: 2, privateDataStatus: "retained" },
      fulfillment: {
        revision: active.sourceRevision,
        privateDataStatus: "retained",
      },
    });
    expect(await storageKeysForOrder(prepared.orderIds.orderId)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("order-private:"),
        expect.stringContaining("order-maintenance:"),
      ]),
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(before.fulfillment.privateExpiresAt).getTime() + 1);
    try {
      expect(await invokeAction(shop, "maintainOrders", undefined, context)).toMatchObject({
        ok: true,
        data: expect.stringContaining("deleted 1 overdue fulfillment"),
      });

      const after = await readCommercialSource();
      expect(after).toMatchObject({
        order: {
          revision: before.order.revision,
          privateDataStatus: "redacted",
        },
        fulfillment: {
          revision: before.fulfillment.revision,
          privateDataStatus: "redacted",
        },
      });
      const retainedKeys = await storageKeysForOrder(prepared.orderIds.orderId);
      expect(retainedKeys.some((key) => key.startsWith("order-private:"))).toBe(false);
      expect(retainedKeys.some((key) => key.startsWith("order-maintenance:"))).toBe(false);
      expect(await readPackingWork(prepared.orderIds.orderId)).toEqual(active);

      expect(
        await invokeAction(
          shop,
          "shipFulfillment",
          {
            row: {
              id: prepared.orderIds.orderId,
              fulfillmentRevision: before.fulfillment.revision,
            },
            values: {
              carrier: "Privacy Retention Parcel",
              trackingNumber: "PACKING-PRIVATE-30D",
              operatorNote: "Complete the unchanged active packing source",
            },
          },
          context,
        ),
      ).toMatchObject({ ok: true, data: expect.stringContaining("revision 3") });
      expect(await readPackingWork(prepared.orderIds.orderId)).toMatchObject({
        status: "consumed",
        sourceRevision: before.fulfillment.revision,
      });
      expect(createPackingWork).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces the 30-day privacy backstop against future sidecar and marker metadata", async () => {
    const shop = createShop({ payment: { adapter: paymentAdapter() } });
    const staff = await seedUser({ email: "packing-private-backstop@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const missingMarker = { orderIds: ids() };
    const futureMarker = { orderIds: ids() };
    await createPendingOrder(missingMarker.orderIds);
    await createPendingOrder(futureMarker.orderIds);
    await payOrder(shop, missingMarker.orderIds.orderId);
    await payOrder(shop, futureMarker.orderIds.orderId);

    const db = await getTestDb();
    const fixtures = await Promise.all(
      [missingMarker, futureMarker].map(async ({ orderIds }) => {
        const [fulfillmentRow] = await db
          .select({ value: npPluginStorage.value })
          .from(npPluginStorage)
          .where(eq(npPluginStorage.key, `fulfillment:${orderIds.orderId}`));
        const fulfillment = fulfillmentRow?.value as Record<string, unknown> | undefined;
        if (
          !fulfillment ||
          typeof fulfillment.ownerSegment !== "string" ||
          typeof fulfillment.privateExpiresAt !== "string"
        ) {
          throw new Error("Missing privacy metadata backstop fixture.");
        }
        expect(new Date(fulfillment.privateExpiresAt).getTime()).toBeGreaterThan(Date.now());
        return {
          orderId: orderIds.orderId,
          ownerSegment: fulfillment.ownerSegment,
          privateExpiresAt: fulfillment.privateExpiresAt,
        };
      }),
    );
    const [missingSource, markerSource] = fixtures;
    if (!missingSource || !markerSource) throw new Error("Missing privacy backstop sources.");
    const staleUpdatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
    const missingPrivateKey = `order-private:${missingSource.ownerSegment}:${missingSource.orderId}`;
    const missingMarkerKey = `order-maintenance:${missingSource.ownerSegment}:${missingSource.orderId}`;
    const markerPrivateKey = `order-private:${markerSource.ownerSegment}:${markerSource.orderId}`;
    const futureMarkerKey = `order-maintenance:${markerSource.ownerSegment}:${markerSource.orderId}`;
    await Promise.all([
      db.delete(npPluginStorage).where(eq(npPluginStorage.key, missingMarkerKey)),
      db
        .update(npPluginStorage)
        .set({ updatedAt: staleUpdatedAt })
        .where(eq(npPluginStorage.key, missingPrivateKey)),
      db
        .update(npPluginStorage)
        .set({ updatedAt: staleUpdatedAt })
        .where(eq(npPluginStorage.key, futureMarkerKey)),
    ]);

    for (const key of [missingPrivateKey, markerPrivateKey, futureMarkerKey]) {
      const [row] = await db
        .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
        .from(npPluginStorage)
        .where(eq(npPluginStorage.key, key));
      expect(row?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
      expect(JSON.stringify(row?.value)).toContain(
        key.startsWith("order-private:") ? "expiresAt" : "dueAt",
      );
    }

    expect(await invokeAction(shop, "maintainOrders", undefined, context)).toMatchObject({
      ok: true,
      data: expect.stringContaining("deleted 2 overdue fulfillment"),
    });
    for (const source of fixtures) {
      const [orderRow, fulfillmentRow] = await Promise.all([
        db
          .select({ value: npPluginStorage.value })
          .from(npPluginStorage)
          .where(eq(npPluginStorage.key, `order:${source.ownerSegment}:${source.orderId}`))
          .then((rows) => rows[0]),
        db
          .select({ value: npPluginStorage.value })
          .from(npPluginStorage)
          .where(eq(npPluginStorage.key, `fulfillment:${source.orderId}`))
          .then((rows) => rows[0]),
      ]);
      expect(orderRow?.value).toMatchObject({ revision: 2, privateDataStatus: "redacted" });
      expect(fulfillmentRow?.value).toMatchObject({
        revision: 1,
        privateDataStatus: "redacted",
      });
      const keys = await storageKeysForOrder(source.orderId);
      expect(keys.some((key) => key.startsWith("order-private:"))).toBe(false);
      expect(keys.some((key) => key.startsWith("order-maintenance:"))).toBe(false);
    }
  });

  it("deletes due private PII without starvation from malformed maintenance state", async () => {
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "private-cleanup-fairness-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-private-cleanup-fairness@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };
    const malformedMarker = await prepareOutbound(shop, context);
    const missingMarker = await prepareOutbound(shop, context);
    const staleMarker = await prepareOutbound(shop, context);
    const malformedPrivate = await prepareOutbound(shop, context);
    const malformedFulfillment = await prepareOutbound(shop, context);
    const malformedPacking = await prepareOutbound(shop, context);
    const healthy = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(malformedPacking.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });

    const db = await getTestDb();
    const fixtures = [
      malformedMarker,
      missingMarker,
      staleMarker,
      malformedPrivate,
      malformedFulfillment,
      malformedPacking,
      healthy,
    ];
    const sources = await Promise.all(
      fixtures.map(async (fixture) => {
        const [fulfillmentRow] = await db
          .select({ value: npPluginStorage.value })
          .from(npPluginStorage)
          .where(eq(npPluginStorage.key, `fulfillment:${fixture.orderIds.orderId}`));
        const fulfillment = fulfillmentRow?.value as Record<string, unknown> | undefined;
        if (
          !fulfillment ||
          typeof fulfillment.ownerSegment !== "string" ||
          typeof fulfillment.privateExpiresAt !== "string"
        ) {
          throw new Error("Missing private cleanup fairness fulfillment source.");
        }
        return {
          orderId: fixture.orderIds.orderId,
          ownerSegment: fulfillment.ownerSegment,
          privateExpiresAt: fulfillment.privateExpiresAt,
          fulfillment,
        };
      }),
    );
    const sourceByOrderId = new Map(sources.map((source) => [source.orderId, source]));
    const requireSource = (orderId: string) => {
      const source = sourceByOrderId.get(orderId);
      if (!source) throw new Error("Missing private cleanup fairness source mapping.");
      return source;
    };
    const markerSource = requireSource(malformedMarker.orderIds.orderId);
    const missingMarkerSource = requireSource(missingMarker.orderIds.orderId);
    const staleMarkerSource = requireSource(staleMarker.orderIds.orderId);
    const privateSource = requireSource(malformedPrivate.orderIds.orderId);
    const fulfillmentSource = requireSource(malformedFulfillment.orderIds.orderId);
    const packingSource = requireSource(malformedPacking.orderIds.orderId);

    const markerKey = `order-maintenance:${markerSource.ownerSegment}:${markerSource.orderId}`;
    const missingMarkerKey = `order-maintenance:${missingMarkerSource.ownerSegment}:${missingMarkerSource.orderId}`;
    const staleMarkerKey = `order-maintenance:${staleMarkerSource.ownerSegment}:${staleMarkerSource.orderId}`;
    const privateKey = `order-private:${privateSource.ownerSegment}:${privateSource.orderId}`;
    await db
      .update(npPluginStorage)
      .set({ value: { malformed: "maintenance-marker" } })
      .where(eq(npPluginStorage.key, markerKey));
    await db.delete(npPluginStorage).where(eq(npPluginStorage.key, missingMarkerKey));
    const staleMarkerDueAt = new Date(
      new Date(staleMarkerSource.privateExpiresAt).getTime() + 7 * 24 * 60 * 60 * 1_000,
    );
    const [staleMarkerRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, staleMarkerKey));
    await db
      .update(npPluginStorage)
      .set({
        value: {
          ...(staleMarkerRow?.value as Record<string, unknown>),
          dueAt: staleMarkerDueAt.toISOString(),
        },
        expiresAt: staleMarkerDueAt,
      })
      .where(eq(npPluginStorage.key, staleMarkerKey));
    const [privateRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(eq(npPluginStorage.key, privateKey));
    await db
      .update(npPluginStorage)
      .set({
        value: {
          ...(privateRow?.value as Record<string, unknown>),
          malformed: "private-sidecar",
        },
      })
      .where(eq(npPluginStorage.key, privateKey));
    await db
      .update(npPluginStorage)
      .set({
        value: {
          ...fulfillmentSource.fulfillment,
          malformed: "fulfillment-source",
        },
      })
      .where(eq(npPluginStorage.key, `fulfillment:${fulfillmentSource.orderId}`));
    const malformedWork = await readPackingWork(packingSource.orderId);
    await db
      .update(npPluginStorage)
      .set({ value: { ...malformedWork, malformed: "packing-work" } })
      .where(eq(npPluginStorage.key, `packing-work:outbound:${packingSource.orderId}`));

    const latestPrivateExpiry = Math.max(
      ...sources.map((source) => new Date(source.privateExpiresAt).getTime()),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(latestPrivateExpiry + 1);
    try {
      expect(await invokeAction(shop, "maintainOrders", undefined, context)).toMatchObject({
        ok: true,
        data: expect.stringContaining("deleted 6 overdue fulfillment"),
      });
      for (const source of sources) {
        const keys = await storageKeysForOrder(source.orderId);
        expect(keys.some((key) => key.startsWith("order-private:"))).toBe(false);
        expect(keys.some((key) => key.startsWith("order-maintenance:"))).toBe(false);
      }
      const healthySource = requireSource(healthy.orderIds.orderId);
      const [healthyOrderRow, healthyFulfillmentRow] = await Promise.all([
        db
          .select({ value: npPluginStorage.value })
          .from(npPluginStorage)
          .where(
            eq(npPluginStorage.key, `order:${healthySource.ownerSegment}:${healthySource.orderId}`),
          )
          .then((rows) => rows[0]),
        db
          .select({ value: npPluginStorage.value })
          .from(npPluginStorage)
          .where(eq(npPluginStorage.key, `fulfillment:${healthySource.orderId}`))
          .then((rows) => rows[0]),
      ]);
      expect(healthyOrderRow?.value).toMatchObject({
        revision: 2,
        privateDataStatus: "redacted",
      });
      expect(healthyFulfillmentRow?.value).toMatchObject({
        revision: 2,
        privateDataStatus: "redacted",
      });
      for (const source of [missingMarkerSource, staleMarkerSource]) {
        const [orderRow, fulfillmentRow] = await Promise.all([
          db
            .select({ value: npPluginStorage.value })
            .from(npPluginStorage)
            .where(eq(npPluginStorage.key, `order:${source.ownerSegment}:${source.orderId}`))
            .then((rows) => rows[0]),
          db
            .select({ value: npPluginStorage.value })
            .from(npPluginStorage)
            .where(eq(npPluginStorage.key, `fulfillment:${source.orderId}`))
            .then((rows) => rows[0]),
        ]);
        expect(orderRow?.value).toMatchObject({ revision: 2, privateDataStatus: "redacted" });
        expect(fulfillmentRow?.value).toMatchObject({
          revision: 2,
          privateDataStatus: "redacted",
        });
      }
      const allRows = await db
        .select({ key: npPluginStorage.key, value: npPluginStorage.value })
        .from(npPluginStorage)
        .where(and(eq(npPluginStorage.pluginId, "shop"), eq(npPluginStorage.siteId, "default")));
      const fixtureIds = new Set(sources.map((source) => source.orderId));
      const fixtureRows = allRows.filter((row) => {
        const serialized = JSON.stringify(row.value);
        return [...fixtureIds].some(
          (orderId) => row.key.includes(orderId) || serialized.includes(orderId),
        );
      });
      expect(JSON.stringify(fixtureRows)).not.toMatch(
        /packing-private@example\.com|홍길동|010-1234-5678|세종대로/u,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves malformed terminal-looking work without starving valid commercial cleanup", async () => {
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "malformed-retention-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-malformed-retention@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };

    const malformed = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(malformed.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const malformedActive = await readPackingWork(malformed.orderIds.orderId);
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(malformedActive), context),
    ).toMatchObject({ ok: true });

    const healthy = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(healthy.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const healthyActive = await readPackingWork(healthy.orderIds.orderId);
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(healthyActive), context),
    ).toMatchObject({ ok: true });

    await expireCommercialRows(malformed.orderIds.orderId);
    await expireCommercialRows(healthy.orderIds.orderId);
    const malformedWork = await readPackingWork(malformed.orderIds.orderId);
    const canonicalMalformedKey = `packing-work:outbound:${malformed.orderIds.orderId}`;
    const malformedKey = `packing-work:outbound:${randomUUID()}`;
    const db = await getTestDb();
    await db
      .update(npPluginStorage)
      .set({
        key: malformedKey,
        value: { ...malformedWork, cancellationId: null },
        updatedAt: new Date("2000-01-01T00:00:00.000Z"),
      })
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, canonicalMalformedKey),
        ),
      );

    const maintenanceMessages: string[] = [];
    const malformedKeysAfterMaintenance: string[][] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await invokeAction(shop, "maintainOrders", undefined, context);
      expect(result).toMatchObject({ ok: true, data: expect.stringContaining("purged") });
      maintenanceMessages.push((result as { data: string }).data);
      malformedKeysAfterMaintenance.push(await storageKeysForOrder(malformed.orderIds.orderId));
    }
    const purged = maintenanceMessages.reduce((total, message) => {
      const match = /purged (\d+) expired commercial snapshot/u.exec(message);
      if (!match) throw new Error(`Missing purge count in maintenance result: ${message}`);
      return total + Number(match[1]);
    }, 0);
    expect({ purged, malformedKeysAfterMaintenance }).toEqual({
      purged: 1,
      malformedKeysAfterMaintenance: [
        expect.arrayContaining([expect.stringContaining("order:"), malformedKey]),
        expect.arrayContaining([expect.stringContaining("order:"), malformedKey]),
      ],
    });

    expect(await storageKeysForOrder(healthy.orderIds.orderId)).toEqual([]);
    expect(await storageKeysForOrder(malformed.orderIds.orderId)).toEqual(
      expect.arrayContaining([expect.stringContaining("order:"), malformedKey]),
    );
    const [retainedMalformedRow] = await db
      .select({ value: npPluginStorage.value })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          eq(npPluginStorage.key, malformedKey),
        ),
      );
    expect(retainedMalformedRow?.value).toMatchObject({
      contract: "np.shop-packing-work-storage.v1",
      orderId: malformed.orderIds.orderId,
      status: "cancelled",
      cancellationId: null,
    });
  });

  it("reserves commercial cleanup capacity behind a terminal packing backlog", async () => {
    const shop = createShop({
      payment: { adapter: paymentAdapter() },
      packing: {
        adapter: {
          id: "cleanup-fairness-packing",
          createPackingWork: (request) =>
            npCreateShopPackingWorkCreateResult(request, {
              providerWorkReference: `provider_${request.workId}`,
              confirmedAt: request.requestedAt,
            }),
          cancelPackingWork: (request) =>
            npCreateShopPackingWorkCancelResult(request, {
              cancelledAt: request.requestedAt,
            }),
        },
      },
    });
    const staff = await seedUser({ email: "packing-cleanup-fairness@example.com" });
    const context = { actionInvocation: { kind: "staff" as const, userId: staff.userId } };

    const templateOrder = await prepareOutbound(shop, context);
    expect(
      await invokeAction(
        shop,
        "createFulfillmentPackingWork",
        createInput(templateOrder.orderIds.orderId),
        context,
      ),
    ).toMatchObject({ ok: true });
    const active = await readPackingWork(templateOrder.orderIds.orderId);
    expect(
      await invokeAction(shop, "cancelPackingWork", existingInput(active), context),
    ).toMatchObject({ ok: true });
    const cancelledTemplate = shiftIsoDates(
      await readPackingWork(templateOrder.orderIds.orderId),
      -366 * 24 * 60 * 60 * 1_000,
    ) as NpShopStoredPackingWork;

    const ordinary = await prepareOutbound(shop, context);
    await expireCommercialRows(ordinary.orderIds.orderId);
    const backlog = Array.from({ length: 251 }, () => {
      const orderId = randomUUID();
      const work = {
        ...cancelledTemplate,
        workId: randomUUID(),
        orderId,
      } satisfies NpShopStoredPackingWork;
      return {
        pluginId: "shop",
        siteId: "default",
        key: `packing-work:outbound:${orderId}`,
        value: work,
        expiresAt: new Date(work.purgeAt),
        updatedAt: new Date(work.updatedAt),
      };
    });
    const db = await getTestDb();
    await db.insert(npPluginStorage).values(backlog);

    expect(await invokeAction(shop, "maintainOrders", undefined, context)).toMatchObject({
      ok: true,
      data: expect.stringContaining("purged 1 expired commercial snapshot"),
    });
    expect(await storageKeysForOrder(ordinary.orderIds.orderId)).toEqual([]);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, "shop"),
          eq(npPluginStorage.siteId, "default"),
          like(npPluginStorage.key, "packing-work:outbound:%"),
          sql`${npPluginStorage.value}->>'providerId' = 'cleanup-fairness-packing'`,
          sql`${npPluginStorage.value}->>'orderId' <> ${templateOrder.orderIds.orderId}`,
        ),
      );
    expect(count).toBe(251);
  });
});
