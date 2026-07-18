# @nexpress/editor

Lexical-based rich text editor for
[NexPress](https://github.com/nexpress-cms/nexpress) — the Next.js-based CMS.
Stores content in the NexPress-owned `NpRichTextContent` v1 envelope and
renders the embedded Lexical document server-side without mounting the editor.
Raw Lexical `{ root }` objects are not the public storage contract and are
rejected at collection write boundaries.

## Install

```bash
pnpm add @nexpress/editor
```

## Client / server boundary

```ts
// Server-safe — types + SSR renderer
import { renderRichText } from "@nexpress/editor";
import type { NpRichTextContent } from "@nexpress/editor";

// Client-only — interactive editor
import { NpRichTextEditor } from "@nexpress/editor/client";
```

`NpRichTextContent` is shared with `@nexpress/core/fields`, which owns the
version constant, validator, type guard, and empty-document factory. Future
format changes use a new envelope version and an explicit migration path.

Server pages render rich text without pulling in Lexical:

```tsx
// app/posts/[slug]/page.tsx (RSC)
import { renderRichText } from "@nexpress/editor";

export default async function PostPage({ params }) {
  const post = await findPost(params.slug);
  return <article>{renderRichText(post.body)}</article>;
}
```

Admin edit forms lazy-load the editor:

```tsx
// any "use client" admin form
import { NpRichTextEditor } from "@nexpress/editor/client";

<NpRichTextEditor
  value={value}
  onChange={setValue}
  config={{ placeholder: "Write…", onUploadImage }}
/>;
```

`value` supports authoritative parent-side replacements. Normal typing stays
inside the mounted Lexical editor and reports through `onChange`, preserving
focus, selection, and undo history. If the parent later supplies different
content—for example after a form reset, autosave recovery, or revision
restore—the editor replaces its visible state and clears the stale undo stack
so the restored content cannot be undone back to the superseded document.
Passing `null` resets the editor to one empty paragraph.

## What's in the box

- Headings, paragraph, blockquote, code block, ordered/unordered lists,
  links, inline code, bold/italic/underline/strikethrough, and horizontal rules
- Image node with paste / upload (`config.onUploadImage`)
- History (undo/redo)
- Toolbar plugin under `@nexpress/editor/client`
- Server renderer that walks the document inside the same NexPress envelope

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [AGENTS.md](https://github.com/nexpress-cms/nexpress/blob/main/AGENTS.md)
- [Rich-text contract](https://github.com/nexpress-cms/nexpress/blob/main/docs/rich-text.md)
- [Lexical docs](https://lexical.dev/)

## License

MIT
