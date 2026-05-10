/**
 * Client-only entry for `@nexpress/plugin-forum`. Components
 * here carry the `"use client"` banner via tsup's banner
 * injection. Server-side route components live under
 * `src/routes/` and are imported into the plugin's `pageRoutes`
 * registration from `src/index.ts`.
 */
export { DiscussionForm } from "./client/discussion-form.js";
export { DiscussionAuthorActions } from "./client/discussion-author-actions.js";
