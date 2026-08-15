import { randomUUID } from "node:crypto";

import { getDb, npAuditEvents, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, desc, eq, like, sql } from "drizzle-orm";

import { NpShopCarrierProviderError, NpShopCarrierUnavailableError } from "./carrier-contract.js";
import {
  npReadShopCarrierLabelSource,
  npReadStoredShopCarrierLabelAcquisition,
  npShopCarrierLabelAcquisitionMatchesSource,
} from "./label-acquisition-service.js";
import {
  NP_SHOP_CARRIER_LABEL_VOID_REQUEST_CONTRACT,
  NP_SHOP_CARRIER_LABEL_VOID_STORAGE_CONTRACT,
  NpShopCarrierLabelVoidConflictError,
  NpShopCarrierLabelVoidContractError,
  npRequireShopCarrierLabelVoidRequest,
  npRequireShopCarrierLabelVoidResult,
  npShopCarrierLabelVoidLimits,
  type NpShopCarrierLabelVoidActionInput,
  type NpShopCarrierLabelVoidResult,
  type NpShopStoredCarrierLabelVoid,
} from "./label-void-contract.js";
import {
  npPersistShopCarrierLabelVoid,
  npReadStoredShopCarrierLabelVoid,
  npRequireStoredShopCarrierLabelVoidAtKey,
  npShopCarrierLabelVoidIsCompletedPredecessor,
  npShopCarrierLabelVoidMatchesAcquisition,
} from "./label-void-storage.js";
import { NP_SHOP_PLUGIN_ID, type NpShopTransaction } from "./order-draft-service.js";
import type { NpShopRuntime } from "./runtime.js";
import {
  npRequireStoredShopTracking,
  npShopExchangeTrackingStorageKey,
  npShopTrackingStorageKey,
} from "./tracking-contract.js";

export interface NpShopAdminCarrierLabelVoidRow {
  [key: string]: unknown;
  id: string;
  voidId: string;
  acquisitionId: string;
  shipmentId: string;
  target: string;
  exchangeId: string | null;
  provider: string;
  status: string;
  generation: number;
  labelReference: string;
  providerError: string;
  expectedAcquisitionRevision: number;
  expectedVoidRevision: number;
  resumeEligible: boolean;
  updatedAt: string;
}

async function hasTracking(
  tx: ReturnType<typeof getDb> | NpShopTransaction,
  siteId: string,
  target: NpShopStoredCarrierLabelVoid["target"],
  orderId: string,
  shipmentId: string,
  purgeAt: string,
  forUpdate: boolean,
): Promise<boolean> {
  const key =
    target === "replacement"
      ? npShopExchangeTrackingStorageKey(orderId)
      : npShopTrackingStorageKey(orderId);
  let query = tx
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
    .limit(1);
  if (forUpdate) query = query.for("update") as typeof query;
  const [row] = await query;
  if (!row) return false;
  const tracking = npRequireStoredShopTracking(row.value);
  if (
    row.key !== key ||
    row.expiresAt?.toISOString() !== tracking.purgeAt ||
    tracking.orderId !== orderId ||
    tracking.shipmentId !== shipmentId ||
    tracking.purgeAt !== purgeAt
  ) {
    throw new NpShopCarrierLabelVoidContractError("Invalid carrier label void tracking source", [
      "tracking identity and retention must match the exact label shipment.",
    ]);
  }
  return true;
}

function requireInputIdentity(
  input: NpShopCarrierLabelVoidActionInput,
  acquisition: NonNullable<Awaited<ReturnType<typeof npReadStoredShopCarrierLabelAcquisition>>>,
): void {
  if (
    input.orderId !== acquisition.orderId ||
    input.shipmentId !== acquisition.shipmentId ||
    input.target !== acquisition.target ||
    input.exchangeId !== acquisition.exchangeId ||
    input.acquisitionId !== acquisition.id ||
    input.generation !== acquisition.generation
  ) {
    throw new NpShopCarrierLabelVoidConflictError(
      "label_void_acquisition_not_found",
      "The selected label generation no longer matches this shipment.",
    );
  }
}

