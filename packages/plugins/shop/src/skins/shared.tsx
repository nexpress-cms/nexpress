import Link from "next/link";
import type { ReactNode } from "react";

import {
  ShopCart,
  ShopCheckout,
  ShopOrder,
  ShopOrderDraft,
  ShopOrders,
} from "@nexpress/plugin-shop/client";

import { buildShopCatalogHref } from "../runtime.js";
import type {
  NpShopCartClientMessages,
  NpShopCartSkinProps,
  NpShopCheckoutSkinProps,
  NpShopOrderSkinProps,
  NpShopOrderDraftSkinProps,
  NpShopOrdersSkinProps,
  NpShopCatalogSkinProps,
  NpShopCategorySkinProps,
  NpShopMessages,
  NpShopProductSkinProps,
  NpShopProductSummary,
  NpShopWishlistSkinProps,
} from "../types.js";

function cartClientMessages(messages: NpShopMessages): NpShopCartClientMessages {
  return {
    locale: messages.locale,
    cart: messages.cart,
    addToCart: messages.addToCart,
    addingToCart: messages.addingToCart,
    addedToCart: messages.addedToCart,
    cartEmpty: messages.cartEmpty,
    cartQuantity: messages.cartQuantity,
    cartRemove: messages.cartRemove,
    cartClear: messages.cartClear,
    cartSubtotal: messages.cartSubtotal,
    promotionDiscount: messages.promotionDiscount,
    couponCode: messages.couponCode,
    couponPlaceholder: messages.couponPlaceholder,
    couponApply: messages.couponApply,
    couponRemove: messages.couponRemove,
    couponRejected: messages.couponRejected,
    cartUnavailable: messages.cartUnavailable,
    cartPriceChanged: messages.cartPriceChanged,
    cartInsufficientStock: messages.cartInsufficientStock,
    cartMixedCurrency: messages.cartMixedCurrency,
    cartReady: messages.cartReady,
    cartNotReady: messages.cartNotReady,
    cartCheckoutUnavailable: messages.cartCheckoutUnavailable,
    cartUpdateFailed: messages.cartUpdateFailed,
    selectVariant: messages.selectVariant,
    checkout: messages.checkout,
    checkoutCreating: messages.checkoutCreating,
    checkoutIntent: messages.checkoutIntent,
    checkoutOpen: messages.checkoutOpen,
    checkoutStale: messages.checkoutStale,
    checkoutCancelled: messages.checkoutCancelled,
    checkoutExpired: messages.checkoutExpired,
    checkoutCancel: messages.checkoutCancel,
    checkoutExpires: messages.checkoutExpires,
    checkoutPaymentUnavailable: messages.checkoutPaymentUnavailable,
    checkoutBackToCart: messages.checkoutBackToCart,
    checkoutFailed: messages.checkoutFailed,
    orderDraft: messages.orderDraft,
    orderDraftCreate: messages.orderDraftCreate,
    orderDraftCreating: messages.orderDraftCreating,
    orderDraftCollecting: messages.orderDraftCollecting,
    orderDraftReviewable: messages.orderDraftReviewable,
    orderDraftStale: messages.orderDraftStale,
    orderDraftExpires: messages.orderDraftExpires,
    orderDraftCustomer: messages.orderDraftCustomer,
    orderDraftShipping: messages.orderDraftShipping,
    orderDraftShippingMethods: messages.orderDraftShippingMethods,
    orderDraftShippingSelect: messages.orderDraftShippingSelect,
    orderDraftShippingSelecting: messages.orderDraftShippingSelecting,
    orderDraftShippingRequired: messages.orderDraftShippingRequired,
    orderDraftShippingUnavailable: messages.orderDraftShippingUnavailable,
    orderDraftShippingDays: messages.orderDraftShippingDays,
    orderDraftFullName: messages.orderDraftFullName,
    orderDraftEmail: messages.orderDraftEmail,
    orderDraftPhone: messages.orderDraftPhone,
    orderDraftRecipientName: messages.orderDraftRecipientName,
    orderDraftCountryCode: messages.orderDraftCountryCode,
    orderDraftPostalCode: messages.orderDraftPostalCode,
    orderDraftAddressLine1: messages.orderDraftAddressLine1,
    orderDraftAddressLine2: messages.orderDraftAddressLine2,
    orderDraftLocality: messages.orderDraftLocality,
    orderDraftAdministrativeArea: messages.orderDraftAdministrativeArea,
    orderDraftSave: messages.orderDraftSave,
    orderDraftSaving: messages.orderDraftSaving,
    orderDraftDelete: messages.orderDraftDelete,
    orderDraftPrivacy: messages.orderDraftPrivacy,
    orderDraftPaymentUnavailable: messages.orderDraftPaymentUnavailable,
    orderDraftFailed: messages.orderDraftFailed,
    shippingAmount: messages.shippingAmount,
    taxAmount: messages.taxAmount,
    taxBreakdown: messages.taxBreakdown,
    orderTotal: messages.orderTotal,
    order: messages.order,
    orders: messages.orders,
    orderCreate: messages.orderCreate,
    orderCreating: messages.orderCreating,
    orderPendingPayment: messages.orderPendingPayment,
    orderPaid: messages.orderPaid,
    orderRefunded: messages.orderRefunded,
    orderPaymentFailed: messages.orderPaymentFailed,
    orderCancelled: messages.orderCancelled,
    orderPaymentVerified: messages.orderPaymentVerified,
    orderRefundedDetail: messages.orderRefundedDetail,
    orderPartialRefundedDetail: messages.orderPartialRefundedDetail,
    orderPaymentFailedDetail: messages.orderPaymentFailedDetail,
    orderPrivateRetained: messages.orderPrivateRetained,
    orderPrivateRedacted: messages.orderPrivateRedacted,
    orderInventoryHeld: messages.orderInventoryHeld,
    orderInventoryConsumed: messages.orderInventoryConsumed,
    orderInventoryReleased: messages.orderInventoryReleased,
    orderInventoryNotRequired: messages.orderInventoryNotRequired,
    orderRefundInventoryRestocked: messages.orderRefundInventoryRestocked,
    orderRefundInventoryManual: messages.orderRefundInventoryManual,
    orderRefundInventoryShipped: messages.orderRefundInventoryShipped,
    orderFulfillmentAwaiting: messages.orderFulfillmentAwaiting,
    orderFulfillmentProcessing: messages.orderFulfillmentProcessing,
    orderFulfillmentShipped: messages.orderFulfillmentShipped,
    orderFulfillmentCancelled: messages.orderFulfillmentCancelled,
    orderFulfillmentTracking: messages.orderFulfillmentTracking,
    orderTrackingInTransit: messages.orderTrackingInTransit,
    orderTrackingOutForDelivery: messages.orderTrackingOutForDelivery,
    orderTrackingDelivered: messages.orderTrackingDelivered,
    orderTrackingException: messages.orderTrackingException,
    orderReturn: messages.orderReturn,
    orderReturnRequested: messages.orderReturnRequested,
    orderReturnApproved: messages.orderReturnApproved,
    orderReturnRejected: messages.orderReturnRejected,
    orderReturnReceived: messages.orderReturnReceived,
    orderReturnCancelled: messages.orderReturnCancelled,
    orderExchange: messages.orderExchange,
    orderExchangeAwaiting: messages.orderExchangeAwaiting,
    orderExchangeProcessing: messages.orderExchangeProcessing,
    orderExchangeShipped: messages.orderExchangeShipped,
    orderExchangeCancelled: messages.orderExchangeCancelled,
    orderExchangeInventoryRestocked: messages.orderExchangeInventoryRestocked,
    orderExchangeInventoryManual: messages.orderExchangeInventoryManual,
    orderExchangeTracking: messages.orderExchangeTracking,
    orderExchangeDestination: messages.orderExchangeDestination,
    orderExchangeDestinationAwaiting: messages.orderExchangeDestinationAwaiting,
    orderExchangeDestinationSubmitted: messages.orderExchangeDestinationSubmitted,
    orderExchangeDestinationAccessed: messages.orderExchangeDestinationAccessed,
    orderExchangeDestinationExpired: messages.orderExchangeDestinationExpired,
    orderExchangeDestinationSubmit: messages.orderExchangeDestinationSubmit,
    orderExchangeDestinationSubmitting: messages.orderExchangeDestinationSubmitting,
    orderExchangeDestinationPrivacy: messages.orderExchangeDestinationPrivacy,
    orderExchangeDestinationFailed: messages.orderExchangeDestinationFailed,
    orderReturnReason: messages.orderReturnReason,
    orderReturnReasonDamaged: messages.orderReturnReasonDamaged,
    orderReturnReasonDefective: messages.orderReturnReasonDefective,
    orderReturnReasonWrongItem: messages.orderReturnReasonWrongItem,
    orderReturnReasonChangedMind: messages.orderReturnReasonChangedMind,
    orderReturnReasonOther: messages.orderReturnReasonOther,
    orderReturnDetail: messages.orderReturnDetail,
    orderReturnSubmit: messages.orderReturnSubmit,
    orderReturnSubmitting: messages.orderReturnSubmitting,
    orderReturnSelectItem: messages.orderReturnSelectItem,
    orderReturnCancel: messages.orderReturnCancel,
    orderReturnPolicy: messages.orderReturnPolicy,
    orderReturnInventoryRestocked: messages.orderReturnInventoryRestocked,
    orderReturnInventoryManual: messages.orderReturnInventoryManual,
    orderReturnInventoryNotRequired: messages.orderReturnInventoryNotRequired,
    orderReturnFailed: messages.orderReturnFailed,
    orderReturnLogistics: messages.orderReturnLogistics,
    orderReturnLogisticsDropoff: messages.orderReturnLogisticsDropoff,
    orderReturnLogisticsPickup: messages.orderReturnLogisticsPickup,
    orderReturnLogisticsCreate: messages.orderReturnLogisticsCreate,
    orderReturnLogisticsCreating: messages.orderReturnLogisticsCreating,
    orderReturnLogisticsPending: messages.orderReturnLogisticsPending,
    orderReturnLogisticsActive: messages.orderReturnLogisticsActive,
    orderReturnLogisticsCancelled: messages.orderReturnLogisticsCancelled,
    orderReturnLogisticsResume: messages.orderReturnLogisticsResume,
    orderReturnLogisticsCancel: messages.orderReturnLogisticsCancel,
    orderReturnLogisticsLabel: messages.orderReturnLogisticsLabel,
    orderReturnLogisticsReadyAt: messages.orderReturnLogisticsReadyAt,
    orderReturnLogisticsCloseAt: messages.orderReturnLogisticsCloseAt,
    orderReturnLogisticsPrivacy: messages.orderReturnLogisticsPrivacy,
    orderReturnLogisticsFailed: messages.orderReturnLogisticsFailed,
    orderReturnPostageQuote: messages.orderReturnPostageQuote,
    orderReturnPostageQuoting: messages.orderReturnPostageQuoting,
    orderReturnPostageSelect: messages.orderReturnPostageSelect,
    orderReturnPostageSelecting: messages.orderReturnPostageSelecting,
    orderReturnPostageSelected: messages.orderReturnPostageSelected,
    orderReturnPostageExpires: messages.orderReturnPostageExpires,
    orderReturnPostagePrivacy: messages.orderReturnPostagePrivacy,
    orderReturnPostageBoundary: messages.orderReturnPostageBoundary,
    orderReturnPostageFailed: messages.orderReturnPostageFailed,
    orderReturnPostageResponsibility: messages.orderReturnPostageResponsibility,
    orderReturnPostageMerchant: messages.orderReturnPostageMerchant,
    orderReturnPostageCustomer: messages.orderReturnPostageCustomer,
    orderReturnPostageDeduction: messages.orderReturnPostageDeduction,
    orderReturnRefundNet: messages.orderReturnRefundNet,
    orderReturnTrackingInTransit: messages.orderReturnTrackingInTransit,
    orderReturnTrackingOutForDelivery: messages.orderReturnTrackingOutForDelivery,
    orderReturnTrackingDelivered: messages.orderReturnTrackingDelivered,
    orderReturnTrackingException: messages.orderReturnTrackingException,
    orderExpires: messages.orderExpires,
    orderCreated: messages.orderCreated,
    orderNotifications: messages.orderNotifications,
    orderCancel: messages.orderCancel,
    orderHistory: messages.orderHistory,
    orderEmpty: messages.orderEmpty,
    orderReference: messages.orderReference,
    orderPaymentUnavailable: messages.orderPaymentUnavailable,
    orderReAdd: messages.orderReAdd,
    orderReAdding: messages.orderReAdding,
    orderReAddBoundary: messages.orderReAddBoundary,
    orderReAddAdded: messages.orderReAddAdded,
    orderReAddSkipped: messages.orderReAddSkipped,
    orderReAddCart: messages.orderReAddCart,
    orderReAddFailed: messages.orderReAddFailed,
    orderReAddConflict: messages.orderReAddConflict,
    orderReAddProductUnavailable: messages.orderReAddProductUnavailable,
    orderReAddVariantUnavailable: messages.orderReAddVariantUnavailable,
    orderReAddLineLimit: messages.orderReAddLineLimit,
    orderReAddQuantityLimit: messages.orderReAddQuantityLimit,
    orderFailed: messages.orderFailed,
  };
}

