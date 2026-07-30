import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, eq, gt, like, lte, sql } from "drizzle-orm";

import { NpShopCheckoutNotFoundError } from "./checkout-contract.js";
import { npReadShopCheckoutIntent } from "./checkout-service.js";
import {
  NP_SHOP_ORDER_DRAFT_CONTRACT,
  NpShopOrderDraftConflictError,
  NpShopOrderDraftContractError,
  NpShopOrderDraftExpiredError,
  NpShopOrderDraftNotFoundError,
  npRequireShopOrderDraft,
  npShopOrderDraftLimits,
  type NpShopOrderDraftCreateInput,
  type NpShopOrderDraftUpdateInput,
} from "./order-draft-contract.js";
import {
  npLockShopCart,
  npQuoteShopCart,
  npShopCartOwnerStorageSegment,
  type NpShopCartOwner,
} from "./cart-service.js";
import type { NpShopRuntime } from "./runtime.js";
import type { NpShopOrderDraft } from "./types.js";

const SHOP_PLUGIN_ID = "shop";

function storageKey(owner: NpShopCartOwner, draftId: string): string {
  return `order-draft:${npShopCartOwnerStorageSegment(owner)}:${draftId}`;
}

type ShopTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function requireStoredDraft(value: unknown, expiresAt: Date | null): NpShopOrderDraft {
  const draft = npRequireShopOrderDraft(value);
  if (expiresAt === null || expiresAt.toISOString() !== draft.expiresAt) {
    throw new NpShopOrderDraftContractError("Invalid Shop order draft storage metadata", [
      "Order draft storage expiry must match its private draft contract.",
    ]);
  }
  return draft;
}

async function lockDraft(
  tx: ShopTransaction,
  siteId: string,
  owner: NpShopCartOwner,
  draftId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-order-draft:${siteId}:${storageKey(owner, draftId)}`}, 0))`,
  );
}

async function lockDraftOwner(
  tx: ShopTransaction,
  siteId: string,
  owner: NpShopCartOwner,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-order-draft-owner:${siteId}:${npShopCartOwnerStorageSegment(owner)}`}, 0))`,
  );
}

async function readStoredDraft(
  siteId: string,
  owner: NpShopCartOwner,
  draftId: string,
): Promise<NpShopOrderDraft | null> {
  const [row] = await getDb()
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, storageKey(owner, draftId)),
      ),
    )
    .limit(1);
  return row ? requireStoredDraft(row.value, row.expiresAt) : null;
}

async function readStoredDraftForUpdate(
  tx: ShopTransaction,
  siteId: string,
  owner: NpShopCartOwner,
  draftId: string,
): Promise<NpShopOrderDraft | null> {
  const [row] = await tx
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, storageKey(owner, draftId)),
      ),
    )
    .limit(1);
  return row ? requireStoredDraft(row.value, row.expiresAt) : null;
}

async function persistDraft(
  tx: ShopTransaction,
  siteId: string,
  owner: NpShopCartOwner,
  draft: NpShopOrderDraft,
): Promise<void> {
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: SHOP_PLUGIN_ID,
      siteId,
      key: storageKey(owner, draft.id),
      value: draft,
      expiresAt: new Date(draft.expiresAt),
      updatedAt: new Date(draft.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: draft,
        expiresAt: new Date(draft.expiresAt),
        updatedAt: new Date(draft.updatedAt),
      },
    });
}

async function deleteExpiredDraft(
  siteId: string,
  owner: NpShopCartOwner,
  draftId: string,
  expiresAt: string,
): Promise<void> {
  await getDb()
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, storageKey(owner, draftId)),
        eq(npPluginStorage.expiresAt, new Date(expiresAt)),
      ),
    );
}

