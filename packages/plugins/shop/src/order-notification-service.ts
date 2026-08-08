import { randomUUID } from "node:crypto";

import { createNotification } from "@nexpress/core/community";
import { getDb, npMembers, npNotifications, npPluginStorage } from "@nexpress/core/db";
import { getEmailAdapter, sendEmail } from "@nexpress/core/email";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, desc, eq, inArray, like, lte, or, sql } from "drizzle-orm";

import { npShopCartOwnerStorageSegment, type NpShopCartOwner } from "./cart-service.js";
import {
  NP_SHOP_ORDER_NOTIFICATION_KIND,
  NP_SHOP_ORDER_NOTIFICATION_LIST_CONTRACT,
  NP_SHOP_ORDER_NOTIFICATION_PRIVATE_CONTRACT,
  NP_SHOP_ORDER_NOTIFICATION_STORAGE_CONTRACT,
  NpShopOrderNotificationContractError,
  npAnalyzeShopOrderNotificationPrivate,
  npAnalyzeShopOrderNotificationStorage,
  npProjectShopOrderNotification,
  npRequireShopOrderNotificationPrivate,
  npRequireShopOrderNotificationStorage,
  npShopOrderNotificationLimits,
  type NpShopOrderNotificationKind,
  type NpShopOrderNotificationListWire,
  type NpShopOrderNotificationStorage,
} from "./order-notification-contract.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";

const EVENT_KEY_PREFIX = "order-notification:";
const PRIVATE_KEY_PREFIX = "order-notification-private:";
const retrySeconds = [60, 300, 1_800, 7_200] as const;

interface StoredRow {
  key: string;
  value: unknown;
  expiresAt: Date | null;
}

export interface NpStageShopOrderNotificationInput {
  orderId: string;
  ownerSegment: string;
  kind: NpShopOrderNotificationKind;
  orderRevision: number;
  occurredAt: string;
  purgeAt: string;
  email: string | null;
}

export interface NpShopOrderNotificationProcessResult {
  inspected: number;
  completed: number;
  deferred: number;
  attention: number;
  invalid: number;
  cleaned: number;
}

export interface NpShopOrderNotificationInspection {
  pending: number;
  claimed: number;
  completed: number;
  attention: number;
  expiredPrivate: number;
  invalidSample: number;
  invalidPrivateSample: number;
  orphanPrivateSample: number;
  staleClaimSample: number;
  sampleBoundReached: boolean;
}

export interface NpShopOrderNotificationAdminRow {
  [key: string]: unknown;
  eventId: string;
  orderId: string;
  kind: NpShopOrderNotificationKind;
  status: NpShopOrderNotificationStorage["status"];
  inboxStatus: NpShopOrderNotificationStorage["inboxStatus"];
  emailStatus: NpShopOrderNotificationStorage["emailStatus"];
  attempts: number;
  occurredAt: string;
  lastErrorCode: string | null;
}

function eventStorageKey(orderId: string, kind: NpShopOrderNotificationKind): string {
  return `${EVENT_KEY_PREFIX}${orderId}:${kind}`;
}

function privateStorageKey(eventId: string): string {
  return `${PRIVATE_KEY_PREFIX}${eventId}`;
}

function plusSeconds(value: Date, seconds: number): string {
  return new Date(value.getTime() + seconds * 1_000).toISOString();
}

function requireEventRow(row: StoredRow): NpShopOrderNotificationStorage {
  const value = npRequireShopOrderNotificationStorage(row.value);
  if (
    row.key !== eventStorageKey(value.orderId, value.kind) ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== value.purgeAt
  ) {
    throw new NpShopOrderNotificationContractError("Invalid Shop order notification row", [
      "order notification storage key or expiry does not match its value.",
    ]);
  }
  return value;
}

function requirePrivateRow(row: StoredRow) {
  const value = npRequireShopOrderNotificationPrivate(row.value);
  if (
    row.key !== privateStorageKey(value.eventId) ||
    row.expiresAt === null ||
    row.expiresAt.toISOString() !== value.expiresAt
  ) {
    throw new NpShopOrderNotificationContractError("Invalid Shop order notification private row", [
      "private recipient storage key or expiry does not match its value.",
    ]);
  }
  return value;
}

