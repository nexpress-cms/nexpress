import type {
  NpShopAppliedPromotion,
  NpShopCurrency,
  NpShopPromotionKind,
  NpShopPromotionSnapshot,
  NpShopPromotionTarget,
} from "./types.js";

export const NP_SHOP_PROMOTION_SNAPSHOT_CONTRACT = "np.shop-promotion-snapshot.v1" as const;

export const npShopPromotionLimits = {
  maximumCouponCodes: 5,
  maximumAppliedPromotions: 10,
  maximumDefinitions: 1_000,
  maximumCodeLength: 32,
  maximumNameLength: 120,
  maximumPriority: 10_000,
  maximumUsageLimit: 1_000_000_000,
  maximumBasisPoints: 10_000,
  maximumPriceMinor: 2_147_483_647,
  diagnosticSampleSize: 1_000,
} as const;

export interface NpShopPromotionDefinition {
  id: string;
  name: string;
  code: string | null;
  automatic: boolean;
  kind: NpShopPromotionKind;
  currency: NpShopCurrency;
  value: number;
  maximumDiscountMinor: number | null;
  minimumSubtotalMinor: number;
  target: NpShopPromotionTarget;
  productIds: string[];
  categoryIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  stackable: boolean;
  totalUsageLimit: number;
  perOwnerUsageLimit: number;
}

export interface NpShopPromotionEvaluationLine {
  key: string;
  productId: string;
  categoryIds: string[];
  lineTotalMinor: number;
}

const codePattern = /^[A-Z0-9][A-Z0-9_-]{0,31}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): string[] {
  const issues: string[] = [];
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) issues.push(`${path}.${key} is not supported.`);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) issues.push(`${path}.${key} is required.`);
  }
  return issues;
}

export function npNormalizeShopCouponCode(value: unknown): string {
  if (typeof value !== "string") throw new Error("Coupon code must be text.");
  const code = value.trim().toUpperCase();
  if (!codePattern.test(code)) {
    throw new Error("Coupon code must use 1–32 uppercase letters, digits, dashes, or underscores.");
  }
  return code;
}

export function npNormalizeShopCouponCodes(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Coupon codes must be an array.");
  const normalized = [...new Set(value.map(npNormalizeShopCouponCode))];
  if (normalized.length > npShopPromotionLimits.maximumCouponCodes) {
    throw new Error(
      `At most ${npShopPromotionLimits.maximumCouponCodes.toString()} coupon codes are allowed.`,
    );
  }
  return normalized.sort();
}