async function requireOwnerCapacity(
  tx: ShopTransaction,
  siteId: string,
  owner: NpShopCartOwner,
): Promise<void> {
  const rows = await tx
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `order-draft:${npShopCartOwnerStorageSegment(owner)}:%`),
        gt(npPluginStorage.expiresAt, new Date()),
      ),
    )
    .limit(npShopOrderDraftLimits.maximumActivePerOwner + 1);
  for (const row of rows) requireStoredDraft(row.value, row.expiresAt);
  if (rows.length >= npShopOrderDraftLimits.maximumActivePerOwner) {
    throw new NpShopOrderDraftContractError("Order draft limit reached", [
      `At most ${npShopOrderDraftLimits.maximumActivePerOwner.toString()} active order drafts are allowed per browser identity.`,
    ]);
  }
}

async function withDerivedStatus(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  draft: NpShopOrderDraft,
): Promise<NpShopOrderDraft> {
  const quote = await npQuoteShopCart(runtime, owner);
  return quote.ready &&
    quote.revision === draft.cartRevision &&
    quote.fingerprint === draft.cartFingerprint
    ? draft
    : { ...draft, status: "stale" };
}

function requireIdempotencyMatch(
  existing: NpShopOrderDraft,
  input: NpShopOrderDraftCreateInput,
): void {
  if (existing.checkoutIntentId !== input.checkoutIntentId) {
    throw new NpShopOrderDraftConflictError(
      "order_draft_idempotency_conflict",
      "The idempotency key already belongs to a different checkout intent.",
    );
  }
}

async function readOpenSourceIntent(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  checkoutIntentId: string,
) {
  try {
    const intent = await npReadShopCheckoutIntent(runtime, owner, checkoutIntentId);
    if (intent.status !== "open") {
      throw new NpShopOrderDraftConflictError(
        "order_draft_source_stale",
        "The checkout intent is no longer open.",
      );
    }
    return intent;
  } catch (error) {
    if (error instanceof NpShopCheckoutNotFoundError) {
      throw new NpShopOrderDraftConflictError(
        "order_draft_source_stale",
        "The checkout intent is no longer open.",
      );
    }
    throw error;
  }
}

export async function npCreateShopOrderDraft(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopOrderDraftCreateInput,
): Promise<NpShopOrderDraft> {
  const siteId = await requireSiteId();
  const existingBeforeSource = await readStoredDraft(siteId, owner, input.idempotencyKey);
  if (existingBeforeSource) {
    requireIdempotencyMatch(existingBeforeSource, input);
    if (new Date(existingBeforeSource.expiresAt) <= new Date()) {
      await deleteExpiredDraft(
        siteId,
        owner,
        existingBeforeSource.id,
        existingBeforeSource.expiresAt,
      );
      throw new NpShopOrderDraftExpiredError();
    }
    return withDerivedStatus(runtime, owner, existingBeforeSource);
  }

  return getDb().transaction(async (tx) => {
    await lockDraftOwner(tx, siteId, owner);
    await npLockShopCart(tx, siteId, owner);
    await lockDraft(tx, siteId, owner, input.idempotencyKey);
    const existing = await readStoredDraftForUpdate(tx, siteId, owner, input.idempotencyKey);
    if (existing) {
      requireIdempotencyMatch(existing, input);
      return withDerivedStatus(runtime, owner, existing);
    }
    await requireOwnerCapacity(tx, siteId, owner);
    const intent = await readOpenSourceIntent(runtime, owner, input.checkoutIntentId);
    const now = new Date();
    const draft: NpShopOrderDraft = {
      contract: NP_SHOP_ORDER_DRAFT_CONTRACT,
      id: input.idempotencyKey,
      status: "collecting",
      revision: 1,
      checkoutIntentId: intent.id,
      cartRevision: intent.cartRevision,
      cartFingerprint: intent.cartFingerprint,
      currency: intent.currency,
      subtotalMinor: intent.subtotalMinor,
      totalUnits: intent.totalUnits,
      lines: intent.lines,
      customer: null,
      shipping: null,
      sourceCreatedAt: intent.createdAt,
      sourceExpiresAt: intent.expiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + npShopOrderDraftLimits.ttlSeconds * 1_000).toISOString(),
    };
    npRequireShopOrderDraft(draft);
    await persistDraft(tx, siteId, owner, draft);
    return draft;
  });
}

