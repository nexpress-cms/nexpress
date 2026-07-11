# Plugin page-builder patterns

Plugins can contribute reusable page-builder compositions with
`definePlugin({ patterns: [...] })`. A pattern is a validated tree of block
instances that Admin clones with fresh instance IDs whenever an operator
inserts it.

## Quickstart

```tsx
import type { NpBlockDefinition, NpPatternDefinition } from "@nexpress/blocks";
import { definePlugin } from "@nexpress/plugin-sdk";

const noticeBlock: NpBlockDefinition = {
  type: "acme.notice",
  label: "Notice",
  defaultProps: { message: "Heads up" },
  propsSchema: [{ name: "message", label: "Message", type: "textarea", translatable: true }],
  render: ({ message }) => <aside>{typeof message === "string" ? message : ""}</aside>,
};

const patterns = [
  {
    id: "acme.notice-section",
    label: "Notice section",
    description: "A ready-to-edit notice.",
    category: "section",
    blocks: [
      {
        id: "template-notice",
        type: "acme.notice",
        props: { message: "Replace this with the important notice." },
      },
    ],
  },
] satisfies NpPatternDefinition[];

export default definePlugin({
  manifest: {
    id: "acme-notice",
    version: "0.1.0",
    name: "Acme notice",
    description: "Adds a notice block and starter pattern.",
    author: { name: "Acme" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  blocks: [noticeBlock],
  patterns,
});
```

Do not invent a runtime source ID. `source` is optional on
`NpPatternDefinition`; bootstrap replaces it with `plugin:<manifest.id>` before
registration. The registered `NpPattern` type requires that concrete source so
Admin can group and filter contributions reliably.

`definePlugin()` also derives `manifest.provides.patterns` from the pattern IDs.
The manifest stays metadata-only; block trees remain on the plugin definition.

## Pattern contract

Each definition supports only these fields:

| Field         | Contract                                                                |
| ------------- | ----------------------------------------------------------------------- |
| `id`          | Required, unique within the plugin, up to 128 identifier characters.    |
| `label`       | Required operator-facing label, up to 100 characters.                   |
| `blocks`      | Required non-empty `NpBlockInstance[]` tree.                            |
| `description` | Optional non-empty description, up to 500 characters.                   |
| `preview`     | Optional non-empty preview path or URL, up to 2,048 characters.         |
| `category`    | Optional non-empty grouping label, up to 100 characters.                |
| `source`      | Optional while authoring; overwritten with the concrete source at boot. |

Unknown top-level fields are errors. Pattern and block instance IDs must start
with a letter or number and may contain letters, numbers, `.`, `_`, and `-`.

Every recursive block instance has the exact wire shape used by page-builder
documents:

```ts
{
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: NpBlockInstance[];
}
```

`props` must contain finite, serializable primitives, arrays, and plain objects.
Functions, class instances, circular values, circular block trees, unsupported
instance fields, duplicate ids anywhere in the tree, and trees deeper than 32
levels are rejected before Admin can see them. Patterns use the same validator
as persisted collection content; see [`block-content.md`](block-content.md).

## Block references

Shape validation runs while `definePlugin()` evaluates. Full block-reference
validation runs in bootstrap, when the host knows the enabled contribution set:

- Plugin patterns may use built-in blocks and blocks from enabled plugins.
- Theme patterns may additionally use blocks from their own theme.
- A plugin pattern must not depend on a theme-only block because the pattern is
  visible independently of which theme is active.

All blocks register before any pattern, so a valid cross-plugin reference does
not depend on configuration order. An unavailable `type` fails boot explicitly
instead of reaching Admin and disappearing during insertion. The registry
repeats the reference check for callers that bypass bootstrap.

## Validation and collisions

The same contract is enforced at four boundaries:

1. `definePlugin()` validates metadata, recursive instances, and same-plugin IDs.
2. `@nexpress/next` validates references before loading plugins.
3. `registerPattern()` validates the concrete source and registered block types.
4. `nexpress ops plugins doctor --json` reports static contract and ownership issues.

Same-plugin duplicate IDs are errors. Different plugins still use the shared
last-loaded-wins registry, but both static doctor and the runtime registry emit
operator-visible ownership diagnostics. Namespace IDs with the contributor,
for example `acme.notice-section`.

| Check ID                    | State   | Meaning                                                 |
| --------------------------- | ------- | ------------------------------------------------------- |
| `plugins.pattern_invalid`   | error   | Malformed tree or reference to an unavailable block.    |
| `plugins.pattern_duplicate` | error   | One plugin declares the same pattern ID more than once. |
| `plugins.pattern_conflict`  | warning | Different plugins claim the same pattern ID.            |

Run:

```bash
pnpm --silent run ops:plugins -- doctor --json
```

The report and `inspect <plugin-id>` output include both definition-level and
live runtime pattern inventories.

## Scaffold and example

`nexpress create block-plugin <slug>` now generates one block plus a source-less
starter pattern that uses it. `packages/plugins/block-callout` is the bundled
reference implementation.

The lightweight public helpers live at `@nexpress/blocks/contracts`:

- `npValidatePatternDefinition(value)` validates an author contribution.
- `npValidatePattern(value)` additionally requires a concrete source.
- `npAnalyzePatternDefinitions(value, { knownBlockTypes? })` diagnoses lists,
  duplicate IDs, and contextual block references.
