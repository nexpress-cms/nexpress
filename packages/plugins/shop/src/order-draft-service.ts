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
import {
  NP_SHOP_DELIVERY_METHOD_CONTRACT,
  NP_SHOP_SHIPPING_HEALTH_CONTRACT,
  NP_SHOP_SHIPPING_QUOTE_REQUEST_CONTRACT,
  NpShopShippingContractError,
  NpShopShippingUnavailableError,
  npRequireShopDeliveryMethod,
  npRequireShopShippingQuoteResult,
  npRequireShopShippingQuoteRequest,
  npRequireShopShippingHealth,
  npShopShippingLimits,
  type NpShopShippingMethodSelectInput,
  type NpShopShippingQuote,
  type NpShopShippingHealth,
} from "./shipping-contract.js";
import { NP_SHOP_SHIPPING_POLICY_PROVIDER_ID } from "./shipping-policy-contract.js";
import {
  npIsShopShippingProviderActive,
  npQuoteShopShippingPolicies,
} from "./shipping-policy-service.js";
import {
  NP_SHOP_TAX_HEALTH_CONTRACT,
  NP_SHOP_TAX_QUOTE_REQUEST_CONTRACT,
  NpShopTaxContractError,
  NpShopTaxUnavailableError,
  npRequireShopTaxHealth,
  npRequireShopTaxQuoteRequest,
  npRequireShopTaxQuoteResult,
  npShopTaxMaximumExpiry,
  type NpShopTaxHealth,
  type NpShopTaxQuote,
} from "./tax-contract.js";
import type { NpShopOrderDraft, NpShopOrderDraftShipping } from "./types.js";

export const NP_SHOP_PLUGIN_ID = "shop";
const NP_SHOP_SHIPPING_HEALTH_KEY = "shipping-health";
const NP_SHOP_TAX_HEALTH_KEY = "tax-health";

export function npShopOrderDraftStorageKey(owner: NpShopCartOwner, draftId: string): string {
  return `order-draft:${npShopCartOwnerStorageSegment(owner)}:${draftId}`;
}

export type NpShopTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

function requireStoredDraft(value: unknown, expiresAt: Date | null): NpShopOrderDraft {
  const draft = npRequireShopOrderDraft(value);
  if (expiresAt === null || expiresAt.toISOString() !== draft.expiresAt) {
    throw new NpShopOrderDraftContractError("Invalid Shop order draft storage metadata", [
      "Order draft storage expiry must match its private draft contract.",
    ]);
  }
  return draft;
}

export async function npLockShopOrderDraft(
  tx: NpShopTransaction,
  siteId: string,
  owner: NpShopCartOwner,
  draftId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-order-draft:${siteId}:${npShopOrderDraftStorageKey(owner, draftId)}`}, 0))`,
  );
}

export async function npLockShopOrderDraftOwner(
  tx: NpShopTransaction,
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
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopOrderDraftStorageKey(owner, draftId)),
      ),
    )
    .limit(1);
  return row ? requireStoredDraft(row.value, row.expiresAt) : null;
}

export async function npReadStoredShopOrderDraftForUpdate(
  tx: NpShopTransaction,
  siteId: string,
  owner: NpShopCartOwner,
  draftId: string,
): Promise<NpShopOrderDraft | null> {
  const [row] = await tx
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopOrderDraftStorageKey(owner, draftId)),
      ),
    )
    .limit(1);
  return row ? requireStoredDraft(row.value, row.expiresAt) : null;
}

async function persistDraft(
  tx: NpShopTransaction,
  siteId: string,
  owner: NpShopCartOwner,
  draft: NpShopOrderDraft,
): Promise<void> {
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopOrderDraftStorageKey(owner, draft.id),
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

async function persistShippingHealth(siteId: string, health: NpShopShippingHealth): Promise<void> {
  npRequireShopShippingHealth(health);
  await getDb()
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: NP_SHOP_SHIPPING_HEALTH_KEY,
      value: health,
      expiresAt: null,
      updatedAt: new Date(health.attemptedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: health,
        expiresAt: null,
        updatedAt: new Date(health.attemptedAt),
      },
      setWhere: sql`${npPluginStorage.value}->>'attemptedAt' <= ${health.attemptedAt}`,
    });
}