export function npAnalyzeShopPromotionSnapshot(value: unknown, path = "promotions"): string[] {
  if (!isRecord(value)) return [`${path} must be a plain object.`];
  const issues = exactKeys(
    value,
    ["contract", "couponCodes", "rejectedCouponCodes", "applied", "discountMinor"],
    path,
  );
  if (value.contract !== NP_SHOP_PROMOTION_SNAPSHOT_CONTRACT) {
    issues.push(`${path}.contract is invalid.`);
  }
  let couponCodes: string[] = [];
  let rejectedCouponCodes: string[] = [];
  try {
    couponCodes = npNormalizeShopCouponCodes(value.couponCodes);
    if (JSON.stringify(couponCodes) !== JSON.stringify(value.couponCodes)) {
      issues.push(`${path}.couponCodes must be unique, canonical, and sorted.`);
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : `${path}.couponCodes is invalid.`);
  }
  try {
    rejectedCouponCodes = npNormalizeShopCouponCodes(value.rejectedCouponCodes);
    if (JSON.stringify(rejectedCouponCodes) !== JSON.stringify(value.rejectedCouponCodes)) {
      issues.push(`${path}.rejectedCouponCodes must be unique, canonical, and sorted.`);
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : `${path}.rejectedCouponCodes is invalid.`);
  }
  if (rejectedCouponCodes.some((code) => !couponCodes.includes(code))) {
    issues.push(`${path}.rejectedCouponCodes must be requested coupon codes.`);
  }
  if (!Array.isArray(value.applied)) {
    issues.push(`${path}.applied must be an array.`);
    return issues;
  }
  if (value.applied.length > npShopPromotionLimits.maximumAppliedPromotions) {
    issues.push(`${path}.applied contains too many promotions.`);
  }
  let total = 0;
  const promotionIds = new Set<string>();
  for (const [index, entry] of value.applied.entries()) {
    const entryPath = `${path}.applied[${index.toString()}]`;
    if (!isRecord(entry)) {
      issues.push(`${entryPath} must be a plain object.`);
      continue;
    }
    issues.push(
      ...exactKeys(
        entry,
        ["id", "name", "code", "kind", "target", "discountMinor", "lineDiscounts"],
        entryPath,
      ),
    );
    if (typeof entry.id !== "string" || !uuidPattern.test(entry.id))
      issues.push(`${entryPath}.id is invalid.`);
    if (typeof entry.id === "string" && promotionIds.has(entry.id))
      issues.push(`${entryPath}.id is duplicated.`);
    if (typeof entry.id === "string") promotionIds.add(entry.id);
    if (
      typeof entry.name !== "string" ||
      entry.name.length < 1 ||
      entry.name.length > npShopPromotionLimits.maximumNameLength ||
      entry.name.trim() !== entry.name
    )
      issues.push(`${entryPath}.name is invalid.`);
    if (entry.code !== null) {
      try {
        if (npNormalizeShopCouponCode(entry.code) !== entry.code)
          issues.push(`${entryPath}.code is not canonical.`);
      } catch {
        issues.push(`${entryPath}.code is invalid.`);
      }
    }
    if (entry.kind !== "fixed" && entry.kind !== "percentage")
      issues.push(`${entryPath}.kind is invalid.`);
    if (entry.target !== "order" && entry.target !== "products" && entry.target !== "categories")
      issues.push(`${entryPath}.target is invalid.`);
    if (!Number.isSafeInteger(entry.discountMinor) || (entry.discountMinor as number) <= 0)
      issues.push(`${entryPath}.discountMinor is invalid.`);
    else total += entry.discountMinor as number;
    if (!Array.isArray(entry.lineDiscounts) || entry.lineDiscounts.length === 0) {
      issues.push(`${entryPath}.lineDiscounts must be a non-empty array.`);
    } else {
      const keys = new Set<string>();
      let lineTotal = 0;
      for (const [lineIndex, line] of entry.lineDiscounts.entries()) {
        const linePath = `${entryPath}.lineDiscounts[${lineIndex.toString()}]`;
        if (!isRecord(line)) {
          issues.push(`${linePath} must be a plain object.`);
          continue;
        }
        issues.push(...exactKeys(line, ["lineKey", "discountMinor"], linePath));
        if (typeof line.lineKey !== "string" || line.lineKey.length < 1 || keys.has(line.lineKey))
          issues.push(`${linePath}.lineKey is invalid or duplicated.`);
        if (typeof line.lineKey === "string") keys.add(line.lineKey);
        if (!Number.isSafeInteger(line.discountMinor) || (line.discountMinor as number) <= 0)
          issues.push(`${linePath}.discountMinor is invalid.`);
        else lineTotal += line.discountMinor as number;
      }
      if (Number.isSafeInteger(entry.discountMinor) && lineTotal !== entry.discountMinor)
        issues.push(`${entryPath}.lineDiscounts must sum to discountMinor.`);
    }
  }
  if (
    !Number.isSafeInteger(value.discountMinor) ||
    (value.discountMinor as number) < 0 ||
    value.discountMinor !== total
  ) {
    issues.push(`${path}.discountMinor must equal the applied promotion total.`);
  }
  return issues;
}

export function npRequireShopPromotionSnapshot(value: unknown): NpShopPromotionSnapshot {
  const issues = npAnalyzeShopPromotionSnapshot(value);
  if (issues.length > 0) throw new Error(`Invalid Shop promotion snapshot: ${issues.join(" ")}`);
  return value as NpShopPromotionSnapshot;
}

function eligibleLines(
  definition: NpShopPromotionDefinition,
  lines: NpShopPromotionEvaluationLine[],
): NpShopPromotionEvaluationLine[] {
  if (definition.target === "order") return lines;
  if (definition.target === "products") {
    const ids = new Set(definition.productIds);
    return lines.filter((line) => ids.has(line.productId));
  }
  const ids = new Set(definition.categoryIds);
  return lines.filter((line) => line.categoryIds.some((id) => ids.has(id)));
}

function allocateFixed(
  amount: number,
  lines: NpShopPromotionEvaluationLine[],
): Map<string, number> {
  const total = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const bounded = Math.min(amount, total);
  const rows = lines.map((line) => {
    const raw = BigInt(bounded) * BigInt(line.lineTotalMinor);
    return {
      key: line.key,
      amount: Number(raw / BigInt(total)),
      remainder: raw % BigInt(total),
    };
  });
  let remaining = bounded - rows.reduce((sum, row) => sum + row.amount, 0);
  rows.sort((a, b) =>
    a.remainder === b.remainder ? a.key.localeCompare(b.key) : a.remainder > b.remainder ? -1 : 1,
  );
  for (const row of rows) {
    if (remaining === 0) break;
    row.amount += 1;
    remaining -= 1;
  }
  return new Map(rows.filter((row) => row.amount > 0).map((row) => [row.key, row.amount]));
}

