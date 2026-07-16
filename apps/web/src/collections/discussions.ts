import { defineDiscussionsCollection } from "@nexpress/plugin-forum";

/**
 * Reference-app discussion schema. Keep the category catalog next to the
 * collection so runtime bootstrap, generated tables, and integration fixtures
 * all register the same exact definition.
 */
export const discussionsCollection = defineDiscussionsCollection({
  categories: [
    { label: "General", value: "general" },
    { label: "Announcements", value: "announcements" },
    { label: "Q&A", value: "qa" },
    { label: "Show & Tell", value: "show-and-tell" },
  ],
});
