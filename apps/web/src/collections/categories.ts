import { defineCollection, isEditorOrAbove } from "@nexpress/core";

/**
 * Categories — terms used to group posts by topic. Split from the
 * legacy single `taxonomies` collection (Phase 21.6) so the admin
 * sidebar exposes Categories and Tags as distinct menus instead
 * of a single "Taxonomies" entry with a discriminator dropdown.
 *
 * Slug is unique within the collection — wp-import shims that
 * write into this table (or any operator-driven create) rely on
 * the uniqueness to dedupe across re-runs.
 *
 * User projects that don't track categories can drop this
 * collection from their config; the wp-import package treats the
 * categories dep as opt-in (the resolver shim is per-app, not
 * built into the package).
 */
export const categoriesCollection = defineCollection({
  slug: "categories",
  labels: { singular: "Category", plural: "Categories" },
  slugField: { useField: "name", unique: true },
  admin: {
    group: "Content",
    listColumns: ["name", "slug"],
    defaultSort: "name",
    description: "Topic groupings for posts.",
    icon: "FolderTree",
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
