import { createHash } from "node:crypto";

import { findDocuments } from "@nexpress/core/collections";

import {
  NP_SHOP_SHIPPING_POLICY_PROVIDER_ID,
  npEvaluateShopShippingPolicies,
  npNormalizeShopShippingPolicy,
  npShopShippingPolicyLimits,
  type NpShopShippingPolicyDefinition,
  type NpShopShippingPolicyDocument,
} from "./shipping-policy-contract.js";
import {
  NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT,
  NpShopShippingUnavailableError,
  type NpShopShippingQuoteRequest,
  type NpShopShippingQuoteResult,
} from "./shipping-contract.js";
import {
  normalizeShopCategoryIds,
  type NpShopRuntime,
  type ShopProductDocument,
} from "./runtime.js";

export async function npListShopShippingPolicies(
  runtime: NpShopRuntime,
): Promise<NpShopShippingPolicyDefinition[]> {
  const result = await findDocuments<NpShopShippingPolicyDocument>(
    runtime.collections.shippingPolicies,
    {
      where: { status: "published", visibility: "*" },
      page: 1,
      limit: npShopShippingPolicyLimits.maximumDefinitions,
    },
  );
  if (result.totalDocs > result.docs.length) {
    throw new Error(
      `Shop supports at most ${npShopShippingPolicyLimits.maximumDefinitions.toString()} published shipping policies per site.`,
    );
  }
  return result.docs.map(npNormalizeShopShippingPolicy);
}

async function loadCategoryIds(
  runtime: NpShopRuntime,
  productIds: string[],
): Promise<Map<string, string[]>> {
  if (productIds.length === 0) return new Map();
  const result = await findDocuments<ShopProductDocument>(runtime.collections.products, {
    where: { id: productIds, status: "published", visibility: "*" },
    page: 1,
    limit: productIds.length,
  });
  if (result.docs.length !== productIds.length) {
    throw new Error("Shop shipping policy could not resolve every current product category.");
  }
  return new Map(
    result.docs.map((document) => [document.id, normalizeShopCategoryIds(document.categories)]),
  );
}

export async function npQuoteShopShippingPolicies(
  runtime: NpShopRuntime,
  request: NpShopShippingQuoteRequest,
  discountMinor: number,
): Promise<NpShopShippingQuoteResult | null> {
  const definitions = await npListShopShippingPolicies(runtime);
  if (definitions.length === 0) return null;
  const needsCategories = definitions.some((definition) => definition.cartScope === "categories");
  const productIds = [...new Set(request.lines.map((line) => line.productId))].sort();
  const categories = needsCategories ? await loadCategoryIds(runtime, productIds) : new Map();
  const evaluation = npEvaluateShopShippingPolicies({
    definitions,
    currency: request.currency,
    grossSubtotalMinor: request.subtotalMinor,
    discountMinor,
    lines: request.lines.map((line) => ({
      ...line,
      categoryIds: categories.get(line.productId) ?? [],
    })),
    destination: request.destination,
    now: new Date(request.requestedAt),
  });
  if (evaluation.methods.length === 0) {
    throw new NpShopShippingUnavailableError(
      "No configured shipping method serves this destination and cart.",
    );
  }
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const appliedEnds = evaluation.appliedPolicyIds.flatMap((id) => {
    const endsAt = byId.get(id)?.endsAt;
    return endsAt ? [new Date(endsAt).getTime()] : [];
  });
  const expiresAt = new Date(
    Math.min(new Date(request.maximumExpiresAt).getTime(), ...appliedEnds),
  ).toISOString();
  const quoteId = `policy:${createHash("sha256")
    .update(
      JSON.stringify({
        draftId: request.draftId,
        draftRevision: request.draftRevision,
        requestedAt: request.requestedAt,
        methods: evaluation.methods,
        policyIds: evaluation.appliedPolicyIds,
      }),
    )
    .digest("hex")}`;
  return {
    contract: NP_SHOP_SHIPPING_QUOTE_RESULT_CONTRACT,
    quoteId,
    methods: evaluation.methods,
    expiresAt,
  };
}

export async function npInspectShopShippingPolicies(runtime: NpShopRuntime): Promise<{
  published: number;
  baseRules: number;
  surchargeRules: number;
  methodCodes: number;
  surchargeOnlyMethodCodes: string[];
}> {
  const definitions = await npListShopShippingPolicies(runtime);
  const baseCodes = new Set(
    definitions
      .filter((definition) => definition.kind === "base")
      .map((definition) => `${definition.currency}:${definition.methodCode}`),
  );
  const surchargeCodes = new Set(
    definitions
      .filter((definition) => definition.kind === "surcharge")
      .map((definition) => `${definition.currency}:${definition.methodCode}`),
  );
  return {
    published: definitions.length,
    baseRules: definitions.filter((definition) => definition.kind === "base").length,
    surchargeRules: definitions.filter((definition) => definition.kind === "surcharge").length,
    methodCodes: new Set(
      definitions.map((definition) => `${definition.currency}:${definition.methodCode}`),
    ).size,
    surchargeOnlyMethodCodes: [...surchargeCodes].filter((code) => !baseCodes.has(code)).sort(),
  };
}

export function npIsShopShippingProviderActive(
  runtime: NpShopRuntime,
  providerId: string,
): boolean {
  return runtime.shippingAdapter
    ? providerId === runtime.shippingAdapter.id
    : providerId === NP_SHOP_SHIPPING_POLICY_PROVIDER_ID;
}
