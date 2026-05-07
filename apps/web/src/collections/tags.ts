import { defineCollection, isEditorOrAbove } from "@nexpress/core";

/**
 * Tags — flat keyword labels for posts. Split from the legacy
 * single `taxonomies` collection (Phase 21.6) for the same reason
 * as Categories — the operator's mental model is "tags" and
 * "categories", not "taxonomies".
 */
export const tagsCollection = defineCollection({
  slug: "tags",
  labels: { singular: "Tag", plural: "Tags" },
  slugField: { useField: "name", unique: true },
  admin: {
    group: "Content",
    listColumns: ["name", "slug"],
    defaultSort: "name",
    description: "Keyword labels for posts.",
    icon: "Tag",
  },
  access: {
    read: () => true,
    create: isEditorOrAbove,
    update: isEditorOrAbove,
    delete: isEditorOrAbove,
  },
  fields: [
    {
      type: "text",
      name: "name",
      required: true,
      admin: { kind: "title" },
    },
    {
      type: "textarea",
      name: "description",
      admin: { position: "sidebar" },
    },
  ],
});