export function getShopCartClientMessages(messages: NpShopMessages): NpShopCartClientMessages {
  return cartClientMessages(messages);
}

function InventoryLabel({
  product,
  messages,
}: {
  product: NpShopProductSummary;
  messages: NpShopMessages;
}) {
  const label = {
    "in-stock": messages.inventoryInStock,
    "low-stock": messages.inventoryLow,
    "out-of-stock": messages.inventoryOut,
    untracked: messages.inventoryUntracked,
  }[product.inventoryState];
  return (
    <span className="np-shop-inventory" data-np-shop-inventory={product.inventoryState}>
      {label}
    </span>
  );
}

export function ProductPrice({
  product,
  messages,
}: {
  product: NpShopProductSummary;
  messages: NpShopMessages;
}) {
  return (
    <span className="np-shop-price">
      <strong>{messages.formatMoney(product.priceMinor, product.currency)}</strong>
      {product.compareAtPriceMinor !== null ? (
        <del aria-label={messages.compareAtPrice}>
          {messages.formatMoney(product.compareAtPriceMinor, product.currency)}
        </del>
      ) : null}
    </span>
  );
}

export function ProductCard({
  basePath,
  product,
  messages,
  wishlistAction,
  priceAlertAction,
}: {
  basePath: string;
  product: NpShopProductSummary;
  messages: NpShopMessages;
  wishlistAction?: ReactNode;
  priceAlertAction?: ReactNode;
}) {
  return (
    <article className="np-shop-product-card" data-np-shop-product={product.id}>
      <Link href={`${basePath}/products/${product.slug}`} className="np-shop-product-image">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" loading="lazy" />
        ) : (
          <span aria-hidden="true">{product.name.slice(0, 1).toUpperCase()}</span>
        )}
      </Link>
      <div className="np-shop-product-card-body">
        <div className="np-shop-product-card-kicker">
          <span>
            <InventoryLabel product={product} messages={messages} />
            {product.featured ? (
              <span className="np-shop-featured">{messages.featured}</span>
            ) : null}
          </span>
          {wishlistAction}
        </div>
        <h2>
          <Link href={`${basePath}/products/${product.slug}`}>{product.name}</Link>
        </h2>
        {product.summary ? <p>{product.summary}</p> : null}
        {(product.reviewCount ?? 0) > 0 ? (
          <p
            className="np-shop-product-rating"
            aria-label={`${((product.reviewAverageBasisPoints ?? 0) / 1_000).toFixed(1)} / 5 (${(product.reviewCount ?? 0).toString()})`}
          >
            <span aria-hidden="true">★</span>{" "}
            {((product.reviewAverageBasisPoints ?? 0) / 1_000).toFixed(1)} ({product.reviewCount})
          </p>
        ) : null}
        <div className="np-shop-product-card-footer">
          <ProductPrice product={product} messages={messages} />
          <Link href={`${basePath}/products/${product.slug}`}>{messages.viewProduct}</Link>
        </div>
        {priceAlertAction}
      </div>
    </article>
  );
}

