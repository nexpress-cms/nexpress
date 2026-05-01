import { defineCollection } from "@nexpress/core";

export const postsCollection = defineCollection({
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  slugField: { useField: "title", unique: true },
  admin: {
    defaultSort: "-publishedAt",
    listColumns: ["title", "status", "publishedAt"],
    description: "Blog posts.",
  },
  versions: { drafts: true },
  access: {
    read: () => true,
  },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "excerpt", type: "textarea" },
    { name: "content", type: "richText", required: true },
    { name: "publishedAt", type: "date" },
  ],
});
