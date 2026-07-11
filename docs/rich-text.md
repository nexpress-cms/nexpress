# Rich-text content contract

NexPress stores every `richText` collection field as a versioned JSON envelope:

```ts
import type { NpRichTextContent } from "@nexpress/core/fields";

const content: NpRichTextContent = {
  version: 1,
  document: {
    root: {
      type: "root",
      children: [],
      direction: null,
      format: "",
      indent: 0,
      version: 1,
    },
  },
};
```

The outer `version` is owned by NexPress. `document` contains the serialized
editor state for that version. Code outside the editor should treat node-specific
properties as opaque and use the shared helpers instead of assuming that the
current editor's JSON will remain the storage contract forever.

## Authoring and validation

`@nexpress/core/fields` is the client-safe contract entry point:

```ts
import {
  NP_RICH_TEXT_CONTENT_VERSION,
  isNpRichTextContent,
  npCreateEmptyRichTextContent,
  npValidateRichTextContent,
} from "@nexpress/core/fields";
```

- `NP_RICH_TEXT_CONTENT_VERSION` is the current envelope version (`1`).
- `npCreateEmptyRichTextContent()` creates a valid empty paragraph document.
- `isNpRichTextContent(value)` is the type guard for API, plugin, and UI boundaries.
- `npValidateRichTextContent(value)` returns either the narrowed value or a precise
  failure message.

`NpRichTextEditor` accepts and emits `NpRichTextContent`; callers never pass raw
Lexical state. `renderRichText` and `extractHeadingToc` consume the same type.

## Write behavior

Collection validation rejects malformed rich text before hooks, indexing, media
reference extraction, or database writes run. The v1 validator requires exactly
`version` and `document` at the envelope level, exactly `root` in the document,
the full root metadata, and recursive nodes with non-empty `type` and positive
integer `version` values. Node-specific JSON properties remain extensible, but
functions, undefined values, non-finite numbers, non-plain objects, excessive
nesting, and circular references are rejected.

There is no raw-Lexical fallback. A payload such as `{ root: { children: [] } }`
is invalid. This fail-closed rule is shared by Admin, generated document types,
OpenAPI, search indexing, mention/media extraction, translation interchange,
the WordPress importer, bundled themes, and example plugins.

The database column remains JSONB; v1 changes the value contract, not the SQL
schema. Future wire changes will use a new NexPress envelope version and ship an
explicit migration path rather than silently reinterpreting stored JSON.

## Translation and imports

XLIFF and Gettext continue to protect individual rich-text leaves. They first
validate the v1 envelope, then replace text only while preserving links,
formatting, media nodes, and other editor metadata. WordPress HTML/Gutenberg
conversion emits v1 content directly, so imported rows go through the same
collection validator as Admin-authored content.
