import type { NpShopShippingMethod } from "./shipping-contract.js";
import type {
  NpShopCheckoutIntentLine,
  NpShopCurrency,
  NpShopOrderDraftShipping,
} from "./types.js";

export const NP_SHOP_SHIPPING_POLICY_PROVIDER_ID = "shop-policy" as const;

export const npShopShippingPolicyLimits = {
  maximumDefinitions: 500,
  maximumComponentsPerMethod: 50,
  maximumMethods: 20,
  maximumMethodCodeLength: 32,
  maximumNameLength: 120,
  maximumPriority: 10_000,
  maximumPriceMinor: 2_147_483_647,
  maximumPostalPrefixes: 100,
  maximumAdministrativeAreas: 100,
} as const;

export type NpShopShippingPolicyKind = "base" | "surcharge";
export type NpShopShippingPolicyDestinationScope =
  "all" | "country" | "postal-prefixes" | "administrative-areas";
export type NpShopShippingPolicyCartScope = "all" | "products" | "categories";
export type NpShopShippingPolicyThresholdBasis = "gross-subtotal" | "discounted-subtotal";

export interface NpShopShippingPolicyDefinition {
  id: string;
  name: string;
  methodCode: string;
  kind: NpShopShippingPolicyKind;
  label: string;
  currency: NpShopCurrency;
  amountMinor: number;
  freeThresholdMinor: number | null;
  thresholdBasis: NpShopShippingPolicyThresholdBasis;
  minimumDays: number | null;
  maximumDays: number | null;
  destinationScope: NpShopShippingPolicyDestinationScope;
  countryCode: string | null;
  postalPrefixes: string[];
  administrativeAreas: string[];
  cartScope: NpShopShippingPolicyCartScope;
  productIds: string[];
  categoryIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
}

export interface NpShopShippingPolicyDocument extends Record<string, unknown> {
  id: string;
  name: unknown;
  methodCode: unknown;
  kind: unknown;
  label: unknown;
  currency: unknown;
  amountMinor: unknown;
  freeThresholdMinor?: unknown;
  thresholdBasis: unknown;
  minimumDays?: unknown;
  maximumDays?: unknown;
  destinationScope: unknown;
  countryCode?: unknown;
  postalPrefixes?: unknown;
  administrativeAreas?: unknown;
  cartScope: unknown;
  products?: unknown;
  categories?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  priority?: unknown;
}

export interface NpShopShippingPolicyLine extends NpShopCheckoutIntentLine {
  categoryIds: string[];
}

export interface NpShopShippingPolicyEvaluation {
  methods: NpShopShippingMethod[];
  appliedPolicyIds: string[];
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const methodCodePattern = /^[a-z][a-z0-9-]{0,31}$/u;
const countryCodePattern = /^[A-Z]{2}$/u;
const postalPrefixPattern = /^[A-Z0-9]{1,10}$/u;

function requireText(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim() !== value ||
    value.length > maximum
  ) {
    throw new Error(
      `Shop shipping policy ${field} must contain 1–${maximum.toString()} characters.`,
    );
  }
  return value;
}

function requireInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(
      `Shop shipping policy ${field} must be an integer between ${minimum.toString()} and ${maximum.toString()}.`,
    );
  }
  return value as number;
}

function optionalInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  return value === undefined || value === null || value === ""
    ? null
    : requireInteger(value, field, minimum, maximum);
}

function normalizeDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`Shop shipping policy ${field} must be a valid date.`);
  }
  return parsed.toISOString();
}

function normalizeRelationIds(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !uuidPattern.test(entry))
  ) {
    throw new Error(`Shop shipping policy ${field} must contain document ids.`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`Shop shipping policy ${field} must not contain duplicates.`);
  }
  return [...value].sort() as string[];
}

