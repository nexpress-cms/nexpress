import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, eq, gt, like, lt, sql } from "drizzle-orm";

import {
  NP_SHOP_CHECKOUT_INTENT_CONTRACT,
  NpShopCheckoutConflictError,
  NpShopCheckoutContractError,
  NpShopCheckoutNotFoundError,
  npRequireShopCheckoutIntent,
  npShopCheckoutLimits,
  type NpShopCheckoutCreateInput,
} from "./checkout-contract.js";
import {
  npLockShopCart,
  npQuoteShopCart,
  npReadStoredShopCartForUpdate,
  npShopCartOwnerStorageSegment,
  type NpShopCartOwner,
} from "./cart-service.js";
import type { NpShopRuntime } from "./runtime.js";
import type { NpShopCheckoutIntent } from "./types.js";

const SHOP_PLUGIN_ID = "shop";

function storageKey(owner: NpShopCartOwner, intentId: string): string {
  return `checkout-intent:${npShopCartOwnerStorageSegment(owner)}:${intentId}`;
}

async function lockIntent(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  siteId: string,
  owner: NpShopCartOwner,
  intentId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-checkout:${siteId}:${storageKey(owner, intentId)}`}, 0))`,
  );
}

async function lockIntentOwner(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  siteId: string,
  owner: NpShopCartOwner,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-checkout-owner:${siteId}:${npShopCartOwnerStorageSegment(owner)}`}, 0))`,
  );
}

async function readStoredIntent(
  siteId: string,
  owner: NpShopCartOwner,
  intentId: string,
): Promise<NpShopCheckoutIntent | null> {
  const [row] = await getDb()
    .select({ value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, storageKey(owner, intentId)),
      ),
    )
    .limit(1);
  return row ? npRequireShopCheckoutIntent(row.value) : null;
}

async function readStoredIntentForUpdate(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  siteId: string,
  owner: NpShopCartOwner,
  intentId: string,
): Promise<NpShopCheckoutIntent | null> {
  const [row] = await tx
    .select({ value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, storageKey(owner, intentId)),
      ),
    )
    .limit(1);
  return row ? npRequireShopCheckoutIntent(row.value) : null;
}

async function persistIntent(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  siteId: string,
  owner: NpShopCartOwner,
  intent: NpShopCheckoutIntent,
): Promise<void> {
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: SHOP_PLUGIN_ID,
      siteId,
      key: storageKey(owner, intent.id),
      value: intent,
      expiresAt: new Date(intent.expiresAt),
      updatedAt: new Date(intent.cancelledAt ?? intent.createdAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: intent,
        expiresAt: new Date(intent.expiresAt),
        updatedAt: new Date(intent.cancelledAt ?? intent.createdAt),
      },
    });
}

async function requireOwnerCapacity(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  siteId: string,
  owner: NpShopCartOwner,
): Promise<void> {
  const rows = await tx
    .select({ value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `checkout-intent:${npShopCartOwnerStorageSegment(owner)}:%`),
        gt(npPluginStorage.expiresAt, new Date()),
      ),
    )
    .limit(npShopCheckoutLimits.maximumRetainedPerOwner + 1);
  let active = 0;
  for (const row of rows) {
    const intent = npRequireShopCheckoutIntent(row.value);
    if (intent.status !== "cancelled") active += 1;
  }
  if (rows.length >= npShopCheckoutLimits.maximumRetainedPerOwner) {
    throw new NpShopCheckoutContractError("Checkout intent retention limit reached", [
      `At most ${npShopCheckoutLimits.maximumRetainedPerOwner.toString()} unexpired checkout intent records are retained per browser identity.`,
    ]);
  }
  if (active >= npShopCheckoutLimits.maximumActivePerOwner) {
    throw new NpShopCheckoutContractError("Checkout intent limit reached", [
      `At most ${npShopCheckoutLimits.maximumActivePerOwner.toString()} active checkout intents are allowed per browser identity.`,
    ]);
  }
}

async function withDerivedStatus(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  intent: NpShopCheckoutIntent,
): Promise<NpShopCheckoutIntent> {
  if (intent.status === "cancelled") return intent;
  if (new Date(intent.expiresAt) <= new Date()) return { ...intent, status: "expired" };
  const quote = await npQuoteShopCart(runtime, owner);
  return quote.ready &&
    quote.revision === intent.cartRevision &&
    quote.fingerprint === intent.cartFingerprint
    ? { ...intent, status: "open" }
    : { ...intent, status: "stale" };
}

function requireReadyQuote(
  quote: Awaited<ReturnType<typeof npQuoteShopCart>>,
  input: NpShopCheckoutCreateInput,
): void {
  if (
    quote.revision !== input.expectedRevision ||
    quote.fingerprint !== input.expectedFingerprint
  ) {
    throw new NpShopCheckoutConflictError(
      "checkout_cart_conflict",
      "The cart changed before the checkout intent could be created.",
    );
  }
  if (!quote.ready || quote.totals.length !== 1 || quote.lines.some((line) => !line.productSlug)) {
    throw new NpShopCheckoutContractError("Checkout intent cannot be created", [
      "The cart must be non-empty, available, and use one currency.",
    ]);
  }
}

