import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShopProductReviews, ShopRestockAlert, ShopWishlistAction } from "./client.js";
import { classicShopSkin } from "./skins/classic.js";
import type { NpShopCatalogQuery, NpShopMessages, NpShopProduct } from "./types.js";

const messages = {
  locale: "ko",
  catalog: "스토어",
  products: "개 상품",
  categories: "카테고리",
  featuredProducts: "추천 상품",
  featured: "추천",
  reviewHeading: "상품 리뷰",
  reviewVerified: "구매 확인",
  reviewEmpty: "리뷰 없음",
  reviewWrite: "리뷰 작성",
  reviewEdit: "리뷰 수정",
  reviewLogin: "로그인 필요",
  reviewUnavailable: "구매 건 없음",
  reviewPurchase: "구매 상품",
  reviewRating: "평점",
  reviewTitle: "제목",
  reviewBody: "내용",
  reviewPhotos: "사진",
  reviewUpload: "사진 추가",
  reviewRemove: "삭제",
  reviewSave: "저장",
  reviewSaving: "저장 중",
  reviewDelete: "리뷰 삭제",
  reviewFailed: "리뷰 실패",
  wishlist: "찜한 상품",
  wishlistSave: "찜하기",
  wishlistSaved: "찜함",
  wishlistSaving: "저장 중",
  wishlistSignIn: "로그인하고 찜하기",
  wishlistFailed: "찜하기 실패",
  wishlistEmpty: "찜한 상품이 없습니다.",
  wishlistLogin: "찜한 상품은 로그인 후 확인할 수 있습니다.",
  wishlistBrowse: "상품 둘러보기",
  restockHeading: "재입고 알림",
  restockSelect: "품절 옵션",
  restockSubscribe: "재입고 시 알림 받기",
  restockSubscribed: "알림 신청됨 · 취소",
  restockSaving: "처리 중",
  restockSignIn: "로그인하고 알림 받기",
  restockUnavailable: "품절",
  restockFailed: "알림 실패",
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
  promotionDiscount: "할인",
  couponCode: "쿠폰",
  couponPlaceholder: "WELCOME",
  couponApply: "적용",
  couponRemove: "삭제",
  couponRejected: "사용 불가",
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
  orderDraftShippingMethods: "배송 방법",
  orderDraftShippingSelect: "선택",
  orderDraftShippingSelecting: "선택 중",
  orderDraftShippingRequired: "배송 방법 필요",
  orderDraftShippingUnavailable: "배송 방법 없음",
  orderDraftShippingDays: "일",
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
  shippingAmount: "배송비",
  taxAmount: "추가 세액",
  taxBreakdown: "세액 내역",
  orderTotal: "총액",
  order: "주문",
  orders: "주문 내역",
  orderCreate: "주문 만들기",
  orderCreating: "주문 만드는 중",
  orderPendingPayment: "결제 대기",
  orderPaid: "결제 완료",
  orderRefunded: "전액 환불",
  orderPaymentFailed: "결제 실패",
  orderCancelled: "취소됨",
  orderPaymentVerified: "결제 검증 완료",
  orderRefundedDetail: "전액 환불 완료",
  orderPartialRefundedDetail: "반품 부분 환불 완료",
  orderPaymentFailedDetail: "결제 실패 상세",
  orderPrivateRetained: "개인정보 보관",
  orderPrivateRedacted: "개인정보 삭제",
  orderInventoryHeld: "재고 예약",
  orderInventoryConsumed: "재고 차감",
  orderInventoryReleased: "재고 해제",
  orderInventoryNotRequired: "재고 추적 없음",
  orderRefundInventoryRestocked: "환불 재고 복원",
  orderRefundInventoryManual: "환불 재고 수동 조정",
  orderRefundInventoryShipped: "출고 후 자동 복원 없음",
  orderFulfillmentAwaiting: "배송 대기",
  orderFulfillmentProcessing: "배송 준비",
  orderFulfillmentShipped: "출고 완료",
  orderFulfillmentCancelled: "배송 취소",
  orderFulfillmentTracking: "배송 조회",
  orderTrackingInTransit: "배송 중",
  orderTrackingOutForDelivery: "배송 출발",
  orderTrackingDelivered: "배송 완료",
  orderTrackingException: "배송 예외",
  orderReturn: "상품 반품",
  orderReturnRequested: "반품 요청",
  orderReturnApproved: "반품 승인",
  orderReturnRejected: "반품 거절",
  orderReturnReceived: "반품 입고",
  orderReturnCancelled: "반품 취소",
  orderReturnReason: "반품 사유",
  orderReturnReasonDamaged: "배송 중 파손",
  orderReturnReasonDefective: "상품 불량",
  orderReturnReasonWrongItem: "다른 상품 배송",
  orderReturnReasonChangedMind: "단순 변심",
  orderReturnReasonOther: "기타",
  orderReturnDetail: "상세 사유",
  orderReturnSubmit: "반품 요청",
  orderReturnSubmitting: "반품 요청 중",
  orderReturnSelectItem: "반품 상품 선택",
  orderReturnCancel: "반품 취소",
  orderReturnPolicy: "반품 정책",
  orderReturnInventoryRestocked: "반품 재고 복원",
  orderReturnInventoryManual: "반품 재고 수동 조정",
  orderReturnInventoryNotRequired: "반품 재고 복원 불필요",
  orderReturnFailed: "반품 실패",
  orderReturnLogistics: "반품 배송",
  orderReturnLogisticsDropoff: "직접 접수",
  orderReturnLogisticsPickup: "회수 예약",
  orderReturnLogisticsCreate: "반품 배송 만들기",
  orderReturnLogisticsCreating: "반품 배송 생성 중",
  orderReturnLogisticsPending: "반품 배송 조정 중",
  orderReturnLogisticsActive: "반품 배송 접수",
  orderReturnLogisticsCancelled: "반품 배송 취소",
  orderReturnLogisticsResume: "반품 배송 다시 시도",
  orderReturnLogisticsCancel: "반품 배송 취소하기",
  orderReturnLogisticsLabel: "반품 운송장",
  orderReturnLogisticsReadyAt: "회수 시작",
  orderReturnLogisticsCloseAt: "회수 종료",
  orderReturnLogisticsPrivacy: "회수 주소 보호",
  orderReturnLogisticsFailed: "반품 배송 실패",
  orderReturnTrackingInTransit: "반품 이동 중",
  orderReturnTrackingOutForDelivery: "반품 배송 출발",
  orderReturnTrackingDelivered: "택배사 반품 배송 완료",
  orderReturnTrackingException: "반품 운송 예외",
  orderExpires: "주문 만료",
  orderCreated: "생성",
  orderCancel: "주문 취소",
  orderHistory: "주문 내역",
  orderEmpty: "주문 없음",
  orderReference: "주문 번호",
  orderPaymentUnavailable: "결제 없음",
  orderFailed: "주문 실패",
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
          reviewAction: <section data-review-fallback>리뷰</section>,
          inquiryAction: <section data-inquiry-fallback>문의</section>,
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
    expect(html).toContain("data-review-fallback");
    expect(html).toContain("data-inquiry-fallback");
  });

  it("keeps plugin structure in the block layer with semantic rich-text rules", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(styles.trimStart().startsWith("@layer np-blocks {")).toBe(true);
    expect(styles).not.toContain("@layer np-theme");
    expect(styles).toContain(".np-shop-product-description h2");
    expect(styles).toContain(".np-shop-product-description ul");
    expect(styles).toContain(".np-shop-product-description blockquote");
    expect(styles).toContain("[data-np-shop-review-form]");
    expect(styles).toContain("data-np-shop-wishlist-action");
    expect(styles).toContain("data-np-shop-restock-alert");
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

  it("renders translated review pagination from the exact page contract", () => {
    const html = renderToStaticMarkup(
      <ShopProductReviews
        apiPath="/api/plugins/shop/reviews"
        productId={product.id}
        productPath="/shop/products/cup"
        initialPage={{
          contract: "np.shop-product-review-page.v1",
          reviews: [],
          aggregate: {
            count: 21,
            ratingTotal: 100,
            averageRatingBasisPoints: 4_762,
            distribution: { 1: 0, 2: 0, 3: 1, 4: 3, 5: 17 },
          },
          eligibility: [],
          page: 1,
          totalPages: 2,
          totalReviews: 21,
        }}
        messages={{
          locale: messages.locale,
          heading: messages.reviewHeading,
          verified: messages.reviewVerified,
          empty: messages.reviewEmpty,
          write: messages.reviewWrite,
          edit: messages.reviewEdit,
          login: messages.reviewLogin,
          unavailable: messages.reviewUnavailable,
          purchase: messages.reviewPurchase,
          rating: messages.reviewRating,
          title: messages.reviewTitle,
          body: messages.reviewBody,
          photos: messages.reviewPhotos,
          upload: messages.reviewUpload,
          remove: messages.reviewRemove,
          save: messages.reviewSave,
          saving: messages.reviewSaving,
          delete: messages.reviewDelete,
          failed: messages.reviewFailed,
          previous: messages.previous,
          next: messages.next,
        }}
        signedIn={false}
      />,
    );
    expect(html).toContain("상품 리뷰");
    expect(html).toContain('href="/shop/products/cup?reviewPage=2"');
    expect(html).toContain(">다음</a>");
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
    expect(html).toContain('href="/shop/wishlist"');
  });

  it("renders the member wishlist surface and signed-out action fallback", async () => {
    const action = (
      <ShopWishlistAction
        targetType="shop-products"
        productId={product.id}
        initialSaved={false}
        signedIn={false}
        loginHref="/members/login?next=%2Fshop"
        labels={{
          save: messages.wishlistSave,
          saved: messages.wishlistSaved,
          saving: messages.wishlistSaving,
          signIn: messages.wishlistSignIn,
          failed: messages.wishlistFailed,
        }}
      />
    );
    expect(renderToStaticMarkup(action)).toContain('data-np-shop-wishlist-action="signed-out"');

    const html = renderToStaticMarkup(
      <>
        {await classicShopSkin.renderWishlist?.({
          basePath: "/shop",
          page: { products: [product], page: 1, hasPrevious: false, hasNext: false },
          signedIn: true,
          loginHref: "/members/login?next=%2Fshop%2Fwishlist",
          wishlistActions: { [product.id]: action },
          messages,
        })}
      </>,
    );
    expect(html).toContain('data-np-shop-surface="wishlist"');
    expect(html).toContain('data-np-shop-product="product-1"');
    expect(html).toContain("찜한 상품");
  });

  it("renders a prepared one-shot restock action through the product skin", async () => {
    const variant = product.variants[0];
    if (!variant) throw new Error("Expected the Shop fixture to include a variant.");
    const unavailableProduct: NpShopProduct = {
      ...product,
      inventoryState: "out-of-stock",
      variants: [{ ...variant, stockQuantity: 0 }],
    };
    const action = (
      <ShopRestockAlert
        apiPath="/api/plugins/shop/restock-alerts"
        product={unavailableProduct}
        initialVariantSkus={[]}
        signedIn={true}
        loginHref="/members/login?next=%2Fshop%2Fproducts%2Fcup"
        labels={{
          heading: messages.restockHeading,
          select: messages.restockSelect,
          subscribe: messages.restockSubscribe,
          subscribed: messages.restockSubscribed,
          saving: messages.restockSaving,
          signIn: messages.restockSignIn,
          unavailable: messages.restockUnavailable,
          failed: messages.restockFailed,
        }}
      />
    );
    const html = renderToStaticMarkup(
      <>
        {await classicShopSkin.renderProduct({
          basePath: "/shop",
          product: unavailableProduct,
          categories: [],
          description: null,
          restockAction: action,
          messages,
        })}
      </>,
    );

    expect(html).toContain('data-np-shop-restock-alert="available"');
    expect(html).toContain("재입고 시 알림 받기");
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
            promotions: {
              contract: "np.shop-promotion-snapshot.v1",
              couponCodes: [],
              rejectedCouponCodes: [],
              applied: [],
              discountMinor: 0,
            },
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
          orderApiPath: "/api/plugins/shop/orders",
          draftId: "123e4567-e89b-42d3-a456-426614174000",
          messages,
        })}
      </>,
    );
    expect(html).toContain('data-np-shop-surface="order-draft"');
    expect(html).toContain("초안 준비 중");
  });

  it("renders order history and detail through independent skin hooks", async () => {
    const history = renderToStaticMarkup(
      <>
        {await classicShopSkin.renderOrders?.({
          basePath: "/shop",
          apiPath: "/api/plugins/shop/orders",
          messages,
        })}
      </>,
    );
    expect(history).toContain('data-np-shop-surface="orders"');
    expect(history).toContain("주문 내역");

    const detail = renderToStaticMarkup(
      <>
        {await classicShopSkin.renderOrder?.({
          basePath: "/shop",
          apiPath: "/api/plugins/shop/orders",
          returnApiPath: "/api/plugins/shop/returns",
          orderId: "123e4567-e89b-42d3-a456-426614174000",
          messages,
        })}
      </>,
    );
    expect(detail).toContain('data-np-shop-surface="order"');
    expect(detail).toContain("주문 만드는 중");
  });
});
