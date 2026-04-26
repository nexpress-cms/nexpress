import { defineCollection, isEditorOrAbove, isOwnerOrAdmin } from "@nexpress/core";

export const pagesCollection = defineCollection({
  slug: "pages",
  labels: { singular: "Page", plural: "Pages" },
  slugField: { useField: "title", unique: true },
  admin: {
    group: "Content",
    listColumns: ["title", "slug", "status", "updatedAt"],
    defaultSort: "title",
    description: "Static pages — composed from blocks.",
  },
  versions: { drafts: true, max: 20 },
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
      // Pages use the catch-all `(site)/[[...slug]]` route. The
      // home page slug is "/" and maps to "/", every other slug
      // maps to "/{slug}". A leading slash on a non-root slug is
      // a data quirk we tolerate by stripping it.
      if (slug === "/") return "/";
      return `/${slug.replace(/^\/+/, "")}`;
    },
    changefreq: "weekly",
    priority: 0.8,
  },
  fields: [
    {
      type: "text",
      name: "title",
      required: true,
    },
    {
      type: "textarea",
      name: "seoDescription",
      admin: { description: "Meta description shown in search results." },
    },
    {
      type: "blocks",
      name: "blocks",
    },
  ],
});