function CatalogFilters({
  action,
  query,
  messages,
}: {
  action: string;
  query: NpShopCatalogSkinProps["query"];
  messages: NpShopMessages;
}) {
  return (
    <form action={action} method="get" role="search" className="np-shop-filters">
      <label>
        <span>{messages.search}</span>
        <input
          type="search"
          name="q"
          defaultValue={query.search ?? ""}
          maxLength={120}
          placeholder={messages.searchPlaceholder}
        />
      </label>
      <label>
        <span>{messages.sort}</span>
        <select name="sort" defaultValue={query.sort}>
          <option value="newest">{messages.newest}</option>
          <option value="price-asc">{messages.priceLow}</option>
          <option value="price-desc">{messages.priceHigh}</option>
          <option value="name">{messages.name}</option>
        </select>
      </label>
      <label className="np-shop-stock-filter">
        <input type="checkbox" name="stock" value="available" defaultChecked={query.inStockOnly} />
        <span>{messages.inStockOnly}</span>
      </label>
      <button type="submit">{messages.apply}</button>
      <Link href={action}>{messages.clear}</Link>
    </form>
  );
}

function Pagination({
  basePath,
  query,
  totalPages,
  messages,
}: {
  basePath: string;
  query: NpShopCatalogSkinProps["query"];
  totalPages: number;
  messages: NpShopMessages;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="np-shop-pagination" aria-label={messages.pageOf(query.page, totalPages)}>
      {query.page > 1 ? (
        <Link href={buildShopCatalogHref(basePath, query, { page: query.page - 1 })}>
          {messages.previous}
        </Link>
      ) : (
        <span aria-disabled="true">{messages.previous}</span>
      )}
      <strong>{messages.pageOf(query.page, totalPages)}</strong>
      {query.page < totalPages ? (
        <Link href={buildShopCatalogHref(basePath, query, { page: query.page + 1 })}>
          {messages.next}
        </Link>
      ) : (
        <span aria-disabled="true">{messages.next}</span>
      )}
    </nav>
  );
}

