import { createHash } from "node:crypto";

import { findDocuments } from "@nexpress/core/collections";
import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, eq, like, lt, sql } from "drizzle-orm";

import {
  NP_SHOP_CART_QUOTE_CONTRACT,
  NP_SHOP_CART_READD_CONTRACT,
  NP_SHOP_CART_STORAGE_CONTRACT,
  NpShopCartContractError,
  npRequireShopCartReAddResult,
  npRequireShopCartStorageValue,
  npShopCartLimits,
  npShopCartLineKey,
  type NpShopCartReAddInput,
  type NpShopCartReAddIssueCode,
  type NpShopCartReAddLineResult,
  type NpShopCartReAddResult,
  type NpShopCartStorageValue,
  type NpShopCartStoredLine,
} from "./cart-contract.js";
import { npGetShopReservedQuantities } from "./inventory-reservation-service.js";
import { npShopInventoryStockKey } from "./inventory-reservation-contract.js";
import {
  listShopPromotions,
  normalizeShopProduct,
  type NpShopRuntime,
  type ShopProductDocument,
} from "./runtime.js";
import {
  NP_SHOP_PROMOTION_SNAPSHOT_CONTRACT,
  npEvaluateShopPromotions,
} from "./promotion-contract.js";
import { npFindUnavailableShopPromotions } from "./promotion-service.js";
import type {
  NpShopCartIssueCode,
  NpShopCartLine,
  NpShopCartQuote,
  NpShopProduct,
} from "./types.js";

const SHOP_PLUGIN_ID = "shop";
const BLOCKING_ISSUES = new Set<NpShopCartIssueCode>([
  "product-unavailable",
  "variant-required",
  "variant-unavailable",
  "insufficient-stock",
  "mixed-currency",
]);

export type NpShopCartOwner =
  { kind: "guest"; idHash: string } | { kind: "member"; memberId: string };

export class NpShopCartRevisionError extends Error {
  readonly actualRevision: number;

  constructor(actualRevision: number) {
    super("The cart changed in another request. Refresh it and try again.");
    this.name = "NpShopCartRevisionError";
    this.actualRevision = actualRevision;
  }
}

export function npShopCartOwnerStorageSegment(owner: NpShopCartOwner): string {
  return owner.kind === "member" ? `member:${owner.memberId}` : `guest:${owner.idHash}`;
}

function storageKey(owner: NpShopCartOwner): string {
  return `cart:${npShopCartOwnerStorageSegment(owner)}`;
}

function ownerTtlSeconds(owner: NpShopCartOwner): number {
  return owner.kind === "member"
    ? npShopCartLimits.memberTtlSeconds
    : npShopCartLimits.guestTtlSeconds;
}

function expiresAt(owner: NpShopCartOwner, now: Date): Date {
  return new Date(now.getTime() + ownerTtlSeconds(owner) * 1_000);
}

export function npEmptyShopCartQuote(): NpShopCartQuote {
  return {
    contract: NP_SHOP_CART_QUOTE_CONTRACT,
    revision: 0,
    lines: [],
    promotions: {
      contract: NP_SHOP_PROMOTION_SNAPSHOT_CONTRACT,
      couponCodes: [],
      rejectedCouponCodes: [],
      applied: [],
      discountMinor: 0,
    },
    totals: [],
    totalUnits: 0,
    ready: false,
    issues: [],
    fingerprint: createHash("sha256").update("[]").digest("hex"),
    updatedAt: null,
  };
}

async function readStoredCart(
  siteId: string,
  owner: NpShopCartOwner,
): Promise<NpShopCartStorageValue | null> {
  const db = getDb();
  const [row] = await db
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, storageKey(owner)),
      ),
    )
    .limit(1);
  if (!row || (row.expiresAt !== null && row.expiresAt <= new Date())) return null;
  return npRequireShopCartStorageValue(row.value);
}

export async function npLockShopCart(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  siteId: string,
  owner: NpShopCartOwner,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-cart:${siteId}:${storageKey(owner)}`}, 0))`,
  );
}

export async function npReadStoredShopCartForUpdate(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  siteId: string,
  owner: NpShopCartOwner,
): Promise<NpShopCartStorageValue | null> {
  const [row] = await tx
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, storageKey(owner)),
      ),
    )
    .limit(1)
    .for("update");
  if (!row || (row.expiresAt !== null && row.expiresAt <= new Date())) return null;
  return npRequireShopCartStorageValue(row.value);
}

