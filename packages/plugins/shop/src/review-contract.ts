export const NP_SHOP_PRODUCT_REVIEW_CONTRACT = "np.shop-product-review.v1" as const;
export const NP_SHOP_PRODUCT_REVIEW_PAGE_CONTRACT = "np.shop-product-review-page.v1" as const;

export const npShopProductReviewLimits = {
  minimumRating: 1,
  maximumRating: 5,
  maximumTitleLength: 120,
  maximumBodyLength: 2_000,
  maximumPhotos: 5,
  pageSize: 20,
  maximumPage: 10_000,
  eligibilityOrderLimit: 100,
  maximumEligibility: 100,
  tokenTtlSeconds: 60 * 30,
} as const;

export interface NpShopProductReviewAggregate {
  count: number;
  ratingTotal: number;
  averageRatingBasisPoints: number;
  distribution: { 1: number; 2: number; 3: number; 4: number; 5: number };
}

export interface NpShopProductReviewPhoto {
  id: string;
  url: string;
}

export interface NpShopProductReviewAuthor {
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
}

export interface NpShopProductReview {
  contract: typeof NP_SHOP_PRODUCT_REVIEW_CONTRACT;
  id: string;
  productId: string;
  rating: number;
  title: string;
  body: string;
  photos: NpShopProductReviewPhoto[];
  verifiedPurchase: true;
  author: NpShopProductReviewAuthor | null;
  ownedByViewer: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NpShopProductReviewEligibility {
  purchaseToken: string;
  variantName: string | null;
  purchasedAt: string;
}

export interface NpShopProductReviewPage {
  contract: typeof NP_SHOP_PRODUCT_REVIEW_PAGE_CONTRACT;
  reviews: NpShopProductReview[];
  aggregate: NpShopProductReviewAggregate;
  eligibility: NpShopProductReviewEligibility[];
  page: number;
  totalPages: number;
  totalReviews: number;
}

export interface NpShopProductReviewCreateInput {
  productId: string;
  purchaseToken: string;
  rating: number;
  title: string;
  body: string;
  photos: string[];
}

export interface NpShopProductReviewUpdateInput {
  reviewId: string;
  rating: number;
  title: string;
  body: string;
  photos: string[];
}

export interface NpShopProductReviewModerationActionInput {
  reviewId: string;
  reason: string | null;
}

export class NpShopProductReviewContractError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "NpShopProductReviewContractError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  issues: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) issues.push(`review.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) issues.push(`review.${key} is required.`);
  }
}

function requireText(value: unknown, field: string, maximum: number, minimum = 1): string {
  if (typeof value !== "string") {
    throw new NpShopProductReviewContractError("Invalid product review", [
      `review.${field} must be text.`,
    ]);
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new NpShopProductReviewContractError("Invalid product review", [
      `review.${field} must contain ${minimum.toString()}–${maximum.toString()} characters.`,
    ]);
  }
  return normalized;
}

function requireRating(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < npShopProductReviewLimits.minimumRating ||
    (value as number) > npShopProductReviewLimits.maximumRating
  ) {
    throw new NpShopProductReviewContractError("Invalid product review", [
      "review.rating must be an integer from 1 through 5.",
    ]);
  }
  return value as number;
}

function requirePhotos(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > npShopProductReviewLimits.maximumPhotos) {
    throw new NpShopProductReviewContractError("Invalid product review", [
      `review.photos must contain at most ${npShopProductReviewLimits.maximumPhotos.toString()} media ids.`,
    ]);
  }
  const photos = value.map((entry) => requireText(entry, "photos", 100));
  if (new Set(photos).size !== photos.length) {
    throw new NpShopProductReviewContractError("Invalid product review", [
      "review.photos must not contain duplicates.",
    ]);
  }
  return photos;
}

export function npRequireShopProductReviewCreateInput(
  value: unknown,
): NpShopProductReviewCreateInput {
  if (!isRecord(value)) {
    throw new NpShopProductReviewContractError("Invalid product review", [
      "review must be an object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["productId", "purchaseToken", "rating", "title", "body", "photos"], issues);
  if (issues.length) throw new NpShopProductReviewContractError("Invalid product review", issues);
  return {
    productId: requireText(value.productId, "productId", 100),
    purchaseToken: requireText(value.purchaseToken, "purchaseToken", 2_000),
    rating: requireRating(value.rating),
    title: requireText(value.title, "title", npShopProductReviewLimits.maximumTitleLength),
    body: requireText(value.body, "body", npShopProductReviewLimits.maximumBodyLength),
    photos: requirePhotos(value.photos),
  };
}

export function npRequireShopProductReviewUpdateInput(
  value: unknown,
): NpShopProductReviewUpdateInput {
  if (!isRecord(value)) {
    throw new NpShopProductReviewContractError("Invalid product review", [
      "review must be an object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["reviewId", "rating", "title", "body", "photos"], issues);
  if (issues.length) throw new NpShopProductReviewContractError("Invalid product review", issues);
  return {
    reviewId: requireText(value.reviewId, "reviewId", 100),
    rating: requireRating(value.rating),
    title: requireText(value.title, "title", npShopProductReviewLimits.maximumTitleLength),
    body: requireText(value.body, "body", npShopProductReviewLimits.maximumBodyLength),
    photos: requirePhotos(value.photos),
  };
}

export function npEmptyShopProductReviewAggregate(): NpShopProductReviewAggregate {
  return {
    count: 0,
    ratingTotal: 0,
    averageRatingBasisPoints: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };
}

export function npRequireShopProductReviewModerationActionInput(
  value: unknown,
  options: { reason: boolean },
): NpShopProductReviewModerationActionInput {
  if (!isRecord(value)) {
    throw new NpShopProductReviewContractError("Invalid review moderation action", [
      "review action must be an object.",
    ]);
  }
  const issues: string[] = [];
  exactKeys(value, ["row", "values"], issues);
  const row = isRecord(value.row) ? value.row : null;
  const values = isRecord(value.values) ? value.values : null;
  if (!row) issues.push("review.row must be an object.");
  if (!values) issues.push("review.values must be an object.");
  if (row) {
    exactKeys(row, ["id", "title"], issues);
    if (typeof row.id !== "string" || !row.id) issues.push("review.row.id is required.");
    if (typeof row.title !== "string" || !row.title) {
      issues.push("review.row.title is required.");
    }
  }
  if (values) {
    exactKeys(values, options.reason ? ["reason"] : [], issues);
    if (
      options.reason &&
      (typeof values.reason !== "string" ||
        values.reason.trim().length < 1 ||
        values.reason.trim().length > 1_000)
    ) {
      issues.push("review.values.reason must contain 1–1000 characters.");
    }
  }
  if (issues.length) {
    throw new NpShopProductReviewContractError("Invalid review moderation action", issues);
  }
  return {
    reviewId: (row as { id: string }).id,
    reason: options.reason ? (values as { reason: string }).reason.trim() : null,
  };
}
