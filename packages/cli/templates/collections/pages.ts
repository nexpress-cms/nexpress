import { defineCollection } from "@nexpress/core";

export const pagesCollection = defineCollection({
  slug: "pages",
  labels: { singular: "Page", plural: "Pages" },
  slugField: { useField: "title", unique: true },
  admin: {
    defaultSort: "title",
    listColumns: ["title", "updatedAt"],
    description: "Static pages.",
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
