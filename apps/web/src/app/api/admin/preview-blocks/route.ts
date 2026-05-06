import { NpForbiddenError, can, getTheme } from "@nexpress/core";
import { renderBlocks, type NpBlockInstance } from "@nexpress/blocks";
import { createDefaultBlockRenderContext } from "@nexpress/next";
import { generateThemeCss } from "@nexpress/theme";
import type { NextRequest } from "next/server";
// `react-dom/server` in Node runtime exports the legacy sync APIs;
// `react-dom/server.edge` exports the streaming `renderToReadableStream`
// which is what we need to await async server components in the
// preview pipeline. Next bundles this fine in a Node API route — the
// edge variant works in Node 18+ since it depends only on Web Streams,
// which are part of the Node global.
import { renderToReadableStream } from "react-dom/server.edge";

import { getCachedActiveTheme } from "@/lib/cached-theme";
import { requireAuth } from "@/lib/auth-helpers";
import { ensureFor } from "@/lib/init-core";

/**
 * Issue #467 — server-rendered live preview for the page-builder.
 *
 * Accepts an unsaved blocks payload from the admin editor and
 * returns a standalone HTML document the editor's iframe can mount
 * via `srcDoc`. Doing the render server-side (instead of client-
 * side emulation) means plugin-contributed blocks resolve through
 * the real `renderBlocks` path — no need to ship server `render`
 * functions across the server → client boundary.
 *
 * Render path:
 * - `renderToReadableStream` (#467 follow-up). Async data-bound
 *   blocks (latest-posts, stats.counter, plugin async blocks) are
 *   awaited via `stream.allReady` so what the operator sees in the
 *   preview matches what the public page would render.
 *
 * Shell:
 * - The active theme's `impl.css` + `generateThemeCss(impl.tokens)`
 *   are inlined into the preview document head, so theme-styled
 *   blocks (rich text typography, theme tokens used as CSS
 *   variables, etc.) actually look right in preview. Multi-site
 *   builds inherit whichever theme the current site context resolves
 *   to (`getCachedActiveTheme` walks the same path the public
 *   renderer uses).
 *
 * Errors come back as a wrapped HTML document with a banner so the
 * iframe still mounts something — the operator doesn't lose editor
 * state because the preview pane never falls into a "blank iframe"
 * failure mode.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureFor("plugins");
    const user = await requireAuth(request);
    if (!can(user, "admin.manage")) {
      throw new NpForbiddenError("preview-blocks", "render");
    }

    const body = (await request.json()) as { blocks?: unknown };
    const blocks = Array.isArray(body.blocks)
      ? (body.blocks as NpBlockInstance[])
      : [];

    const themeStyle = await resolveThemeStyle();

    const ctx = createDefaultBlockRenderContext();
    let bodyHtml: string;
    try {
      // `previewMarkers: true` wraps each rendered block with a
      // `<div data-np-block-id="…" style="display: contents">` so
      // the editor can scroll-to / highlight the focused row in
      // the iframe. The wrapper is layout-neutral (display:
      // contents); production renders never enable this.
      const tree = renderBlocks(blocks, { ctx, previewMarkers: true });
      bodyHtml = tree ? await renderTreeToHtml(tree) : emptyState();
    } catch (renderError) {
      return new Response(
        buildErrorDocument(
          renderError instanceof Error
            ? renderError.message
            : "Block render failed.",
        ),
        {
          status: 200, // Don't 5xx — iframe still needs to mount.
          headers: previewHeaders(),
        },
      );
    }

    return new Response(buildPreviewDocument(bodyHtml, themeStyle), {
      headers: previewHeaders(),
    });
  } catch (error) {
    if (error instanceof NpForbiddenError) {
      return new Response(buildErrorDocument("Forbidden"), {
        status: 403,
        headers: previewHeaders(),
      });
    }
    return new Response(
      buildErrorDocument(
        error instanceof Error ? error.message : "Preview unavailable.",
      ),
      {
        status: 500,
        headers: previewHeaders(),
      },
    );
  }
}

// Streams the tree to an HTML string. `onAllReady` waits for every
// suspended async server component before flushing; that's what
// lets data-bound blocks (`latest-posts`, plugin async blocks)
// actually appear in the preview instead of falling back to their
// sync placeholder. Render errors inside the tree get caught here
// and re-thrown so the outer try/catch maps them to the error
// document.
async function renderTreeToHtml(tree: React.ReactElement): Promise<string> {
  let renderError: unknown = null;
  const stream = await renderToReadableStream(tree, {
    onError(error) {
      renderError = error;
    },
  });
  // Wait for all Suspense boundaries to resolve. `allReady` is a
  // Promise on the stream object, not a method — `await stream` by
  // itself would throw because ReadableStream isn't thenable.
  await stream.allReady;
  if (renderError) {
    throw renderError;
  }
  // Drain the stream into a string. Response is the simplest text
  // accumulator that handles backpressure; we don't have to manage
  // chunks manually.
  return await new Response(stream).text();
}

interface PreviewThemeStyle {
  inlineCss: string;
}

// Resolves the active theme for the current site context and
// concatenates its tokens-CSS + theme-owned `impl.css` into a
// single string for the preview shell. Returns an empty string
// when no theme is registered (test setups, fresh installs).
async function resolveThemeStyle(): Promise<PreviewThemeStyle> {
  try {
    const theme = await getCachedActiveTheme();
    if (!theme) return { inlineCss: "" };
    // `getTheme` does the layered merge:
    //   DEFAULT_THEME ⊕ active theme's impl.tokens ⊕ DB override.
    // It's the same call the public site layout makes, so preview
    // and public render resolve to identical tokens for the same
    // active theme. The previous shallow `{...DEFAULT_THEME,
    // ...impl.tokens}` form blew away sub-objects (a theme that
    // only set `colors.primary` lost every other color), so the
    // preview iframe rendered with `--np-color-destructive: undefined`
    // and similar — visible as missing form-error styling.
    const tokens = await getTheme();
    const tokensCss = generateThemeCss(tokens);
    const themeCss = theme.impl.css ?? "";
    // Order: tokens first (so theme-owned CSS can use them as
    // variables), theme CSS second.
    return { inlineCss: `${tokensCss}\n${themeCss}` };
  } catch {
    // Defensive — preview shouldn't hard-fail if the theme lookup
    // throws (e.g. site context missing on a non-request thread).
    return { inlineCss: "" };
  }
}

function previewHeaders(): HeadersInit {
  return {
    "Content-Type": "text/html; charset=utf-8",
    // Prevent the browser from caching preview output — the editor
    // refetches on every blocks-change anyway, and a stale 304
    // would defeat the live-update loop.
    "Cache-Control": "no-store",
  };
}

function emptyState(): string {
  return `<div style="padding:3rem 1.5rem;text-align:center;color:#94a3b8;font-style:italic;">No blocks to preview yet. Add a block in the editor to see it here.</div>`;
}

function buildPreviewDocument(body: string, theme: PreviewThemeStyle): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Block preview</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #ffffff; line-height: 1.5; }
  img { max-width: 100%; height: auto; display: block; }
  a { color: inherit; }
</style>
${theme.inlineCss ? `<style data-np-theme>${theme.inlineCss}</style>` : ""}
</head>
<body>
${body}
</body>
</html>`;
}

function buildErrorDocument(message: string): string {
  // Inline-style error banner so the iframe always has *something*
  // to mount — preserving editor state even when the render
  // pipeline blew up. The operator sees the failure context and
  // can keep editing.
  const escaped = message.replace(/[&<>"]/g, (char) =>
    char === "&"
      ? "&amp;"
      : char === "<"
        ? "&lt;"
        : char === ">"
          ? "&gt;"
          : "&quot;",
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Preview error</title>
<style>
  body { margin: 0; padding: 2rem 1.5rem; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #fef2f2; color: #7f1d1d; }
  h1 { margin: 0 0 0.5rem; font-size: 1.05rem; }
  pre { margin: 0; padding: 0.75rem; background: #fee2e2; border: 1px solid rgba(127, 29, 29, 0.2); border-radius: 0.5rem; white-space: pre-wrap; word-break: break-word; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>Preview render failed</h1>
<pre>${escaped}</pre>
</body>
</html>`;
}

export const dynamic = "force-dynamic";
