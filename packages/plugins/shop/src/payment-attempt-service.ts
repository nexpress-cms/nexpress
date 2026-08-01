import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, desc, eq, like, sql } from "drizzle-orm";

import {
  NP_SHOP_PAYMENT_ATTEMPT_CONTRACT,
  NP_SHOP_PAYMENT_HANDOFF_CONTRACT,
  NpShopPaymentAttemptConflictError,
  NpShopPaymentAttemptContractError,
  NpShopPaymentAttemptNotFoundError,
  npProjectShopPaymentAttempt,
  npRequireShopPaymentPrepareResult,
  npRequireStoredShopPaymentAttempt,
  npShopPaymentAttemptLimits,
  type NpShopPaymentAttempt,
  type NpShopPaymentAttemptConfirmInput,
  type NpShopPaymentAttemptCreateInput,
  type NpShopStoredPaymentAttempt,
} from "./payment-attempt-contract.js";
import { npRequireFreshShopPaymentEvent } from "./payment-contract.js";
import {
  NpShopOrderContractError,
  NpShopOrderNotFoundError,
  npRequireStoredShopOrder,
  type NpShopStoredOrder,
} from "./order-contract.js";
import { npApplyShopPaymentEvent, npReadShopOrder } from "./order-service.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import { npShopCartOwnerStorageSegment, type NpShopCartOwner } from "./cart-service.js";
import type { NpShopRuntime } from "./runtime.js";
import type { NpShopOrder } from "./types.js";

export interface NpShopPaymentConfirmationResult {
  attempt: NpShopPaymentAttempt;
  order: NpShopOrder;
  duplicate: boolean;
}

export interface NpShopAdminPaymentAttemptRow {
  [key: string]: unknown;
  provider: string;
  attemptId: string;
  orderId: string;
  status: string;
  total: string;
  createdAt: string;
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ownerSegmentPattern = new RegExp(
  `^(?:guest:[0-9a-f]{64}|member:${canonicalUuidPattern.source.slice(1, -1)})$`,
  "u",
);

function paymentAttemptStorageKey(
  ownerSegment: string,
  orderId: string,
  attemptId: string,
): string {
  return `payment-attempt:${ownerSegment}:${orderId}:${attemptId}`;
}

function orderStorageKey(ownerSegment: string, orderId: string): string {
  return `order:${ownerSegment}:${orderId}`;
}

function ownerSegmentFromAttemptKey(
  key: string,
  attempt: NpShopStoredPaymentAttempt,
): string | null {
  const prefix = "payment-attempt:";
  const suffix = `:${attempt.orderId}:${attempt.id}`;
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return null;
  const ownerSegment = key.slice(prefix.length, -suffix.length);
  return ownerSegmentPattern.test(ownerSegment) ? ownerSegment : null;
}

async function lockAttempt(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
  attemptId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-payment-attempt:${siteId}:${ownerSegment}:${orderId}:${attemptId}`}, 0))`,
  );
}

async function lockOrder(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-order:${siteId}:${ownerSegment}:${orderId}`}, 0))`,
  );
}

function requireAttemptStorage(
  value: unknown,
  key: string,
  expiresAt: Date | null,
  ownerSegment: string,
): NpShopStoredPaymentAttempt {
  const attempt = npRequireStoredShopPaymentAttempt(value);
  if (
    key !== paymentAttemptStorageKey(ownerSegment, attempt.orderId, attempt.id) ||
    expiresAt === null ||
    expiresAt.toISOString() !== attempt.purgeAt
  ) {
    throw new NpShopPaymentAttemptContractError("Invalid payment attempt storage metadata", [
      "Payment attempt key and expiry must match its exact value.",
    ]);
  }
  return attempt;
}

async function readAttemptForUpdate(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
  attemptId: string,
): Promise<NpShopStoredPaymentAttempt | null> {
  const key = paymentAttemptStorageKey(ownerSegment, orderId, attemptId);
  const [row] = await tx
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, key),
      ),
    )
    .limit(1)
    .for("update");
  return row ? requireAttemptStorage(row.value, row.key, row.expiresAt, ownerSegment) : null;
}

