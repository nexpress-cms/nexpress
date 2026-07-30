import {
  NpValidationError,
  defineCollection,
  findDocuments,
  isEditorOrAbove,
  type NpCollectionConfig,
} from "@nexpress/core";

import {
  normalizeShopCategoryIds,
  normalizeShopGalleryIds,
  normalizeShopVariants,
  getShopStockQuantity,
  npRequireShopCurrency,
  npShopCatalogLimits,
  npShopSkuPattern,
  type NpShopRuntime,
  type ShopProductDocument,
} from "./runtime.js";

function validationError(field: string, message: string): NpValidationError {
  return new NpValidationError("Invalid shop catalog data", [{ field, message }]);
}

function validatePrice(data: Record<string, unknown>): void {
  const price = data.priceMinor;
  const compareAt = data.compareAtPriceMinor;
  if (
    !Number.isSafeInteger(price) ||
    (price as number) < 0 ||
    (price as number) > npShopCatalogLimits.maximumPriceMinor
  ) {
    throw validationError(
      "priceMinor",
      `Use an integer between 0 and ${npShopCatalogLimits.maximumPriceMinor.toString()}.`,
    );
  }
  if (
    compareAt !== undefined &&
    compareAt !== null &&
    (!Number.isSafeInteger(compareAt) ||
      (compareAt as number) <= (price as number) ||
      (compareAt as number) > npShopCatalogLimits.maximumPriceMinor)
  ) {
    throw validationError(
      "compareAtPriceMinor",
      "Compare-at price must be an integer greater than the selling price.",
    );
  }
}

function validateInventory(data: Record<string, unknown>): void {
  for (const field of ["stockQuantity", "lowStockThreshold"] as const) {
    const value = data[field];
    if (
      !Number.isSafeInteger(value) ||
      (value as number) < 0 ||
      (value as number) > npShopCatalogLimits.maximumStockQuantity
    ) {
      throw validationError(
        field,
        `Use an integer between 0 and ${npShopCatalogLimits.maximumStockQuantity.toString()}.`,
      );
    }
  }
}

function validateShopProduct(data: Record<string, unknown>): Record<string, unknown> {
  try {
    npRequireShopCurrency(data.currency);
  } catch (error) {
    throw validationError("currency", error instanceof Error ? error.message : "Invalid currency.");
  }
  validatePrice(data);
  validateInventory(data);
  if (
    data.sku !== undefined &&
    data.sku !== null &&
    (typeof data.sku !== "string" ||
      (data.sku.trim() !== "" && !npShopSkuPattern.test(data.sku.trim().toUpperCase())))
  ) {
    throw validationError(
      "sku",
      "Use 1–64 uppercase letters, digits, dots, dashes, or underscores.",
    );
  }
  try {
    normalizeShopCategoryIds(data.categories);
  } catch (error) {
    throw validationError(
      "categories",
      error instanceof Error ? error.message : "Invalid product categories.",
    );
  }
  const galleryIds = (() => {
    try {
      return normalizeShopGalleryIds(data.gallery);
    } catch (error) {
      throw validationError(
        "gallery",
        error instanceof Error ? error.message : "Invalid product gallery.",
      );
    }
  })();
  if (typeof data.primaryImage === "string" && galleryIds.includes(data.primaryImage)) {
    throw validationError("gallery", "Do not repeat the primary image in the product gallery.");
  }
  const variants = (() => {
    try {
      return normalizeShopVariants(data.variants);
    } catch (error) {
      throw validationError(
        "variants",
        error instanceof Error ? error.message : "Invalid product variants.",
      );
    }
  })();
  const rootSku =
    typeof data.sku === "string" && data.sku.trim() ? data.sku.trim().toUpperCase() : null;
  if (rootSku && variants.some((variant) => variant.sku === rootSku)) {
    throw validationError("variants", "The product SKU and variant SKUs must be different.");
  }
  const stockQuantity = getShopStockQuantity({
    ...data,
    variants,
  } as ShopProductDocument);
  const available = data.trackInventory !== true || stockQuantity > 0;
  const inventoryState =
    data.trackInventory !== true
      ? "untracked"
      : stockQuantity === 0
        ? "out-of-stock"
        : stockQuantity <= (data.lowStockThreshold as number)
          ? "low-stock"
          : "in-stock";
  return {
    ...data,
    available,
    inventoryState,
    sku: rootSku,
    variants,
  };
}

