# @nexpress/editor

Lexical-based rich text editor for
[NexPress](https://github.com/hahabsw/nexpress) — the Next.js-based CMS.
Stores content as Lexical JSON; renders the same JSON server-side without
mounting the editor.

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
/>
```

## What's in the box

- Headings, paragraph, blockquote, code block, ordered/unordered lists,
  links, inline code, bold/italic, horizontal rule
- Image node with paste / upload (`config.onUploadImage`)
- History (undo/redo)
- Toolbar plugin under `@nexpress/editor/client`
- Server renderer that walks the same Lexical JSON

## Links

- [Repository](https://github.com/hahabsw/nexpress)
- [AGENTS.md](https://github.com/hahabsw/nexpress/blob/main/AGENTS.md)
- [Lexical docs](https://lexical.dev/)

## License

MIT
