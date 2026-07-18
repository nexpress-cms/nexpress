# @nexpress/blocks

Block-based page builder for
[NexPress](https://github.com/nexpress-cms/nexpress) — the Next.js-based CMS.
Drag-and-drop blocks in the admin; render the same blocks server-side
on the public site.

Stored content uses the stable recursive `NpBlockContent` wire shape. Every
instance has `id`, `type`, `props`, and optional `children`; definition-aware
validation checks props and container rules before writes while preserving
unknown blocks from inactive plugins or themes.

## Install

```bash
pnpm add @nexpress/blocks
```

## What's in this package

```ts
// Server-safe — registry + renderer + types + block definitions
import { renderBlocks, getDefaultBlocks, createBlockRegistry } from "@nexpress/blocks";
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

`getDefaultBlocks()` returns the built-in definitions: grid, section header,
hero, feature grid, testimonials, stats grid, logos cloud, tabs, FAQ, pricing,
CTA, rich text, contact form, and image gallery.

## Edit in the admin

The drag-and-drop editor is part of `@nexpress/admin`. A `richText`
or `blocks` field on a collection automatically renders it in the
admin form for that collection — sites don't import the editor
directly.

## Authoring a custom block

```tsx
import type { NpBlockDefinition } from "@nexpress/blocks";

export const calloutBlock: NpBlockDefinition = {
  type: "callout",
  label: "Callout",
  description: "A short highlighted notice.",
  defaultProps: { tone: "info", body: "Important information" },
  propsSchema: [
    {
      name: "tone",
      label: "Tone",
      type: "select",
      options: [
        { label: "Info", value: "info" },
        { label: "Warning", value: "warning" },
        { label: "Danger", value: "danger" },
      ],
    },
    { name: "body", label: "Body", type: "textarea", translatable: true },
  ],
  render: (props) => {
    const tone = typeof props.tone === "string" ? props.tone : "info";
    const body = typeof props.body === "string" ? props.body : "";
    return <aside data-tone={tone}>{body}</aside>;
  },
};
```

Register alongside the defaults:

```ts
const registry = createBlockRegistry();
for (const block of getDefaultBlocks()) registry.register(block);
registry.register(calloutBlock);
```

Plugins normally contribute blocks through `definePlugin({ blocks: [...] })`
instead of mutating the registry themselves. Bootstrap validates each
definition, assigns source ownership, and exposes serializable metadata to the
Admin picker. See the
[block contract guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/block-content.md)
and
[plugin block guide](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-blocks.md).

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [AGENTS.md](https://github.com/nexpress-cms/nexpress/blob/main/AGENTS.md)

## License

MIT