export async function npReadShopShippingHealth(): Promise<NpShopShippingHealth | null> {
  const siteId = await requireSiteId();
  const [row] = await getDb()
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, NP_SHOP_SHIPPING_HEALTH_KEY),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt !== null) {
    throw new NpShopShippingContractError("Invalid Shop shipping health storage metadata", [
      "Shipping health must not have storage expiry.",
    ]);
  }
  return npRequireShopShippingHealth(row.value);
}

async function persistTaxHealth(siteId: string, health: NpShopTaxHealth): Promise<void> {
  npRequireShopTaxHealth(health);
  await getDb()
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: NP_SHOP_TAX_HEALTH_KEY,
      value: health,
      expiresAt: null,
      updatedAt: new Date(health.attemptedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: health,
        expiresAt: null,
        updatedAt: new Date(health.attemptedAt),
      },
      setWhere: sql`${npPluginStorage.value}->>'attemptedAt' <= ${health.attemptedAt}`,
    });
}

export async function npReadShopTaxHealth(): Promise<NpShopTaxHealth | null> {
  const siteId = await requireSiteId();
  const [row] = await getDb()
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, NP_SHOP_TAX_HEALTH_KEY),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt !== null) {
    throw new NpShopTaxContractError("Invalid Shop tax health storage metadata", [
      "Tax health must not have storage expiry.",
    ]);
  }
  return npRequireShopTaxHealth(row.value);
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
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopOrderDraftStorageKey(owner, draftId)),
        eq(npPluginStorage.expiresAt, new Date(expiresAt)),
      ),
    );
}

