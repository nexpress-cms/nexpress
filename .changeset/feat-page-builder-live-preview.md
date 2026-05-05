---
"@nexpress/admin": minor
---

Page builder live preview surface (#467, "Server-rendered live preview").

Third PR off the #467 phase 2-4 queue. The editor now ships an
optional iframe preview that re-renders on every blocks change,
so operators can see what their unsaved tree looks like without
saving + reloading the public page.

- New `POST /api/admin/preview-blocks` route (in the reference
  app). Accepts an unsaved blocks payload, runs `renderBlocks`
  + `renderToStaticMarkup` server-side, returns a standalone
  HTML document. `admin.manage` capability required. Render
  errors come back as a wrapped HTML doc with a banner — the
  iframe still mounts something, the operator never falls into
  a "blank preview" state and editor state is preserved.
- New `PreviewPanel` client component in `@nexpress/admin`.
  Posts the editor's blocks (debounced 500 ms), drops the
  response into an `iframe srcDoc`, renders inside a sandbox
  (`allow-same-origin` only). Three viewport widths (Desktop /
  Tablet / Mobile) so operators can spot mobile-only layout
  issues without resizing the browser.
- New "Show preview" / "Hide preview" toggle in the block-page
  editor toolbar. State persists in `localStorage` so an
  operator who keeps it open across sessions doesn't need to
  flip it on every page load. Defaults to off — preview costs
  an extra server round trip per edit and not every session
  needs it.

Caveats (tracked as follow-ups):

- `renderToStaticMarkup` is sync, so data-bound blocks that
  return `Promise<ReactElement>` (latest-posts, stats.counter,
  plugin async blocks) won't await — they fall back to whatever
  their sync placeholder is. Streaming support via
  `renderToReadableStream` is the obvious upgrade.
- The preview document uses a generic system-font shell, not
  the active theme's CSS. Threading the active theme into the
  preview shell is a separate item on the #467 roadmap.

No wire-format changes. The editor's existing save path and the
public render path are untouched.
