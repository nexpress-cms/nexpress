import Link from "next/link";

import type { NpBlockDefinition, NpPatternDefinition } from "@nexpress/plugin-sdk";

import {
  getShopMessages,
  normalizeShopCategory,
  normalizeShopProductSummary,
  type NpShopRuntime,
  type ShopCategoryDocument,
  type ShopProductDocument,
} from "./runtime.js";
import { npAttachShopProductReviewAggregates } from "./review-service.js";
import { ProductCard } from "./skins/shared.js";

const MAX_PRODUCTS = 24;
const MAX_CATEGORIES = 24;

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readLimit(value: unknown, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value as number)));
}

type BlockContext = NonNullable<Parameters<NpBlockDefinition["render"]>[2]>;

async function FeaturedProductsBlock({
  runtime,
  ctx,
  heading,
  limit,
  onlyAvailable,
}: {
  runtime: NpShopRuntime;
  ctx: BlockContext;
  heading: string;
  limit: number;
  onlyAvailable: boolean;
}) {
  const where: Record<string, unknown> = { status: "published", featured: true };
  if (onlyAvailable) where.available = true;
  const [result, messages] = await Promise.all([
    ctx.content.find(runtime.collections.products, {
      where,
      sort: "-createdAt",
      page: 1,
      limit,
    }),
    getShopMessages(),
  ]);
  const products = await npAttachShopProductReviewAggregates(
    runtime,
    await Promise.all((result.docs as ShopProductDocument[]).map(normalizeShopProductSummary)),
  );
  return (
    <section className="np-shop-block np-shop-featured-products" data-np-shop-block="products">
      <header>
        <h2>{heading}</h2>
        <Link href={runtime.basePath}>{messages.catalog}</Link>
      </header>
      {products.length === 0 ? (
        <p className="np-shop-empty">{messages.emptyProducts}</p>
      ) : (
        <div className="np-shop-product-grid">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              basePath={runtime.basePath}
              product={product}
              messages={messages}
            />
          ))}
        </div>
      )}
    </section>
  );
}

async function CategoryGridBlock({
  runtime,
  ctx,
  heading,
  limit,
  featuredOnly,
}: {
  runtime: NpShopRuntime;
  ctx: BlockContext;
  heading: string;
  limit: number;
  featuredOnly: boolean;
}) {
  const [result, messages] = await Promise.all([
    ctx.content.find(runtime.collections.categories, {
      where: {
        status: "published",
        ...(featuredOnly ? { featured: true } : {}),
      },
      sort: "displayOrder",
      page: 1,
      limit,
    }),
    getShopMessages(),
  ]);
  const categories = await Promise.all(
    (result.docs as ShopCategoryDocument[]).map(normalizeShopCategory),
  );
  return (
    <section className="np-shop-block np-shop-category-grid-block" data-np-shop-block="categories">
      <header>
        <h2>{heading}</h2>
        <Link href={runtime.basePath}>{messages.catalog}</Link>
      </header>
      {categories.length === 0 ? (
        <p className="np-shop-empty">{messages.emptyCategories}</p>
      ) : (
        <div className="np-shop-category-grid">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`${runtime.basePath}/categories/${category.slug}`}
              data-np-shop-category={category.id}
            >
              {category.imageUrl ? <img src={category.imageUrl} alt="" loading="lazy" /> : null}
              <span>
                <strong>{category.name}</strong>
                {category.description ? <small>{category.description}</small> : null}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function createShopHomeBlocks(runtime: NpShopRuntime): NpBlockDefinition[] {
  return [
    {
      type: "shop.featured-products",
      label: "Shop featured products",
      description: "Shows bounded featured products from the active shop catalog.",
      icon: "🛍️",
      category: "commerce",
      keywords: ["shop", "products", "catalog", "featured"],
      summaryFields: ["heading", "limit"],
      defaultProps: {
        heading: "Featured products",
        limit: 8,
        onlyAvailable: true,
      },
      propsSchema: [
        {
          name: "heading",
          label: "Heading",
          type: "text",
          translatable: true,
          defaultValue: "Featured products",
        },
        {
          name: "limit",
          label: "Maximum products",
          type: "number",
          min: 1,
          max: MAX_PRODUCTS,
          step: 1,
          defaultValue: 8,
        },
        {
          name: "onlyAvailable",
          label: "Only products currently available",
          type: "boolean",
          defaultValue: true,
        },
      ],
      render: (props, _children, ctx) => {
        if (!ctx) throw new Error("Shop featured-products block requires render context.");
        return FeaturedProductsBlock({
          runtime,
          ctx,
          heading: readString(props.heading, "Featured products"),
          limit: readLimit(props.limit, 8, MAX_PRODUCTS),
          onlyAvailable: readBoolean(props.onlyAvailable, true),
        });
      },
    },
    {
      type: "shop.category-grid",
      label: "Shop category grid",
      description: "Shows public catalog categories with optional images.",
      icon: "▦",
      category: "commerce",
      keywords: ["shop", "categories", "catalog", "navigation"],
      summaryFields: ["heading", "limit"],
      defaultProps: {
        heading: "Shop by category",
        limit: 8,
        featuredOnly: false,
      },
      propsSchema: [
        {
          name: "heading",
          label: "Heading",
          type: "text",
          translatable: true,
          defaultValue: "Shop by category",
        },
        {
          name: "limit",
          label: "Maximum categories",
          type: "number",
          min: 1,
          max: MAX_CATEGORIES,
          step: 1,
          defaultValue: 8,
        },
        {
          name: "featuredOnly",
          label: "Only featured categories",
          type: "boolean",
          defaultValue: false,
        },
      ],
      render: (props, _children, ctx) => {
        if (!ctx) throw new Error("Shop category-grid block requires render context.");
        return CategoryGridBlock({
          runtime,
          ctx,
          heading: readString(props.heading, "Shop by category"),
          limit: readLimit(props.limit, 8, MAX_CATEGORIES),
          featuredOnly: readBoolean(props.featuredOnly, false),
        });
      },
    },
  ];
}

export const shopHomePatterns = [
  {
    id: "shop.storefront-home",
    label: "Storefront home",
    description: "Featured categories and products from the active shop catalog.",
    category: "homepage",
    blocks: [
      {
        id: "shop-home-categories",
        type: "shop.category-grid",
        props: { heading: "Shop by category", limit: 8, featuredOnly: false },
      },
      {
        id: "shop-home-products",
        type: "shop.featured-products",
        props: { heading: "Featured products", limit: 8, onlyAvailable: true },
      },
    ],
  },
] satisfies NpPatternDefinition[];
