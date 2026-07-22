# Plugin blocks

Plugins can contribute server-rendered blocks to the page builder with
`definePlugin({ blocks: [...] })`. The bootstrap registers each enabled
plugin's definitions in the shared block registry, which drives both public
rendering and the Admin block picker.

## Quickstart

```tsx
import type { NpBlockDefinition } from "@nexpress/blocks";
import { definePlugin } from "@nexpress/plugin-sdk";

const noticeBlock: NpBlockDefinition = {
  type: "acme.notice",
  label: "Notice",
  description: "A short highlighted message.",
  defaultProps: { message: "Heads up" },
  propsSchema: [
    {
      name: "message",
      label: "Message",
      type: "textarea",
      translatable: true,
      required: true,
      defaultValue: "Heads up",
    },
  ],
  render: ({ message }) => <aside>{typeof message === "string" ? message : ""}</aside>,
};

export default definePlugin({
  manifest: {
    id: "acme-notice",
    version: "0.1.0",
    name: "Acme notice",
    description: "Adds a notice block.",
    author: { name: "Acme" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  blocks: [noticeBlock] satisfies NpBlockDefinition[],
});
```

`definePlugin()` derives `manifest.provides.blocks` from these definitions.
Plugins do not need a capability merely to render a block; the block context
is read-only.

## Definition contract

Every `NpBlockDefinition` has these required fields:

| Field          | Contract                                                                      |
| -------------- | ----------------------------------------------------------------------------- |
| `type`         | Unique within the plugin; up to 128 ASCII letters, numbers, `.`, `_`, or `-`. |
| `label`        | Non-empty operator-facing label.                                              |
| `defaultProps` | Plain object containing serializable initial values.                          |
| `propsSchema`  | Array of editor field definitions.                                            |
| `render`       | Function receiving props, optional rendered children, and read context.       |

Supported optional metadata is `description`, `icon`, `iconKind`, `category`,
`keywords`, `summaryFields`, `source`, and the container fields described
below. Unknown keys are rejected so a misspelling does not silently disappear
between the server registry and Admin metadata bridge.

The framework validates the same contract in four places:

1. `definePlugin()` while the plugin module is evaluated.
2. `@nexpress/next` before it mutates the core plugin registry.
3. `registerBlock()` before a definition enters the shared registry.
4. `nexpress ops plugins doctor --json` during static inspection.

Definitions that bypass the SDK therefore cannot rely on the old bootstrap
behavior that silently dropped malformed blocks.

Stored instances use the separate stable `NpBlockContent` wire contract. See
[`block-content.md`](block-content.md) for its exact keys, identifier and JSON
rules, duplicate-id handling, and validation boundaries.

## Prop schema

The runtime field inventory is exported as `npBlockPropFieldTypes`:

```text
text, textarea, number, boolean, select, url, richtext, image,
color, collection, array
```

Every field requires a unique identifier-style `name`, a non-empty `label`,
and one supported `type`. The TypeScript surface is an exact discriminated
union: a field exposes only the keys and `defaultValue` type owned by its
`type`. The runtime validator repeats the same closed-key check for JavaScript
and SDK-bypassing definitions. Optional common fields are `required`,
`defaultValue`, `description`, `group`, `hiddenWhen`, and `visibleWhen`.
Explicit `undefined`, accessors, class instances, and other non-JSON values are
not definition metadata.

| Type         | Stored/default value   | Type-specific metadata                                        |
| ------------ | ---------------------- | ------------------------------------------------------------- |
| `text`       | string                 | `translatable`, `placeholder`, `pattern`, `validationMessage` |
| `textarea`   | string                 | `translatable`, `placeholder`, `rows`                         |
| `number`     | finite number          | `placeholder`, `min`, `max`, `step`, `validationMessage`      |
| `boolean`    | boolean                | —                                                             |
| `select`     | declared option value  | required non-empty `options`                                  |
| `url`        | string URI reference   | `placeholder`, `pattern`, `validationMessage`                 |
| `richtext`   | `NpRichTextContent` v1 | `translatable`                                                |
| `image`      | image URL string       | —                                                             |
| `color`      | CSS color string       | —                                                             |
| `collection` | collection slug string | —                                                             |
| `array`      | array of objects       | required `itemSchema`, optional `itemDefault`                 |

`url` deliberately accepts relative paths and fragments such as `/pricing` and
`#details`; use `pattern` when a block needs a narrower URL grammar. `image`
stores the URL returned by the image library. `color` permits CSS values such
as `#0f172a`, `rgb(...)`, and `var(--np-color-primary)`. `collection` stores a
slug; Admin renders the active collection inventory when it is available.

Type-specific rules are checked during plugin loading:

- `text`, `textarea`, and `richtext` require an explicit
  `translatable: true | false`. Use `true` for visitor-facing copy and `false`
  for operational strings such as ids, CSS lengths, email addresses, and JSON
  blobs. Other field types must omit `translatable`.