function normalizeEmail(value: string | null): string | null {
  if (value === null) return null;
  return value.trim().toLowerCase();
}

export async function npStageShopOrderNotification(
  tx: NpShopTransaction,
  siteId: string,
  input: NpStageShopOrderNotificationInput,
): Promise<void> {
  const occurredAt = new Date(input.occurredAt);
  const purgeAt = new Date(input.purgeAt);
  const eventId = randomUUID();
  const memberOwned = input.ownerSegment.startsWith("member:");
  const email = normalizeEmail(input.email);
  const hasEmailChannel = email !== null || memberOwned;
  const hasInboxChannel = memberOwned;
  const completed = !hasEmailChannel && !hasInboxChannel;
  const value = npRequireShopOrderNotificationStorage({
    contract: NP_SHOP_ORDER_NOTIFICATION_STORAGE_CONTRACT,
    id: eventId,
    orderId: input.orderId,
    ownerSegment: input.ownerSegment,
    kind: input.kind,
    orderRevision: input.orderRevision,
    occurredAt: occurredAt.toISOString(),
    status: completed ? "completed" : "pending",
    inboxStatus: hasInboxChannel ? "pending" : "not-applicable",
    emailStatus: hasEmailChannel ? "pending" : "not-applicable",
    notificationId: null,
    attempts: 0,
    claimId: null,
    claimedAt: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    lastErrorCode: null,
    completedAt: completed ? occurredAt.toISOString() : null,
    purgeAt: purgeAt.toISOString(),
  });
  const [inserted] = await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: eventStorageKey(input.orderId, input.kind),
      value,
      expiresAt: purgeAt,
      updatedAt: occurredAt,
    })
    .onConflictDoNothing()
    .returning({ key: npPluginStorage.key });
  if (!inserted) {
    const [existingRow] = await tx
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
          eq(npPluginStorage.key, eventStorageKey(input.orderId, input.kind)),
        ),
      )
      .limit(1);
    if (!existingRow) {
      throw new NpShopOrderNotificationContractError(
        "Shop order notification conflict disappeared",
        ["the conflicting order notification row must remain visible in its transaction."],
      );
    }
    const existing = requireEventRow(existingRow);
    if (
      existing.orderId !== value.orderId ||
      existing.ownerSegment !== value.ownerSegment ||
      existing.kind !== value.kind ||
      existing.orderRevision !== value.orderRevision ||
      existing.occurredAt !== value.occurredAt ||
      existing.purgeAt !== value.purgeAt
    ) {
      throw new NpShopOrderNotificationContractError("Shop order notification conflict", [
        "the existing semantic event does not match this exact order transition.",
      ]);
    }
    return;
  }
  if (email === null) return;
  const privateExpiresAt = new Date(
    Math.min(
      occurredAt.getTime() + npShopOrderNotificationLimits.privateTtlSeconds * 1_000,
      purgeAt.getTime(),
    ),
  );
  const privateValue = npRequireShopOrderNotificationPrivate({
    contract: NP_SHOP_ORDER_NOTIFICATION_PRIVATE_CONTRACT,
    eventId,
    orderId: input.orderId,
    email,
    createdAt: occurredAt.toISOString(),
    expiresAt: privateExpiresAt.toISOString(),
  });
  await tx.insert(npPluginStorage).values({
    pluginId: NP_SHOP_PLUGIN_ID,
    siteId,
    key: privateStorageKey(eventId),
    value: privateValue,
    expiresAt: privateExpiresAt,
    updatedAt: occurredAt,
  });
}

export async function npListShopOrderNotifications(
  owner: NpShopCartOwner,
  orderId: string,
): Promise<NpShopOrderNotificationListWire> {
  const siteId = await requireSiteId();
  const ownerSegment = npShopCartOwnerStorageSegment(owner);
  const rows = await getDb()
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
        like(npPluginStorage.key, `${EVENT_KEY_PREFIX}${orderId}:%`),
        sql`${npPluginStorage.value}->>'ownerSegment' = ${ownerSegment}`,
      ),
    )
    .orderBy(asc(sql`${npPluginStorage.value}->>'occurredAt'`), asc(npPluginStorage.key))
    .limit(npShopOrderNotificationLimits.timelineSize + 1);
  if (rows.length > npShopOrderNotificationLimits.timelineSize) {
    throw new NpShopOrderNotificationContractError("Invalid Shop order notification timeline", [
      "order notification timeline exceeds its fixed event bound.",
    ]);
  }
  return {
    contract: NP_SHOP_ORDER_NOTIFICATION_LIST_CONTRACT,
    events: rows.map((row) => npProjectShopOrderNotification(requireEventRow(row))),
  };
}

