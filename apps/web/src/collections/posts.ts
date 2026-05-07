import { defineCollection, isEditorOrAbove, isOwnerOrAdmin } from "@nexpress/core";

export const postsCollection = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  slugField: { useField: "title", unique: true },
  admin: {
    group: "Content",
    listColumns: ["title", "status", "publishedAt", "updatedAt"],
    defaultSort: "-publishedAt",
    description: "Blog posts — long-form rich-text content.",
  },
  versions: { drafts: { autosave: true }, max: 20 },
  community: { comments: true },
  access: {
    read: () => true,
    create: isEditorOrAbove,
    update: isOwnerOrAdmin,
    delete: isOwnerOrAdmin,
  },
  seo: {
    urlPath: (doc) => {
      const slug = typeof doc.slug === "string" ? doc.slug : null;
      return slug ? `/blog/${slug}` : null;
    },
    changefreq: "weekly",
    priority: 0.7,
  },
  fields: [
    {
      type: "text",
      name: "title",
      required: true,
      admin: { kind: "title", placeholder: "My first post" },
    },
    {
      type: "textarea",
      name: "excerpt",
      admin: {
        position: "sidebar",
        description: "Short summary shown in lists and social previews.",
      },
    },
    {
      type: "richText",
      name: "content",
      required: true,
    },
    {
      type: "upload",
      name: "coverImage",
      relationTo: "media",
      admin: { position: "sidebar" },
    },
    {
      type: "date",
      name: "publishedAt",
      admin: { description: "Publish date — used for sort order and archive pages." },
    },
    {
      type: "relationship",
      name: "author",
      relationTo: "users",
      admin: { position: "sidebar" },
    },
    {
      // Phase 21.11 — preserves the original WP byline when the
      // importer can't resolve `author` to an `np_users` row (the
      // `--no-create-authors` opt-out, or a custom resolver that
      // returns null for a specific login). Empty when the staff
      // link survived. Themes that want to surface "Originally
      // by …" lines read this field as a fallback.
      type: "text",
      name: "wpOriginalAuthor",
      admin: {
        position: "sidebar",
        description: "WP author byline preserved from import — read-only in admin.",
      },
    },
    {
      type: "relationship",
      name: "categories",
      relationTo: "taxonomies",
      hasMany: true,
      filterOptions: { taxonomy: "category" },
      admin: { position: "sidebar" },
    },
    {
      type: "relationship",
      name: "tags",
      relationTo: "taxonomies",
      hasMany: true,
      filterOptions: { taxonomy: "post_tag" },
      admin: { position: "sidebar" },
    },
  ],
});
