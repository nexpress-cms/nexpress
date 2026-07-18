# Block content wire format

Collection fields declared with `type: "blocks"` store one stable recursive
wire format: `NpBlockContent`, an array of `NpBlockInstance` values.

```ts
import {
  isNpBlockContent,
  npValidateBlockContent,
  type NpBlockContent,
} from "@nexpress/core/fields";

const content: NpBlockContent = [
  {
    id: "grid-1",
    type: "grid",
    props: { columns: 12, gap: "1rem" },
    children: [
      {
        id: "hero-1",
        type: "acme.hero",
        props: { title: "Hello" },
        layout: { colSpan: 12, mdColSpan: 8, lgColSpan: 6 },
      },
    ],
  },
];
```

`@nexpress/blocks` and `@nexpress/blocks/contracts` re-export the same type,
validator, and type guard. There is no separate plugin, pattern, Admin, or
translation shape.

## Instance contract

Every recursive instance contains exactly:

| Field      | Contract                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `id`       | Required, globally unique in the tree, at most 128 identifier characters.                           |
| `type`     | Required block type, at most 128 identifier characters.                                             |
| `props`    | Required plain object containing only JSON values and finite numbers.                               |
| `layout`   | Optional exact `{ colSpan, mdColSpan?, lgColSpan? }` object; every present span is an integer 1–12. |
| `children` | Optional array of instances using the same contract, up to 32 levels deep.                          |

Identifiers start with an ASCII letter or number and then use only letters,
numbers, `.`, `_`, or `-`. Unknown top-level fields, missing `props`, duplicate
ids, class instances, `undefined`, functions, non-finite numbers, excessive
depth, and circular values fail validation.

`layout` is parent-owned placement metadata rather than a block prop. The
built-in `grid` reads it from each direct child: `colSpan` is the mobile/base
span, `mdColSpan` applies from 768px, and `lgColSpan` applies from 1024px.
Omitted breakpoint overrides fall back to the next smaller breakpoint, while
an omitted `layout` spans the parent grid's configured columns. Other parents
preserve the field even when they do not render it, so moving or temporarily
unnesting a block does not lose its placement. Admin exposes the same three
spans and omits the object when all values resolve to the full-width default.

Block `type` values are not required to be active at structural-validation
time. This is intentional: disabling a plugin or switching themes must not
make stored content unreadable or silently delete its instances. Admin and
public rendering show unknown or inactive block placeholders, and the
unknown-blocks operations surface can inventory or explicitly remove them.

## Validation boundaries

`npValidateBlockContent(value)` returns either `{ ok: true, value }` or
`{ ok: false, message }`; `isNpBlockContent(value)` is the corresponding type
guard. The same validator runs at these boundaries:

- collection writes for every `type: "blocks"` field;
- plugin/theme and operator-saved patterns;
- theme seed pages before they enter the collection pipeline;
- Admin page JSON and paste import;
- server-rendered block previews;
- translation extraction and application;
- unknown-block inventory and cleanup.

Generated collection document types use `NpBlockContent` rather than
`unknown`, and OpenAPI collection schemas reference the recursive
`block_instance` component.

The wire validator checks structure without consulting a registry. The
definition-aware layer in `@nexpress/blocks` then connects an instance to the
currently registered `propsSchema` and container contract:

`propsSchema` itself is the stable closed v1 field union documented in
[`plugin-blocks.md`](plugin-blocks.md). Definition loading rejects type-specific
key/default mismatches, invalid sibling conditions, malformed rich text,
undeclared defaults, and non-object array entries before an instance can be
inserted. The same schema is projected through public discovery and OpenAPI.

```ts
import {
  getRegisteredBlockMetadata,
  npAnalyzeBlockContent,
  npValidateBlockContentAgainstDefinitions,
} from "@nexpress/blocks";

const issues = npAnalyzeBlockContent(content, getRegisteredBlockMetadata());
const result = npValidateBlockContentAgainstDefinitions(content, getRegisteredBlockMetadata());
```

Known prop type, required value, pattern, numeric bound/step, select option,
rich-text envelope, nested array schema, leaf/container, maximum-child, and
allowed-child violations are errors. Unknown block types and stale extra props
are warnings: disabling a plugin or tightening a schema must not destroy stored
content. Parent-owned placement belongs in top-level `layout`; a legacy
`props._layout` value is now an ordinary stale prop warning and is ignored by
the grid renderer. `minChildren` remains a warning because an in-progress edit
naturally passes through incomplete container states.

The definition-aware validator runs before Admin saves, app collection writes,
live preview, pattern persistence/registration, and block rendering. Plugin
doctor applies it to contributed patterns. This layer stays outside core so the
client-safe collection validator does not import the rendering registry.

## Evolution

The array shape is the v1 contract. Adding an optional instance field is
non-breaking. Renaming or removing fields, changing identifier rules, or
wrapping the array requires a versioned migration rather than accepting both
formats ambiguously.

The pre-1.0 experimental grid convention moved from
`props._layout: { colSpan, mdColSpan?, lgColSpan? }` to the exact top-level
`layout` field. Move the object rather than keeping both forms; the retired prop
is preserved as stale data but no longer controls rendering.