async function claimEvent(
  siteId: string,
  row: StoredRow,
  event: NpShopOrderNotificationStorage,
  now: Date,
): Promise<NpShopOrderNotificationStorage | null> {
  const claimId = randomUUID();
  const claimedAt = now.toISOString();
  const value = npRequireShopOrderNotificationStorage({
    ...event,
    status: "claimed",
    claimId,
    claimedAt,
    leaseExpiresAt: plusSeconds(now, npShopOrderNotificationLimits.leaseSeconds),
    completedAt: null,
  });
  const updated = await getDb()
    .update(npPluginStorage)
    .set({ value, updatedAt: now })
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, row.key),
        sql`${npPluginStorage.value}->>'id' = ${event.id}`,
        or(
          sql`${npPluginStorage.value}->>'status' = 'pending'`,
          and(
            sql`${npPluginStorage.value}->>'status' = 'claimed'`,
            sql`${npPluginStorage.value}->>'leaseExpiresAt' <= ${now.toISOString()}`,
          ),
        ),
      ),
    )
    .returning({ key: npPluginStorage.key });
  return updated.length === 1 ? value : null;
}

async function findExistingInboxNotification(
  siteId: string,
  memberId: string,
  eventId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: npNotifications.id })
    .from(npNotifications)
    .where(
      and(
        eq(npNotifications.siteId, siteId),
        eq(npNotifications.memberId, memberId),
        eq(npNotifications.kind, NP_SHOP_ORDER_NOTIFICATION_KIND),
        sql`${npNotifications.payload}->>'eventId' = ${eventId}`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function resolveEmail(
  siteId: string,
  event: NpShopOrderNotificationStorage,
  now: Date,
): Promise<string | null> {
  const db = getDb();
  const [privateRow] = await db
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
        eq(npPluginStorage.key, privateStorageKey(event.id)),
        sql`${npPluginStorage.expiresAt} > ${now}`,
      ),
    )
    .limit(1);
  if (privateRow) {
    const value = requirePrivateRow(privateRow);
    if (value.eventId !== event.id || value.orderId !== event.orderId) {
      throw new NpShopOrderNotificationContractError(
        "Invalid Shop order notification private row",
        ["private recipient row metadata does not match its event."],
      );
    }
    return value.email;
  }
  if (!event.ownerSegment.startsWith("member:")) return null;
  const memberId = event.ownerSegment.slice("member:".length);
  const [member] = await db
    .select({ email: npMembers.email })
    .from(npMembers)
    .where(and(eq(npMembers.id, memberId), eq(npMembers.status, "active")))
    .limit(1);
  return member?.email.trim().toLowerCase() ?? null;
}

const eventLabels: Record<NpShopOrderNotificationKind, string> = {
  "order.created": "Order created",
  "order.cancelled": "Order cancelled",
  "payment.succeeded": "Payment confirmed",
  "payment.failed": "Payment failed",
  "fulfillment.processing": "Order processing",
  "fulfillment.shipped": "Order shipped",
  "delivery.delivered": "Order delivered",
  "return.requested": "Return requested",
  "return.cancelled": "Return cancelled",
  "return.approved": "Return approved",
  "return.rejected": "Return rejected",
  "return.received": "Return received",
  "refund.completed": "Refund completed",
  "partial-refund.completed": "Partial refund completed",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absoluteEmailHref(relativeHref: string): string {
  const configured = process.env.SITE_URL?.trim();
  if (!configured) return relativeHref;
  try {
    const origin = new URL(configured);
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") ||
      origin.username ||
      origin.password
    ) {
      return relativeHref;
    }
    return new URL(relativeHref, origin.origin).toString();
  } catch {
    return relativeHref;
  }
}

