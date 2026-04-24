# Render contributions

Plugins can inject tags into the public site's `<head>` and body by
handling the `render:beforePage` hook. The host fires the hook on every
site page render, collects contributions from every plugin, and emits
the returned tags as real DOM elements.

No plugin React code runs on the site — plugins describe what they want
rendered, and the host renders it. Same principle as the admin
extension model.

---

## Handler shape

```ts
import { definePlugin, type NxRenderContribution } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    /* … */
    capabilities: ["hooks:render" /* , … */],
  },
  hooks: {
    "render:beforePage": ({ data }): NxRenderContribution | undefined => {
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

The hook receives `{ collection, slug, document }` in `data`. Return
`undefined` (or `null`) to contribute nothing — plugins often only want
to act on specific collections. Throw to fail the render.

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
2. Calls `runHookAndCollect<NxRenderContribution>("render:beforePage", {
   collection, slug, document })` — fires every registered handler in
   registration order, collects non-null returns.
3. Flattens all `head` and `bodyEnd` arrays into two lists.
4. Renders `<RenderHead>` and `<RenderBodyEnd>` inside the page tree;
   React places them correctly.

Plugins compose: two plugins that both emit `<meta name="description">`
both get rendered. The last tag in the `<head>` usually wins for
user-agent dedup — declare plugin load order accordingly.

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
