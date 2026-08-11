import { randomUUID } from "node:crypto";

import { getDb, npPluginStorage } from "@nexpress/core/db";
import { requireSiteId } from "@nexpress/core/sites";
import { and, eq, sql } from "drizzle-orm";

import {
  NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT,
  NP_SHOP_PACKAGING_PROPOSAL_REQUEST_CONTRACT,
  NpShopPackagingProposalContractError,
  NpShopPackagingProposalUnavailableError,
  npAnalyzeShopPackagingProposalResultForRequest,
  npRequireShopPackagingProposalHealth,
  npRequireShopPackagingProposalRequest,
  npRequireShopPackagingProposalResult,
  npShopPackagingProposalLimits,
  type NpShopPackagingProposalHealth,
  type NpShopPackagingProposalInput,
  type NpShopPackagingProposalRequest,
  type NpShopPackagingProposalResult,
  type NpShopPackagingProposalTarget,
  type NpShopPackagingAdapter,
} from "./packaging-contract.js";
import { NP_SHOP_PLUGIN_ID } from "./order-draft-service.js";
import {
  npPrepareShopPackagingProposal,
  npSaveShopExchangeParcels,
  npSaveShopFulfillmentParcels,
} from "./order-service.js";
import type { NpShopRuntime } from "./runtime.js";

const HEALTH_PREFIX = "packaging-proposal-health:";

export function npShopPackagingProposalHealthKey(target: NpShopPackagingProposalTarget): string {
  return `${HEALTH_PREFIX}${target}`;
}

