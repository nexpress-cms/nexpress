import {
  defineCollection,
  getCollectionConfig,
  isEditorOrAbove,
  isOwnerOrAdmin,
} from "@nexpress/core";

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
    // Editor sidebar group icons (#8 of the editor progressive-
    // disclosure track). The icon name is a Lucide identifier;
    // unknown names are silently ignored. Themes contributing
    // their own groups (Magazine, Portfolio, Docs) add their
    // entries via `requires.collections.posts.groupMeta` and
    // the merge-requirements step unions them in.
    groupMeta: {
      Publish: { icon: "Calendar", description: "Status, kind, and publish date." },
      Lead: { icon: "Layout", description: "Excerpt + cover image used in cards and social previews." },
      Author: { icon: "User", description: "Byline + import-preserved attribution." },
      Taxonomy: { icon: "Tag", description: "Categories + tags." },
      SEO: { icon: "Search", description: "Search-result preview + social card meta." },
      Hierarchy: { icon: "FolderTree", description: "Parent post + sort order for hierarchical kinds." },
    },
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
      // `urlPattern` via `requires.collections.posts.kinds`;
      // the merge-requirements step lands the union on
      // `admin.kinds`. Read that here and substitute `:slug`
      // — `kind="article"` (and any kind without a urlPattern)
      // falls back to `/blog/<slug>`, matching the framework's
      // built-in `/blog/[slug]` route.
      const kind = typeof doc.kind === "string" ? doc.kind : "article";
      try {
        const config = getCollectionConfig("posts");
        const pattern = config.admin?.kinds?.[kind]?.urlPattern;
        if (pattern && pattern.includes(":slug")) {
          return pattern.replace(":slug", slug);
        }
      } catch {
        // Registry not initialised yet (e.g. seed scripts running
        // before `loadCollections` completes) — fall through to
        // the framework default rather than crashing the urlPath
        // resolver.
      }
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
      admin: { position: "sidebar", group: "Publish" },
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
        group: "Lead",
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
      admin: { position: "sidebar", group: "Lead" },
    },
    {
      type: "date",
      name: "publishedAt",
      admin: {
        position: "sidebar",
        group: "Publish",
        description: "Publish date — used for sort order and archive pages.",
      },
    },
    {
      type: "relationship",
      name: "author",
      relationTo: "users",
      admin: { position: "sidebar", group: "Author" },
    },
    {
      // Phase 21.11 — preserves the original WP byline when the
      // importer can't resolve `author` to an `np_users` row.
      // `condition`: only surface when the field actually carries
      // a value — operators creating posts by hand never need this,
      // and showing an empty "WP original author" input on every
      // post is noise. Imported posts that retained the byline
      // will pass the predicate and render normally.
      type: "text",
      name: "wpOriginalAuthor",
      admin: {
        position: "sidebar",
        group: "Author",
        description: "WP author byline preserved from import — read-only in admin.",
        // Serializable form (#763) so the client editor evaluates
        // the same condition as the server pipeline. `exists: true`
        // hides the field on freshly authored posts (empty value)
        // and surfaces it on imported posts that retained a byline.
        condition: { when: "wpOriginalAuthor", exists: true },
      },
    },
    {
      type: "relationship",
      name: "categories",
      relationTo: "categories",
      hasMany: true,
      admin: { position: "sidebar", group: "Taxonomy" },
    },
    {
      type: "relationship",
      name: "tags",
      relationTo: "tags",
      hasMany: true,
      admin: { position: "sidebar", group: "Taxonomy" },
    },
    {
      // Hierarchical-kind support (universal-content-model Phase U.1).
      // `condition`: only surfaces for kinds whose theme registered
      // `hierarchical: true` in its kinds metadata. Today only the
      // docs theme's `kind: "doc"` qualifies; the hardcoded check
      // keeps the condition self-contained (the alternative — reading
      // `admin.kinds.<x>.hierarchical` from the registry inside the
      // condition — would require widening the condition signature
      // for one call site).
      type: "relationship",
      name: "parent",
      relationTo: "posts",
      admin: {
        position: "sidebar",
        group: "Hierarchy",
        description: "Parent post — used by hierarchical kinds (e.g. docs).",
        condition: { when: "kind", equals: "doc" },
      },
    },
    {
      type: "number",
      name: "order",
      admin: {
        position: "sidebar",
        group: "Hierarchy",
        description: "Sort order within a parent. Only used by hierarchical kinds.",
        condition: { when: "kind", equals: "doc" },
      },
    },
    // Per-doc SEO meta. Flat fields (not a `group`) because the
    // `NpGroupField` codegen path has a known type-vs-runtime
    // inconsistency (type says nested object, drizzle column is
    // flat) — flat keeps the contract honest. The frontend route
    // reads these directly and falls back to title / excerpt /
    // coverImage when unset.
    {
      type: "text",
      name: "seoMetaTitle",
      // ~60 char soft limit is the search-result snippet
      // truncation point on Google + Bing. The hard `maxLength`
      // here gives operators a tactile signal (input rejects
      // further keystrokes) before they exceed the truncation
      // threshold. Leaving 4 extra chars buffer for fudge.
      maxLength: 64,
      admin: {
        position: "sidebar",
        group: "SEO",
        description: "Overrides the page's <title> tag. ~60 chars before search-result truncation. Falls back to the post title.",
      },
    },
    {
      type: "textarea",
      name: "seoMetaDescription",
      // ~155 char soft limit per the same convention.
      // Operators routinely write blog excerpts that bust this
      // — the maxLength keeps them honest.
      maxLength: 160,
      admin: {
        position: "sidebar",
        group: "SEO",
        description: "Meta description / social card description. ~155 chars before search-result truncation. Falls back to the post excerpt.",
      },
    },
    {
      type: "upload",
      name: "seoOgImage",
      relationTo: "media",
      admin: {
        position: "sidebar",
        group: "SEO",
        description: "Open Graph / Twitter Card image. Falls back to the cover image.",
      },
    },
    {
      // Marker for theme-seeded demo content (e.g. "theme:magazine").
      // Empty for operator-authored rows. Reseed wipes only rows
      // carrying a value here so operator content survives a theme
      // switch.
      type: "text",
      name: "seedSource",
      admin: {
        position: "sidebar",
        group: "System",
        description:
          "Set by the seeder. Empty for operator-authored posts. Reseed wipes only rows that carry a value here.",
        readOnly: true,
        condition: { when: "seedSource", exists: true },
      },
    },
  ],
});