async function readOrderForUpdate(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
): Promise<NpShopStoredOrder | null> {
  const key = orderStorageKey(ownerSegment, orderId);
  const [row] = await tx
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, key),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) return null;
  const order = npRequireStoredShopOrder(row.value);
  if (row.key !== key || row.expiresAt === null || row.expiresAt.toISOString() !== order.purgeAt) {
    throw new NpShopOrderContractError("Invalid Shop order storage metadata", [
      "Order storage key and expiry must match its exact value.",
    ]);
  }
  return order;
}

async function persistAttempt(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  attempt: NpShopStoredPaymentAttempt,
): Promise<void> {
  npRequireStoredShopPaymentAttempt(attempt);
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: paymentAttemptStorageKey(ownerSegment, attempt.orderId, attempt.id),
      value: attempt,
      expiresAt: new Date(attempt.purgeAt),
      updatedAt: new Date(attempt.confirmedAt ?? attempt.createdAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: attempt,
        expiresAt: new Date(attempt.purgeAt),
        updatedAt: new Date(attempt.confirmedAt ?? attempt.createdAt),
      },
    });
}

function requirePendingOrder(order: NpShopStoredOrder, now: Date): void {
  if (order.status !== "pending-payment") {
    throw new NpShopPaymentAttemptConflictError(
      "payment_attempt_order_terminal",
      "Only a pending-payment order can start or confirm a payment attempt.",
    );
  }
  if (new Date(order.pendingExpiresAt) <= now) {
    throw new NpShopPaymentAttemptConflictError(
      "payment_attempt_order_terminal",
      "The pending-payment order expired before payment initiation.",
    );
  }
}

function orderName(order: NpShopStoredOrder): string {
  const first = order.lines[0]?.productName ?? "Shop order";
  const suffix = order.lines.length > 1 ? ` and ${order.lines.length - 1} more` : "";
  return `${first}${suffix}`.slice(0, npShopPaymentAttemptLimits.orderNameLength);
}

async function requireAttemptCapacity(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
  now: Date,
): Promise<void> {
  const rows = await tx
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `payment-attempt:${ownerSegment}:${orderId}:%`),
      ),
    )
    .limit(npShopPaymentAttemptLimits.maximumRetainedPerOrder + 1);
  let active = 0;
  for (const row of rows) {
    const attempt = requireAttemptStorage(row.value, row.key, row.expiresAt, ownerSegment);
    if (attempt.status === "prepared" && new Date(attempt.expiresAt) > now) active += 1;
  }
  if (rows.length >= npShopPaymentAttemptLimits.maximumRetainedPerOrder) {
    throw new NpShopPaymentAttemptConflictError(
      "payment_attempt_limit",
      `At most ${npShopPaymentAttemptLimits.maximumRetainedPerOrder.toString()} retained payment attempts are allowed per order.`,
    );
  }
  if (active >= npShopPaymentAttemptLimits.maximumActivePerOrder) {
    throw new NpShopPaymentAttemptConflictError(
      "payment_attempt_limit",
      `At most ${npShopPaymentAttemptLimits.maximumActivePerOrder.toString()} active payment attempts are allowed per order.`,
    );
  }
}

