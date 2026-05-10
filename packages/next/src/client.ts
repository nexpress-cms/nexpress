/**
 * Client-only entry point for `@nexpress/next`. Components
 * exported here carry the `"use client"` banner via tsup's
 * banner injection, so consumers can import them from a Server
 * Component without RSC complaining about the directive.
 *
 * Server-safe code lives at the root entry (`@nexpress/next`).
 * If you're adding a new component, decide based on whether it
 * uses React hooks / browser-only APIs — those go here; pure
 * server functions go in the root.
 */
export { Comments } from "./comments.js";