async function requireOwnerCapacity(
  tx: NpShopTransaction,
  siteId: string,
  owner: NpShopCartOwner,
): Promise<void> {
  const rows = await tx
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
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

async function quoteTaxForDraft(
  runtime: NpShopRuntime,
  siteId: string,
  draft: NpShopOrderDraft,
  destination: NpShopOrderDraftShipping,
  deliveryMethod: NonNullable<NpShopOrderDraft["deliveryMethod"]> | null,
): Promise<NpShopTaxQuote | null> {
  if (!runtime.taxAdapter) return null;
  const requestedAt = new Date();
  const maximumExpiresAt = npShopTaxMaximumExpiry(requestedAt, draft.expiresAt, deliveryMethod);
  if (maximumExpiresAt <= requestedAt) {
    throw new NpShopTaxUnavailableError("The tax quote source expired before calculation.");
  }
  const shippingMinor = deliveryMethod?.amountMinor ?? 0;
  const discountedSubtotalMinor = draft.subtotalMinor - draft.discountMinor;
  const totalBeforeTaxMinor = discountedSubtotalMinor + shippingMinor;
  if (!Number.isSafeInteger(totalBeforeTaxMinor)) {
    throw new NpShopTaxUnavailableError("The pre-tax order total is outside bounds.");
  }
  const request = npRequireShopTaxQuoteRequest({
    contract: NP_SHOP_TAX_QUOTE_REQUEST_CONTRACT,
    draftId: draft.id,
    draftRevision: draft.revision,
    currency: draft.currency,
    subtotalMinor: discountedSubtotalMinor,
    shippingMinor,
    totalBeforeTaxMinor,
    totalUnits: draft.totalUnits,
    lines: draft.lines,
    destination,
    deliveryMethod,
    requestedAt: requestedAt.toISOString(),
    maximumExpiresAt: maximumExpiresAt.toISOString(),
  });
  let result: unknown;
  try {
    result = await runtime.taxAdapter.quoteTax(request);
  } catch {
    await persistTaxHealth(siteId, {
      contract: NP_SHOP_TAX_HEALTH_CONTRACT,
      providerId: runtime.taxAdapter.id,
      status: "error",
      errorCode: "provider-error",
      attemptedAt: requestedAt.toISOString(),
      succeededAt: null,
    });
    throw new NpShopTaxUnavailableError();
  }
  let taxQuote: NpShopTaxQuote;
  try {
    taxQuote = npRequireShopTaxQuoteResult(result, {
      providerId: runtime.taxAdapter.id,
      requestedAt: requestedAt.toISOString(),
      maximumExpiresAt: maximumExpiresAt.toISOString(),
    });
  } catch {
    await persistTaxHealth(siteId, {
      contract: NP_SHOP_TAX_HEALTH_CONTRACT,
      providerId: runtime.taxAdapter.id,
      status: "error",
      errorCode: "invalid-result",
      attemptedAt: requestedAt.toISOString(),
      succeededAt: null,
    });
    throw new NpShopTaxUnavailableError();
  }
  await persistTaxHealth(siteId, {
    contract: NP_SHOP_TAX_HEALTH_CONTRACT,
    providerId: runtime.taxAdapter.id,
    status: "ok",
    errorCode: null,
    attemptedAt: requestedAt.toISOString(),
    succeededAt: requestedAt.toISOString(),
  });
  return taxQuote;
}

function requireSelectedDeliveryMethod(
  runtime: NpShopRuntime,
  draft: NpShopOrderDraft,
  methodId: string,
  now: Date,
): NonNullable<NpShopOrderDraft["deliveryMethod"]> {
  if (
    draft.status !== "shipping-selection-required" ||
    !draft.shippingQuote ||
    !draft.customer ||
    !draft.shipping
  ) {
    throw new NpShopOrderDraftConflictError(
      "order_draft_source_stale",
      "The order draft has no shipping quote to select.",
    );
  }
  if (
    !npIsShopShippingProviderActive(runtime, draft.shippingQuote.providerId) ||
    new Date(draft.shippingQuote.expiresAt) <= now
  ) {
    throw new NpShopShippingUnavailableError(
      "The shipping quote expired or its provider is no longer configured.",
    );
  }
  const method = draft.shippingQuote.methods.find((entry) => entry.id === methodId);
  if (!method) {
    throw new NpShopOrderDraftConflictError(
      "order_draft_source_stale",
      "The selected shipping method is not present in the current quote.",
    );
  }
  return npRequireShopDeliveryMethod({
    contract: NP_SHOP_DELIVERY_METHOD_CONTRACT,
    providerId: draft.shippingQuote.providerId,
    quoteId: draft.shippingQuote.quoteId,
    methodId: method.id,
    label: method.label,
    amountMinor: method.amountMinor,
    estimatedDelivery: method.estimatedDelivery,
    quotedAt: draft.shippingQuote.quotedAt,
    quoteExpiresAt: draft.shippingQuote.expiresAt,
  });
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
    await npLockShopOrderDraftOwner(tx, siteId, owner);
    await npLockShopCart(tx, siteId, owner);
    await npLockShopOrderDraft(tx, siteId, owner, input.idempotencyKey);
    const existing = await npReadStoredShopOrderDraftForUpdate(
      tx,
      siteId,
      owner,
      input.idempotencyKey,
    );
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
      discountMinor: intent.discountMinor,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: intent.totalMinor,
      totalUnits: intent.totalUnits,
      lines: intent.lines,
      promotions: intent.promotions,
      customer: null,
      shipping: null,
      shippingQuote: null,
      deliveryMethod: null,
      taxQuote: null,
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
  const snapshot = await npReadShopOrderDraft(runtime, owner, input.draftId);
  if (snapshot.revision !== input.expectedRevision) {
    throw new NpShopOrderDraftConflictError(
      "order_draft_revision_conflict",
      "The order draft changed before this update.",
    );
  }
  if (snapshot.status === "stale") {
    throw new NpShopOrderDraftConflictError(
      "order_draft_source_stale",
      "The cart changed after this order draft was created.",
    );
  }
  let shippingQuote: NpShopShippingQuote | null = null;
  const requestedAt = new Date();
  const maximumExpiresAt = new Date(
    Math.min(
      requestedAt.getTime() + npShopShippingLimits.maximumQuoteLifetimeSeconds * 1_000,
      new Date(snapshot.expiresAt).getTime(),
    ),
  );
  if (maximumExpiresAt <= requestedAt) throw new NpShopOrderDraftExpiredError();
  const shippingRequest = npRequireShopShippingQuoteRequest({
    contract: NP_SHOP_SHIPPING_QUOTE_REQUEST_CONTRACT,
    draftId: snapshot.id,
    draftRevision: snapshot.revision,
    currency: snapshot.currency,
    subtotalMinor: snapshot.subtotalMinor,
    totalUnits: snapshot.totalUnits,
    lines: snapshot.lines,
    destination: input.shipping,
    requestedAt: requestedAt.toISOString(),
    maximumExpiresAt: maximumExpiresAt.toISOString(),
  });
  if (runtime.shippingAdapter) {
    let result: unknown;
    try {
      result = await runtime.shippingAdapter.quoteShipping(shippingRequest);
    } catch {
      await persistShippingHealth(siteId, {
        contract: NP_SHOP_SHIPPING_HEALTH_CONTRACT,
        providerId: runtime.shippingAdapter.id,
        status: "error",
        errorCode: "provider-error",
        attemptedAt: requestedAt.toISOString(),
        succeededAt: null,
      });
      throw new NpShopShippingUnavailableError();
    }
    try {
      shippingQuote = npRequireShopShippingQuoteResult(result, {
        providerId: runtime.shippingAdapter.id,
        requestedAt: requestedAt.toISOString(),
        maximumExpiresAt: maximumExpiresAt.toISOString(),
      });
    } catch {
      await persistShippingHealth(siteId, {
        contract: NP_SHOP_SHIPPING_HEALTH_CONTRACT,
        providerId: runtime.shippingAdapter.id,
        status: "error",
        errorCode: "invalid-result",
        attemptedAt: requestedAt.toISOString(),
        succeededAt: null,
      });
      throw new NpShopShippingUnavailableError();
    }
    await persistShippingHealth(siteId, {
      contract: NP_SHOP_SHIPPING_HEALTH_CONTRACT,
      providerId: runtime.shippingAdapter.id,
      status: "ok",
      errorCode: null,
      attemptedAt: requestedAt.toISOString(),
      succeededAt: requestedAt.toISOString(),
    });
  } else {
    let result: unknown;
    try {
      result = await npQuoteShopShippingPolicies(runtime, shippingRequest, snapshot.discountMinor);
    } catch (error) {
      if (error instanceof NpShopShippingUnavailableError) throw error;
      throw new NpShopShippingUnavailableError(
        error instanceof Error ? error.message : "The local shipping policies are unavailable.",
      );
    }
    if (result !== null) {
      try {
        shippingQuote = npRequireShopShippingQuoteResult(result, {
          providerId: NP_SHOP_SHIPPING_POLICY_PROVIDER_ID,
          requestedAt: requestedAt.toISOString(),
          maximumExpiresAt: maximumExpiresAt.toISOString(),
        });
      } catch {
        throw new NpShopShippingUnavailableError("The local shipping policy quote is invalid.");
      }
    }
  }
  const taxQuote = shippingQuote
    ? null
    : await quoteTaxForDraft(runtime, siteId, snapshot, input.shipping, null);
  const quotedTotalMinor =
    snapshot.subtotalMinor - snapshot.discountMinor + (taxQuote?.amountMinor ?? 0);
  if (!Number.isSafeInteger(quotedTotalMinor)) {
    throw new NpShopTaxUnavailableError("The taxed order total is outside bounds.");
  }
  const result = await getDb().transaction(async (tx) => {
    await npLockShopOrderDraftOwner(tx, siteId, owner);
    await npLockShopCart(tx, siteId, owner);
    await npLockShopOrderDraft(tx, siteId, owner, input.draftId);
    const current = await npReadStoredShopOrderDraftForUpdate(tx, siteId, owner, input.draftId);
    if (!current) throw new NpShopOrderDraftNotFoundError();
    const now = new Date();
    if (new Date(current.expiresAt) <= now) {
      await tx
        .delete(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, npShopOrderDraftStorageKey(owner, input.draftId)),
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
    if (taxQuote && new Date(taxQuote.expiresAt) <= now) {
      throw new NpShopTaxUnavailableError("The tax quote expired before the draft was updated.");
    }
    const updated = {
      ...current,
      status: shippingQuote ? "shipping-selection-required" : "reviewable",
      revision: current.revision + 1,
      customer: input.customer,
      shipping: input.shipping,
      shippingQuote,
      deliveryMethod: null,
      taxQuote,
      shippingMinor: 0,
      taxMinor: taxQuote?.amountMinor ?? 0,
      totalMinor: quotedTotalMinor,
      updatedAt: now.toISOString(),
    } satisfies NpShopOrderDraft;
    npRequireShopOrderDraft(updated);
    await persistDraft(tx, siteId, owner, updated);
    return updated;
  });
  if (!result) throw new NpShopOrderDraftExpiredError();
  return result;
}

export async function npSelectShopShippingMethod(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopShippingMethodSelectInput,
): Promise<NpShopOrderDraft> {
  const siteId = await requireSiteId();
  const snapshot = await npReadShopOrderDraft(runtime, owner, input.draftId);
  if (snapshot.revision !== input.expectedRevision) {
    throw new NpShopOrderDraftConflictError(
      "order_draft_revision_conflict",
      "The order draft changed before this selection.",
    );
  }
  if (snapshot.status === "stale") {
    throw new NpShopOrderDraftConflictError(
      "order_draft_source_stale",
      "The cart changed after this shipping quote was prepared.",
    );
  }
  const deliverySnapshot = requireSelectedDeliveryMethod(
    runtime,
    snapshot,
    input.methodId,
    new Date(),
  );
  if (!snapshot.shipping) {
    throw new NpShopOrderDraftConflictError(
      "order_draft_source_stale",
      "The order draft has no shipping destination.",
    );
  }
  const taxQuote = await quoteTaxForDraft(
    runtime,
    siteId,
    snapshot,
    snapshot.shipping,
    deliverySnapshot,
  );
  const quotedTotalMinor =
    snapshot.subtotalMinor -
    snapshot.discountMinor +
    deliverySnapshot.amountMinor +
    (taxQuote?.amountMinor ?? 0);
  if (!Number.isSafeInteger(quotedTotalMinor)) {
    throw new NpShopTaxUnavailableError("The taxed order total is outside bounds.");
  }
  return getDb().transaction(async (tx) => {
    await npLockShopOrderDraftOwner(tx, siteId, owner);
    await npLockShopCart(tx, siteId, owner);
    await npLockShopOrderDraft(tx, siteId, owner, input.draftId);
    const current = await npReadStoredShopOrderDraftForUpdate(tx, siteId, owner, input.draftId);
    if (!current) throw new NpShopOrderDraftNotFoundError();
    const now = new Date();
    if (new Date(current.expiresAt) <= now) throw new NpShopOrderDraftExpiredError();
    if (current.revision !== input.expectedRevision) {
      throw new NpShopOrderDraftConflictError(
        "order_draft_revision_conflict",
        "The order draft changed before this selection.",
      );
    }
    const derived = await withDerivedStatus(runtime, owner, current);
    if (derived.status === "stale") {
      throw new NpShopOrderDraftConflictError(
        "order_draft_source_stale",
        "The cart changed after this shipping quote was prepared.",
      );
    }
    const deliveryMethod = requireSelectedDeliveryMethod(runtime, current, input.methodId, now);
    if (taxQuote && new Date(taxQuote.expiresAt) <= now) {
      throw new NpShopTaxUnavailableError("The tax quote expired before selection completed.");
    }
    const updated = {
      ...current,
      status: "reviewable",
      revision: current.revision + 1,
      deliveryMethod,
      shippingMinor: deliveryMethod.amountMinor,
      taxQuote,
      taxMinor: taxQuote?.amountMinor ?? 0,
      totalMinor: quotedTotalMinor,
      updatedAt: now.toISOString(),
    } satisfies NpShopOrderDraft;
    npRequireShopOrderDraft(updated);
    await persistDraft(tx, siteId, owner, updated);
    return updated;
  });
}

export async function npDeleteShopOrderDraft(
  owner: NpShopCartOwner,
  draftId: string,
): Promise<void> {
  const siteId = await requireSiteId();
  await getDb().transaction(async (tx) => {
    await npLockShopOrderDraftOwner(tx, siteId, owner);
    await npLockShopOrderDraft(tx, siteId, owner, draftId);
    await tx
      .delete(npPluginStorage)
      .where(
        and(
          eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
          eq(npPluginStorage.siteId, siteId),
          eq(npPluginStorage.key, npShopOrderDraftStorageKey(owner, draftId)),
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
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
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
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
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
  shippingSelectionRequired: number;
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
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
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
          else if (draft.status === "shipping-selection-required") {
            counts.shippingSelectionRequired += 1;
          } else counts.collecting += 1;
        } catch {
          counts.invalid += 1;
        }
      }
      return counts;
    },
    { collecting: 0, shippingSelectionRequired: 0, reviewable: 0, expired: 0, invalid: 0 },
  );
}
