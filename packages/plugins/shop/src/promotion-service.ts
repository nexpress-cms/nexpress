import { createHash } from "node:crypto";

import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import { npShopPromotionLimits, type NpShopPromotionDefinition } from "./promotion-contract.js";
import type { NpShopPromotionSnapshot } from "./types.js";

const COUNTER_CONTRACT = "np.shop-promotion-counter.v1" as const;
const RESERVATION_CONTRACT = "np.shop-promotion-reservation.v1" as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

interface NpShopPromotionCounter {
  contract: typeof COUNTER_CONTRACT;
  promotionId: string;
  reserved: number;
  redeemed: number;
  updatedAt: string;
}

interface NpShopPromotionReservation {
  contract: typeof RESERVATION_CONTRACT;
  orderId: string;
  ownerHash: string;
  promotionIds: string[];
  status: "reserved" | "redeemed" | "released";
  createdAt: string;
  updatedAt: string;
  purgeAt: string;
}

function ownerHash(ownerSegment: string): string {
  return createHash("sha256").update(ownerSegment).digest("hex");
}

function aggregateKey(promotionId: string): string {
  return `promotion-usage:${promotionId}`;
}

function ownerKey(promotionId: string, hash: string): string {
  return `promotion-owner-usage:${promotionId}:${hash}`;
}

function reservationKey(orderId: string): string {
  return `promotion-reservation:${orderId}`;
}

function requireCounter(value: unknown, promotionId: string): NpShopPromotionCounter {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "contract,promotionId,redeemed,reserved,updatedAt" ||
    (value as Record<string, unknown>).contract !== COUNTER_CONTRACT ||
    (value as Record<string, unknown>).promotionId !== promotionId ||
    !uuidPattern.test(promotionId) ||
    !Number.isSafeInteger((value as Record<string, unknown>).reserved) ||
    ((value as Record<string, unknown>).reserved as number) < 0 ||
    !Number.isSafeInteger((value as Record<string, unknown>).redeemed) ||
    ((value as Record<string, unknown>).redeemed as number) < 0 ||
    !isCanonicalIso((value as Record<string, unknown>).updatedAt)
  ) {
    throw new Error("Invalid Shop promotion usage counter.");
  }
  return value as NpShopPromotionCounter;
}

function requireReservation(value: unknown, orderId: string): NpShopPromotionReservation {
  const record = value as Record<string, unknown>;
  const promotionIds = record?.promotionIds;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "contract,createdAt,orderId,ownerHash,promotionIds,purgeAt,status,updatedAt" ||
    record.contract !== RESERVATION_CONTRACT ||
    record.orderId !== orderId ||
    !uuidPattern.test(orderId) ||
    typeof record.ownerHash !== "string" ||
    !digestPattern.test(record.ownerHash) ||
    !Array.isArray(promotionIds) ||
    promotionIds.length < 1 ||
    promotionIds.length > npShopPromotionLimits.maximumAppliedPromotions ||
    promotionIds.some((id) => typeof id !== "string" || !uuidPattern.test(id)) ||
    JSON.stringify([...promotionIds].sort()) !== JSON.stringify(promotionIds) ||
    new Set(promotionIds).size !== promotionIds.length ||
    !["reserved", "redeemed", "released"].includes(record.status as string) ||
    !isCanonicalIso(record.createdAt) ||
    !isCanonicalIso(record.updatedAt) ||
    !isCanonicalIso(record.purgeAt) ||
    (typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string" &&
      record.updatedAt < record.createdAt) ||
    (typeof record.updatedAt === "string" &&
      typeof record.purgeAt === "string" &&
      record.purgeAt <= record.updatedAt)
  ) {
    throw new Error("Invalid Shop promotion reservation.");
  }
  return value as NpShopPromotionReservation;
}

async function readCounter(
  tx: NpShopTransaction,
  siteId: string,
  key: string,
  promotionId: string,
): Promise<NpShopPromotionCounter> {
  const [row] = await tx
    .select({ value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, key),
      ),
    )
    .limit(1);
  return row
    ? requireCounter(row.value, promotionId)
    : {
        contract: COUNTER_CONTRACT,
        promotionId,
        reserved: 0,
        redeemed: 0,
        updatedAt: new Date(0).toISOString(),
      };
}