export async function npConsumeShopCartForOrder(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  siteId: string,
  owner: NpShopCartOwner,
  expectedRevision: number,
): Promise<boolean> {
  const current = await npReadStoredShopCartForUpdate(tx, siteId, owner);
  if (!current || current.revision !== expectedRevision) return false;
  const deleted = await tx
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, storageKey(owner)),
        sql`${npPluginStorage.value}->>'revision' = ${expectedRevision.toString()}`,
      ),
    )
    .returning({ key: npPluginStorage.key });
  return deleted.length === 1;
}

async function persistCart(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  siteId: string,
  owner: NpShopCartOwner,
  cart: NpShopCartStorageValue,
): Promise<void> {
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: SHOP_PLUGIN_ID,
      siteId,
      key: storageKey(owner),
      value: cart,
      expiresAt: expiresAt(owner, new Date(cart.updatedAt)),
      updatedAt: new Date(cart.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: cart,
        expiresAt: expiresAt(owner, new Date(cart.updatedAt)),
        updatedAt: new Date(cart.updatedAt),
      },
    });
}

function requireRevision(cart: NpShopCartStorageValue | null, expected: number): void {
  const actual = cart?.revision ?? 0;
  if (actual !== expected) throw new NpShopCartRevisionError(actual);
}

async function findPublishedProducts(
  runtime: NpShopRuntime,
  ids: string[],
): Promise<Map<string, NpShopProduct>> {
  if (ids.length === 0) return new Map();
  const result = await findDocuments<ShopProductDocument>(runtime.collections.products, {
    where: { id: ids, status: "published" },
    page: 1,
    limit: npShopCartLimits.maximumLines,
  });
  const products = await Promise.all(result.docs.map(normalizeShopProduct));
  return new Map(products.map((product) => [product.id, product]));
}

function resolveCurrentLine(
  stored: NpShopCartStoredLine,
  product: NpShopProduct | undefined,
  reservedQuantities: ReadonlyMap<string, number>,
): NpShopCartLine {
  const issues: NpShopCartIssueCode[] = [];
  let price = stored.unitPriceMinor;
  let stock: number | null = null;
  let available = false;
  let imageUrl: string | null = null;
  let productSlug: string | null = stored.productSlug;
  let productName = stored.productName;
  let variantName = stored.variantName;

  if (!product) {
    issues.push("product-unavailable");
  } else {
    imageUrl = product.imageUrl;
    productSlug = product.slug;
    productName = product.name;
    price = product.priceMinor;
    const enabledVariants = product.variants.filter((variant) => variant.enabled);
    if (enabledVariants.length > 0 && stored.variantSku === null) {
      issues.push("variant-required");
    } else if (stored.variantSku !== null) {
      const variant = enabledVariants.find((candidate) => candidate.sku === stored.variantSku);
      if (!variant) {
        issues.push("variant-unavailable");
      } else {
        price = variant.priceMinor ?? product.priceMinor;
        stock =
          product.inventoryState === "untracked"
            ? null
            : Math.max(
                0,
                variant.stockQuantity -
                  (reservedQuantities.get(npShopInventoryStockKey(product.id, variant.sku)) ?? 0),
              );
        variantName = variant.name;
        available = stock === null || stock >= stored.quantity;
      }
    } else {
      price = product.priceMinor;
      stock =
        product.inventoryState === "untracked"
          ? null
          : Math.max(
              0,
              product.stockQuantity -
                (reservedQuantities.get(npShopInventoryStockKey(product.id, null)) ?? 0),
            );
      available = stock === null || stock >= stored.quantity;
    }
    if (stock !== null && stock < stored.quantity) issues.push("insufficient-stock");
    if (price !== stored.unitPriceMinor || product.currency !== stored.currency) {
      issues.push("price-changed");
    }
  }

  return {
    ...stored,
    productSlug,
    productName,
    variantName,
    currency: product?.currency ?? stored.currency,
    unitPriceMinor: price,
    lineTotalMinor: price * stored.quantity,
    imageUrl,
    stockQuantity: stock,
    available,
    issues,
  };
}