function nextTimestamp(...values: Array<string | null>): string {
  return new Date(
    Math.max(Date.now(), ...values.flatMap((value) => (value ? [new Date(value).getTime()] : []))),
  ).toISOString();
}

function closedProviderCode(error: NpShopCarrierProviderError): string {
  const code = error.code.trim();
  return /^[a-z][a-z0-9-]{0,99}$/u.test(code) ? code : "provider-error";
}

async function recordAudit(
  tx: NpShopTransaction,
  siteId: string,
  userId: string,
  action: string,
  state: NpShopStoredCarrierLabelVoid,
): Promise<void> {
  await tx.insert(npAuditEvents).values({
    actorKind: "staff",
    actorUserId: userId,
    actorMemberId: null,
    action,
    targetType: "shop-order",
    targetId: state.orderId,
    payload: {
      voidId: state.id,
      acquisitionId: state.acquisitionId,
      shipmentId: state.shipmentId,
      target: state.target,
      exchangeId: state.exchangeId,
      providerId: state.providerId,
      generation: state.generation,
    },
    siteId,
  });
}

async function markManualReview(
  siteId: string,
  shipmentId: string,
  voidId: string,
  providerErrorCode: string,
  expectedStatuses: readonly NpShopStoredCarrierLabelVoid["status"][],
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const current = await npReadStoredShopCarrierLabelVoid(tx, siteId, shipmentId, true);
    if (!current || current.id !== voidId || !expectedStatuses.includes(current.status)) return;
    await npPersistShopCarrierLabelVoid(tx, siteId, {
      ...current,
      status: "manual-review",
      revision: current.revision + 1,
      providerErrorCode,
      updatedAt: nextTimestamp(current.updatedAt, current.voidedAt),
    });
  });
}

