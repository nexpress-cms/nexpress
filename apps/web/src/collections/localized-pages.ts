import { defineCollection, isEditorOrAbove, isOwnerOrAdmin } from "@nexpress/core";

/**
 * Phase 12.1 — minimal i18n-enabled collection. Demonstrates
 * the framework primitive: setting `i18n: true` makes the
 * codegen add `locale` + `translation_group_id` columns and
 * key the slug uniqueness on `(locale, slug)` so the same
 * slug can appear in two locales.
 *
 * Kept separate from `pages` so the existing single-locale
 * pages collection isn't disrupted. Sites that want every
 * page localized just flip the flag on their pages collection
 * and run db:generate / db:migrate; sites that want both
 * (a single-locale "core" pages set and a multi-locale "info"
 * pages set) declare two collections like this one and the
 * existing one.
 */
export const localizedPagesCollection = defineCollection({
  slug: "localized-pages",
  labels: { singular: "Localized Page", plural: "Localized Pages" },
  slugField: { useField: "title", unique: true },
  i18n: true,
  admin: {
    group: "Content",
    listColumns: ["title", "locale", "_status", "updatedAt"],
    description:
      "Per-locale variants of the same logical page; rows linked by translation_group_id.",
  },
  versions: { drafts: { autosave: true }, max: 20 },
  access: {
    read: () => true,
    create: isEditorOrAbove,
    update: isOwnerOrAdmin,
    delete: isOwnerOrAdmin,
  },
  seo: {
    urlPath: (doc) => {
      const slug = typeof doc.slug === "string" ? doc.slug : null;
      const locale = typeof doc.locale === "string" ? doc.locale : null;
      if (!slug || !locale) return null;
      return `/${locale}/${slug.replace(/^\/+/, "")}`;
    },
    changefreq: "weekly",
    priority: 0.6,
  },
  fields: [
    {
      type: "text",
      name: "title",
      required: true,
    },
    {
      type: "textarea",
      name: "body",
      admin: { description: "Plain-text body — the test surface for i18n." },
    },
  ],
});
