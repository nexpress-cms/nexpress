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
  fields: [
    { name: "title", type: "text", required: true },
    { name: "summary", type: "textarea" },
    { name: "blocks", type: "blocks" },
  ],
});