export function defineShopCategoriesCollection(runtime: NpShopRuntime): NpCollectionConfig {
  return defineCollection({
    slug: runtime.collections.categories,
    labels: { singular: "Shop category", plural: "Shop categories" },
    slugField: { useField: "name", unique: true },
    admin: {
      group: "Commerce",
      listColumns: ["name", "slug", "featured", "displayOrder", "status"],
      defaultSort: "displayOrder",
      description: "Stable public catalog categories shared by every shop skin.",
    },
    versions: { drafts: true, max: 20 },
    access: {
      read: () => true,
      create: isEditorOrAbove,
      update: isEditorOrAbove,
      delete: isEditorOrAbove,
    },
    hooks: {
      beforeDelete: [
        async ({ data }) => {
          const categoryId = typeof data.id === "string" ? data.id : null;
          if (!categoryId) return data;
          const products = await findDocuments<ShopProductDocument>(runtime.collections.products, {
            where: { categories: categoryId, visibility: "*" },
            page: 1,
            limit: 1,
          });
          if (products.totalDocs > 0) {
            throw validationError(
              "category",
              "Remove this category from every product before deleting it.",
            );
          }
          return data;
        },
      ],
    },
    seo: {
      urlPath: (doc) =>
        typeof doc.slug === "string"
          ? `${runtime.basePath}/categories/${doc.slug}`
          : runtime.basePath,
      changefreq: "weekly",
      priority: 0.7,
    },
    fields: [
      {
        type: "text",
        name: "name",
        required: true,
        minLength: 1,
        maxLength: 120,
        admin: { kind: "title", placeholder: "Living" },
      },
      {
        type: "textarea",
        name: "description",
        maxLength: 500,
        rows: 3,
      },
      {
        type: "upload",
        name: "image",
        relationTo: "media",
        admin: { position: "sidebar", group: "Presentation" },
      },
      {
        type: "checkbox",
        name: "featured",
        defaultValue: false,
        admin: { position: "sidebar", group: "Presentation" },
      },
      {
        type: "number",
        name: "displayOrder",
        required: true,
        defaultValue: 0,
        min: 0,
        max: 9999,
        integerOnly: true,
        admin: { position: "sidebar", group: "Presentation" },
      },
    ],
  });
}

