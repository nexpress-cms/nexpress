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
import { npShopFulfillmentParcelLimits } from "./parcel-contract.js";
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

function invalidMaterializedResult(issue: string): never {
  throw new NpShopPackagingProposalContractError("Invalid Shop packaging proposal result", [issue]);
}

function readExactDataObject(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidMaterializedResult(`${path} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidMaterializedResult(`${path} must be a plain object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    return invalidMaterializedResult(`${path} must contain only its exact contract fields.`);
  }
  const result: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      return invalidMaterializedResult(`${path}.${key} must be a data property.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function readBoundedDataArray(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    return invalidMaterializedResult(
      `${path} must contain between ${minimum.toString()} and ${maximum.toString()} entries.`,
    );
  }
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index.toString());
    if (!descriptor || !("value" in descriptor)) {
      return invalidMaterializedResult(`${path}[${index.toString()}] must be a data property.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function materializePackagingResult(value: unknown): NpShopPackagingProposalResult {
  const result = readExactDataObject(
    value,
    [
      "contract",
      "proposalId",
      "orderId",
      "target",
      "exchangeId",
      "sourceRevision",
      "expectedParcelRevision",
      "parcels",
      "proposedAt",
      "expiresAt",
    ],
    "packaging proposal result",
  );
  const parcels = readBoundedDataArray(
    result.parcels,
    1,
    npShopFulfillmentParcelLimits.maximumParcels,
    "packaging proposal result.parcels",
  );
  let allocationCount = 0;
  const materializedParcels = parcels.map((parcelValue, parcelIndex) => {
    const path = `packaging proposal result.parcels[${parcelIndex.toString()}]`;
    const parcel = readExactDataObject(
      parcelValue,
      ["id", "lengthMm", "widthMm", "heightMm", "weightGrams", "items"],
      path,
    );
    const items = readBoundedDataArray(
      parcel.items,
      1,
      npShopFulfillmentParcelLimits.maximumAllocations,
      `${path}.items`,
    );
    allocationCount += items.length;
    if (allocationCount > npShopFulfillmentParcelLimits.maximumAllocations) {
      return invalidMaterializedResult(
        `packaging proposal result.parcels accepts at most ${npShopFulfillmentParcelLimits.maximumAllocations.toString()} item allocations.`,
      );
    }
    return {
      id: parcel.id,
      lengthMm: parcel.lengthMm,
      widthMm: parcel.widthMm,
      heightMm: parcel.heightMm,
      weightGrams: parcel.weightGrams,
      items: items.map((itemValue, itemIndex) => {
        const item = readExactDataObject(
          itemValue,
          ["lineKey", "quantity"],
          `${path}.items[${itemIndex.toString()}]`,
        );
        return { lineKey: item.lineKey, quantity: item.quantity };
      }),
    };
  });
  return npRequireShopPackagingProposalResult({
    contract: result.contract,
    proposalId: result.proposalId,
    orderId: result.orderId,
    target: result.target,
    exchangeId: result.exchangeId,
    sourceRevision: result.sourceRevision,
    expectedParcelRevision: result.expectedParcelRevision,
    parcels: materializedParcels,
    proposedAt: result.proposedAt,
    expiresAt: result.expiresAt,
  });
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
