import { defineCollection, isEditorOrAbove, isOwnerOrAdmin } from "@nexpress/core";

/**
 * DB integration fixture. The public reference surface uses the forum's
 * `forum-boards` + `forum-posts` model; generic community pipeline suites keep
 * this hidden collection so they can test member writes without board policy.
 */
export const discussionsCollection = defineCollection({
  slug: "discussions",
  labels: { singular: "Discussion fixture", plural: "Discussion fixtures" },
  slugField: { useField: "title", unique: true },
  admin: { hidden: true },
  versions: { drafts: true, max: 30 },
  community: {
    comments: true,
    profileActivity: { documents: true, comments: true },
    memberWrite: { create: true, update: true, delete: true },
  },
  access: {
    read: () => true,
    create: isEditorOrAbove,
    update: isOwnerOrAdmin,
    delete: isOwnerOrAdmin,
  },
  seo: {
    urlPath: (doc) => (typeof doc.id === "string" ? `/discussions/${doc.id}` : null),
  },
  fields: [
    { type: "text", name: "title", required: true },
    { type: "richText", name: "body" },
    {
      type: "select",
      name: "category",
      options: [
        { label: "General", value: "general" },
        { label: "Announcements", value: "announcements" },
        { label: "Q&A", value: "qa" },
        { label: "Show & Tell", value: "show-and-tell" },
      ],
    },
    { type: "checkbox", name: "pinned", defaultValue: false },
    { type: "checkbox", name: "locked", defaultValue: false },
  ],
});