export function defineShopProductsCollection(runtime: NpShopRuntime): NpCollectionConfig {
  const skinOptions = [...runtime.skins.values()].map((skin) => ({
    label: skin.label,
    value: skin.id,
  }));
  return defineCollection({
    slug: runtime.collections.products,
    labels: { singular: "Product", plural: "Products" },
    slugField: { useField: "name", unique: true },
    admin: {
      group: "Commerce",
      listColumns: [
        "name",
        "sku",
        "priceMinor",
        "currency",
        "inventoryState",
        "featured",
        "status",
      ],
      defaultSort: "-createdAt",
      description:
        "Catalog products use integer minor-unit prices. Publishing does not enable payment or orders.",
    },
    versions: { drafts: true, max: 30 },
    access: {
      read: () => true,
      create: isEditorOrAbove,
      update: isEditorOrAbove,
      delete: isEditorOrAbove,
    },
    hooks: {
      beforeCreate: [({ data }) => validateShopProduct(data)],
      beforeUpdate: [({ data }) => validateShopProduct(data)],
    },
    seo: {
      urlPath: (doc) =>
        typeof doc.slug === "string"
          ? `${runtime.basePath}/products/${doc.slug}`
          : runtime.basePath,
      changefreq: "weekly",
      priority: 0.8,
    },
    fields: [
      {
        type: "text",
        name: "name",
        required: true,
        minLength: 1,
        maxLength: 180,
        admin: { kind: "title", placeholder: "Product name" },
      },
      {
        type: "textarea",
        name: "summary",
        maxLength: 500,
        rows: 3,
      },
      {
        type: "richText",
        name: "description",
        required: true,
      },
      {
        type: "relationship",
        name: "categories",
        relationTo: runtime.collections.categories,
        hasMany: true,
      },
      {
        type: "upload",
        name: "primaryImage",
        relationTo: "media",
        admin: { position: "sidebar", group: "Media" },
      },
      {
        type: "array",
        name: "gallery",
        maxRows: npShopCatalogLimits.maximumGalleryImages,
        admin: { description: "Additional product-detail images." },
        fields: [
          {
            type: "upload",
            name: "image",
            relationTo: "media",
            required: true,
          },
        ],
      },
      {
        type: "select",
        name: "currency",
        required: true,
        defaultValue: "KRW",
        options: [
          { label: "KRW — Korean won", value: "KRW" },
          { label: "USD — US dollar", value: "USD" },
          { label: "EUR — Euro", value: "EUR" },
          { label: "JPY — Japanese yen", value: "JPY" },
        ],
        admin: { position: "sidebar", group: "Price" },
      },
      {
        type: "number",
        name: "priceMinor",
        label: "Price (minor units)",
        required: true,
        defaultValue: 0,
        min: 0,
        max: npShopCatalogLimits.maximumPriceMinor,
        integerOnly: true,
        admin: {
          position: "sidebar",
          group: "Price",
          description: "KRW/JPY use whole units; USD/EUR use cents.",
        },
      },
      {
        type: "number",
        name: "compareAtPriceMinor",
        label: "Compare-at price (minor units)",
        min: 0,
        max: npShopCatalogLimits.maximumPriceMinor,
        integerOnly: true,
        admin: { position: "sidebar", group: "Price" },
      },
      {
        type: "checkbox",
        name: "taxIncluded",
        defaultValue: true,
        admin: { position: "sidebar", group: "Price" },
      },
      {
        type: "text",
        name: "sku",
        label: "Product SKU",
        maxLength: 64,
        unique: true,
        admin: { position: "sidebar", group: "Inventory", placeholder: "PRODUCT-001" },
      },
      {
        type: "checkbox",
        name: "trackInventory",
        defaultValue: true,
        admin: { position: "sidebar", group: "Inventory" },
      },
      {
        type: "number",
        name: "stockQuantity",
        required: true,
        defaultValue: 0,
        min: 0,
        max: npShopCatalogLimits.maximumStockQuantity,
        integerOnly: true,
        admin: { position: "sidebar", group: "Inventory" },
      },
      {
        type: "number",
        name: "lowStockThreshold",
        required: true,
        defaultValue: 5,
        min: 0,
        max: npShopCatalogLimits.maximumStockQuantity,
        integerOnly: true,
        admin: { position: "sidebar", group: "Inventory" },
      },
      {
        type: "checkbox",
        name: "featured",
        defaultValue: false,
        admin: { position: "sidebar", group: "Presentation" },
      },
      {
        type: "checkbox",
        name: "available",
        required: true,
        defaultValue: false,
        hidden: true,
      },
      {
        type: "select",
        name: "inventoryState",
        required: true,
        defaultValue: "out-of-stock",
        options: [
          { label: "In stock", value: "in-stock" },
          { label: "Low stock", value: "low-stock" },
          { label: "Out of stock", value: "out-of-stock" },
          { label: "Not tracked", value: "untracked" },
        ],
        hidden: true,
      },
      {
        type: "select",
        name: "skin",
        required: true,
        defaultValue: runtime.defaultSkinId,
        options: skinOptions,
        admin: { position: "sidebar", group: "Presentation" },
      },
      {
        type: "array",
        name: "variants",
        maxRows: npShopCatalogLimits.maximumVariants,
        admin: {
          description:
            "Optional purchasable choices. Variant price overrides the product price when present.",
        },
        fields: [
          { type: "text", name: "name", required: true, maxLength: 120 },
          { type: "text", name: "sku", required: true, maxLength: 64, unique: true },
          { type: "text", name: "optionSummary", maxLength: 240 },
          {
            type: "number",
            name: "priceMinor",
            min: 0,
            max: npShopCatalogLimits.maximumPriceMinor,
            integerOnly: true,
          },
          {
            type: "number",
            name: "stockQuantity",
            required: true,
            defaultValue: 0,
            min: 0,
            max: npShopCatalogLimits.maximumStockQuantity,
            integerOnly: true,
          },
          { type: "checkbox", name: "enabled", required: true, defaultValue: true },
        ],
      },
    ],
  });
}