- `select` requires at least one `{ label, value }` option, and option values
  must be unique.
- `number` owns `min`, `max`, and positive `step`; `min` cannot exceed `max`.
- `text` and `url` may declare `pattern`; the regular expression is compiled
  immediately and matched against the whole value. `validationMessage`
  customizes the pattern error. Number fields may use the same key when at
  least one of `min`, `max`, or `step` exists.
- `textarea` owns positive integer `rows`.
- `array` requires `itemSchema`, may provide an object `itemDefault`, and
  supports nested schemas up to eight levels without cycles. Every stored item
  must be a plain object; strings, primitive arrays, and JSON-encoded strings
  are rejected rather than coerced by Admin. `itemDefault` is validated against
  its own schema and is merged over field defaults when Admin inserts an item.
  Translation intent is declared on recursive textual leaves, not the array.
- `hiddenWhen` and `visibleWhen` must be non-empty, cannot repeat a prop, and
  may reference only a sibling scalar field. The expected string, finite number,
  or boolean must satisfy that sibling's options, pattern, and numeric bounds.
  Rich-text and array reference equality is intentionally not a condition
  language.

The former experimental `media` field was removed before the v1 contract was
stabilized: it was an alias of the image picker and never honored `accept`.
Use `image` for image URLs. A future general asset field will ship under a new
name with its own stored value and Admin control contract.

`summaryFields` must reference names in the top-level `propsSchema`, which
catches stale collapsed-row summaries during plugin evaluation. Values in
`defaultProps` and field-level `defaultValue` entries are also checked against
their declared field types, constraints, rich-text envelope, and nested array
schema. Undeclared keys in `defaultProps` and `itemDefault` are errors. A
malformed default therefore fails while the plugin module loads, rather than
after an operator inserts the first instance.

For i18n-enabled collections with a `blocks` field, the XLIFF and Gettext
translation adapters follow only props marked `translatable: true`. They
resolve nested blocks by stable block instance id and walk array `itemSchema`
values positionally. Unknown or
unloaded block types, duplicate ids, stale source text, and paths that no longer
match the registered schema are skipped rather than guessed. Keep block ids
stable across translation siblings and avoid independently reordering array
items while a translation bundle is in flight.

## Container blocks

Set `acceptsChildren: true` when `render` places the rendered child tree.
Only container blocks may declare:

- `allowedChildTypes`: unique block types or `"*"`.
- `minChildren`: non-negative integer.
- `maxChildren`: non-negative integer.

When both bounds exist, `minChildren` must not exceed `maxChildren`. Disallowed
child types and excess children block save and render; an in-progress document
can still temporarily contain too few children and receives a warning instead.

## Registration and collisions

Same-plugin duplicate block types are definition errors. Across different
plugins, the process-global registry emits a warning and keeps
registration-order candidates. A site's active snapshot uses the last active
owner, so disabling a colliding later owner restores the previous active block
instead of making the type disappear. Re-registering the same source remains
idempotent for reload and HMR.

Plugin doctor uses stable checks:

| Check ID                  | State   | Meaning                                       |
| ------------------------- | ------- | --------------------------------------------- |
| `plugins.block_invalid`   | error   | Malformed definition or props schema.         |
| `plugins.block_duplicate` | error   | Same plugin declares one type more than once. |
| `plugins.block_conflict`  | warning | Different plugins claim the same block type.  |

Run:

```bash
pnpm --silent run ops:plugins -- doctor --json
```

## Server and client boundary

`render` runs as server code and may use the third argument's read-only content
API. Interactive UI belongs in a separate `"use client"` entry exported by the
plugin package. Import that client entry through the package's own `./client`
subpath so the bundler preserves the React Server Component boundary.

The CLI generates both forms:

```bash
nexpress create block-plugin my-block
nexpress create block-plugin my-block --interactive
```

See `packages/plugins/block-callout` for a static reference and
`packages/plugins/block-newsletter` for the server/client split.
The block scaffold also emits a reusable starter pattern; see
[`plugin-patterns.md`](plugin-patterns.md) for its recursive tree and reference
contract.

## Runtime helpers

`@nexpress/blocks/contracts` exports the lightweight validation surface:

- `npValidateBlockDefinition(value)` for one definition.
- `npAnalyzeBlockDefinitions(value)` for array and duplicate analysis.
- `npBlockPropFieldTypes` for tools that need the supported field inventory.
- `npAnalyzeBlockContent(value, definitions)` for error/warning diagnostics.
- `npAnalyzeBlockProps(value, definition)` for prop-only editor boundaries.
- `npValidateBlockContentAgainstDefinitions(value, definitions)` for a
  fail-closed boundary result.

These are the same helpers used by the SDK, bootstrap, registry, and doctor.
