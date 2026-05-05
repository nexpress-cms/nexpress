# @nexpress/blocks

Block-based page builder for
[NexPress](https://github.com/hahabsw/nexpress) — the Next.js-based CMS.
Drag-and-drop blocks in the admin; render the same blocks server-side
on the public site.

## Install

```bash
pnpm add @nexpress/blocks
```

## What's in this package

```ts
// Server-safe — registry + renderer + types + block definitions
import {
  renderBlocks,
  getDefaultBlocks,
  createBlockRegistry,
} from "@nexpress/blocks";
```

The page-builder UI itself (drag-and-drop editor + palette) lives
inside `@nexpress/admin` so it can use the admin's Radix + Tailwind
primitives directly. There is no `@nexpress/blocks/client`
sub-export.

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

The drag-and-drop editor is part of `@nexpress/admin`. A `richText`
or `blocks` field on a collection automatically renders it in the
admin form for that collection — sites don't import the editor
directly.

## Authoring a custom block

```ts
import type { NpBlockDefinition } from "@nexpress/blocks";

export const calloutBlock: NpBlockDefinition = {
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