export async function npVoidShopCarrierShippingLabel(
  runtime: NpShopRuntime,
  input: NpShopCarrierLabelVoidActionInput,
  staffUserId: string,
): Promise<{ state: NpShopStoredCarrierLabelVoid; duplicate: boolean }> {
  const siteId = await requireSiteId();
  const candidateAcquisition = await npReadStoredShopCarrierLabelAcquisition(
    getDb(),
    siteId,
    input.shipmentId,
  );
  const expectedProviderId = candidateAcquisition?.providerId;
  if (!expectedProviderId) {
    throw new NpShopCarrierLabelVoidConflictError(
      "label_void_acquisition_not_found",
      "The exact completed label acquisition no longer exists.",
    );
  }
  const prepared = await getDb().transaction(async (tx) => {
    const source = await npReadShopCarrierLabelSource(
      tx,
      siteId,
      { orderId: input.orderId, shipmentId: input.shipmentId },
      expectedProviderId,
      true,
    );
    const acquisition = await npReadStoredShopCarrierLabelAcquisition(
      tx,
      siteId,
      input.shipmentId,
      true,
    );
    if (
      !acquisition ||
      acquisition.status !== "completed" ||
      acquisition.labelReference === null ||
      !npShopCarrierLabelAcquisitionMatchesSource(acquisition, source)
    ) {
      throw new NpShopCarrierLabelVoidConflictError(
        "label_void_acquisition_not_found",
        "Only the exact completed current label generation can be voided.",
      );
    }
    requireInputIdentity(input, acquisition);
    const current = await npReadStoredShopCarrierLabelVoid(tx, siteId, input.shipmentId, true);
    const currentMatches = current
      ? npShopCarrierLabelVoidMatchesAcquisition(current, acquisition)
      : false;
    if (
      current &&
      !currentMatches &&
      !npShopCarrierLabelVoidIsCompletedPredecessor(current, acquisition)
    ) {
      throw new NpShopCarrierLabelVoidConflictError(
        "label_void_state_conflict",
        "The durable label void belongs to another current label generation.",
      );
    }
    if (
      acquisition.revision !== input.expectedAcquisitionRevision ||
      (current?.revision ?? 0) !== input.expectedVoidRevision
    ) {
      throw new NpShopCarrierLabelVoidConflictError(
        "label_void_revision_conflict",
        "The label acquisition or void state changed before this action started.",
      );
    }
    if (currentMatches && current?.status === "manual-review") {
      throw new NpShopCarrierLabelVoidConflictError(
        "label_void_manual_review",
        "The current label void requires manual reconciliation.",
      );
    }
    if (
      currentMatches &&
      (current?.status === "pending" || current?.status === "provider-confirmed")
    ) {
      return { state: current };
    }
    if (currentMatches && current?.status === "completed") {
      return { state: current, complete: true as const };
    }
    if (
      !runtime.carrierLabelVoidAdapter ||
      runtime.carrierLabelVoidAdapter.id !== acquisition.providerId
    ) {
      throw new NpShopCarrierLabelVoidConflictError(
        "label_void_not_supported",
        "Starting a label void requires the original void-capable carrier adapter.",
      );
    }
    if (
      await hasTracking(
        tx,
        siteId,
        acquisition.target,
        acquisition.orderId,
        acquisition.shipmentId,
        acquisition.purgeAt,
        true,
      )
    ) {
      throw new NpShopCarrierLabelVoidConflictError(
        "label_void_tracking_started",
        "A verified tracking state blocks starting label voiding.",
      );
    }
    const requestedAt = nextTimestamp(acquisition.updatedAt, current?.updatedAt ?? null);
    if (new Date(requestedAt) >= new Date(acquisition.purgeAt)) {
      throw new NpShopCarrierLabelVoidConflictError(
        "label_void_state_conflict",
        "An expired commercial shipment cannot start label voiding.",
      );
    }
    const state: NpShopStoredCarrierLabelVoid = {
      contract: NP_SHOP_CARRIER_LABEL_VOID_STORAGE_CONTRACT,
      id: randomUUID(),
      acquisitionId: acquisition.id,
      shipmentId: acquisition.shipmentId,
      orderId: acquisition.orderId,
      target: acquisition.target,
      exchangeId: acquisition.exchangeId,
      providerId: acquisition.providerId,
      status: "pending",
      revision: (current?.revision ?? 0) + 1,
      sourceRevision: acquisition.sourceRevision,
      generation: acquisition.generation,
      bookingReference: acquisition.bookingReference,
      labelReference: acquisition.labelReference,
      providerErrorCode: null,
      requestedAt,
      voidedAt: null,
      updatedAt: requestedAt,
      purgeAt: acquisition.purgeAt,
    };
    await npPersistShopCarrierLabelVoid(tx, siteId, state);
    await recordAudit(tx, siteId, staffUserId, "shop.carrier.label.void.prepare", state);
    return { state };
  });
  let state = prepared.state;
  if ("complete" in prepared && prepared.complete) return { state, duplicate: true };
  if (state.status === "pending") {
    const adapter = runtime.carrierLabelVoidAdapter;
    if (!adapter || adapter.id !== state.providerId) {
      throw new NpShopCarrierLabelVoidConflictError(
        "label_void_not_supported",
        "The pending label void requires its original carrier adapter.",
      );
    }
    const request = npRequireShopCarrierLabelVoidRequest({
      contract: NP_SHOP_CARRIER_LABEL_VOID_REQUEST_CONTRACT,
      voidId: state.id,
      acquisitionId: state.acquisitionId,
      shipmentId: state.shipmentId,
      orderId: state.orderId,
      generation: state.generation,
      bookingReference: state.bookingReference,
      labelReference: state.labelReference,
      requestedAt: state.requestedAt,
    });
    let result: NpShopCarrierLabelVoidResult;
    try {
      result = npRequireShopCarrierLabelVoidResult(await adapter.voidShippingLabel(request));
    } catch (error) {
      if (error instanceof NpShopCarrierProviderError) {
        if (!error.retryable) {
          await markManualReview(siteId, state.shipmentId, state.id, closedProviderCode(error), [
            "pending",
            "provider-confirmed",
          ]);
          throw new NpShopCarrierLabelVoidConflictError(
            "label_void_manual_review",
            "The carrier rejected this stable label void; manual review is required.",
          );
        }
        throw new NpShopCarrierUnavailableError(
          "The carrier label-void service is temporarily unavailable; retry the same void id.",
        );
      }
      if (error instanceof NpShopCarrierLabelVoidContractError) {
        await markManualReview(siteId, state.shipmentId, state.id, "invalid-result", ["pending"]);
        throw new NpShopCarrierLabelVoidConflictError(
          "label_void_result_mismatch",
          "The carrier returned an invalid label void result; manual review is required.",
        );
      }
      throw new NpShopCarrierUnavailableError(
        "The carrier label-void service is temporarily unavailable; retry the same void id.",
      );
    }
    const voidedAt = new Date(result.voidedAt).getTime();
    if (
      result.voidId !== request.voidId ||
      result.acquisitionId !== request.acquisitionId ||
      result.shipmentId !== request.shipmentId ||
      result.orderId !== request.orderId ||
      result.generation !== request.generation ||
      result.labelReference !== request.labelReference ||
      voidedAt < new Date(request.requestedAt).getTime() ||
      voidedAt > Date.now() + npShopCarrierLabelVoidLimits.futureToleranceSeconds * 1_000 ||
      voidedAt >= new Date(state.purgeAt).getTime()
    ) {
      await markManualReview(siteId, state.shipmentId, state.id, "invalid-result", ["pending"]);
      throw new NpShopCarrierLabelVoidConflictError(
        "label_void_result_mismatch",
        "The carrier label void result does not match the durable request.",
      );
    }
    state = await getDb().transaction(async (tx) => {
      const current = await npReadStoredShopCarrierLabelVoid(tx, siteId, state.shipmentId, true);
      const acquisition = await npReadStoredShopCarrierLabelAcquisition(
        tx,
        siteId,
        state.shipmentId,
        true,
      );
      if (
        !current ||
        current.id !== state.id ||
        !acquisition ||
        !npShopCarrierLabelVoidMatchesAcquisition(current, acquisition)
      ) {
        throw new NpShopCarrierLabelVoidConflictError(
          "label_void_state_conflict",
          "The current label changed before provider confirmation was stored.",
        );
      }
      if (current.status === "provider-confirmed" || current.status === "completed") {
        if (current.voidedAt === result.voidedAt) return current;
        throw new NpShopCarrierLabelVoidConflictError(
          "label_void_result_mismatch",
          "The carrier returned conflicting results for one label void id.",
        );
      }
      if (current.status !== "pending") {
        throw new NpShopCarrierLabelVoidConflictError(
          "label_void_state_conflict",
          "The label void cannot accept provider confirmation in its current state.",
        );
      }
      const confirmed: NpShopStoredCarrierLabelVoid = {
        ...current,
        status: "provider-confirmed",
        revision: current.revision + 1,
        voidedAt: result.voidedAt,
        updatedAt: nextTimestamp(current.updatedAt, result.voidedAt),
      };
      await npPersistShopCarrierLabelVoid(tx, siteId, confirmed);
      await recordAudit(tx, siteId, staffUserId, "shop.carrier.label.void.confirm", confirmed);
      return confirmed;
    });
  }
  if (state.status === "completed") return { state, duplicate: true };
  return getDb().transaction(async (tx) => {
    const current = await npReadStoredShopCarrierLabelVoid(tx, siteId, state.shipmentId, true);
    const acquisition = await npReadStoredShopCarrierLabelAcquisition(
      tx,
      siteId,
      state.shipmentId,
      true,
    );
    if (
      !current ||
      current.id !== state.id ||
      current.status !== "provider-confirmed" ||
      !acquisition ||
      !npShopCarrierLabelVoidMatchesAcquisition(current, acquisition)
    ) {
      throw new NpShopCarrierLabelVoidConflictError(
        "label_void_state_conflict",
        "The provider-confirmed label void cannot be completed locally.",
      );
    }
    const completed: NpShopStoredCarrierLabelVoid = {
      ...current,
      status: "completed",
      revision: current.revision + 1,
      updatedAt: nextTimestamp(current.updatedAt, current.voidedAt),
    };
    await npPersistShopCarrierLabelVoid(tx, siteId, completed);
    await recordAudit(tx, siteId, staffUserId, "shop.carrier.label.void.complete", completed);
    return { state: completed, duplicate: false };
  });
}

