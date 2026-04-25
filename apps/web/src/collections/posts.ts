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
  fields: [
    {
      type: "text",
      name: "title",
      required: true,
      admin: { placeholder: "My first post" },
    },
    {
      type: "textarea",
      name: "excerpt",
      admin: { description: "Short summary shown in lists and social previews." },
    },
    {
      type: "upload",
      name: "coverImage",
      relationTo: "media",
    },
    {
      type: "richText",
      name: "content",
      required: true,
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
    },
  ],
});