export function npBuildShopOrderNotificationEmail(
  event: NpShopOrderNotificationStorage,
  href: string,
): { subject: string; text: string; html: string } {
  const label = eventLabels[event.kind];
  const orderReference = event.orderId.slice(0, 8);
  const subject = `${label} · ${orderReference}`;
  const text = `${label}\n\nOrder: ${orderReference}\nView order: ${href}\nEvent reference: ${event.id}`;
  return {
    subject,
    text,
    html: `<h1>${escapeHtml(label)}</h1><p>Order: <strong>${escapeHtml(orderReference)}</strong></p><p><a href="${escapeHtml(href)}">View order</a></p><p>Event reference: ${escapeHtml(event.id)}</p>`,
  };
}

async function deliverClaimedEvent(
  siteId: string,
  event: NpShopOrderNotificationStorage,
  basePath: string,
  now: Date,
): Promise<NpShopOrderNotificationStorage> {
  let inboxStatus = event.inboxStatus;
  let emailStatus = event.emailStatus;
  let notificationId = event.notificationId;
  let failed = false;
  if (inboxStatus === "pending") {
    const memberId = event.ownerSegment.slice("member:".length);
    try {
      notificationId = await findExistingInboxNotification(siteId, memberId, event.id);
      if (!notificationId) {
        const created = await createNotification({
          memberId,
          kind: NP_SHOP_ORDER_NOTIFICATION_KIND,
          payload: {
            eventId: event.id,
            eventKind: event.kind,
            orderId: event.orderId,
            href: `${basePath}/orders/${event.orderId}`,
            title: eventLabels[event.kind],
          },
        });
        notificationId = created?.id ?? null;
      }
      inboxStatus = notificationId ? "sent" : "suppressed";
    } catch {
      failed = true;
    }
  }
  if (emailStatus === "pending") {
    try {
      const email = await resolveEmail(siteId, event, now);
      let deliveredStatus: NpShopOrderNotificationStorage["emailStatus"];
      if (email) {
        if (getEmailAdapter().kind === "noop") {
          deliveredStatus = "suppressed";
        } else {
          await sendEmail({
            to: email,
            ...npBuildShopOrderNotificationEmail(
              event,
              absoluteEmailHref(`${basePath}/orders/${event.orderId}`),
            ),
          });
          deliveredStatus = "sent";
        }
      } else {
        deliveredStatus = "not-applicable";
      }
      await getDb()
        .delete(npPluginStorage)
        .where(
          and(
            eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
            eq(npPluginStorage.siteId, siteId),
            eq(npPluginStorage.key, privateStorageKey(event.id)),
          ),
        );
      emailStatus = deliveredStatus;
    } catch {
      failed = true;
    }
  }
  const attempts = failed ? event.attempts + 1 : event.attempts;
  const terminal = [inboxStatus, emailStatus].every((status) =>
    ["sent", "suppressed", "not-applicable"].includes(status),
  );
  const attention = failed && attempts >= npShopOrderNotificationLimits.maximumAttempts;
  return npRequireShopOrderNotificationStorage({
    ...event,
    status: terminal ? "completed" : attention ? "attention" : "pending",
    inboxStatus: attention && inboxStatus === "pending" ? "attention" : inboxStatus,
    emailStatus: attention && emailStatus === "pending" ? "attention" : emailStatus,
    notificationId,
    attempts,
    claimId: null,
    claimedAt: null,
    leaseExpiresAt: null,
    nextAttemptAt:
      terminal || attention ? null : plusSeconds(now, retrySeconds[Math.min(attempts - 1, 3)]),
    lastErrorCode: attention ? "delivery-failed" : failed ? "delivery-failed" : null,
    completedAt: terminal ? now.toISOString() : null,
  });
}

async function finishEvent(
  siteId: string,
  row: StoredRow,
  claimed: NpShopOrderNotificationStorage,
  value: NpShopOrderNotificationStorage,
  now: Date,
): Promise<boolean> {
  const updated = await getDb()
    .update(npPluginStorage)
    .set({ value, updatedAt: now })
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, row.key),
        sql`${npPluginStorage.value}->>'id' = ${claimed.id}`,
        sql`${npPluginStorage.value}->>'claimId' = ${claimed.claimId}`,
      ),
    )
    .returning({ key: npPluginStorage.key });
  return updated.length === 1;
}