export async function npQuoteShopCart(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
): Promise<NpShopCartQuote> {
  const siteId = await requireSiteId();
  const cart = await readStoredCart(siteId, owner);
  if (!cart) return npEmptyShopCartQuote();
  const products = await findPublishedProducts(
    runtime,
    cart.lines.map((line) => line.productId),
  );
  const reservedQuantities = await npGetShopReservedQuantities(siteId, [...products.keys()]);
  const lines = cart.lines.map((line) =>
    resolveCurrentLine(line, products.get(line.productId), reservedQuantities),
  );
  const currencies = [...new Set(lines.map((line) => line.currency))];
  if (currencies.length > 1) {
    for (const line of lines) {
      if (!line.issues.includes("mixed-currency")) line.issues.push("mixed-currency");
    }
  }
  const issues = [...new Set(lines.flatMap((line) => line.issues))].sort();
  const totals = currencies.sort().map((currency) => ({
    currency,
    subtotalMinor: lines
      .filter((line) => line.currency === currency)
      .reduce((total, line) => total + line.lineTotalMinor, 0),
    discountMinor: 0,
    totalMinor: lines
      .filter((line) => line.currency === currency)
      .reduce((total, line) => total + line.lineTotalMinor, 0),
  }));
  const definitions = totals.length === 1 ? await listShopPromotions(runtime) : [];
  const unavailablePromotionIds = await npFindUnavailableShopPromotions(
    getDb(),
    siteId,
    npShopCartOwnerStorageSegment(owner),
    definitions,
  );
  const promotions =
    totals.length === 1
      ? npEvaluateShopPromotions({
          definitions,
          couponCodes: cart.couponCodes,
          currency: totals[0].currency,
          subtotalMinor: totals[0].subtotalMinor,
          lines: lines.map((line) => ({
            key: line.key,
            productId: line.productId,
            categoryIds: products.get(line.productId)?.categoryIds ?? [],
            lineTotalMinor: line.lineTotalMinor,
          })),
          now: new Date(),
          unavailablePromotionIds,
        })
      : {
          contract: NP_SHOP_PROMOTION_SNAPSHOT_CONTRACT,
          couponCodes: cart.couponCodes,
          rejectedCouponCodes: cart.couponCodes,
          applied: [],
          discountMinor: 0,
        };
  if (totals.length === 1) {
    totals[0].discountMinor = promotions.discountMinor;
    totals[0].totalMinor = totals[0].subtotalMinor - promotions.discountMinor;
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        lines: lines.map((line) => [
          line.key,
          line.quantity,
          line.currency,
          line.unitPriceMinor,
          line.issues,
        ]),
        promotions,
      }),
    )
    .digest("hex");
  return {
    contract: NP_SHOP_CART_QUOTE_CONTRACT,
    revision: cart.revision,
    lines,
    promotions,
    totals,
    totalUnits: lines.reduce((total, line) => total + line.quantity, 0),
    ready: lines.length > 0 && !issues.some((issue) => BLOCKING_ISSUES.has(issue)),
    issues,
    fingerprint,
    updatedAt: cart.updatedAt,
  };
}