function requireIdempotencyMatch(
  existing: NpShopCheckoutIntent,
  input: NpShopCheckoutCreateInput,
): void {
  if (
    existing.cartRevision !== input.expectedRevision ||
    existing.cartFingerprint !== input.expectedFingerprint
  ) {
    throw new NpShopCheckoutConflictError(
      "checkout_idempotency_conflict",
      "The idempotency key already belongs to a different cart snapshot.",
    );
  }
}

export async function npCreateShopCheckoutIntent(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopCheckoutCreateInput,
): Promise<NpShopCheckoutIntent> {
  const siteId = await requireSiteId();
  const existingBeforeQuote = await readStoredIntent(siteId, owner, input.idempotencyKey);
  if (existingBeforeQuote) {
    requireIdempotencyMatch(existingBeforeQuote, input);
    return withDerivedStatus(runtime, owner, existingBeforeQuote);
  }
  const quote = await npQuoteShopCart(runtime, owner);
  requireReadyQuote(quote, input);
  const stored = await getDb().transaction(async (tx) => {
    await lockIntentOwner(tx, siteId, owner);
    await npLockShopCart(tx, siteId, owner);
    await lockIntent(tx, siteId, owner, input.idempotencyKey);
    const [cart, existing] = await Promise.all([
      npReadStoredShopCartForUpdate(tx, siteId, owner),
      readStoredIntentForUpdate(tx, siteId, owner, input.idempotencyKey),
    ]);
    if (existing) {
      requireIdempotencyMatch(existing, input);
      return existing;
    }
    await requireOwnerCapacity(tx, siteId, owner);
    if (!cart || cart.revision !== input.expectedRevision) {
      throw new NpShopCheckoutConflictError(
        "checkout_cart_conflict",
        "The cart changed before the checkout intent could be stored.",
      );
    }
    const now = new Date();
    const intent: NpShopCheckoutIntent = {
      contract: NP_SHOP_CHECKOUT_INTENT_CONTRACT,
      id: input.idempotencyKey,
      status: "open",
      cartRevision: quote.revision,
      cartFingerprint: quote.fingerprint,
      currency: quote.totals[0].currency,
      subtotalMinor: quote.totals[0].subtotalMinor,
      discountMinor: quote.totals[0].discountMinor,
      totalMinor: quote.totals[0].totalMinor,
      promotions: quote.promotions,
      totalUnits: quote.totalUnits,
      lines: quote.lines.map((line) => ({
        key: line.key,
        productId: line.productId,
        productSlug: line.productSlug as string,
        productName: line.productName,
        variantSku: line.variantSku,
        variantName: line.variantName,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineTotalMinor: line.lineTotalMinor,
      })),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + npShopCheckoutLimits.ttlSeconds * 1_000).toISOString(),
      cancelledAt: null,
    };
    await persistIntent(tx, siteId, owner, intent);
    return intent;
  });
  return withDerivedStatus(runtime, owner, stored);
}

export async function npReadShopCheckoutIntent(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  intentId: string,
): Promise<NpShopCheckoutIntent> {
  const siteId = await requireSiteId();
  const intent = await readStoredIntent(siteId, owner, intentId);
  if (!intent) throw new NpShopCheckoutNotFoundError();
  return withDerivedStatus(runtime, owner, intent);
}

export async function npCancelShopCheckoutIntent(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  intentId: string,
): Promise<NpShopCheckoutIntent> {
  const siteId = await requireSiteId();
  const stored = await getDb().transaction(async (tx) => {
    await lockIntent(tx, siteId, owner, intentId);
    const current = await readStoredIntentForUpdate(tx, siteId, owner, intentId);
    if (!current) throw new NpShopCheckoutNotFoundError();
    const now = new Date();
    if (current.status === "cancelled" || new Date(current.expiresAt) <= now) {
      return current;
    }
    const cancelled = {
      ...current,
      status: "cancelled",
      cancelledAt: now.toISOString(),
    } satisfies NpShopCheckoutIntent;
    await persistIntent(tx, siteId, owner, cancelled);
    return cancelled;
  });
  return withDerivedStatus(runtime, owner, stored);
}

export async function npCleanupExpiredShopCheckoutIntents(): Promise<number> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "checkout-intent:%"),
        lt(npPluginStorage.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopCheckoutLimits.cleanupBatchSize);
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

export async function npCountShopCheckoutIntents(): Promise<{
  active: number;
  cancelled: number;
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
        like(npPluginStorage.key, "checkout-intent:%"),
      ),
    );
  const now = new Date();
  return rows.reduce(
    (counts, row) => {
      if (row.expiresAt !== null && row.expiresAt <= now) {
        counts.expired += 1;
      } else {
        try {
          const intent = npRequireShopCheckoutIntent(row.value);
          if (intent.status === "cancelled") counts.cancelled += 1;
          else counts.active += 1;
        } catch {
          counts.invalid += 1;
        }
      }
      return counts;
    },
    { active: 0, cancelled: 0, expired: 0, invalid: 0 },
  );
}