export async function npPrepareShopPaymentAttempt(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopPaymentAttemptCreateInput,
): Promise<NpShopPaymentAttempt> {
  const adapter = runtime.paymentInitiationAdapter;
  if (!adapter) {
    throw new NpShopPaymentAttemptConflictError(
      "payment_attempt_provider_mismatch",
      "No payment initiation provider is configured for this Shop.",
    );
  }
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const snapshot = await getDb().transaction(async (tx) => {
    await lockAttempt(tx, siteId, ownerSegment, input.orderId, input.idempotencyKey);
    const existing = await readAttemptForUpdate(
      tx,
      siteId,
      ownerSegment,
      input.orderId,
      input.idempotencyKey,
    );
    if (existing) return { existing, order: null };
    await lockOrder(tx, siteId, ownerSegment, input.orderId);
    const order = await readOrderForUpdate(tx, siteId, ownerSegment, input.orderId);
    if (!order) throw new NpShopOrderNotFoundError();
    const now = new Date();
    requirePendingOrder(order, now);
    await requireAttemptCapacity(tx, siteId, ownerSegment, input.orderId, now);
    return { existing: null, order };
  });
  if (snapshot.existing) return npProjectShopPaymentAttempt(snapshot.existing);
  const order = snapshot.order;
  const createdAt = new Date();
  const expiresAt = new Date(
    Math.min(
      createdAt.getTime() + npShopPaymentAttemptLimits.ttlSeconds * 1_000,
      new Date(order.pendingExpiresAt).getTime(),
    ),
  );
  const successPath = `${runtime.basePath}/orders/${order.id}?npPayment=success&attempt=${input.idempotencyKey}`;
  const failPath = `${runtime.basePath}/orders/${order.id}?npPayment=fail&attempt=${input.idempotencyKey}`;
  const prepared = npRequireShopPaymentPrepareResult(
    await adapter.preparePayment({
      attemptId: input.idempotencyKey,
      orderId: order.id,
      orderName: orderName(order),
      currency: order.currency,
      amountMinor: order.totalMinor,
      expiresAt: expiresAt.toISOString(),
      successPath,
      failPath,
    }),
  );
  return getDb().transaction(async (tx) => {
    await lockAttempt(tx, siteId, ownerSegment, input.orderId, input.idempotencyKey);
    const existing = await readAttemptForUpdate(
      tx,
      siteId,
      ownerSegment,
      input.orderId,
      input.idempotencyKey,
    );
    if (existing) return npProjectShopPaymentAttempt(existing);
    await lockOrder(tx, siteId, ownerSegment, input.orderId);
    const current = await readOrderForUpdate(tx, siteId, ownerSegment, input.orderId);
    if (!current) throw new NpShopOrderNotFoundError();
    const currentTime = new Date();
    requirePendingOrder(current, currentTime);
    await requireAttemptCapacity(tx, siteId, ownerSegment, input.orderId, currentTime);
    if (
      current.revision !== order.revision ||
      current.currency !== order.currency ||
      current.totalMinor !== order.totalMinor
    ) {
      throw new NpShopPaymentAttemptConflictError(
        "payment_attempt_order_changed",
        "The order changed while its payment handoff was prepared.",
      );
    }
    const handoff = {
      contract: NP_SHOP_PAYMENT_HANDOFF_CONTRACT,
      providerId: adapter.id,
      attemptId: input.idempotencyKey,
      expiresAt: expiresAt.toISOString(),
      ...prepared,
    } as const;
    const attempt: NpShopStoredPaymentAttempt = {
      contract: NP_SHOP_PAYMENT_ATTEMPT_CONTRACT,
      id: input.idempotencyKey,
      orderId: order.id,
      providerId: adapter.id,
      status: "prepared",
      orderRevision: order.revision,
      currency: order.currency,
      amountMinor: order.totalMinor,
      orderName: orderName(order),
      handoff,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      confirmedAt: null,
      paymentReference: null,
      eventId: null,
      purgeAt: order.purgeAt,
    };
    await persistAttempt(tx, siteId, ownerSegment, attempt);
    return npProjectShopPaymentAttempt(attempt);
  });
}

export async function npReadShopPaymentAttempt(
  owner: NpShopCartOwner,
  orderId: string,
  attemptId: string,
): Promise<NpShopPaymentAttempt> {
  if (!canonicalUuidPattern.test(orderId) || !canonicalUuidPattern.test(attemptId)) {
    throw new NpShopPaymentAttemptNotFoundError();
  }
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const result = await getDb().transaction(async (tx) => {
    await lockAttempt(tx, siteId, ownerSegment, orderId, attemptId);
    return readAttemptForUpdate(tx, siteId, ownerSegment, orderId, attemptId);
  });
  if (!result) throw new NpShopPaymentAttemptNotFoundError();
  return npProjectShopPaymentAttempt(result);
}

