import { describe, expect, it } from "vitest";

import {
  NpShopProductReviewContractError,
  npEmptyShopProductReviewAggregate,
  npRequireShopProductReviewCreateInput,
  npRequireShopProductReviewModerationActionInput,
  npRequireShopProductReviewUpdateInput,
} from "./review-contract.js";

describe("Shop product review contract", () => {
  it("normalizes one exact create request", () => {
    expect(
      npRequireShopProductReviewCreateInput({
        productId: "product-1",
        purchaseToken: "signed.purchase",
        rating: 5,
        title: "  Great fit  ",
        body: "  Arrived exactly as described.  ",
        photos: ["photo-1", "photo-2"],
      }),
    ).toEqual({
      productId: "product-1",
      purchaseToken: "signed.purchase",
      rating: 5,
      title: "Great fit",
      body: "Arrived exactly as described.",
      photos: ["photo-1", "photo-2"],
    });
  });

  it("rejects unknown keys, invalid ratings, duplicate photos, and oversized text", () => {
    expect(() =>
      npRequireShopProductReviewCreateInput({
        productId: "product-1",
        purchaseToken: "signed.purchase",
        rating: 0,
        title: "Title",
        body: "Body",
        photos: [],
        orderId: "must-not-be-public",
      }),
    ).toThrow(NpShopProductReviewContractError);
    try {
      npRequireShopProductReviewUpdateInput({
        reviewId: "review-1",
        rating: 5,
        title: "Title",
        body: "Body",
        photos: ["same", "same"],
      });
      throw new Error("Expected duplicate review photos to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(NpShopProductReviewContractError);
      expect((error as NpShopProductReviewContractError).issues.join(" ")).toMatch(/duplicates/u);
    }
  });

  it("uses an exact zero aggregate without NaN averages", () => {
    expect(npEmptyShopProductReviewAggregate()).toEqual({
      count: 0,
      ratingTotal: 0,
      averageRatingBasisPoints: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });

  it("closes Admin row action payloads over explicit row and form fields", () => {
    expect(
      npRequireShopProductReviewModerationActionInput(
        { row: { id: "review-1", title: "Review" }, values: { reason: "  Spam  " } },
        { reason: true },
      ),
    ).toEqual({ reviewId: "review-1", reason: "Spam" });
    expect(
      npRequireShopProductReviewModerationActionInput(
        { row: { id: "review-1", title: "Review" }, values: {} },
        { reason: false },
      ),
    ).toEqual({ reviewId: "review-1", reason: null });
    expect(() =>
      npRequireShopProductReviewModerationActionInput(
        { row: { id: "review-1", title: "Review", memberId: "leak" }, values: {} },
        { reason: false },
      ),
    ).toThrow(NpShopProductReviewContractError);
  });
});
