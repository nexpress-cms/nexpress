---
"@nexpress/web": patch
---

Page builder live preview — streaming render + theme CSS shell (#467 follow-ups).

Two upgrades to `/api/admin/preview-blocks` flagged in the
self-review of #485.

- **Streaming render via `renderToReadableStream`** — replaces
  `renderToStaticMarkup` (sync). The route now `await`s
  `stream.allReady` so async data-bound blocks (`latest-posts`,
  `stats.counter`, plugin async server components) actually
  resolve in preview instead of falling back to whatever sync
  placeholder they have. Render errors flow through the existing
  error-document path.
- **Active theme CSS in the preview shell** — the route resolves
  the active theme via `getCachedActiveTheme()` (same path the
  public renderer uses), generates token CSS via
  `generateThemeCss(DEFAULT_THEME ⨯ theme.impl.tokens)`, and
  inlines that plus the theme's `impl.css` into the preview
  document head. Theme-styled blocks (typography, theme tokens
  used as CSS variables, etc.) now look right in the iframe
  instead of falling back to system fonts only.

Backward compatible. The preview route's wire shape is unchanged
(POST blocks payload → HTML response). Themes that ship neither
`tokens` nor `css` see no difference.

Imports `react-dom/server.edge` (Web Streams, runs in Node 18+
because Web Streams are part of the Node global) instead of
`react-dom/server` because Next bundles only the legacy sync
exports from the Node entry. The route still runs in the Node
runtime — this is purely an import-path detail.