export async function npCleanupShopOrderNotifications(now = new Date()): Promise<number> {
  const siteId = await requireSiteId();
  const db = getDb();
  const rows = await db
    .select({ key: npPluginStorage.key })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        or(
          and(
            like(npPluginStorage.key, `${EVENT_KEY_PREFIX}%`),
            lte(npPluginStorage.expiresAt, now),
          ),
          and(
            like(npPluginStorage.key, `${PRIVATE_KEY_PREFIX}%`),
            lte(npPluginStorage.expiresAt, now),
          ),
        ),
      ),
    )
    .orderBy(asc(npPluginStorage.expiresAt), asc(npPluginStorage.key))
    .limit(npShopOrderNotificationLimits.cleanupBatchSize);
  if (rows.length === 0) return 0;
  const deleted = await db
    .delete(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        inArray(
          npPluginStorage.key,
          rows.map((row) => row.key),
        ),
        lte(npPluginStorage.expiresAt, now),
      ),
    )
    .returning({ key: npPluginStorage.key });
  return deleted.length;
}

export async function npProcessShopOrderNotifications(
  basePath: string,
): Promise<NpShopOrderNotificationProcessResult> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
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
        like(npPluginStorage.key, `${EVENT_KEY_PREFIX}%`),
        sql`${npPluginStorage.expiresAt} > ${now}`,
        or(
          and(
            sql`${npPluginStorage.value}->>'status' = 'pending'`,
            or(
              sql`${npPluginStorage.value}->>'nextAttemptAt' is null`,
              sql`${npPluginStorage.value}->>'nextAttemptAt' <= ${now.toISOString()}`,
            ),
          ),
          and(
            sql`${npPluginStorage.value}->>'status' = 'claimed'`,
            sql`${npPluginStorage.value}->>'leaseExpiresAt' <= ${now.toISOString()}`,
          ),
        ),
      ),
    )
    .orderBy(asc(npPluginStorage.updatedAt), asc(npPluginStorage.key))
    .limit(npShopOrderNotificationLimits.processingBatchSize);
  const result: NpShopOrderNotificationProcessResult = {
    inspected: rows.length,
    completed: 0,
    deferred: 0,
    attention: 0,
    invalid: 0,
    cleaned: 0,
  };
  for (const row of rows) {
    let event: NpShopOrderNotificationStorage;
    try {
      event = requireEventRow(row);
    } catch {
      result.invalid += 1;
      continue;
    }
    const claimed = await claimEvent(siteId, row, event, now);
    if (!claimed) continue;
    const next = await deliverClaimedEvent(siteId, claimed, basePath, now);
    if (!(await finishEvent(siteId, row, claimed, next, now))) continue;
    if (next.status === "completed") result.completed += 1;
    else if (next.status === "attention") result.attention += 1;
    else result.deferred += 1;
  }
  result.cleaned = await npCleanupShopOrderNotifications(now);
  return result;
}

export async function npInspectShopOrderNotifications(): Promise<NpShopOrderNotificationInspection> {
  const siteId = await requireSiteId();
  const db = getDb();
  const now = new Date();
  const base = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, `${EVENT_KEY_PREFIX}%`),
  );
  const [counts = { pending: 0, claimed: 0, completed: 0, attention: 0 }] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'pending')::int`,
      claimed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'claimed')::int`,
      completed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'completed')::int`,
      attention: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'attention')::int`,
    })
    .from(npPluginStorage)
    .where(base);
  const sample = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(base)
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopOrderNotificationLimits.diagnosticSampleSize + 1);
  const privateSample = await db
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
        like(npPluginStorage.key, `${PRIVATE_KEY_PREFIX}%`),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(npShopOrderNotificationLimits.diagnosticSampleSize + 1);
  let invalidSample = 0;
  let staleClaimSample = 0;
  for (const row of sample.slice(0, npShopOrderNotificationLimits.diagnosticSampleSize)) {
    try {
      const event = requireEventRow(row);
      if (
        event.status === "claimed" &&
        event.leaseExpiresAt !== null &&
        new Date(event.leaseExpiresAt) <= now
      ) {
        staleClaimSample += 1;
      }
    } catch {
      invalidSample += 1;
    }
  }
  let invalidPrivateSample = 0;
  const privateEventIds: string[] = [];
  for (const row of privateSample.slice(0, npShopOrderNotificationLimits.diagnosticSampleSize)) {
    try {
      privateEventIds.push(requirePrivateRow(row).eventId);
    } catch {
      invalidPrivateSample += 1;
    }
  }
  const matchingEvents =
    privateEventIds.length === 0
      ? []
      : await db
          .select({ id: sql<string>`${npPluginStorage.value}->>'id'` })
          .from(npPluginStorage)
          .where(
            and(
              eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
              eq(npPluginStorage.siteId, siteId),
              like(npPluginStorage.key, `${EVENT_KEY_PREFIX}%`),
              inArray(sql<string>`${npPluginStorage.value}->>'id'`, privateEventIds),
            ),
          );
  const matchingEventIds = new Set(matchingEvents.map((row) => row.id));
  const orphanPrivateSample = privateEventIds.filter((id) => !matchingEventIds.has(id)).length;
  const [expired = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        like(npPluginStorage.key, `${PRIVATE_KEY_PREFIX}%`),
        lte(npPluginStorage.expiresAt, now),
      ),
    );
  return {
    ...counts,
    expiredPrivate: expired.count,
    invalidSample,
    invalidPrivateSample,
    orphanPrivateSample,
    staleClaimSample,
    sampleBoundReached:
      sample.length > npShopOrderNotificationLimits.diagnosticSampleSize ||
      privateSample.length > npShopOrderNotificationLimits.diagnosticSampleSize,
  };
}