function evaluateOne(
  definition: NpShopPromotionDefinition,
  lines: NpShopPromotionEvaluationLine[],
  remaining: ReadonlyMap<string, number>,
): NpShopAppliedPromotion | null {
  const candidates = eligibleLines(definition, lines)
    .map((line) => ({ ...line, lineTotalMinor: remaining.get(line.key) ?? 0 }))
    .filter((line) => line.lineTotalMinor > 0);
  const eligibleTotal = candidates.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  if (eligibleTotal === 0) return null;
  const allocations =
    definition.kind === "fixed"
      ? allocateFixed(definition.value, candidates)
      : new Map(
          candidates
            .map(
              (line) =>
                [
                  line.key,
                  Number((BigInt(line.lineTotalMinor) * BigInt(definition.value)) / BigInt(10_000)),
                ] as const,
            )
            .filter(([, amount]) => amount > 0),
        );
  let discountMinor = [...allocations.values()].reduce((sum, amount) => sum + amount, 0);
  if (definition.maximumDiscountMinor !== null && discountMinor > definition.maximumDiscountMinor) {
    const capped = allocateFixed(definition.maximumDiscountMinor, candidates);
    allocations.clear();
    for (const entry of capped) allocations.set(...entry);
    discountMinor = definition.maximumDiscountMinor;
  }
  if (discountMinor <= 0) return null;
  return {
    id: definition.id,
    name: definition.name,
    code: definition.code,
    kind: definition.kind,
    target: definition.target,
    discountMinor,
    lineDiscounts: [...allocations]
      .map(([lineKey, amount]) => ({ lineKey, discountMinor: amount }))
      .sort((a, b) => a.lineKey.localeCompare(b.lineKey)),
  };
}

export function npEvaluateShopPromotions(input: {
  definitions: NpShopPromotionDefinition[];
  couponCodes: string[];
  currency: NpShopCurrency;
  subtotalMinor: number;
  lines: NpShopPromotionEvaluationLine[];
  now: Date;
  unavailablePromotionIds?: ReadonlySet<string>;
}): NpShopPromotionSnapshot {
  const couponCodes = npNormalizeShopCouponCodes(input.couponCodes);
  const requested = new Set(couponCodes);
  const eligible = input.definitions
    .filter(
      (definition) =>
        definition.currency === input.currency &&
        input.subtotalMinor >= definition.minimumSubtotalMinor &&
        (definition.automatic || (definition.code !== null && requested.has(definition.code))) &&
        (!definition.startsAt || new Date(definition.startsAt) <= input.now) &&
        (!definition.endsAt || new Date(definition.endsAt) > input.now) &&
        !input.unavailablePromotionIds?.has(definition.id),
    )
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const applyGroup = (definitions: NpShopPromotionDefinition[]): NpShopAppliedPromotion[] => {
    const remaining = new Map(input.lines.map((line) => [line.key, line.lineTotalMinor]));
    const applied: NpShopAppliedPromotion[] = [];
    for (const definition of definitions) {
      if (applied.length >= npShopPromotionLimits.maximumAppliedPromotions) break;
      const promotion = evaluateOne(definition, input.lines, remaining);
      if (!promotion) continue;
      applied.push(promotion);
      for (const line of promotion.lineDiscounts) {
        remaining.set(line.lineKey, (remaining.get(line.lineKey) ?? 0) - line.discountMinor);
      }
    }
    return applied;
  };
  const stack = applyGroup(eligible.filter((definition) => definition.stackable));
  const exclusive = eligible
    .filter((definition) => !definition.stackable)
    .map((definition) => applyGroup([definition]));
  const candidates = [stack, ...exclusive];
  const applied =
    candidates.sort((a, b) => {
      const discountA = a.reduce((sum, promotion) => sum + promotion.discountMinor, 0);
      const discountB = b.reduce((sum, promotion) => sum + promotion.discountMinor, 0);
      return discountB - discountA || JSON.stringify(a).localeCompare(JSON.stringify(b));
    })[0] ?? [];
  const appliedCodes = new Set(
    applied.flatMap((promotion) => (promotion.code ? [promotion.code] : [])),
  );
  return {
    contract: NP_SHOP_PROMOTION_SNAPSHOT_CONTRACT,
    couponCodes,
    rejectedCouponCodes: couponCodes.filter((code) => !appliedCodes.has(code)),
    applied,
    discountMinor: applied.reduce((sum, promotion) => sum + promotion.discountMinor, 0),
  };
}