export async function npReadShopOrderDraft(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  draftId: string,
): Promise<NpShopOrderDraft> {
  const siteId = await requireSiteId();
  const draft = await readStoredDraft(siteId, owner, draftId);
  if (!draft) throw new NpShopOrderDraftNotFoundError();
  if (new Date(draft.expiresAt) <= new Date()) {
    await deleteExpiredDraft(siteId, owner, draftId, draft.expiresAt);
    throw new NpShopOrderDraftExpiredError();
  }
  return withDerivedStatus(runtime, owner, draft);
}

export async function npUpdateShopOrderDraft(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopOrderDraftUpdateInput,
): Promise<NpShopOrderDraft> {
  const siteId = await requireSiteId();
  const result = await getDb().transaction(async (tx) => {
    await lockDraftOwner(tx, siteId, owner);
    await npLockShopCart(tx, siteId, owner);
    await lockDraft(tx, siteId, owner, input.draftId);
    const current = await readStoredDraftForUpdate(tx, siteId, owner, input.draftId);
    if (!current) throw new NpShopOrderDraftNotFoundError();
    const now = new Date();
    if (new Date(current.expiresAt) <= now) {
      await tx
        .delete(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, storageKey(owner, input.draftId)),
          ),
        );
      return null;
    }
    if (current.revision !== input.expectedRevision) {
      throw new NpShopOrderDraftConflictError(
        "order_draft_revision_conflict",
        "The order draft changed before this update.",
      );
    }
    const derived = await withDerivedStatus(runtime, owner, current);
    if (derived.status === "stale") {
      throw new NpShopOrderDraftConflictError(
        "order_draft_source_stale",
        "The cart changed after this order draft was created.",
      );
    }
    const updated = {
      ...current,
      status: "reviewable",
      revision: current.revision + 1,
      customer: input.customer,
      shipping: input.shipping,
      updatedAt: now.toISOString(),
    } satisfies NpShopOrderDraft;
    npRequireShopOrderDraft(updated);
    await persistDraft(tx, siteId, owner, updated);
    return updated;
  });
  if (!result) throw new NpShopOrderDraftExpiredError();
  return result;
}

export async function npDeleteShopOrderDraft(
  owner: NpShopCartOwner,
  draftId: string,
): Promise<void> {
  const siteId = await requireSiteId();
  await getDb().transaction(async (tx) => {
    await lockDraftOwner(tx, siteId, owner);
    await lockDraft(tx, siteId, owner, draftId);
    await tx
      .delete(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
          eq(npPluginStorage.siteId, siteId),
          eq(npPluginStorage.key, storageKey(owner, draftId)),
        ),
      );
  });
}

export async function npCleanupExpiredShopOrderDrafts(): Promise<number> {
  const siteId = await requireSiteId();
  const db = getDb();
  const cleanupNow = new Date();
  const rows = await db
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "order-draft:%"),
        lte(npPluginStorage.expiresAt, cleanupNow),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopOrderDraftLimits.cleanupBatchSize);
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
            lte(npPluginStorage.expiresAt, cleanupNow),
          ),
        )
        .returning({ key: npPluginStorage.key });
      deleted += removed.length;
    }
    return deleted;
  });
}

export async function npCountShopOrderDrafts(): Promise<{
  collecting: number;
  reviewable: number;
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
        like(npPluginStorage.key, "order-draft:%"),
      ),
    );
  const now = new Date();
  return rows.reduce(
    (counts, row) => {
      if (row.expiresAt !== null && row.expiresAt <= now) {
        counts.expired += 1;
      } else {
        try {
          const draft = requireStoredDraft(row.value, row.expiresAt);
          if (draft.status === "reviewable") counts.reviewable += 1;
          else counts.collecting += 1;
        } catch {
          counts.invalid += 1;
        }
      }
      return counts;
    },
    { collecting: 0, reviewable: 0, expired: 0, invalid: 0 },
  );
}