export async function npConfirmShopPaymentAttempt(
  runtime: NpShopRuntime,
  owner: NpShopCartOwner,
  input: NpShopPaymentAttemptConfirmInput,
): Promise<NpShopPaymentConfirmationResult> {
  const adapter = runtime.paymentInitiationAdapter;
  if (!adapter) {
    throw new NpShopPaymentAttemptConflictError(
      "payment_attempt_provider_mismatch",
      "No payment initiation provider is configured for this Shop.",
    );
  }
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const snapshot = await getDb().transaction(async (tx) => {
    await lockAttempt(tx, siteId, ownerSegment, input.orderId, input.attemptId);
    const attempt = await readAttemptForUpdate(
      tx,
      siteId,
      ownerSegment,
      input.orderId,
      input.attemptId,
    );
    if (!attempt) throw new NpShopPaymentAttemptNotFoundError();
    if (attempt.providerId !== adapter.id) {
      throw new NpShopPaymentAttemptConflictError(
        "payment_attempt_provider_mismatch",
        "The payment attempt belongs to another provider.",
      );
    }
    if (attempt.status === "confirmed") return { attempt, order: null };
    await lockOrder(tx, siteId, ownerSegment, input.orderId);
    const order = await readOrderForUpdate(tx, siteId, ownerSegment, input.orderId);
    if (!order) throw new NpShopOrderNotFoundError();
    if (order.status !== "pending-payment" && order.status !== "paid") {
      throw new NpShopPaymentAttemptConflictError(
        "payment_attempt_order_terminal",
        "Only a pending or matching paid order can confirm a payment attempt.",
      );
    }
    if (order.status === "pending-payment") {
      if (new Date(attempt.expiresAt) <= new Date()) {
        throw new NpShopPaymentAttemptConflictError(
          "payment_attempt_expired",
          "The payment attempt expired before confirmation.",
        );
      }
      requirePendingOrder(order, new Date());
    }
    if (order.currency !== attempt.currency || order.totalMinor !== attempt.amountMinor) {
      throw new NpShopPaymentAttemptConflictError(
        "payment_attempt_order_changed",
        "The immutable order no longer matches its payment attempt.",
      );
    }
    if (order.status === "pending-payment" && order.revision !== attempt.orderRevision) {
      throw new NpShopPaymentAttemptConflictError(
        "payment_attempt_order_changed",
        "The immutable order no longer matches its payment attempt.",
      );
    }
    return { attempt, order };
  });
  const stored = snapshot.attempt;
  if (stored.status === "confirmed") {
    return {
      attempt: npProjectShopPaymentAttempt(stored),
      order: await npReadShopOrder(owner, stored.orderId),
      duplicate: true,
    };
  }
  const receivedAt = new Date();
  const event = npRequireFreshShopPaymentEvent(
    await adapter.confirmPayment({
      attempt: npProjectShopPaymentAttempt(stored, receivedAt),
      confirmation: input.confirmation,
      receivedAt: receivedAt.toISOString(),
    }),
    receivedAt,
  );
  if (
    event.orderId !== stored.orderId ||
    event.currency !== stored.currency ||
    event.amountMinor !== stored.amountMinor ||
    event.type !== "payment.succeeded"
  ) {
    throw new NpShopPaymentAttemptConflictError(
      "payment_confirmation_mismatch",
      "The provider confirmation does not match the exact pending order.",
    );
  }
  let duplicate = true;
  if (snapshot.order?.status === "paid") {
    if (
      snapshot.order.paymentProvider !== adapter.id ||
      snapshot.order.paymentReference !== event.paymentReference
    ) {
      throw new NpShopPaymentAttemptConflictError(
        "payment_confirmation_mismatch",
        "The order was already paid by a different provider payment.",
      );
    }
  } else {
    const applied = await npApplyShopPaymentEvent(runtime, adapter.id, event, receivedAt);
    duplicate = applied.duplicate;
  }
  const paidOrder = await npReadShopOrder(owner, stored.orderId);
  if (
    paidOrder.status !== "paid" ||
    paidOrder.paymentProvider !== adapter.id ||
    paidOrder.paymentReference !== event.paymentReference
  ) {
    throw new NpShopPaymentAttemptConflictError(
      "payment_confirmation_mismatch",
      "Another terminal payment transition won while this attempt was confirmed.",
    );
  }
  const confirmed = await getDb().transaction(async (tx) => {
    await lockAttempt(tx, siteId, ownerSegment, input.orderId, input.attemptId);
    const current = await readAttemptForUpdate(
      tx,
      siteId,
      ownerSegment,
      input.orderId,
      input.attemptId,
    );
    if (!current) throw new NpShopPaymentAttemptNotFoundError();
    if (current.status === "confirmed") return current;
    const next: NpShopStoredPaymentAttempt = {
      ...current,
      status: "confirmed",
      confirmedAt: receivedAt.toISOString(),
      paymentReference: event.paymentReference,
      eventId: paidOrder.paymentEventId ?? event.eventId,
    };
    await persistAttempt(tx, siteId, ownerSegment, next);
    return next;
  });
  return {
    attempt: npProjectShopPaymentAttempt(confirmed),
    order: paidOrder,
    duplicate,
  };
}

