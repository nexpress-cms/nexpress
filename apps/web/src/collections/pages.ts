import {
  defineCollection,
  getCurrentSiteId,
  isEditorOrAbove,
  isOwnerOrAdmin,
  NP_DEFAULT_SITE_ID,
} from "@nexpress/core";
import { navCacheTag } from "@nexpress/next";
import { revalidateTag } from "next/cache";

// Nav locations the editor exposes. Kept in sync with the `Settings →
// Navigation` switcher in `packages/admin/src/settings/navigation-editor.tsx`.
// When a page's slug changes, the nav cache for any of these locations
// could now be pointing at the OLD URL — invalidate them all rather
// than tracking which location actually references this page (the JSONB
// scan would cost more than the cache rebuild).
const NAV_LOCATIONS = ["header", "footer", "main"] as const;

export const pagesCollection = defineCollection({
  slug: "pages",
  labels: { singular: "Page", plural: "Pages" },
  slugField: { useField: "title", unique: true },
  // Multi-language editing lives on the page edit screen itself
  // (TranslationTabs auto-mount when `i18n: true`). Each row carries
  // a `locale` and a `translation_group_id`; siblings of the same
  // logical page share the group id so the edit view can switch
  // between language variants without a separate "Localized Pages"
  // menu entry. The slug uniqueness key flips from `(site_id, slug)`
  // to `(site_id, locale, slug)` so the same slug can resolve to
  // different documents per locale.
  i18n: true,
  admin: {
    group: "Content",
    listColumns: ["title", "slug", "locale", "status", "updatedAt"],
    defaultSort: "title",
    description: "Static pages — composed from blocks.",
    navMembership: true,
  },
  versions: { drafts: true, max: 20 },
  hooks: {
    // When a page slug changes, the cached navigation menus may
    // still hold the old `/{slug}` URL (resolved by `getNavigation`
    // from `pageId`). Bust every nav location's cache for the
    // current site so the next render picks up the new slug.
    afterUpdate: [
      async ({ data, originalDoc }) => {
        const previousSlug = typeof originalDoc?.slug === "string" ? originalDoc.slug : null;
        const nextSlug = typeof data.slug === "string" ? data.slug : null;
        if (previousSlug === nextSlug) return data;
        const siteId = (await getCurrentSiteId()) ?? NP_DEFAULT_SITE_ID;
        for (const location of NAV_LOCATIONS) {
          revalidateTag(navCacheTag(siteId, location), "default");
        }
        return data;
      },
    ],
  },
  access: {
    read: () => true,
    create: isEditorOrAbove,
    update: isOwnerOrAdmin,
    delete: isOwnerOrAdmin,
  },
  seo: {
    urlPath: (doc) => {
      const slug = typeof doc.slug === "string" ? doc.slug : null;
      if (!slug) return null;
      const locale = typeof doc.locale === "string" ? doc.locale : null;
      // Pages use the catch-all `(site)/[[...slug]]` route. The
      // home page slug is "/" and maps to the locale's root,
      // every other slug maps to `/{locale}/{slug}`. A leading
      // slash on a non-root slug is a data quirk we tolerate by
      // stripping it. The middleware (`apps/web/src/proxy.ts`)
      // strips the locale prefix before the lookup, so storage
      // keys aren't polluted with locale.
      const localePrefix = locale ? `/${locale}` : "";
      if (slug === "/") return localePrefix || "/";
      return `${localePrefix}/${slug.replace(/^\/+/, "")}`;
    },
    changefreq: "weekly",
    priority: 0.8,
  },
  fields: [
    {
      type: "text",
      name: "title",
      required: true,
      admin: { kind: "title" },
    },
    {
      type: "textarea",
      name: "seoDescription",
      admin: {
        position: "sidebar",
        description: "Meta description shown in search results.",
      },
    },
    {
      // Phase 11.3 — template id chosen for this page. The
      // catch-all renderer dispatches into the active theme's
      // template registry; the admin renderer replaces the
      // input with a dropdown sourced from the same registry
      // via `admin.kind: "templatePicker"`.
      type: "text",
      name: "template",
      admin: {
        kind: "templatePicker",
        position: "sidebar",
        description:
          "Page layout template. Defaults to the active theme's `default` when blank.",
      },
    },
    {
      type: "blocks",
      name: "blocks",
    },
  ],
});
