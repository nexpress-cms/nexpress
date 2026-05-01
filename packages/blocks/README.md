# @nexpress/blocks

Block-based page builder for
[NexPress](https://github.com/hahabsw/nexpress) — the Next.js-based CMS.
Drag-and-drop blocks in the admin; render the same blocks server-side
on the public site.

## Install

```bash
pnpm add @nexpress/blocks
```

## Client / server boundary

```ts
// Server-safe — registry + renderer
import { renderBlocks, getDefaultBlocks } from "@nexpress/blocks";

// Client-only — drag-and-drop editor + palette
import { BlockPageEditor, BlockPalette } from "@nexpress/blocks/client";
```

## Render blocks server-side

```tsx
// app/[[...slug]]/page.tsx (RSC catch-all)
import { renderBlocks } from "@nexpress/blocks";

export default async function Page({ params }) {
  const page = await getPageBySlug(params.slug);
  return <main>{renderBlocks(page.blocks)}</main>;
}
```

`renderBlocks` falls back to the built-in registry when no second
argument is passed.

## Default blocks

`getDefaultBlocks()` returns the built-in definitions: hero, feature
grid, FAQ, pricing, CTA, rich text, contact form, image gallery.

## Edit in the admin

`BlockPageEditor` is the drag-and-drop UI. Build a registry from the
defaults plus any custom blocks and pass it in:

```tsx
"use client";
import { BlockPageEditor } from "@nexpress/blocks/client";
import { createBlockRegistry, getDefaultBlocks } from "@nexpress/blocks";

const registry = createBlockRegistry();
for (const block of getDefaultBlocks()) registry.register(block);

<BlockPageEditor registry={registry} blocks={value} onChange={setValue} />
```

## Authoring a custom block

```ts
import type { NxBlockDefinition } from "@nexpress/blocks";

export const calloutBlock: NxBlockDefinition = {
  type: "callout",
  label: "Callout",
  fields: [
    { name: "tone", type: "select", options: ["info", "warning", "danger"] },
    { name: "body", type: "richText" },
  ],
  render: ({ data }) => (
    <aside data-tone={data.tone}>{/* render data.body */}</aside>
  ),
};
```

Register alongside the defaults:

```ts
const registry = createBlockRegistry();
for (const block of getDefaultBlocks()) registry.register(block);
registry.register(calloutBlock);
```

## Links

- [Repository](https://github.com/hahabsw/nexpress)
- [AGENTS.md](https://github.com/hahabsw/nexpress/blob/main/AGENTS.md)

## License

MIT
