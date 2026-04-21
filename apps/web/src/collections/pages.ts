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
