import Link from "next/link";

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
    order: messages.order,
    orders: messages.orders,
    orderCreate: messages.orderCreate,
    orderCreating: messages.orderCreating,
    orderPendingPayment: messages.orderPendingPayment,
    orderCancelled: messages.orderCancelled,
    orderPrivateRetained: messages.orderPrivateRetained,
    orderPrivateRedacted: messages.orderPrivateRedacted,
    orderInventoryHeld: messages.orderInventoryHeld,
    orderInventoryReleased: messages.orderInventoryReleased,
    orderInventoryNotRequired: messages.orderInventoryNotRequired,
    orderExpires: messages.orderExpires,
    orderCreated: messages.orderCreated,
    orderCancel: messages.orderCancel,
    orderHistory: messages.orderHistory,
    orderEmpty: messages.orderEmpty,
    orderReference: messages.orderReference,
    orderPaymentUnavailable: messages.orderPaymentUnavailable,
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
}: {
  basePath: string;
  product: NpShopProductSummary;
  messages: NpShopMessages;
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
          <InventoryLabel product={product} messages={messages} />
          {product.featured ? <span className="np-shop-featured">{messages.featured}</span> : null}
        </div>
        <h2>
          <Link href={`${basePath}/products/${product.slug}`}>{product.name}</Link>
        </h2>
        {product.summary ? <p>{product.summary}</p> : null}
        <div className="np-shop-product-card-footer">
          <ProductPrice product={product} messages={messages} />
          <Link href={`${basePath}/products/${product.slug}`}>{messages.viewProduct}</Link>
        </div>
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
}: {
  basePath: string;
  products: NpShopProductSummary[];
  messages: NpShopMessages;
}) {
  return products.length === 0 ? (
    <p className="np-shop-empty">{messages.emptyProducts}</p>
  ) : (
    <div className="np-shop-product-grid">
      {products.map((product) => (
        <ProductCard key={product.id} basePath={basePath} product={product} messages={messages} />
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
        <span>
          {props.totalProducts.toLocaleString(props.messages.locale)} {props.messages.products}
        </span>
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
      <ProductGrid basePath={props.basePath} products={props.products} messages={props.messages} />
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
          <h1>{props.category.name}</h1>
          {props.category.description ? <p>{props.category.description}</p> : null}
        </div>
      </header>
      <CatalogFilters action={routePath} query={props.query} messages={props.messages} />
      <ProductGrid basePath={props.basePath} products={props.products} messages={props.messages} />
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
        basePath={props.basePath}
        orderId={props.orderId}
        messages={cartClientMessages(props.messages)}
      />
    </main>
  );
}
