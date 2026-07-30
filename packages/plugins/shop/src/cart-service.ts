import { createHash } from "node:crypto";

import { findDocuments } from "@nexpress/core/collections";
import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, eq, like, lt, sql } from "drizzle-orm";

import {
  NP_SHOP_CART_QUOTE_CONTRACT,
  NP_SHOP_CART_STORAGE_CONTRACT,
  NpShopCartContractError,
  npRequireShopCartStorageValue,
  npShopCartLimits,
  npShopCartLineKey,
  type NpShopCartStorageValue,
  type NpShopCartStoredLine,
} from "./cart-contract.js";
import { normalizeShopProduct, type NpShopRuntime, type ShopProductDocument } from "./runtime.js";
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
    .limit(1);
  if (!row || (row.expiresAt !== null && row.expiresAt <= new Date())) return null;
  return npRequireShopCartStorageValue(row.value);
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
        stock = product.inventoryState === "untracked" ? null : variant.stockQuantity;
        variantName = variant.name;
        available = stock === null || stock >= stored.quantity;
      }
    } else {
      price = product.priceMinor;
      stock = product.inventoryState === "untracked" ? null : product.stockQuantity;
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
  const lines = cart.lines.map((line) => resolveCurrentLine(line, products.get(line.productId)));
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
  }));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        lines.map((line) => [
          line.key,
          line.quantity,
          line.currency,
          line.unitPriceMinor,
          line.issues,
        ]),
      ),
    )
    .digest("hex");
  return {
    contract: NP_SHOP_CART_QUOTE_CONTRACT,
    revision: cart.revision,
    lines,
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
      createdAt: current?.createdAt ?? now,
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
  const rows = await db
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "cart:%"),
        lt(npPluginStorage.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopCartLimits.cleanupBatchSize);
  if (rows.length === 0) return 0;
  return db.transaction(async (tx) => {
    let deleted = 0;
    for (const row of rows) {
      const removed = await tx
        .delete(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, row.key),
            lt(npPluginStorage.expiresAt, new Date()),
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
