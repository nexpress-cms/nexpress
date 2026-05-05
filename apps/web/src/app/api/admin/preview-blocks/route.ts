import { NpForbiddenError, can } from "@nexpress/core";
import { renderBlocks, type NpBlockInstance } from "@nexpress/blocks";
import { createDefaultBlockRenderContext } from "@nexpress/next";
import type { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

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
 * Caveats:
 * - Uses `renderToStaticMarkup` (sync). Data-bound blocks that
 *   return `Promise<ReactElement>` (latest-posts, stats.counter,
 *   plugin async blocks) won't await — they fall back to whatever
 *   their sync placeholder is. Streaming support is a follow-up.
 * - The output document is intentionally minimal — generic system-
 *   font + inline-style block markup only. Theme CSS isn't applied
 *   so what the operator sees here matches "blocks rendered without
 *   a wrapper template", not the final theme output. Threading the
 *   active theme's CSS into the preview shell is a follow-up
 *   tracked separately.
 *
 * Returns the HTML inline (Content-Type: text/html). Errors come
 * back as a wrapped HTML document with a banner so the iframe still
 * mounts something — the operator doesn't lose editor state because
 * the preview pane never falls into a "blank iframe" failure mode.
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

    const ctx = createDefaultBlockRenderContext();
    let bodyHtml: string;
    try {
      const tree = renderBlocks(blocks, { ctx });
      bodyHtml = tree ? renderToStaticMarkup(tree) : emptyState();
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

    return new Response(buildPreviewDocument(bodyHtml), {
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

function buildPreviewDocument(body: string): string {
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