export async function npAddShopCartLine(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  productId: string,
  variantSku: string | null,
  quantity: number,
  expectedRevision: number,
): Promise<NpShopCartQuote> {
  const products = await findPublishedProducts(runtime, [productId]);
  const product = products.get(productId);
  if (!product) {
    throw new NpShopCartContractError("Invalid cart add request", ["The product is unavailable."]);
  }
  const enabledVariants = product.variants.filter((variant) => variant.enabled);
  const variant =
    variantSku === null
      ? null
      : (enabledVariants.find((candidate) => candidate.sku === variantSku) ?? undefined);
  if (enabledVariants.length > 0 && variantSku === null) {
    throw new NpShopCartContractError("Invalid cart add request", ["Select a product option."]);
  }
  if (variant === undefined) {
    throw new NpShopCartContractError("Invalid cart add request", [
      "The selected product option is unavailable.",
    ]);
  }
  const key = npShopCartLineKey(product.id, variantSku);
  const siteId = await requireSiteId();
  await getDb().transaction(async (tx) => {
    await npLockShopCart(tx, siteId, owner);
    const current = await npReadStoredShopCartForUpdate(tx, siteId, owner);
    requireRevision(current, expectedRevision);
    const existing = current?.lines.find((line) => line.key === key);
    const nextQuantity = Math.min(
      npShopCartLimits.maximumQuantityPerLine,
      (existing?.quantity ?? 0) + quantity,
    );
    const line: NpShopCartStoredLine = {
      key,
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      variantSku,
      variantName: variant?.name ?? null,
      quantity: nextQuantity,
      currency: product.currency,
      unitPriceMinor: variant?.priceMinor ?? product.priceMinor,
    };
    const lines = existing
      ? (current?.lines ?? []).map((candidate) => (candidate.key === key ? line : candidate))
      : [...(current?.lines ?? []), line];
    if (lines.length > npShopCartLimits.maximumLines) {
      throw new NpShopCartContractError("Invalid cart add request", [
        `A cart may contain at most ${npShopCartLimits.maximumLines.toString()} lines.`,
      ]);
    }
    const now = new Date().toISOString();
    await persistCart(tx, siteId, owner, {
      contract: NP_SHOP_CART_STORAGE_CONTRACT,
      revision: (current?.revision ?? 0) + 1,
      lines,
      couponCodes: current?.couponCodes ?? [],
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });
  });
  return npQuoteShopCart(runtime, owner);
}

type NpShopCartReAddSourceLine = {
  productId: string;
  variantSku: string | null;
  quantity: number;
};

export async function npReAddShopCartLines(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopCartReAddInput & { lines: readonly NpShopCartReAddSourceLine[] },
): Promise<NpShopCartReAddResult> {
  if (input.lines.length < 1 || input.lines.length > npShopCartLimits.maximumLines) {
    throw new NpShopCartContractError("Invalid order lines for cart re-add", [
      `An order re-add must contain 1–${npShopCartLimits.maximumLines.toString()} lines.`,
    ]);
  }
  const sourceLines = input.lines.map((line) => {
    const variantSku = line.variantSku?.trim().toUpperCase() ?? null;
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > npShopCartLimits.maximumQuantityPerLine ||
      (variantSku !== null && (variantSku.length < 1 || variantSku.length > 64))
    ) {
      throw new NpShopCartContractError("Invalid order lines for cart re-add", [
        "Order line quantities and option identifiers must fit the current cart contract.",
      ]);
    }
    return {
      lineKey: npShopCartLineKey(line.productId, variantSku),
      productId: line.productId,
      variantSku,
      quantity: line.quantity,
    };
  });
  if (new Set(sourceLines.map((line) => line.lineKey)).size !== sourceLines.length) {
    throw new NpShopCartContractError("Invalid order lines for cart re-add", [
      "Order lines must identify unique product options.",
    ]);
  }
  const products = await findPublishedProducts(runtime, [
    ...new Set(sourceLines.map((line) => line.productId)),
  ]);
  const siteId = await requireSiteId();
  const result = await getDb().transaction(async (tx) => {
    await npLockShopCart(tx, siteId, owner);
    const current = await npReadStoredShopCartForUpdate(tx, siteId, owner);
    requireRevision(current, input.expectedCartRevision);
    const nextLines = [...(current?.lines ?? [])];
    const outcomes: NpShopCartReAddLineResult[] = [];
    let addedUnits = 0;
    let skippedUnits = 0;

    for (const source of sourceLines) {
      const product = products.get(source.productId);
      const enabledVariants = product?.variants.filter((variant) => variant.enabled) ?? [];
      const variant =
        source.variantSku === null
          ? null
          : enabledVariants.find((candidate) => candidate.sku === source.variantSku);
      let issue: NpShopCartReAddIssueCode | null = null;
      if (!product) issue = "product-unavailable";
      else if (
        (source.variantSku === null && enabledVariants.length > 0) ||
        (source.variantSku !== null && !variant)
      ) {
        issue = "variant-unavailable";
      }

      const existingIndex = nextLines.findIndex((line) => line.key === source.lineKey);
      const existing = existingIndex < 0 ? null : nextLines[existingIndex];
      if (!issue && !existing && nextLines.length >= npShopCartLimits.maximumLines) {
        issue = "cart-line-limit";
      }
      const capacity = existing
        ? npShopCartLimits.maximumQuantityPerLine - existing.quantity
        : npShopCartLimits.maximumQuantityPerLine;
      const addedQuantity = issue ? 0 : Math.min(source.quantity, Math.max(0, capacity));
      const skippedQuantity = source.quantity - addedQuantity;
      if (!issue && skippedQuantity > 0) issue = "quantity-limit";

      if (addedQuantity > 0 && product) {
        const line: NpShopCartStoredLine = {
          key: source.lineKey,
          productId: product.id,
          productSlug: product.slug,
          productName: product.name,
          variantSku: source.variantSku,
          variantName: variant?.name ?? null,
          quantity: (existing?.quantity ?? 0) + addedQuantity,
          currency: product.currency,
          unitPriceMinor: variant?.priceMinor ?? product.priceMinor,
        };
        if (existingIndex < 0) nextLines.push(line);
        else nextLines[existingIndex] = line;
      }
      addedUnits += addedQuantity;
      skippedUnits += skippedQuantity;
      outcomes.push({
        lineKey: source.lineKey,
        productId: source.productId,
        variantSku: source.variantSku,
        requestedQuantity: source.quantity,
        addedQuantity,
        skippedQuantity,
        issue,
      });
    }

    const cartRevision = addedUnits > 0 ? (current?.revision ?? 0) + 1 : (current?.revision ?? 0);
    if (addedUnits > 0) {
      const now = new Date().toISOString();
      await persistCart(tx, siteId, owner, {
        contract: NP_SHOP_CART_STORAGE_CONTRACT,
        revision: cartRevision,
        lines: nextLines,
        couponCodes: current?.couponCodes ?? [],
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      });
    }
    return npRequireShopCartReAddResult({
      contract: NP_SHOP_CART_READD_CONTRACT,
      orderId: input.orderId,
      cartRevision,
      addedUnits,
      skippedUnits,
      lines: outcomes,
    });
  });
  return result;
}