export async function npListRecentShopOrderNotifications(): Promise<
  NpShopOrderNotificationAdminRow[]
> {
  const siteId = await requireSiteId();
  const rows = await getDb()
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
        like(npPluginStorage.key, `${EVENT_KEY_PREFIX}%`),
      ),
    )
    .orderBy(desc(npPluginStorage.updatedAt))
    .limit(50);
  return rows.flatMap((row) => {
    try {
      const event = requireEventRow(row);
      return [
        {
          eventId: event.id,
          orderId: event.orderId,
          kind: event.kind,
          status: event.status,
          inboxStatus: event.inboxStatus,
          emailStatus: event.emailStatus,
          attempts: event.attempts,
          occurredAt: event.occurredAt,
          lastErrorCode: event.lastErrorCode,
        },
      ];
    } catch {
      return [];
    }
  });
}

export async function npRetryShopOrderNotifications(): Promise<number> {
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
        like(npPluginStorage.key, `${EVENT_KEY_PREFIX}%`),
        sql`${npPluginStorage.value}->>'status' = 'attention'`,
      ),
    )
    .orderBy(asc(npPluginStorage.updatedAt))
    .limit(npShopOrderNotificationLimits.processingBatchSize);
  let retried = 0;
  for (const row of rows) {
    let event: NpShopOrderNotificationStorage;
    try {
      event = requireEventRow(row);
    } catch {
      continue;
    }
    const value = npRequireShopOrderNotificationStorage({
      ...event,
      status: "pending",
      inboxStatus: event.inboxStatus === "attention" ? "pending" : event.inboxStatus,
      emailStatus: event.emailStatus === "attention" ? "pending" : event.emailStatus,
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
    });
    const updated = await db
      .update(npPluginStorage)
      .set({ value, updatedAt: new Date() })
      .where(
        and(
          eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
          eq(npPluginStorage.siteId, siteId),
          eq(npPluginStorage.key, row.key),
          sql`${npPluginStorage.value}->>'id' = ${event.id}`,
          sql`${npPluginStorage.value}->>'status' = 'attention'`,
        ),
      )
      .returning({ key: npPluginStorage.key });
    retried += updated.length;
  }
  return retried;
}

export function npAnalyzeShopOrderNotificationRowsForDoctor(rows: readonly StoredRow[]): {
  invalid: number;
  expiredPrivate: number;
} {
  let invalid = 0;
  let expiredPrivate = 0;
  const now = new Date();
  for (const row of rows) {
    if (row.key.startsWith(EVENT_KEY_PREFIX)) {
      invalid += npAnalyzeShopOrderNotificationStorage(row.value).length > 0 ? 1 : 0;
    } else if (row.key.startsWith(PRIVATE_KEY_PREFIX)) {
      invalid += npAnalyzeShopOrderNotificationPrivate(row.value).length > 0 ? 1 : 0;
      if (row.expiresAt !== null && row.expiresAt <= now) expiredPrivate += 1;
    }
  }
  return { invalid, expiredPrivate };
}
