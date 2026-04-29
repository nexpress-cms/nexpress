import { defineCollection, isEditorOrAbove } from "@nexpress/core";

/**
 * Phase 21.6 — taxonomies collection. WordPress imports land
 * categories and post tags as rows here; posts then reference
 * them via the `categories` / `tags` relationship fields.
 *
 * Slug is unique within the collection — the wp-import applier
 * relies on that uniqueness to dedupe across re-runs (it looks
 * up by `(taxonomy, slug)` before creating).
 *
 * User projects that don't need term tracking can drop this
 * collection from their config; the wp-import package treats the
 * `taxonomies` deps as opt-in and just skips term wiring when no
 * resolver is supplied.
 */
export const taxonomiesCollection = defineCollection({
  slug: "taxonomies",
  labels: { singular: "Taxonomy term", plural: "Taxonomies" },
  slugField: { useField: "name", unique: true },
  admin: {
    group: "Content",
    listColumns: ["name", "taxonomy", "slug"],
    defaultSort: "name",
    description: "Tags, categories, and any other taxonomy terms imported from WordPress.",
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
    },
    {
      type: "select",
      name: "taxonomy",
      required: true,
      options: [
        { label: "Category", value: "category" },
        { label: "Tag", value: "post_tag" },
      ],
    },
    {
      type: "textarea",
      name: "description",
    },
  ],
});
