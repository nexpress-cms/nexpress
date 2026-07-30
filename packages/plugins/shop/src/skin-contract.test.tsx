import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { classicShopSkin } from "./skins/classic.js";
import type { NpShopCatalogQuery, NpShopMessages, NpShopProduct } from "./types.js";

const messages = {
  locale: "ko",
  catalog: "스토어",
  products: "개 상품",
  categories: "카테고리",
  featuredProducts: "추천 상품",
  featured: "추천",
  search: "상품 검색",
  searchPlaceholder: "검색",
  sort: "정렬",
  newest: "최신순",
  priceLow: "낮은 가격순",
  priceHigh: "높은 가격순",
  name: "이름",
  inStockOnly: "구매 가능 상품만",
  apply: "적용",
  clear: "초기화",
  emptyProducts: "상품 없음",
  emptyCategories: "카테고리 없음",
  inventoryInStock: "재고 있음",
  inventoryLow: "품절 임박",
  inventoryOut: "품절",
  inventoryUntracked: "재고 문의",
  compareAtPrice: "정상 가격",
  sku: "상품 코드",
  variants: "옵션",
  option: "선택",
  price: "가격",
  stock: "재고",
  taxIncluded: "세금 포함",
  catalogOnly: "카탈로그 전용",
  cart: "장바구니",
  addToCart: "담기",
  addingToCart: "담는 중",
  addedToCart: "담음",
  cartEmpty: "비어 있음",
  cartQuantity: "수량",
  cartRemove: "삭제",
  cartClear: "비우기",
  cartSubtotal: "합계",
  cartUnavailable: "구매 불가",
  cartPriceChanged: "가격 변경",
  cartInsufficientStock: "재고 부족",
  cartMixedCurrency: "통화 혼합",
  cartReady: "준비됨",
  cartNotReady: "준비 안 됨",
  cartCheckoutUnavailable: "결제 없음",
  cartUpdateFailed: "갱신 실패",
  selectVariant: "옵션 선택",
  checkout: "결제 준비",
  checkoutCreating: "준비 중",
  checkoutIntent: "결제 의도",
  checkoutOpen: "확인 완료",
  checkoutStale: "변경됨",
  checkoutCancelled: "취소됨",
  checkoutExpired: "만료됨",
  checkoutCancel: "취소",
  checkoutExpires: "만료",
  checkoutPaymentUnavailable: "결제 없음",
  checkoutBackToCart: "장바구니로",
  checkoutFailed: "실패",
  orderDraft: "주문 초안",
  orderDraftCreate: "배송정보 입력",
  orderDraftCreating: "초안 준비 중",
  orderDraftCollecting: "정보 필요",
  orderDraftReviewable: "검토 가능",
  orderDraftStale: "변경됨",
  orderDraftExpires: "만료",
  orderDraftCustomer: "주문자",
  orderDraftShipping: "배송지",
  orderDraftFullName: "이름",
  orderDraftEmail: "이메일",
  orderDraftPhone: "전화번호",
  orderDraftRecipientName: "받는 분",
  orderDraftCountryCode: "국가",
  orderDraftPostalCode: "우편번호",
  orderDraftAddressLine1: "주소",
  orderDraftAddressLine2: "상세주소",
  orderDraftLocality: "시군구",
  orderDraftAdministrativeArea: "시도",
  orderDraftSave: "저장",
  orderDraftSaving: "저장 중",
  orderDraftDelete: "삭제",
  orderDraftPrivacy: "24시간 후 삭제",
  orderDraftPaymentUnavailable: "결제 없음",
  orderDraftFailed: "초안 실패",
  previous: "이전",
  next: "다음",
  backToCatalog: "돌아가기",
  viewProduct: "상품 보기",
  pageOf: (page: number, totalPages: number) => `${page.toString()} / ${totalPages.toString()}`,
  formatMoney: (amount: number) => `${amount.toLocaleString("ko-KR")}원`,
} satisfies NpShopMessages;

const query: NpShopCatalogQuery = {
  page: 1,
  search: null,
  sort: "newest",
  inStockOnly: false,
};

const product: NpShopProduct = {
  id: "product-1",
  slug: "cup",
  name: "컵",
  summary: "매일 쓰는 컵",
  description: null,
  currency: "KRW",
  priceMinor: 25_000,
  compareAtPriceMinor: 30_000,
  featured: true,
  imageUrl: null,
  inventoryState: "low-stock",
  stockQuantity: 2,
  categoryIds: ["category-1"],
  skinId: "classic",
  galleryUrls: [],
  sku: "CUP-001",
  variants: [
    {
      name: "작은 컵",
      sku: "CUP-S",
      optionSummary: "240ml",
      priceMinor: null,
      stockQuantity: 2,
      enabled: true,
    },
  ],
  taxIncluded: true,
};

