"use client";

/**
 * Page-builder editor entry point. Kept here as a thin re-export
 * so existing dynamic imports (`field-renderer.tsx`'s
 * `LazyBlockPageEditor`) keep working unchanged. The actual
 * implementation moved into `form-editor/` as part of the
 * #467 refactor; an `in-page-editor/` directory will land
 * alongside it without disturbing this entry.
 */
export { BlockPageEditor } from "./form-editor/index.js";
