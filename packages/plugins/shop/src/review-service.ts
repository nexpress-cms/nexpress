import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getMemberProfiles } from "@nexpress/core/community";
import {
  createMemberDocument,
  deleteMemberDocument,
  getCollectionRegistration,
  promoteMemberDocument,
  unpublishDocumentForModeration,
  updateMemberDocument,
} from "@nexpress/core/collections";
import { getDb, npPluginStorage, npUsers } from "@nexpress/core/db";
import { getMediaById, getMediaUrl } from "@nexpress/core/media";
import { canOnSite, requireSiteId, resolveSiteAuthUser } from "@nexpress/core/sites";
import { and, desc, eq, getTableColumns, inArray, like, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { npRequireStoredShopFulfillment } from "./fulfillment-contract.js";
import { npRequireStoredShopOrder, type NpShopStoredOrder } from "./order-contract.js";
import {
  NP_SHOP_PRODUCT_REVIEW_CONTRACT,
  NP_SHOP_PRODUCT_REVIEW_PAGE_CONTRACT,
  NpShopProductReviewContractError,
  npEmptyShopProductReviewAggregate,
  npShopProductReviewLimits,
  type NpShopProductReview,
  type NpShopProductReviewAggregate,
  type NpShopProductReviewCreateInput,
  type NpShopProductReviewEligibility,
  type NpShopProductReviewPage,
  type NpShopProductReviewUpdateInput,
} from "./review-contract.js";
import { NP_SHOP_PLUGIN_ID } from "./order-draft-service.js";
import type { NpShopRuntime } from "./runtime.js";
import type { NpShopProductSummary } from "./types.js";

interface ReviewTokenPayload {
  memberId: string;
  orderId: string;
  lineKey: string;
  productId: string;
  issuedAt: number;
  expiresAt: number;
}

interface ReviewRow {
  id: string;
  productId: string;
  purchaseKey: string;
  rating: number;
  title: string;
  body: string;
  verifiedPurchase: boolean;
  moderationHidden: boolean;
  status: string;
  memberAuthorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function secret(): string {
  const value = process.env.NP_SECRET;
  if (!value || value.length < 32) {
    throw new Error("NP_SECRET must contain at least 32 characters for Shop review eligibility.");
  }
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(`shop-review:${payload}`).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function encodeToken(payload: ReviewTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

function decodeToken(value: string): ReviewTokenPayload {
  const separator = value.indexOf(".");
  if (
    separator < 1 ||
    !safeEqual(value.slice(separator + 1), signature(value.slice(0, separator)))
  ) {
    throw new NpShopProductReviewContractError("Invalid review eligibility", [
      "The purchase token is invalid or has been altered.",
    ]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value.slice(0, separator), "base64url").toString("utf8"));
  } catch {
    parsed = null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 6
  ) {
    throw new NpShopProductReviewContractError("Invalid review eligibility", [
      "The purchase token payload is malformed.",
    ]);
  }
  const payload = parsed as Partial<ReviewTokenPayload>;
  if (
    typeof payload.memberId !== "string" ||
    typeof payload.orderId !== "string" ||
    typeof payload.lineKey !== "string" ||
    typeof payload.productId !== "string" ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    (payload.expiresAt as number) <= Date.now()
  ) {
    throw new NpShopProductReviewContractError("Invalid review eligibility", [
      "The purchase token is malformed or expired.",
    ]);
  }
  return payload as ReviewTokenPayload;
}

function purchaseKey(
  payload: Pick<ReviewTokenPayload, "memberId" | "orderId" | "lineKey">,
): string {
  return createHash("sha256")
    .update(`${payload.memberId}:${payload.orderId}:${payload.lineKey}`)
    .digest("hex");
}

function tableAndColumns(runtime: NpShopRuntime): {
  table: PgTable;
  columns: Record<string, PgColumn>;
} {
  const table = getCollectionRegistration(runtime.collections.reviews).table as PgTable;
  return { table, columns: getTableColumns(table) };
}

async function readEligibleOrders(memberId: string): Promise<NpShopStoredOrder[]> {
  const siteId = await requireSiteId();
  const rows = await getDb()
    .select({ value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `order:member:${memberId}:%`),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopProductReviewLimits.eligibilityOrderLimit);
  const orders: NpShopStoredOrder[] = [];
  for (const row of rows) {
    try {
      const order = npRequireStoredShopOrder(row.value);
      if (
        order.ownerSegment === `member:${memberId}` &&
        ["paid", "refunded"].includes(order.status)
      ) {
        orders.push(order);
      }
    } catch {
      // Malformed order storage is reported by the existing Shop Doctor contract.
    }
  }
  return orders;
}

async function shippedOrderIds(orders: NpShopStoredOrder[]): Promise<Set<string>> {
  if (orders.length === 0) return new Set();
  const siteId = await requireSiteId();
  const rows = await getDb()
    .select({ value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        inArray(
          npPluginStorage.key,
          orders.map((order) => `fulfillment:${order.id}`),
        ),
      ),
    );
  const ids = new Set<string>();
  for (const row of rows) {
    try {
      const fulfillment = npRequireStoredShopFulfillment(row.value);
      if (fulfillment.status === "shipped") ids.add(fulfillment.orderId);
    } catch {
      // Existing fulfillment diagnostics own malformed storage reporting.
    }
  }
  return ids;
}

async function usedPurchaseKeys(
  runtime: NpShopRuntime,
  candidates: string[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const siteId = await requireSiteId();
  const { table, columns } = tableAndColumns(runtime);
  const rows = await getDb()
    .select({ purchaseKey: columns.purchaseKey })
    .from(table)
    .where(and(eq(columns.siteId, siteId), inArray(columns.purchaseKey, candidates)));
  return new Set(
    rows
      .map((row) => row.purchaseKey)
      .filter((value): value is string => typeof value === "string"),
  );
}

export async function npListShopProductReviewEligibility(
  runtime: NpShopRuntime,
  memberId: string,
  productId: string,
): Promise<NpShopProductReviewEligibility[]> {
  const orders = await readEligibleOrders(memberId);
  const shipped = await shippedOrderIds(orders);
  const now = Date.now();
  const candidates: Array<{
    key: string;
    payload: ReviewTokenPayload;
    variantName: string | null;
    purchasedAt: string;
  }> = [];
  for (const order of orders) {
    if (!shipped.has(order.id)) continue;
    for (const line of order.lines) {
      if (line.productId !== productId) continue;
      const payload: ReviewTokenPayload = {
        memberId,
        orderId: order.id,
        lineKey: line.key,
        productId,
        issuedAt: now,
        expiresAt: now + npShopProductReviewLimits.tokenTtlSeconds * 1_000,
      };
      candidates.push({
        key: purchaseKey(payload),
        payload,
        variantName: line.variantName,
        purchasedAt: order.paymentResolvedAt ?? order.updatedAt,
      });
    }
  }
  const used = await usedPurchaseKeys(
    runtime,
    candidates.map((candidate) => candidate.key),
  );
  return candidates
    .flatMap((candidate) =>
      used.has(candidate.key)
        ? []
        : [
            {
              purchaseToken: encodeToken(candidate.payload),
              variantName: candidate.variantName,
              purchasedAt: candidate.purchasedAt,
            },
          ],
    )
    .slice(0, npShopProductReviewLimits.maximumEligibility);
}

async function validatePurchase(
  runtime: NpShopRuntime,
  memberId: string,
  productId: string,
  token: string,
): Promise<string> {
  const payload = decodeToken(token);
  if (payload.memberId !== memberId || payload.productId !== productId) {
    throw new NpShopProductReviewContractError("Invalid review eligibility", [
      "The purchase token does not belong to this member and product.",
    ]);
  }
  const orders = await readEligibleOrders(memberId);
  const order = orders.find((candidate) => candidate.id === payload.orderId);
  const shipped = order ? await shippedOrderIds([order]) : new Set<string>();
  if (
    !order ||
    !shipped.has(order.id) ||
    !order.lines.some((line) => line.key === payload.lineKey && line.productId === productId)
  ) {
    throw new NpShopProductReviewContractError("Invalid review eligibility", [
      "The shipped purchase is no longer eligible for review.",
    ]);
  }
  const key = purchaseKey(payload);
  if ((await usedPurchaseKeys(runtime, [key])).has(key)) {
    throw new NpShopProductReviewContractError("Duplicate product review", [
      "This purchased item already has a review.",
    ]);
  }
  return key;
}

async function validatePhotos(ids: string[], memberId: string): Promise<void> {
  const records = await Promise.all(ids.map((id) => getMediaById(id)));
  for (const [index, media] of records.entries()) {
    if (
      !media ||
      media.status !== "ready" ||
      !media.mimeType.startsWith("image/") ||
      media.uploadedByMemberId !== memberId
    ) {
      throw new NpShopProductReviewContractError("Invalid review photo", [
        `review.photos.${index.toString()} must be a ready image uploaded by this member.`,
      ]);
    }
  }
}

export function npPrepareShopProductReviewCreate(
  input: NpShopProductReviewCreateInput,
): Record<string, unknown> {
  return {
    product: input.productId,
    purchaseKey: input.purchaseToken,
    rating: input.rating,
    title: input.title,
    body: input.body,
    photos: input.photos.map((file) => ({ file })),
  };
}

export async function npCreateShopProductReview(
  runtime: NpShopRuntime,
  memberId: string,
  input: NpShopProductReviewCreateInput,
): Promise<void> {
  await createMemberDocument(
    runtime.collections.reviews,
    npPrepareShopProductReviewCreate(input),
    memberId,
  );
}

function photoIdsFromDocument(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    typeof (entry as { file?: unknown }).file === "string"
      ? [(entry as { file: string }).file]
      : [],
  );
}

export async function npValidateShopProductReviewCreateDocument(
  runtime: NpShopRuntime,
  memberId: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (typeof data.product !== "string" || typeof data.purchaseKey !== "string") {
    throw new NpShopProductReviewContractError("Invalid product review", [
      "A product and purchase token are required.",
    ]);
  }
  const photos = photoIdsFromDocument(data.photos);
  const [key] = await Promise.all([
    validatePurchase(runtime, memberId, data.product, data.purchaseKey),
    validatePhotos(photos, memberId),
  ]);
  return { ...data, purchaseKey: key, verifiedPurchase: true, moderationHidden: false };
}

export async function npValidateShopProductReviewUpdateDocument(
  memberId: string,
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await validatePhotos(photoIdsFromDocument(data.photos), memberId);
  return {
    ...data,
    product: originalDoc.product,
    purchaseKey: originalDoc.purchaseKey,
    verifiedPurchase: true,
    moderationHidden: originalDoc.moderationHidden === true,
  };
}

export async function npUpdateShopProductReview(
  runtime: NpShopRuntime,
  memberId: string,
  input: NpShopProductReviewUpdateInput,
): Promise<void> {
  await updateMemberDocument(
    runtime.collections.reviews,
    input.reviewId,
    {
      rating: input.rating,
      title: input.title,
      body: input.body,
      photos: input.photos.map((file) => ({ file })),
    },
    memberId,
  );
}

export async function npDeleteShopProductReview(
  runtime: NpShopRuntime,
  memberId: string,
  reviewId: string,
): Promise<void> {
  await deleteMemberDocument(runtime.collections.reviews, reviewId, memberId);
}

function requireColumn(columns: Record<string, PgColumn>, name: string): PgColumn {
  const column = columns[name];
  if (!column) throw new Error(`Shop reviews collection is missing the ${name} column.`);
  return column;
}

function publicReviewConditions(columns: Record<string, PgColumn>): SQL[] {
  const rating = requireColumn(columns, "rating");
  const title = requireColumn(columns, "title");
  const body = requireColumn(columns, "body");
  const purchaseKeyColumn = requireColumn(columns, "purchaseKey");
  return [
    eq(requireColumn(columns, "status"), "published"),
    eq(requireColumn(columns, "moderationHidden"), false),
    eq(requireColumn(columns, "verifiedPurchase"), true),
    sql`${rating} between 1 and 5`,
    sql`char_length(${title}) between 1 and ${npShopProductReviewLimits.maximumTitleLength}`,
    sql`char_length(btrim(${title})) >= 1`,
    sql`char_length(${body}) between 1 and ${npShopProductReviewLimits.maximumBodyLength}`,
    sql`char_length(btrim(${body})) >= 1`,
    sql`${purchaseKeyColumn} ~ '^[0-9a-f]{64}$'`,
  ];
}

export async function npReadShopProductReviewAggregate(
  runtime: NpShopRuntime,
  productId: string,
): Promise<NpShopProductReviewAggregate> {
  const siteId = await requireSiteId();
  const { table, columns } = tableAndColumns(runtime);
  const rating = requireColumn(columns, "rating");
  const predicates = and(
    eq(requireColumn(columns, "siteId"), siteId),
    eq(requireColumn(columns, "product"), productId),
    ...publicReviewConditions(columns),
  );
  const [row] = await getDb()
    .select({
      count: sql<number>`count(*)::int`,
      ratingTotal: sql<number>`coalesce(sum(${rating}), 0)::int`,
      one: sql<number>`count(*) filter (where ${rating} = 1)::int`,
      two: sql<number>`count(*) filter (where ${rating} = 2)::int`,
      three: sql<number>`count(*) filter (where ${rating} = 3)::int`,
      four: sql<number>`count(*) filter (where ${rating} = 4)::int`,
      five: sql<number>`count(*) filter (where ${rating} = 5)::int`,
    })
    .from(table)
    .where(predicates);
  if (!row || row.count === 0) return npEmptyShopProductReviewAggregate();
  return {
    count: row.count,
    ratingTotal: row.ratingTotal,
    averageRatingBasisPoints: Math.round((row.ratingTotal * 1_000) / row.count),
    distribution: { 1: row.one, 2: row.two, 3: row.three, 4: row.four, 5: row.five },
  };
}

export async function npAttachShopProductReviewAggregates<T extends NpShopProductSummary>(
  runtime: NpShopRuntime,
  products: T[],
): Promise<T[]> {
  if (products.length === 0) return products;
  const siteId = await requireSiteId();
  const { table, columns } = tableAndColumns(runtime);
  const product = requireColumn(columns, "product");
  const rating = requireColumn(columns, "rating");
  const rows = await getDb()
    .select({
      productId: product,
      count: sql<number>`count(*)::int`,
      ratingTotal: sql<number>`coalesce(sum(${rating}), 0)::int`,
    })
    .from(table)
    .where(
      and(
        eq(requireColumn(columns, "siteId"), siteId),
        inArray(
          product,
          products.map((entry) => entry.id),
        ),
        ...publicReviewConditions(columns),
      ),
    )
    .groupBy(product);
  const byProduct = new Map(
    rows.flatMap((row) =>
      typeof row.productId === "string"
        ? [[row.productId, { count: row.count, total: row.ratingTotal }] as const]
        : [],
    ),
  );
  return products.map((entry) => {
    const aggregate = byProduct.get(entry.id);
    return {
      ...entry,
      reviewCount: aggregate?.count ?? 0,
      reviewAverageBasisPoints:
        aggregate && aggregate.count > 0
          ? Math.round((aggregate.total * 1_000) / aggregate.count)
          : 0,
    };
  });
}

export async function npCountShopProductReviewRows(
  runtime: NpShopRuntime,
  productId?: string,
): Promise<number> {
  const siteId = await requireSiteId();
  const { table, columns } = tableAndColumns(runtime);
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(
      and(
        eq(requireColumn(columns, "siteId"), siteId),
        productId ? eq(requireColumn(columns, "product"), productId) : undefined,
      ),
    );
  return row?.count ?? 0;
}

export interface NpShopProductReviewHealth {
  total: number;
  published: number;
  pending: number;
  hidden: number;
  invalid: number;
}

export async function npInspectShopProductReviews(
  runtime: NpShopRuntime,
): Promise<NpShopProductReviewHealth> {
  const siteId = await requireSiteId();
  const { table, columns } = tableAndColumns(runtime);
  const status = requireColumn(columns, "status");
  const hidden = requireColumn(columns, "moderationHidden");
  const rating = requireColumn(columns, "rating");
  const verified = requireColumn(columns, "verifiedPurchase");
  const purchaseKeyColumn = requireColumn(columns, "purchaseKey");
  const title = requireColumn(columns, "title");
  const body = requireColumn(columns, "body");
  const [row] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${status} = 'published' and ${hidden} = false)::int`,
      pending: sql<number>`count(*) filter (where ${status} = 'pending')::int`,
      hidden: sql<number>`count(*) filter (where ${hidden} = true)::int`,
      invalid: sql<number>`count(*) filter (where ${rating} < 1 or ${rating} > 5 or ${verified} <> true or ${purchaseKeyColumn} !~ '^[0-9a-f]{64}$' or char_length(btrim(${title})) < 1 or char_length(${title}) > ${npShopProductReviewLimits.maximumTitleLength} or char_length(btrim(${body})) < 1 or char_length(${body}) > ${npShopProductReviewLimits.maximumBodyLength})::int`,
    })
    .from(table)
    .where(eq(requireColumn(columns, "siteId"), siteId));
  return row ?? { total: 0, published: 0, pending: 0, hidden: 0, invalid: 0 };
}

export async function npListRecentShopProductReviews(
  runtime: NpShopRuntime,
): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  const siteId = await requireSiteId();
  const { table, columns } = tableAndColumns(runtime);
  const [rows, health] = await Promise.all([
    getDb()
      .select({
        id: requireColumn(columns, "id"),
        productId: requireColumn(columns, "product"),
        title: requireColumn(columns, "title"),
        rating: requireColumn(columns, "rating"),
        status: requireColumn(columns, "status"),
        moderationHidden: requireColumn(columns, "moderationHidden"),
        updatedAt: requireColumn(columns, "updatedAt"),
      })
      .from(table)
      .where(eq(requireColumn(columns, "siteId"), siteId))
      .orderBy(desc(requireColumn(columns, "updatedAt")))
      .limit(50),
    npInspectShopProductReviews(runtime),
  ]);
  return {
    rows: rows.map((row) => ({
      ...row,
      state: row.moderationHidden === true ? "hidden" : row.status,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    })),
    total: health.total,
  };
}

async function resolveReviewStaff(userId: string) {
  const [row] = await getDb()
    .select({
      id: npUsers.id,
      email: npUsers.email,
      name: npUsers.name,
      role: npUsers.role,
      tokenVersion: npUsers.tokenVersion,
    })
    .from(npUsers)
    .where(eq(npUsers.id, userId))
    .limit(1);
  if (!row) throw new Error("The direct staff actor no longer exists.");
  const user = await resolveSiteAuthUser(row);
  if (!user) throw new Error("The direct staff actor has no access to this site.");
  if (!(await canOnSite(row, "community.moderate"))) {
    throw new Error("The direct staff actor cannot moderate community documents on this site.");
  }
  return user;
}

export async function npHideShopProductReview(
  runtime: NpShopRuntime,
  reviewId: string,
  reason: string,
  userId: string,
): Promise<void> {
  await unpublishDocumentForModeration(
    runtime.collections.reviews,
    reviewId,
    await resolveReviewStaff(userId),
    reason,
  );
}

export async function npRestoreShopProductReview(
  runtime: NpShopRuntime,
  reviewId: string,
  userId: string,
): Promise<void> {
  await resolveReviewStaff(userId);
  await promoteMemberDocument(runtime.collections.reviews, reviewId, userId);
}

async function readReviewPhotos(
  runtime: NpShopRuntime,
  reviewIds: string[],
): Promise<Map<string, string[]>> {
  if (reviewIds.length === 0) return new Map();
  const registration = getCollectionRegistration(runtime.collections.reviews);
  const table = registration.childTables?.photos as PgTable | undefined;
  if (!table) throw new Error("Shop reviews photos table is not registered.");
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const rows = await getDb()
    .select({
      parentId: requireColumn(columns, "parentId"),
      file: requireColumn(columns, "file"),
      order: requireColumn(columns, "order"),
    })
    .from(table)
    .where(inArray(requireColumn(columns, "parentId"), reviewIds))
    .orderBy(requireColumn(columns, "order"));
  const result = new Map<string, string[]>();
  for (const row of rows) {
    if (typeof row.parentId !== "string" || typeof row.file !== "string") continue;
    result.set(row.parentId, [...(result.get(row.parentId) ?? []), row.file]);
  }
  return result;
}

async function safeReviewPhotoUrl(id: string): Promise<string | null> {
  try {
    return await getMediaUrl(id, { variant: "medium" });
  } catch {
    return null;
  }
}

export async function npListShopProductReviews(
  runtime: NpShopRuntime,
  productId: string,
  viewerMemberId: string | null,
  page: number,
): Promise<Omit<NpShopProductReviewPage, "eligibility">> {
  const normalizedPage = Number.isSafeInteger(page)
    ? Math.min(Math.max(page, 1), npShopProductReviewLimits.maximumPage)
    : 1;
  const siteId = await requireSiteId();
  const { table, columns } = tableAndColumns(runtime);
  const predicates = and(
    eq(requireColumn(columns, "siteId"), siteId),
    eq(requireColumn(columns, "product"), productId),
    ...publicReviewConditions(columns),
  );
  const [rows, aggregate] = await Promise.all([
    getDb()
      .select({
        id: requireColumn(columns, "id"),
        productId: requireColumn(columns, "product"),
        rating: requireColumn(columns, "rating"),
        title: requireColumn(columns, "title"),
        body: requireColumn(columns, "body"),
        memberAuthorId: requireColumn(columns, "memberAuthorId"),
        createdAt: requireColumn(columns, "createdAt"),
        updatedAt: requireColumn(columns, "updatedAt"),
      })
      .from(table)
      .where(predicates)
      .orderBy(desc(requireColumn(columns, "createdAt")), desc(requireColumn(columns, "id")))
      .limit(npShopProductReviewLimits.pageSize)
      .offset((normalizedPage - 1) * npShopProductReviewLimits.pageSize),
    npReadShopProductReviewAggregate(runtime, productId),
  ]);
  const typedRows = rows as unknown as Array<
    Pick<
      ReviewRow,
      | "id"
      | "productId"
      | "rating"
      | "title"
      | "body"
      | "memberAuthorId"
      | "createdAt"
      | "updatedAt"
    >
  >;
  const [photos, profiles] = await Promise.all([
    readReviewPhotos(
      runtime,
      typedRows.map((row) => row.id),
    ),
    getMemberProfiles(typedRows.flatMap((row) => (row.memberAuthorId ? [row.memberAuthorId] : []))),
  ]);
  const reviews: NpShopProductReview[] = await Promise.all(
    typedRows.map(async (row) => {
      const profile = row.memberAuthorId ? profiles.get(row.memberAuthorId) : null;
      const photoIds = photos.get(row.id) ?? [];
      return {
        contract: NP_SHOP_PRODUCT_REVIEW_CONTRACT,
        id: row.id,
        productId: row.productId,
        rating: row.rating,
        title: row.title,
        body: row.body,
        photos: (
          await Promise.all(photoIds.map(async (id) => ({ id, url: await safeReviewPhotoUrl(id) })))
        ).filter((photo): photo is { id: string; url: string } => photo.url !== null),
        verifiedPurchase: true,
        author: profile
          ? {
              displayName: profile.displayName,
              handle: profile.handle,
              avatarUrl: profile.avatarUrl,
            }
          : null,
        ownedByViewer: viewerMemberId !== null && row.memberAuthorId === viewerMemberId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
  );
  return {
    contract: NP_SHOP_PRODUCT_REVIEW_PAGE_CONTRACT,
    reviews,
    aggregate,
    page: normalizedPage,
    totalPages: Math.max(1, Math.ceil(aggregate.count / npShopProductReviewLimits.pageSize)),
    totalReviews: aggregate.count,
  };
}

export async function npGetShopProductReviewPage(
  runtime: NpShopRuntime,
  productId: string,
  memberId: string | null,
  page: number,
): Promise<NpShopProductReviewPage> {
  const [listed, eligibility] = await Promise.all([
    npListShopProductReviews(runtime, productId, memberId, page),
    memberId ? npListShopProductReviewEligibility(runtime, memberId, productId) : [],
  ]);
  return { ...listed, eligibility };
}
