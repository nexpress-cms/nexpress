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
    icon: "Newspaper",
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
      if (!slug) return null;
      // Universal-content-model #748 — per-kind URL routing.
      // Themes that contribute a kind also contribute its
      // `urlPattern` via `requires.collections.posts.kinds`.
      // Operators with custom kinds register their own
      // `seo.urlPath` override; built-in kinds fall through
      // this switch.
      const kind = typeof doc.kind === "string" ? doc.kind : "article";
      if (kind === "doc") return `/docs/${slug}`;
      return `/blog/${slug}`;
    },
    changefreq: "weekly",
    priority: 0.7,
  },
  fields: [
    {
      // Content-type discriminator (universal-content-model Phase U.1).
      // Themes contribute extra options via
      // `requires.collections.posts.fields.kind`, which the
      // merge-requirements union folds into the runtime schema.
      // Single-kind sites see "article" everywhere and never
      // notice this field; multi-kind sites get a per-kind
      // sidebar entry from the kinds metadata block.
      type: "select",
      name: "kind",
      required: true,
      defaultValue: "article",
      options: [{ label: "Article", value: "article" }],
      admin: { position: "sidebar" },
    },
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
      relationTo: "categories",
      hasMany: true,
      admin: { position: "sidebar" },
    },
    {
      type: "relationship",
      name: "tags",
      relationTo: "tags",
      hasMany: true,
      admin: { position: "sidebar" },
    },
    {
      // Hierarchical-kind support (universal-content-model Phase U.1).
      // Optional for every kind. Themes whose kind is hierarchical
      // (e.g. docs) read `parent` + `order` to build their sidebar
      // tree; article-kind posts leave both null and ignore them.
      type: "relationship",
      name: "parent",
      relationTo: "posts",
      admin: {
        position: "sidebar",
        description: "Parent post — used by hierarchical kinds (e.g. docs).",
      },
    },
    {
      type: "number",
      name: "order",
      admin: {
        position: "sidebar",
        description: "Sort order within a parent. Only used by hierarchical kinds.",
      },
    },
  ],
});
