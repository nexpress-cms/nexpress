# Render contributions

Plugins inject tags into the public site's `<head>` and body through one
hook: `render:beforePage`. The returned contribution has separate `head`
and `bodyEnd` arrays, so a second lifecycle hook is not needed. The host
fires the hook on every site page render, validates and collects every
plugin result, and emits the tags as real DOM elements.

No plugin React code runs on the site — plugins describe what they want
rendered, and the host renders it. Same principle as the admin
extension model.

---

## Handler shape

```ts
import { definePlugin, type NpRenderContribution } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "render-example",
    version: "0.1.0",
    name: "Render example",
    description: "Adds document metadata and a body-end script.",
    author: { name: "Example author" },
    license: "MIT",
    nexpress: { minVersion: "0.3.0" },
  },
  hooks: {
    "render:beforePage": ({ data }): NpRenderContribution | undefined => {
      const doc = data.document as Record<string, unknown>;
      return {
        head: [
          { tag: "meta", attrs: { name: "description", content: String(doc.excerpt ?? "") } },
          { tag: "link", attrs: { rel: "canonical", href: `/blog/${String(doc.slug)}` } },
        ],
        bodyEnd: [
          { tag: "script", attrs: { src: "https://plausible.io/js/script.js", async: "" } },
        ],
      };
    },
  },
});
```

The hook receives a typed `{ collection, slug, document }` value in
`data`, and TypeScript constrains its return to `NpRenderContribution`,
`null`, or `undefined` (including async forms). Return `undefined` or
`null` to contribute nothing — plugins often only want to act on specific
collections. Throwing fails that plugin contribution without failing the
page render.

`definePlugin()` rejects unknown hook names, string handlers, and malformed
registration descriptors during module evaluation. The host also validates
the value after each render handler returns, so JavaScript plugins or casted
values with unsupported tags, non-string attributes, or misspelled fields are
logged and skipped before any markup is emitted.

---

## Entry shapes

### `head` — hoisted into `<head>`

- `{ tag: "meta", attrs }` — arbitrary meta tag.
- `{ tag: "link", attrs }` — stylesheet, canonical, preload, etc.
- `{ tag: "script", attrs?, children? }` — inline or external script.
- `{ tag: "style", attrs?, children }` — inline styles.

### `bodyEnd` — appended right before `</body>`

- `{ tag: "script", attrs?, children? }` — analytics trackers, third-party
  widget bootstraps.
- `{ tag: "noscript", children }` — fallbacks paired with scripts.

React 19 head hoisting handles `meta` / `link` / `title` / `style`
placement automatically regardless of where the host renders them. For
`bodyEnd`, render the host's `<RenderBodyEnd>` component near the end of
your page tree so tag order is preserved.

---

## What the host does

1. Resolves the document for the current URL (`pages/:slug` or
   `posts/:slug`).
2. Calls `runHookAndCollect<NpRenderContribution>("render:beforePage", data)`
   with `{ collection, slug, document }`; this fires every registered handler
   in registration order and validates every non-null return.
3. Flattens all `head` and `bodyEnd` arrays into two lists.
4. Renders `<RenderHead>` and `<RenderBodyEnd>` inside the page tree;
   React places them correctly.

Plugins compose: two plugins that both emit `<meta name="description">`
both get rendered. The last tag in the `<head>` usually wins for
user-agent dedup — declare plugin load order accordingly.

There is no `render:afterPage` hook. Use `bodyEnd` on the
`render:beforePage` result for analytics collectors and other end-of-body
scripts.

---

## Capabilities

- Requires `hooks:render` in the plugin manifest, enforced at
  `loadPlugins` time.
- The hook's `data.document` is read-only — mutations don't round-trip.

---

## Security

`<script>` / `<style>` `children` are injected via
`dangerouslySetInnerHTML`. `attrs` values are React-escaped. Plugins are
trusted code in v1 (no sandbox) — code-review before installing.

For untrusted script URLs, prefer `attrs.src` over inline `children`
and serve the script from a domain you control.