async function persistCounter(
  tx: NpShopTransaction,
  siteId: string,
  key: string,
  counter: NpShopPromotionCounter,
): Promise<void> {
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key,
      value: counter,
      expiresAt: null,
      updatedAt: new Date(counter.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: { value: counter, updatedAt: new Date(counter.updatedAt) },
    });
}

async function readReservation(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
): Promise<NpShopPromotionReservation | null> {
  const [row] = await tx
    .select({ value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, reservationKey(orderId)),
      ),
    )
    .limit(1);
  return row ? requireReservation(row.value, orderId) : null;
}

async function persistReservation(
  tx: NpShopTransaction,
  siteId: string,
  reservation: NpShopPromotionReservation,
): Promise<void> {
  await tx
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: reservationKey(reservation.orderId),
      value: reservation,
      expiresAt: new Date(reservation.purgeAt),
      updatedAt: new Date(reservation.updatedAt),
    })
    .onConflictDoUpdate({
      target: [npPluginStorage.pluginId, npPluginStorage.siteId, npPluginStorage.key],
      set: {
        value: reservation,
        expiresAt: new Date(reservation.purgeAt),
        updatedAt: new Date(reservation.updatedAt),
      },
    });
}

async function lockPromotions(
  tx: NpShopTransaction,
  siteId: string,
  promotionIds: string[],
): Promise<void> {
  for (const promotionId of [...promotionIds].sort()) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`np:shop-promotion:${siteId}:${promotionId}`}, 0))`,
    );
  }
}

export async function npFindUnavailableShopPromotions(
  tx: NpShopTransaction | ReturnType<typeof getDb>,
  siteId: string,
  ownerSegment: string,
  definitions: NpShopPromotionDefinition[],
): Promise<Set<string>> {
  if (definitions.length === 0) return new Set();
  const hash = ownerHash(ownerSegment);
  const keys = definitions.flatMap((definition) => [
    aggregateKey(definition.id),
    ownerKey(definition.id, hash),
  ]);
  const rows = await tx
    .select({ key: npPluginStorage.key, value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        inArray(npPluginStorage.key, keys),
      ),
    );
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const unavailable = new Set<string>();
  for (const definition of definitions) {
    const aggregateValue = values.get(aggregateKey(definition.id));
    const ownerValue = values.get(ownerKey(definition.id, hash));
    const aggregate = aggregateValue
      ? requireCounter(aggregateValue, definition.id)
      : { reserved: 0, redeemed: 0 };
    const perOwner = ownerValue
      ? requireCounter(ownerValue, definition.id)
      : { reserved: 0, redeemed: 0 };
    if (
      (definition.totalUsageLimit > 0 &&
        aggregate.reserved + aggregate.redeemed >= definition.totalUsageLimit) ||
      (definition.perOwnerUsageLimit > 0 &&
        perOwner.reserved + perOwner.redeemed >= definition.perOwnerUsageLimit)
    ) {
      unavailable.add(definition.id);
    }
  }
  return unavailable;
}

export async function npReserveShopPromotions(
  tx: NpShopTransaction,
  siteId: string,
  ownerSegment: string,
  orderId: string,
  snapshot: NpShopPromotionSnapshot,
  definitions: NpShopPromotionDefinition[],
  now: Date,
  purgeAt: string,
): Promise<void> {
  const promotionIds = snapshot.applied.map((promotion) => promotion.id).sort();
  if (promotionIds.length === 0) return;
  await lockPromotions(tx, siteId, promotionIds);
  const existing = await readReservation(tx, siteId, orderId);
  if (existing) {
    if (JSON.stringify(existing.promotionIds) !== JSON.stringify(promotionIds)) {
      throw new Error("Shop promotion reservation conflicts with the order snapshot.");
    }
    return;
  }
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const selected = promotionIds.map((id) => byId.get(id));
  if (selected.some((definition) => !definition)) {
    throw new Error("A selected Shop promotion is no longer published.");
  }
  const unavailable = await npFindUnavailableShopPromotions(
    tx,
    siteId,
    ownerSegment,
    selected as NpShopPromotionDefinition[],
  );
  if (unavailable.size > 0) throw new Error("A selected Shop promotion reached its usage limit.");
  const hash = ownerHash(ownerSegment);
  const updatedAt = now.toISOString();
  for (const definition of selected as NpShopPromotionDefinition[]) {
    for (const key of [aggregateKey(definition.id), ownerKey(definition.id, hash)]) {
      const counter = await readCounter(tx, siteId, key, definition.id);
      await persistCounter(tx, siteId, key, {
        ...counter,
        reserved: counter.reserved + 1,
        updatedAt,
      });
    }
  }
  await persistReservation(tx, siteId, {
    contract: RESERVATION_CONTRACT,
    orderId,
    ownerHash: hash,
    promotionIds,
    status: "reserved",
    createdAt: updatedAt,
    updatedAt,
    purgeAt,
  });
}

export async function npResolveShopPromotionReservation(
  tx: NpShopTransaction,
  siteId: string,
  orderId: string,
  outcome: "redeemed" | "released",
  now: Date,
): Promise<void> {
  const reservation = await readReservation(tx, siteId, orderId);
  if (!reservation || reservation.status === outcome) return;
  if (reservation.status !== "reserved") {
    throw new Error("A resolved Shop promotion reservation cannot change outcome.");
  }
  await lockPromotions(tx, siteId, reservation.promotionIds);
  const updatedAt = now.toISOString();
  for (const promotionId of reservation.promotionIds) {
    for (const key of [aggregateKey(promotionId), ownerKey(promotionId, reservation.ownerHash)]) {
      const counter = await readCounter(tx, siteId, key, promotionId);
      if (counter.reserved < 1) throw new Error("Shop promotion reserved usage is missing.");
      await persistCounter(tx, siteId, key, {
        ...counter,
        reserved: counter.reserved - 1,
        redeemed: counter.redeemed + (outcome === "redeemed" ? 1 : 0),
        updatedAt,
      });
    }
  }
  await persistReservation(tx, siteId, {
    ...reservation,
    status: outcome,
    updatedAt,
  });
}

export async function npCountShopPromotionUsage(): Promise<{
  campaigns: number;
  ownerCounters: number;
  reserved: number;
  redeemed: number;
  reservations: number;
  invalid: number;
  truncated: boolean;
}> {
  const siteId = await requireSiteId();
  const rows = await getDb()
    .select({ key: npPluginStorage.key, value: npPluginStorage.value })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        sql`(${npPluginStorage.key} like 'promotion-usage:%' or ${npPluginStorage.key} like 'promotion-owner-usage:%' or ${npPluginStorage.key} like 'promotion-reservation:%')`,
      ),
    )
    .orderBy(asc(npPluginStorage.key))
    .limit(npShopPromotionLimits.diagnosticSampleSize + 1);
  const sampledRows = rows.slice(0, npShopPromotionLimits.diagnosticSampleSize);
  let campaigns = 0;
  let ownerCounters = 0;
  let reserved = 0;
  let redeemed = 0;
  let reservations = 0;
  let invalid = 0;
  for (const row of sampledRows) {
    try {
      if (row.key.startsWith("promotion-usage:")) {
        const promotionId = row.key.slice("promotion-usage:".length);
        const counter = requireCounter(row.value, promotionId);
        campaigns += 1;
        reserved += counter.reserved;
        redeemed += counter.redeemed;
      } else if (row.key.startsWith("promotion-owner-usage:")) {
        const segments = row.key.slice("promotion-owner-usage:".length).split(":");
        if (
          segments.length !== 2 ||
          !uuidPattern.test(segments[0] ?? "") ||
          !digestPattern.test(segments[1] ?? "")
        ) {
          throw new Error("Invalid Shop promotion owner usage key.");
        }
        requireCounter(row.value, segments[0]);
        ownerCounters += 1;
      } else {
        const orderId = row.key.slice("promotion-reservation:".length);
        requireReservation(row.value, orderId);
        reservations += 1;
      }
    } catch {
      invalid += 1;
    }
  }
  return {
    campaigns,
    ownerCounters,
    reserved,
    redeemed,
    reservations,
    invalid,
    truncated: rows.length > npShopPromotionLimits.diagnosticSampleSize,
  };
}
