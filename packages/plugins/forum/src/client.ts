/**
 * Client-only entry for `@nexpress/plugin-forum`. Components
 * here carry the `"use client"` banner via tsup's banner
 * injection. Server-side route components live under
 * `src/routes/` and are imported into the plugin's `pageRoutes`
 * registration from `src/index.ts`.
 */
export { ForumPostForm } from "./client/forum-post-form.js";
export { ForumPostActions } from "./client/forum-post-actions.js";
export { ForumPostEngagement } from "./client/forum-post-engagement.js";
export { ForumPostReportAction } from "./client/forum-post-report-action.js";