async function persistHealth(siteId: string, health: NpShopPackagingProposalHealth): Promise<void> {
  npRequireShopPackagingProposalHealth(health);
  await getDb()
    .insert(npPluginStorage)
    .values({
      pluginId: NP_SHOP_PLUGIN_ID,
      siteId,
      key: npShopPackagingProposalHealthKey(health.target),
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

async function persistHealthOrUnavailable(
  siteId: string,
  health: NpShopPackagingProposalHealth,
): Promise<void> {
  try {
    await persistHealth(siteId, health);
  } catch {
    throw new NpShopPackagingProposalUnavailableError();
  }
}

export async function npReadShopPackagingProposalHealth(
  target: NpShopPackagingProposalTarget,
): Promise<NpShopPackagingProposalHealth | null> {
  const siteId = await requireSiteId();
  const [row] = await getDb()
    .select({ value: npPluginStorage.value, expiresAt: npPluginStorage.expiresAt })
    .from(npPluginStorage)
    .where(
      and(
        eq(npPluginStorage.pluginId, NP_SHOP_PLUGIN_ID),
        eq(npPluginStorage.siteId, siteId),
        eq(npPluginStorage.key, npShopPackagingProposalHealthKey(target)),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt !== null) {
    throw new NpShopPackagingProposalContractError(
      "Invalid Shop packaging proposal health metadata",
      ["packaging proposal health must not expire."],
    );
  }
  const health = npRequireShopPackagingProposalHealth(row.value);
  if (health.target !== target) {
    throw new NpShopPackagingProposalContractError(
      "Invalid Shop packaging proposal health target",
      ["packaging proposal health must match its target-specific storage key."],
    );
  }
  return health;
}

async function callPackagingProvider(
  adapter: NpShopPackagingAdapter,
  request: NpShopPackagingProposalRequest,
  canonicalExpiresAt: string,
): Promise<unknown> {
  const remainingMs = Math.max(1, new Date(canonicalExpiresAt).getTime() - Date.now());
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve().then(() => adapter.proposeParcels(request)),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new NpShopPackagingProposalUnavailableError()),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function freezePackagingRequest(
  request: NpShopPackagingProposalRequest,
): NpShopPackagingProposalRequest {
  for (const line of request.lines) Object.freeze(line);
  Object.freeze(request.lines);
  return Object.freeze(request);
}

function materializePackagingResult(value: unknown): NpShopPackagingProposalResult {
  let snapshot: unknown;
  try {
    snapshot = structuredClone(value);
  } catch {
    throw new NpShopPackagingProposalContractError("Invalid Shop packaging proposal result", [
      "packaging proposal result must contain cloneable data properties only.",
    ]);
  }
  return npRequireShopPackagingProposalResult(snapshot);
}

export async function npProposeShopPackaging(
  runtime: NpShopRuntime,
  input: NpShopPackagingProposalInput,
  staffUserId: string,
) {
  const adapter = runtime.packagingAdapter;
  if (!adapter) {
    throw new NpShopPackagingProposalUnavailableError(
      "No packaging proposal adapter is configured for this Shop.",
    );
  }
  const siteId = await requireSiteId();
  const prepared = await npPrepareShopPackagingProposal(input);
  const requestedAtDate = new Date();
  const expiresAtDate = new Date(
    requestedAtDate.getTime() + npShopPackagingProposalLimits.maximumProposalAgeSeconds * 1_000,
  );
  const request = freezePackagingRequest(
    npRequireShopPackagingProposalRequest({
      contract: NP_SHOP_PACKAGING_PROPOSAL_REQUEST_CONTRACT,
      proposalId: randomUUID(),
      orderId: prepared.orderId,
      target: prepared.target,
      exchangeId: prepared.exchangeId,
      sourceRevision: prepared.sourceRevision,
      expectedParcelRevision: prepared.parcelRevision,
      lines: prepared.lines,
      requestedAt: requestedAtDate.toISOString(),
      expiresAt: expiresAtDate.toISOString(),
    }),
  );
  const providerRequest = freezePackagingRequest(
    npRequireShopPackagingProposalRequest(structuredClone(request)),
  );

  let rawResult: unknown;
  try {
    rawResult = await callPackagingProvider(adapter, providerRequest, request.expiresAt);
  } catch {
    await persistHealthOrUnavailable(siteId, {
      contract: NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT,
      providerId: adapter.id,
      target: input.target,
      status: "error",
      errorCode: "provider-error",
      attemptedAt: request.requestedAt,
    });
    throw new NpShopPackagingProposalUnavailableError();
  }

  let result: NpShopPackagingProposalResult;
  try {
    result = materializePackagingResult(rawResult);
    const issues = npAnalyzeShopPackagingProposalResultForRequest(request, result, new Date());
    if (issues.length) {
      throw new NpShopPackagingProposalContractError(
        "Invalid Shop packaging proposal result",
        issues,
      );
    }
  } catch {
    await persistHealthOrUnavailable(siteId, {
      contract: NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT,
      providerId: adapter.id,
      target: input.target,
      status: "error",
      errorCode: "invalid-result",
      attemptedAt: request.requestedAt,
    });
    throw new NpShopPackagingProposalUnavailableError();
  }

  await persistHealthOrUnavailable(siteId, {
    contract: NP_SHOP_PACKAGING_PROPOSAL_HEALTH_CONTRACT,
    providerId: adapter.id,
    target: input.target,
    status: "ok",
    errorCode: null,
    attemptedAt: request.requestedAt,
  });
  const proposal = {
    proposalId: request.proposalId,
    providerId: adapter.id,
    expiresAt: request.expiresAt,
  };
  if (input.target === "outbound") {
    return npSaveShopFulfillmentParcels(
      {
        orderId: input.orderId,
        expectedFulfillmentRevision: input.expectedSourceRevision,
        expectedParcelRevision: input.expectedParcelRevision,
        parcels: result.parcels,
      },
      staffUserId,
      proposal,
    );
  }
  return npSaveShopExchangeParcels(
    {
      orderId: input.orderId,
      exchangeId: input.exchangeId,
      expectedExchangeRevision: input.expectedSourceRevision,
      expectedParcelRevision: input.expectedParcelRevision,
      parcels: result.parcels,
    },
    staffUserId,
    proposal,
  );
}