function ProductGrid({
  basePath,
  products,
  messages,
  wishlistActions,
  priceAlertActions,
}: {
  basePath: string;
  products: NpShopProductSummary[];
  messages: NpShopMessages;
  wishlistActions?: Readonly<Record<string, ReactNode>>;
  priceAlertActions?: Readonly<Record<string, ReactNode>>;
}) {
  return products.length === 0 ? (
    <p className="np-shop-empty">{messages.emptyProducts}</p>
  ) : (
    <div className="np-shop-product-grid">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          basePath={basePath}
          product={product}
          messages={messages}
          wishlistAction={wishlistActions?.[product.id]}
          priceAlertAction={priceAlertActions?.[product.id]}
        />
      ))}
    </div>
  );
}

export function ShopCatalogSurface({ skin, ...props }: NpShopCatalogSkinProps & { skin: string }) {
  return (
    <main
      className="np-shop np-shop-catalog"
      data-np-shop-surface="catalog"
      data-np-shop-skin={skin}
    >
      <header className="np-shop-page-header">
        <p>{props.messages.catalogOnly}</p>
        <h1>{props.messages.catalog}</h1>
        <div className="np-shop-page-header-actions">
          <span>
            {props.totalProducts.toLocaleString(props.messages.locale)} {props.messages.products}
          </span>
          <Link href={`${props.basePath}/wishlist`}>{props.messages.wishlist}</Link>
        </div>
      </header>
      {props.categories.length > 0 ? (
        <nav className="np-shop-category-strip" aria-label={props.messages.categories}>
          {props.categories.map((category) => (
            <Link key={category.id} href={`${props.basePath}/categories/${category.slug}`}>
              {category.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <CatalogFilters action={props.basePath} query={props.query} messages={props.messages} />
      <ProductGrid
        basePath={props.basePath}
        products={props.products}
        messages={props.messages}
        wishlistActions={props.wishlistActions}
      />
      <Pagination
        basePath={props.basePath}
        query={props.query}
        totalPages={props.totalPages}
        messages={props.messages}
      />
    </main>
  );
}

export function ShopCategorySurface({
  skin,
  ...props
}: NpShopCategorySkinProps & { skin: string }) {
  const routePath = `${props.basePath}/categories/${props.category.slug}`;
  return (
    <main
      className="np-shop np-shop-category"
      data-np-shop-surface="category"
      data-np-shop-skin={skin}
    >
      <header className="np-shop-category-hero">
        {props.category.imageUrl ? <img src={props.category.imageUrl} alt="" /> : null}
        <div>
          <Link href={props.basePath}>{props.messages.backToCatalog}</Link>
          <Link href={`${props.basePath}/wishlist`}>{props.messages.wishlist}</Link>
          <h1>{props.category.name}</h1>
          {props.category.description ? <p>{props.category.description}</p> : null}
        </div>
      </header>
      <CatalogFilters action={routePath} query={props.query} messages={props.messages} />
      <ProductGrid
        basePath={props.basePath}
        products={props.products}
        messages={props.messages}
        wishlistActions={props.wishlistActions}
      />
      <Pagination
        basePath={routePath}
        query={props.query}
        totalPages={props.totalPages}
        messages={props.messages}
      />
    </main>
  );
}

export function ShopProductSurface({ skin, ...props }: NpShopProductSkinProps & { skin: string }) {
  const variants = props.product.variants.filter((variant) => variant.enabled);
  const images = [
    ...(props.product.imageUrl ? [props.product.imageUrl] : []),
    ...props.product.galleryUrls,
  ];
  return (
    <main
      className="np-shop np-shop-product-detail"
      data-np-shop-surface="product"
      data-np-shop-skin={skin}
    >
      <nav className="np-shop-breadcrumbs">
        <Link href={props.basePath}>{props.messages.catalog}</Link>
        {props.categories.slice(0, 1).map((category) => (
          <Link key={category.id} href={`${props.basePath}/categories/${category.slug}`}>
            {category.name}
          </Link>
        ))}
      </nav>
      <div className="np-shop-product-layout">
        <section className="np-shop-product-gallery" aria-label={props.product.name}>
          {images.length > 0 ? (
            images.map((url, index) => (
              <img
                key={url}
                src={url}
                alt={index === 0 ? props.product.name : ""}
                loading={index === 0 ? "eager" : "lazy"}
              />
            ))
          ) : (
            <div className="np-shop-product-placeholder" aria-hidden="true">
              {props.product.name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </section>
        <aside className="np-shop-product-summary">
          <InventoryLabel product={props.product} messages={props.messages} />
          <h1>{props.product.name}</h1>
          {props.product.summary ? <p>{props.product.summary}</p> : null}
          <ProductPrice product={props.product} messages={props.messages} />
          {props.product.taxIncluded ? <small>{props.messages.taxIncluded}</small> : null}
          {props.product.sku ? (
            <dl>
              <div>
                <dt>{props.messages.sku}</dt>
                <dd>{props.product.sku}</dd>
              </div>
            </dl>
          ) : null}
          <div className="np-shop-catalog-notice">
            <strong>{props.messages.catalogOnly}</strong>
          </div>
          {props.cartAction}
          {props.restockAction}
          {props.priceAlertAction}
          {props.wishlistAction}
          <Link className="np-shop-cart-link" href={`${props.basePath}/cart`}>
            {props.messages.cart}
          </Link>
        </aside>
      </div>
      {variants.length > 0 ? (
        <section className="np-shop-variants">
          <h2>{props.messages.variants}</h2>
          <div className="np-shop-variant-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{props.messages.name}</th>
                  <th>{props.messages.sku}</th>
                  <th>{props.messages.option}</th>
                  <th>{props.messages.price}</th>
                  <th>{props.messages.stock}</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((variant) => (
                  <tr key={variant.sku}>
                    <th scope="row">{variant.name}</th>
                    <td>{variant.sku}</td>
                    <td>{variant.optionSummary ?? "—"}</td>
                    <td>
                      {props.messages.formatMoney(
                        variant.priceMinor ?? props.product.priceMinor,
                        props.product.currency,
                      )}
                    </td>
                    <td>{variant.stockQuantity.toLocaleString(props.messages.locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <article className="np-shop-product-description">{props.description}</article>
      {props.inquiryAction}
      {props.reviewAction}
    </main>
  );
}

export function ShopWishlistSurface({
  skin,
  ...props
}: NpShopWishlistSkinProps & { skin: string }) {
  const routePath = `${props.basePath}/wishlist`;
  return (
    <main
      className="np-shop np-shop-wishlist"
      data-np-shop-surface="wishlist"
      data-np-shop-skin={skin}
    >
      <header className="np-shop-page-header">
        <p>{props.messages.catalogOnly}</p>
        <h1>{props.messages.wishlist}</h1>
        <Link href={props.basePath}>{props.messages.wishlistBrowse}</Link>
      </header>
      {!props.signedIn ? (
        <section className="np-shop-wishlist-login">
          <p>{props.messages.wishlistLogin}</p>
          <a href={props.loginHref}>{props.messages.wishlistSignIn}</a>
        </section>
      ) : props.page.products.length === 0 ? (
        <p className="np-shop-empty">{props.messages.wishlistEmpty}</p>
      ) : (
        <ProductGrid
          basePath={props.basePath}
          products={props.page.products}
          messages={props.messages}
          wishlistActions={props.wishlistActions}
          priceAlertActions={props.priceAlertActions}
        />
      )}
      {props.signedIn && (props.page.hasPrevious || props.page.hasNext) ? (
        <nav className="np-shop-pagination" aria-label={props.messages.wishlist}>
          {props.page.hasPrevious ? (
            <Link
              href={
                props.page.page === 2
                  ? routePath
                  : `${routePath}?page=${(props.page.page - 1).toString()}`
              }
            >
              {props.messages.previous}
            </Link>
          ) : (
            <span aria-disabled="true">{props.messages.previous}</span>
          )}
          <strong>{props.page.page.toLocaleString(props.messages.locale)}</strong>
          {props.page.hasNext ? (
            <Link href={`${routePath}?page=${(props.page.page + 1).toString()}`}>
              {props.messages.next}
            </Link>
          ) : (
            <span aria-disabled="true">{props.messages.next}</span>
          )}
        </nav>
      ) : null}
    </main>
  );
}

export function ShopCartSurface({ skin, ...props }: NpShopCartSkinProps & { skin: string }) {
  return (
    <main className="np-shop np-shop-cart" data-np-shop-surface="cart" data-np-shop-skin={skin}>
      <header className="np-shop-page-header">
        <p>{props.messages.catalogOnly}</p>
        <h1>{props.messages.cart}</h1>
        <Link href={props.basePath}>{props.messages.backToCatalog}</Link>
      </header>
      <ShopCart
        apiPath={props.apiPath}
        checkoutApiPath={props.checkoutApiPath}
        basePath={props.basePath}
        initialQuote={props.quote}
        messages={cartClientMessages(props.messages)}
      />
    </main>
  );
}

export function ShopCheckoutSurface({
  skin,
  ...props
}: NpShopCheckoutSkinProps & { skin: string }) {
  return (
    <main
      className="np-shop np-shop-checkout"
      data-np-shop-surface="checkout"
      data-np-shop-skin={skin}
    >
      <header className="np-shop-page-header">
        <p>{props.messages.catalogOnly}</p>
        <h1>{props.messages.checkout}</h1>
        <Link href={`${props.basePath}/cart`}>{props.messages.checkoutBackToCart}</Link>
      </header>
      <ShopCheckout
        apiPath={props.apiPath}
        orderDraftApiPath={props.orderDraftApiPath}
        basePath={props.basePath}
        intentId={props.intentId}
        messages={cartClientMessages(props.messages)}
      />
    </main>
  );
}

export function ShopOrderDraftSurface({
  skin,
  ...props
}: NpShopOrderDraftSkinProps & { skin: string }) {
  return (
    <main
      className="np-shop np-shop-order-draft"
      data-np-shop-surface="order-draft"
      data-np-shop-skin={skin}
    >
      <ShopOrderDraft
        apiPath={props.apiPath}
        orderApiPath={props.orderApiPath}
        basePath={props.basePath}
        draftId={props.draftId}
        messages={cartClientMessages(props.messages)}
      />
    </main>
  );
}

export function ShopOrdersSurface({ skin, ...props }: NpShopOrdersSkinProps & { skin: string }) {
  return (
    <main className="np-shop np-shop-orders" data-np-shop-surface="orders" data-np-shop-skin={skin}>
      <header className="np-shop-page-header">
        <p>{props.messages.catalogOnly}</p>
        <h1>{props.messages.orders}</h1>
        <Link href={props.basePath}>{props.messages.backToCatalog}</Link>
      </header>
      <ShopOrders
        apiPath={props.apiPath}
        basePath={props.basePath}
        messages={cartClientMessages(props.messages)}
      />
    </main>
  );
}

export function ShopOrderSurface({ skin, ...props }: NpShopOrderSkinProps & { skin: string }) {
  return (
    <main className="np-shop np-shop-order" data-np-shop-surface="order" data-np-shop-skin={skin}>
      <ShopOrder
        apiPath={props.apiPath}
        cartApiPath={props.cartApiPath}
        cartReAddApiPath={props.cartReAddApiPath}
        returnApiPath={props.returnApiPath}
        exchangeDestinationApiPath={props.exchangeDestinationApiPath}
        returnLogisticsApiPath={props.returnLogisticsApiPath}
        returnPostageApiPath={props.returnPostageApiPath}
        returnLogisticsLabelPath={props.returnLogisticsLabelPath}
        basePath={props.basePath}
        orderId={props.orderId}
        paymentAction={props.paymentAction}
        messages={cartClientMessages(props.messages)}
      />
    </main>
  );
}