function normalizeArrayRows(
  value: unknown,
  field: "postalPrefixes" | "administrativeAreas",
  child: "prefix" | "area",
  maximum: number,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(
      `Shop shipping policy ${field} must contain at most ${maximum.toString()} rows.`,
    );
  }
  const normalized = value.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => key !== child) ||
      typeof (entry as Record<string, unknown>)[child] !== "string"
    ) {
      throw new Error(`Shop shipping policy ${field} rows must contain only ${child}.`);
    }
    const raw = ((entry as Record<string, string>)[child] ?? "").normalize("NFKC").trim();
    if (!raw) throw new Error(`Shop shipping policy ${field} rows must not be empty.`);
    return field === "postalPrefixes"
      ? raw.replace(/[\s-]/gu, "").toUpperCase()
      : raw.toLocaleLowerCase("en-US");
  });
  if (
    field === "postalPrefixes" &&
    normalized.some((prefix) => !postalPrefixPattern.test(prefix))
  ) {
    throw new Error("Shop shipping policy postal prefixes are invalid.");
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Shop shipping policy ${field} must not contain duplicates.`);
  }
  return normalized.sort();
}

export function npNormalizeShopShippingPolicy(
  document: NpShopShippingPolicyDocument,
): NpShopShippingPolicyDefinition {
  if (!uuidPattern.test(document.id)) throw new Error("Shop shipping policy id is invalid.");
  const name = requireText(document.name, "name", npShopShippingPolicyLimits.maximumNameLength);
  const methodCode = requireText(
    document.methodCode,
    "method code",
    npShopShippingPolicyLimits.maximumMethodCodeLength,
  ).toLowerCase();
  if (!methodCodePattern.test(methodCode)) {
    throw new Error("Shop shipping policy method code must be a lowercase segment.");
  }
  if (document.kind !== "base" && document.kind !== "surcharge") {
    throw new Error("Shop shipping policy kind is invalid.");
  }
  const label = requireText(document.label, "label", 120);
  if (!(["KRW", "USD", "EUR", "JPY"] as unknown[]).includes(document.currency)) {
    throw new Error("Shop shipping policy currency is invalid.");
  }
  const amountMinor = requireInteger(
    document.amountMinor,
    "amount",
    document.kind === "surcharge" ? 1 : 0,
    npShopShippingPolicyLimits.maximumPriceMinor,
  );
  const freeThresholdMinor = optionalInteger(
    document.freeThresholdMinor,
    "free threshold",
    1,
    npShopShippingPolicyLimits.maximumPriceMinor,
  );
  if (
    document.thresholdBasis !== "gross-subtotal" &&
    document.thresholdBasis !== "discounted-subtotal"
  ) {
    throw new Error("Shop shipping policy threshold basis is invalid.");
  }
  const minimumDays = optionalInteger(document.minimumDays, "minimum days", 0, 365);
  const maximumDays = optionalInteger(document.maximumDays, "maximum days", 0, 365);
  if (
    (minimumDays === null) !== (maximumDays === null) ||
    (minimumDays ?? 0) > (maximumDays ?? 0)
  ) {
    throw new Error(
      "Shop shipping policy delivery estimates must be a valid minimum/maximum pair.",
    );
  }
  if (document.kind === "surcharge" && (freeThresholdMinor !== null || minimumDays !== null)) {
    throw new Error("Shop shipping surcharge rules cannot define free thresholds or estimates.");
  }
  if (
    document.destinationScope !== "all" &&
    document.destinationScope !== "country" &&
    document.destinationScope !== "postal-prefixes" &&
    document.destinationScope !== "administrative-areas"
  ) {
    throw new Error("Shop shipping policy destination scope is invalid.");
  }
  const countryCode =
    document.countryCode === undefined ||
    document.countryCode === null ||
    document.countryCode === ""
      ? null
      : requireText(document.countryCode, "country code", 2).toUpperCase();
  if (countryCode !== null && !countryCodePattern.test(countryCode)) {
    throw new Error("Shop shipping policy country code is invalid.");
  }
  const postalPrefixes = normalizeArrayRows(
    document.postalPrefixes,
    "postalPrefixes",
    "prefix",
    npShopShippingPolicyLimits.maximumPostalPrefixes,
  );
  const administrativeAreas = normalizeArrayRows(
    document.administrativeAreas,
    "administrativeAreas",
    "area",
    npShopShippingPolicyLimits.maximumAdministrativeAreas,
  );
  if (document.destinationScope === "all") {
    if (countryCode !== null || postalPrefixes.length > 0 || administrativeAreas.length > 0) {
      throw new Error("An all-destination shipping policy cannot define destination filters.");
    }
  } else if (countryCode === null) {
    throw new Error("A destination-scoped shipping policy requires a country code.");
  }
  if (
    (document.destinationScope === "postal-prefixes") !== postalPrefixes.length > 0 ||
    (document.destinationScope === "administrative-areas") !== administrativeAreas.length > 0
  ) {
    throw new Error("Shop shipping policy destination rows must match their selected scope.");
  }
  if (
    document.destinationScope === "country" &&
    (postalPrefixes.length || administrativeAreas.length)
  ) {
    throw new Error("A country shipping policy cannot define narrower destination rows.");
  }
  if (
    document.cartScope !== "all" &&
    document.cartScope !== "products" &&
    document.cartScope !== "categories"
  ) {
    throw new Error("Shop shipping policy cart scope is invalid.");
  }
  const productIds = normalizeRelationIds(document.products, "products");
  const categoryIds = normalizeRelationIds(document.categories, "categories");
  if (
    (document.cartScope === "products") !== productIds.length > 0 ||
    (document.cartScope === "categories") !== categoryIds.length > 0
  ) {
    throw new Error("Shop shipping policy relationships must match their selected cart scope.");
  }
  if (document.cartScope === "all" && (productIds.length || categoryIds.length)) {
    throw new Error("An all-cart shipping policy cannot define product or category filters.");
  }
  const startsAt = normalizeDate(document.startsAt, "start");
  const endsAt = normalizeDate(document.endsAt, "end");
  if (startsAt && endsAt && startsAt >= endsAt) {
    throw new Error("Shop shipping policy end must follow its start.");
  }
  return {
    id: document.id,
    name,
    methodCode,
    kind: document.kind,
    label,
    currency: document.currency as NpShopCurrency,
    amountMinor,
    freeThresholdMinor,
    thresholdBasis: document.thresholdBasis,
    minimumDays,
    maximumDays,
    destinationScope: document.destinationScope,
    countryCode,
    postalPrefixes,
    administrativeAreas,
    cartScope: document.cartScope,
    productIds,
    categoryIds,
    startsAt,
    endsAt,
    priority: requireInteger(
      document.priority ?? 0,
      "priority",
      0,
      npShopShippingPolicyLimits.maximumPriority,
    ),
  };
}

function normalizePostalCode(value: string): string {
  return value.normalize("NFKC").replace(/[\s-]/gu, "").toUpperCase();
}

function matchesDestination(
  definition: NpShopShippingPolicyDefinition,
  destination: NpShopOrderDraftShipping,
): boolean {
  if (definition.destinationScope === "all") return true;
  if (definition.countryCode !== destination.countryCode) return false;
  if (definition.destinationScope === "country") return true;
  if (definition.destinationScope === "postal-prefixes") {
    const postalCode = normalizePostalCode(destination.postalCode);
    return definition.postalPrefixes.some((prefix) => postalCode.startsWith(prefix));
  }
  if (!destination.administrativeArea) return false;
  const area = destination.administrativeArea.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  return definition.administrativeAreas.includes(area);
}

function matchesCart(
  definition: NpShopShippingPolicyDefinition,
  lines: NpShopShippingPolicyLine[],
): boolean {
  if (definition.cartScope === "all") return true;
  if (definition.cartScope === "products") {
    const ids = new Set(definition.productIds);
    return lines.some((line) => ids.has(line.productId));
  }
  const ids = new Set(definition.categoryIds);
  return lines.some((line) => line.categoryIds.some((id) => ids.has(id)));
}

export function npEvaluateShopShippingPolicies(input: {
  definitions: NpShopShippingPolicyDefinition[];
  currency: NpShopCurrency;
  grossSubtotalMinor: number;
  discountMinor: number;
  lines: NpShopShippingPolicyLine[];
  destination: NpShopOrderDraftShipping;
  now: Date;
}): NpShopShippingPolicyEvaluation {
  const discountedSubtotalMinor = input.grossSubtotalMinor - input.discountMinor;
  if (!Number.isSafeInteger(discountedSubtotalMinor) || discountedSubtotalMinor < 0) {
    throw new Error("Shop shipping policy discounted subtotal is invalid.");
  }
  const matching = input.definitions.filter(
    (definition) =>
      definition.currency === input.currency &&
      (!definition.startsAt || new Date(definition.startsAt) <= input.now) &&
      (!definition.endsAt || new Date(definition.endsAt) > input.now) &&
      matchesDestination(definition, input.destination) &&
      matchesCart(definition, input.lines),
  );
  const methodCodes = [...new Set(matching.map((definition) => definition.methodCode))].sort();
  const evaluated = methodCodes.flatMap((methodCode) => {
    const components = matching.filter((definition) => definition.methodCode === methodCode);
    if (components.length > npShopShippingPolicyLimits.maximumComponentsPerMethod) {
      throw new Error(
        `Shop shipping method ${methodCode} has too many matching policy components.`,
      );
    }
    const base = components
      .filter((definition) => definition.kind === "base")
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0];
    if (!base) return [];
    const thresholdSubtotal =
      base.thresholdBasis === "gross-subtotal" ? input.grossSubtotalMinor : discountedSubtotalMinor;
    const baseAmount =
      base.freeThresholdMinor !== null && thresholdSubtotal >= base.freeThresholdMinor
        ? 0
        : base.amountMinor;
    const surcharges = components
      .filter((definition) => definition.kind === "surcharge")
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    const amountMinor = surcharges.reduce(
      (total, definition) => total + definition.amountMinor,
      baseAmount,
    );
    if (!Number.isSafeInteger(amountMinor)) {
      throw new Error(`Shop shipping method ${methodCode} amount is outside safe integer bounds.`);
    }
    return [
      {
        priority: base.priority,
        method: {
          id: base.methodCode,
          label: base.label,
          amountMinor,
          estimatedDelivery:
            base.minimumDays === null
              ? null
              : { minimumDays: base.minimumDays, maximumDays: base.maximumDays! },
        } satisfies NpShopShippingMethod,
        policyIds: [base.id, ...surcharges.map((definition) => definition.id)],
      },
    ];
  });
  if (evaluated.length > npShopShippingPolicyLimits.maximumMethods) {
    throw new Error("Shop shipping policies produced too many methods.");
  }
  evaluated.sort(
    (left, right) =>
      right.priority - left.priority || left.method.id.localeCompare(right.method.id),
  );
  return {
    methods: evaluated.map((entry) => entry.method),
    appliedPolicyIds: [...new Set(evaluated.flatMap((entry) => entry.policyIds))].sort(),
  };
}