export async function npListRecentShopCarrierLabelVoids(
  expectedProviderId?: string,
): Promise<{ rows: NpShopAdminCarrierLabelVoidRow[]; total: number }> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "carrier-label-void:%"),
  );
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(where)
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopCarrierLabelVoidLimits.adminListSize);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(npPluginStorage)
    .where(where);
  const projected: NpShopAdminCarrierLabelVoidRow[] = [];
  for (const row of rows) {
    try {
      const state = npRequireStoredShopCarrierLabelVoidAtKey(row.value, row.expiresAt, row.key);
      const acquisition = await npReadStoredShopCarrierLabelAcquisition(
        db,
        siteId,
        state.shipmentId,
      );
      const relationshipValid = Boolean(
        acquisition && npShopCarrierLabelVoidMatchesAcquisition(state, acquisition),
      );
      projected.push({
        id: state.orderId,
        voidId: state.id,
        acquisitionId: state.acquisitionId,
        shipmentId: state.shipmentId,
        target: state.target,
        exchangeId: state.exchangeId,
        provider: state.providerId,
        status: state.status,
        generation: state.generation,
        labelReference: state.labelReference,
        providerError: state.providerErrorCode ?? "—",
        expectedAcquisitionRevision: acquisition?.revision ?? 0,
        expectedVoidRevision: state.revision,
        resumeEligible:
          relationshipValid &&
          (state.status === "provider-confirmed" ||
            (state.status === "pending" && state.providerId === expectedProviderId)),
        updatedAt: state.updatedAt,
      });
    } catch {
      // Health retains malformed rows without exposing their raw values.
    }
  }
  return { rows: projected, total: Number(total) };
}

