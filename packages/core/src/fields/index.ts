/**
 * `@nexpress/core/fields` — pure, client-safe field helpers.
 *
 * These functions evaluate `admin.condition` predicates and walk
 * collection field trees. They have no dependencies on the
 * server-only surface of `@nexpress/core` (db, auth, sharp,
 * argon2), so they can be safely imported from `"use client"`
 * components in `@nexpress/admin` without dragging the whole
 * backend bundle into the browser (#774 audit follow-up).
 *
 * Single source of truth: the same evaluator runs server-side
 * inside the pipeline's required-drop validation and client-side
 * inside the editor's `passesCondition`. Keep both in sync by
 * importing from this subpath in both places.
 */
export {
  evaluateFieldCondition,
  collectHiddenFieldNames,
  buildZodSchema,
  getCollectionZodSchema,
} from "../collections/validation.js";
export {
  NP_RICH_TEXT_CONTENT_VERSION,
  isNpRichTextContent,
  npCreateEmptyRichTextContent,
  npValidateRichTextContent,
  type NpRichTextContent,
  type NpRichTextContentValidationResult,
  type NpRichTextDocumentV1,
  type NpRichTextSerializedNode,
} from "./rich-text.js";
