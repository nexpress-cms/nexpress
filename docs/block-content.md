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
    id: "hero-1",
    type: "acme.hero",
    props: { title: "Hello" },
    children: [],
  },
];
```

`@nexpress/blocks` and `@nexpress/blocks/contracts` re-export the same type,
validator, and type guard. There is no separate plugin, pattern, Admin, or
translation shape.

## Instance contract

Every recursive instance contains exactly:

| Field      | Contract                                                                   |
| ---------- | -------------------------------------------------------------------------- |
| `id`       | Required, globally unique in the tree, at most 128 identifier characters.  |
| `type`     | Required block type, at most 128 identifier characters.                    |
| `props`    | Required plain object containing only JSON values and finite numbers.      |
| `children` | Optional array of instances using the same contract, up to 32 levels deep. |

Identifiers start with an ASCII letter or number and then use only letters,
numbers, `.`, `_`, or `-`. Unknown top-level fields, missing `props`, duplicate
ids, class instances, `undefined`, functions, non-finite numbers, excessive
depth, and circular values fail validation.

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
content. `_layout` remains reserved parent-owned layout metadata and is not
treated as a stale prop. `minChildren` remains a warning because an in-progress
edit naturally passes through incomplete container states.

The definition-aware validator runs before Admin saves, app collection writes,
live preview, pattern persistence/registration, and block rendering. Plugin
doctor applies it to contributed patterns. This layer stays outside core so the
client-safe collection validator does not import the rendering registry.

## Evolution

The array shape is the v1 contract. Adding an optional instance field is
non-breaking. Renaming or removing fields, changing identifier rules, or
wrapping the array requires a versioned migration rather than accepting both
formats ambiguously.
