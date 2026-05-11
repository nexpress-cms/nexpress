/**
 * Ambient declaration for the package's own `./client` subpath
 * (`@nexpress/plugin-forum/client`).
 *
 * Why: tsup builds `index` + `client` as parallel array configs,
 * and DTS for both entries kicks off in parallel. The
 * `index.ts` dts step needs to resolve
 * `@nexpress/plugin-forum/client` to typecheck imports in
 * `src/routes/*.tsx` (`DiscussionForm`, `DiscussionAuthorActions`).
 * On a fresh CI build the parallel client dts might not have
 * emitted `dist/client.d.ts` yet when index dts tries to
 * resolve the subpath, breaking the build with "Could not
 * find a declaration file".
 *
 * This shim pre-declares the module's types so dts resolution
 * doesn't cross into the `exports` map → filesystem. Runtime
 * imports still go through the exports map (preserves the
 * `"use client"` RSC boundary).
 */
declare module "@nexpress/plugin-forum/client" {
  export { DiscussionForm } from "./client/discussion-form.js";
  export { DiscussionAuthorActions } from "./client/discussion-author-actions.js";
}