describe("shop skin contract", () => {
  it("renders translated commerce labels and stable integration hooks", async () => {
    const html = renderToStaticMarkup(
      <>
        {await classicShopSkin.renderProduct({
          basePath: "/shop",
          product,
          categories: [
            {
              id: "category-1",
              slug: "living",
              name: "생활",
              description: null,
              imageUrl: null,
              featured: true,
              displayOrder: 0,
            },
          ],
          description: (
            <>
              <h2>설명</h2>
              <ul>
                <li>도자기</li>
              </ul>
            </>
          ),
          messages,
        })}
      </>,
    );

    expect(html).toContain('data-np-shop-surface="product"');
    expect(html).toContain('data-np-shop-skin="classic"');
    expect(html).toContain('data-np-shop-inventory="low-stock"');
    expect(html).toContain("<th>선택</th>");
    expect(html).toContain("<th>가격</th>");
    expect(html).toContain("<h2>설명</h2>");
    expect(html).toContain("<ul><li>도자기</li></ul>");
  });

  it("keeps plugin structure in the block layer with semantic rich-text rules", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(styles.trimStart().startsWith("@layer np-blocks {")).toBe(true);
    expect(styles).not.toContain("@layer np-theme");
    expect(styles).toContain(".np-shop-product-description h2");
    expect(styles).toContain(".np-shop-product-description ul");
    expect(styles).toContain(".np-shop-product-description blockquote");
    for (const property of [
      "--np-shop-content-max",
      "--np-shop-surface",
      "--np-shop-soft",
      "--np-shop-ink",
      "--np-shop-subtle",
      "--np-shop-line",
      "--np-shop-accent",
      "--np-shop-accent-foreground",
    ]) {
      expect(styles).toMatch(new RegExp(`var\\(\\s*${property},`, "u"));
    }
  });

  it("preserves catalog query controls and translated product counts", async () => {
    const html = renderToStaticMarkup(
      <>
        {await classicShopSkin.renderCatalog({
          basePath: "/shop",
          products: [product],
          categories: [],
          query,
          totalPages: 1,
          totalProducts: 1,
          messages,
        })}
      </>,
    );
    expect(html).toContain("1 개 상품");
    expect(html).toContain('role="search"');
    expect(html).toContain('name="q"');
    expect(html).toContain(">추천</span>");
  });

  it("renders the complete cart fallback through the skin contract", async () => {
    const html = renderToStaticMarkup(
      <>
        {await classicShopSkin.renderCart?.({
          basePath: "/shop",
          apiPath: "/api/plugins/shop/cart",
          checkoutApiPath: "/api/plugins/shop/checkout",
          quote: {
            contract: "np.shop-cart-quote.v1",
            revision: 0,
            lines: [],
            totals: [],
            totalUnits: 0,
            ready: false,
            issues: [],
            fingerprint: "a".repeat(64),
            updatedAt: null,
          },
          messages,
        })}
      </>,
    );
    expect(html).toContain('data-np-shop-surface="cart"');
    expect(html).toContain("장바구니");
    expect(html).toContain("비어 있음");
  });

  it("renders the complete checkout fallback through the optional skin contract", async () => {
    const html = renderToStaticMarkup(
      <>
        {await classicShopSkin.renderCheckout?.({
          basePath: "/shop",
          apiPath: "/api/plugins/shop/checkout",
          orderDraftApiPath: "/api/plugins/shop/order-drafts",
          intentId: "123e4567-e89b-42d3-a456-426614174000",
          messages,
        })}
      </>,
    );
    expect(html).toContain('data-np-shop-surface="checkout"');
    expect(html).toContain("결제 준비");
    expect(html).toContain("준비 중");
  });

  it("renders the private order draft form through the skin contract", async () => {
    const html = renderToStaticMarkup(
      <>
        {await classicShopSkin.renderOrderDraft?.({
          basePath: "/shop",
          apiPath: "/api/plugins/shop/order-drafts",
          draftId: "123e4567-e89b-42d3-a456-426614174000",
          messages,
        })}
      </>,
    );
    expect(html).toContain('data-np-shop-surface="order-draft"');
    expect(html).toContain("초안 준비 중");
  });
});