export async function npCountShopPaymentAttempts(): Promise<{
  total: number;
  prepared: number;
  confirmed: number;
  expired: number;
  invalidSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      prepared: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'prepared' and ${npPluginStorage.value}->>'expiresAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$' and ${npPluginStorage.value}->>'expiresAt' > ${nowIso})::int`,
      confirmed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'confirmed')::int`,
      expired: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'prepared' and ${npPluginStorage.value}->>'expiresAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$' and ${npPluginStorage.value}->>'expiresAt' <= ${nowIso})::int`,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-attempt:%"),
      ),
    );
  const sample = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-attempt:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPaymentAttemptLimits.diagnosticSampleSize);
  let invalidSample = 0;
  for (const row of sample) {
    try {
      const attempt = npRequireStoredShopPaymentAttempt(row.value);
      const ownerSegment = ownerSegmentFromAttemptKey(row.key, attempt);
      if (!ownerSegment) throw new Error("key mismatch");
      if (
        row.expiresAt === null ||
        row.expiresAt.toISOString() !== attempt.purgeAt ||
        row.key !== paymentAttemptStorageKey(ownerSegment, attempt.orderId, attempt.id)
      ) {
        throw new Error("expiry mismatch");
      }
    } catch {
      invalidSample += 1;
    }
  }
  return { ...counts, invalidSample };
}

export async function npListRecentShopPaymentAttempts(): Promise<{
  rows: NpShopAdminPaymentAttemptRow[];
  total: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-attempt:%"),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopPaymentAttemptLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, "payment-attempt:%"),
      ),
    );
  return {
    rows: rows.map(({ key, value, expiresAt }) => {
      const attempt = npRequireStoredShopPaymentAttempt(value);
      const ownerSegment = ownerSegmentFromAttemptKey(key, attempt);
      if (!ownerSegment) {
        throw new NpShopPaymentAttemptContractError("Invalid payment attempt storage key", [
          "Payment attempt owner key is invalid.",
        ]);
      }
      requireAttemptStorage(value, key, expiresAt, ownerSegment);
      return {
        provider: attempt.providerId,
        attemptId: attempt.id,
        orderId: attempt.orderId,
        status: npProjectShopPaymentAttempt(attempt).status,
        total: `${attempt.currency} ${attempt.amountMinor.toString()}`,
        createdAt: attempt.createdAt,
      };
    }),
    total,
  };
}
