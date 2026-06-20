"use client";

/**
 * Page-builder editor entry point. Kept here as a thin re-export
 * so existing dynamic imports (`field-renderer.tsx`'s
 * `LazyBlockPageEditor`) keep working unchanged. The actual
 * orchestrator lives in `form-editor/` and switches between the
 * row-card Page builder surface and the sibling `in-page-editor/`
 * Document view.
 */
export { BlockPageEditor } from "./form-editor/index.js";