export async function npSetShopCartCoupons(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  couponCodes: string[],
  expectedRevision: number,
): Promise<NpShopCartQuote> {
  const siteId = await requireSiteId();
  await getDb().transaction(async (tx) => {
    await npLockShopCart(tx, siteId, owner);
    const current = await npReadStoredShopCartForUpdate(tx, siteId, owner);
    requireRevision(current, expectedRevision);
    if (!current || current.lines.length === 0) {
      throw new NpShopCartContractError("Invalid cart coupon request", [
        "A coupon code cannot be attached to an empty cart.",
      ]);
    }
    const now = new Date().toISOString();
    await persistCart(tx, siteId, owner, {
      ...current,
      revision: current.revision + 1,
      couponCodes,
      updatedAt: now,
    });
  });
  return npQuoteShopCart(runtime, owner);
}

export async function npSetShopCartQuantity(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  lineKey: string,
  quantity: number,
  expectedRevision: number,
): Promise<NpShopCartQuote> {
  const siteId = await requireSiteId();
  await getDb().transaction(async (tx) => {
    await npLockShopCart(tx, siteId, owner);
    const current = await npReadStoredShopCartForUpdate(tx, siteId, owner);
    requireRevision(current, expectedRevision);
    if (!current?.lines.some((line) => line.key === lineKey)) {
      throw new NpShopCartContractError("Invalid cart quantity request", [
        "The cart line no longer exists.",
      ]);
    }
    const now = new Date().toISOString();
    await persistCart(tx, siteId, owner, {
      ...current,
      revision: current.revision + 1,
      lines: current.lines.map((line) => (line.key === lineKey ? { ...line, quantity } : line)),
      updatedAt: now,
    });
  });
  return npQuoteShopCart(runtime, owner);
}

export async function npDeleteShopCartLine(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  lineKey: string | null,
  expectedRevision: number,
): Promise<NpShopCartQuote> {
  const siteId = await requireSiteId();
  await getDb().transaction(async (tx) => {
    await npLockShopCart(tx, siteId, owner);
    const current = await npReadStoredShopCartForUpdate(tx, siteId, owner);
    requireRevision(current, expectedRevision);
    const nextLines =
      lineKey === null ? [] : (current?.lines ?? []).filter((line) => line.key !== lineKey);
    if (nextLines.length === (current?.lines.length ?? 0) && lineKey !== null) {
      throw new NpShopCartContractError("Invalid cart delete request", [
        "The cart line no longer exists.",
      ]);
    }
    if (nextLines.length === 0) {
      await tx
        .delete(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, storageKey(owner)),
          ),
        );
      return;
    }
    const now = new Date().toISOString();
    await persistCart(tx, siteId, owner, {
      ...(current as NpShopCartStorageValue),
      revision: (current?.revision ?? 0) + 1,
      lines: nextLines,
      updatedAt: now,
    });
  });
  return npQuoteShopCart(runtime, owner);
}