export async function npCountShopCarrierLabelVoids(expectedProviderId?: string): Promise<{
  total: number;
  pending: number;
  providerConfirmed: number;
  completed: number;
  manualReview: number;
  invalidSample: number;
  orphanSample: number;
  acquisitionMismatchSample: number;
  providerMismatchSample: number;
}> {
  const siteId = await requireSiteId();
  const db = getDb();
  const where = and(
    eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
    eq(npPluginStorage.siteId, siteId),
    like(npPluginStorage.key, "carrier-label-void:%"),
  );
  const [aggregate] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'pending')::int`,
      providerConfirmed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'provider-confirmed')::int`,
      completed: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'completed')::int`,
      manualReview: sql<number>`count(*) filter (where ${npPluginStorage.value}->>'status' = 'manual-review')::int`,
    })
    .from(npPluginStorage)
    .where(where);
  const rows = await db
    .select({
      key: npPluginStorage.key,
      value: npPluginStorage.value,
      expiresAt: npPluginStorage.expiresAt,
    })
    .from(npPluginStorage)
    .where(where)
    .orderBy(desc(npPluginStorage.updatedAt), desc(npPluginStorage.key))
    .limit(npShopCarrierLabelVoidLimits.diagnosticSampleSize);
  const counts = {
    total: Number(aggregate?.total ?? 0),
    pending: Number(aggregate?.pending ?? 0),
    providerConfirmed: Number(aggregate?.providerConfirmed ?? 0),
    completed: Number(aggregate?.completed ?? 0),
    manualReview: Number(aggregate?.manualReview ?? 0),
    invalidSample: 0,
    orphanSample: 0,
    acquisitionMismatchSample: 0,
    providerMismatchSample: 0,
  };
  for (const row of rows) {
    try {
      const state = npRequireStoredShopCarrierLabelVoidAtKey(row.value, row.expiresAt, row.key);
      if (expectedProviderId && state.providerId !== expectedProviderId) {
        counts.providerMismatchSample += 1;
      }
      const acquisition = await npReadStoredShopCarrierLabelAcquisition(
        db,
        siteId,
        state.shipmentId,
      );
      if (!acquisition) counts.orphanSample += 1;
      else if (
        !npShopCarrierLabelVoidMatchesAcquisition(state, acquisition) &&
        !npShopCarrierLabelVoidIsCompletedPredecessor(state, acquisition)
      ) {
        counts.acquisitionMismatchSample += 1;
      }
    } catch {
      counts.invalidSample += 1;
    }
  }
  return counts;
}
