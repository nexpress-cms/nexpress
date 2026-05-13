import { defineCollection } from "@nexpress/core";

export const pagesCollection = defineCollection({
  slug: "pages",
  labels: { singular: "Page", plural: "Pages" },
  slugField: { useField: "title", unique: true },
  admin: {
    defaultSort: "title",
    listColumns: ["title", "updatedAt"],
    description: "Static pages.",
    // Surfaces an "In navigation" panel on each page's edit view so
    // operators can add/remove the page from any nav location
    // (header / footer / custom slots) without leaving the form.
    // Flip on for any page-shaped collection (`landing-pages`,
    // `static-pages`, etc.) — back-compat: defaults to false.
    navMembership: true,
  },
  versions: { drafts: true },
  access: {
    read: () => true,
  },
  // Tells the framework what public URL each page is served at.
  // The catch-all `(site)/[[...slug]]` route handles slugs; the
  // home page slug is "/" and maps to "/", every other slug
  // maps to "/{slug}". This contract is read by the sitemap, the
  // RSS feed builder, and the navigation resolver — without it,
  // nav items pointing at this collection render as `#`.
  seo: {
    urlPath: (doc) => {
      const slug = typeof doc.slug === "string" ? doc.slug : null;
      if (!slug) return null;
      if (slug === "/") return "/";
      return `/${slug.replace(/^\/+/, "")}`;
    },
    changefreq: "weekly",
    priority: 0.8,
  },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "summary", type: "textarea" },
    { name: "blocks", type: "blocks" },
  ],
});