export async function npMergeShopGuestCart(
  runtime: NpShopRuntime,
  member: Extract<NpShopCartOwner, { kind: "member" }>,
  guest: Extract<NpShopCartOwner, { kind: "guest" }>,
): Promise<NpShopCartQuote> {
  const siteId = await requireSiteId();
  await getDb().transaction(async (tx) => {
    for (const owner of [member, guest].sort((a, b) =>
      storageKey(a).localeCompare(storageKey(b)),
    )) {
      await npLockShopCart(tx, siteId, owner);
    }
    const [memberCart, guestCart] = await Promise.all([
      npReadStoredShopCartForUpdate(tx, siteId, member),
      npReadStoredShopCartForUpdate(tx, siteId, guest),
    ]);
    if (!guestCart) return;
    const memberLines = memberCart?.lines ?? [];
    const merged = new Map(memberLines.map((line) => [line.key, line]));
    for (const line of [...guestCart.lines].sort((left, right) =>
      left.key.localeCompare(right.key),
    )) {
      const existing = merged.get(line.key);
      if (!existing && merged.size >= npShopCartLimits.maximumLines) continue;
      merged.set(line.key, {
        ...(existing ?? line),
        quantity: Math.min(
          npShopCartLimits.maximumQuantityPerLine,
          (existing?.quantity ?? 0) + line.quantity,
        ),
      });
    }
    const now = new Date().toISOString();
    await persistCart(tx, siteId, member, {
      contract: NP_SHOP_CART_STORAGE_CONTRACT,
      revision: (memberCart?.revision ?? 0) + 1,
      lines: [...merged.values()].sort((left, right) => left.key.localeCompare(right.key)),
      couponCodes: [...new Set([...(memberCart?.couponCodes ?? []), ...guestCart.couponCodes])]
        .slice(0, 5)
        .sort(),
      createdAt: memberCart?.createdAt ?? guestCart.createdAt,
      updatedAt: now,
    });
    await tx
      .delete(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
          eq(npPluginStorage.siteId, siteId),
          eq(npPluginStorage.key, storageKey(guest)),
        ),
      );
  });
  return npQuoteShopCart(runtime, member);
}

export async function npCleanupExpiredShopCarts(): Promise<number> {
  const siteId = await requireSiteId();
  const db = getDb();
  return db.transaction(async (tx) => {
    const now = new Date();
    const rows = await tx
      .select({ key: npPluginStorage.key })
      .from(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
          eq(npPluginStorage.siteId, siteId),
          like(npPluginStorage.key, "cart:%"),
          lt(npPluginStorage.expiresAt, now),
        ),
      )
      .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
      .limit(npShopCartLimits.cleanupBatchSize)
      .for("update", { skipLocked: true });
    let deleted = 0;
    for (const row of rows) {
      const removed = await tx
        .delete(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, row.key),
            lt(npPluginStorage.expiresAt, now),
          ),
        )
        .returning({ key: npPluginStorage.key });
      deleted += removed.length;
    }
    return deleted;
  });
}

export async function npCountShopCarts(): Promise<{
  active: number;
  expired: number;
  invalid: number;
}> {
  const siteId = await requireSiteId();
  const rows = await getDb()
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        sql`${npPluginStorage.key} like 'cart:%'`,
      ),
    );
  const now = new Date();
  return rows.reduce(
    (counts, row) => {
      if (row.expiresAt !== null && row.expiresAt <= now) counts.expired += 1;
      else {
        try {
          npRequireShopCartStorageValue(row.value);
          counts.active += 1;
        } catch {
          counts.invalid += 1;
        }
      }
      return counts;
    },
    { active: 0, expired: 0, invalid: 0 },
  );
}
