import * as React from "react";

import { readGridChildLayout } from "./blocks/grid.js";
import { getSharedRegistry } from "./registry.js";
import { isBlockSourceActive } from "./source.js";
import type {
  NpBlockDefinition,
  NpBlockInstance,
  NpBlockRegistry,
  NpBlockRenderContext,
  NpPageBlocks,
} from "./types.js";

export interface NpRenderBlocksOptions {
  /**
   * Override the block lookup. Defaults to the shared module-scoped
   * registry — plugins register into it at boot, so their blocks
   * resolve here automatically. Pass a custom registry only when you
   * want to scope renders to a strict subset (tests, sandboxed
   * previews).
   */
  registry?: NpBlockRegistry;
  /**
   * Read-only data ctx forwarded as the third arg to each block's
   * `render(props, children, ctx)`. Optional — leaf blocks (text,
   * image, hero, callout, embed) don't need it and the renderer
   * passes `undefined` through unchanged. Data-bound blocks
   * (`stats.counter`, custom feeds) handle the missing ctx by
   * rendering a placeholder.
   *
   * The default builder lives in `@nexpress/next`'s server entry
   * (`createDefaultBlockRenderContext`) — kept out of this package
   * so importing `@nexpress/blocks` from a client bundle never drags
   * `@nexpress/core` along the graph. See `next.config.ts`'s
   * `transpilePackages: ["@nexpress/blocks", ...]` — that puts blocks
   * on the client side of the boundary, so it must not reach into
   * server-only modules even via dynamic import.
   */
  ctx?: NpBlockRenderContext;
  /**
   * When true, wraps each rendered block instance with a marker
   * `<div data-np-block-id="…">` so the page-builder's iframe-
   * preview can find a specific block in the rendered DOM (for
   * selection highlight + scroll-to). The wrapper uses
   * `display: contents` so it doesn't change layout — it's
   * purely a DOM landmark, invisible to layout and to the
   * accessibility tree's content flow.
   *
   * Off by default. Production renders never enable this; only
   * the preview API route flips it on.
   */
  previewMarkers?: boolean;
}

/**
 * Walk a tree of block instances and render the React tree.
 * Container blocks (`acceptsChildren: true`) get their rendered
 * children passed in as the second arg of `definition.render`;
 * the renderer itself handles the recursion + the grid-child
 * `_layout.colSpan` wrapping so individual block renders stay
 * unaware of where they're placed.
 *
 * The legacy `renderBlocks(pageBlocks, registry)` signature is kept for
 * back-compat — passing a registry directly still works, the new
 * options-object form is preferred for new call sites that want to
 * supply a render ctx.
 */
export function renderBlocks(
  pageBlocks: NpPageBlocks,
  optionsOrRegistry?: NpRenderBlocksOptions | NpBlockRegistry,
): React.ReactElement | null {
  if (pageBlocks.length === 0) {
    return null;
  }

  const options: NpRenderBlocksOptions = isRegistry(optionsOrRegistry)
    ? { registry: optionsOrRegistry }
    : (optionsOrRegistry ?? {});
  const registry = options.registry ?? getSharedRegistry();
  const ctx = options.ctx;
  const previewMarkers = options.previewMarkers ?? false;

  return (
    <div className="np-blocks">
      {pageBlocks.map((b) => renderBlock(b, registry, ctx, undefined, previewMarkers))}
    </div>
  );
}

function isRegistry(
  value: NpRenderBlocksOptions | NpBlockRegistry | undefined,
): value is NpBlockRegistry {
  return (
    !!value &&
    typeof (value as { register?: unknown }).register === "function" &&
    typeof (value as { get?: unknown }).get === "function"
  );
}

/**
 * Renders one block with a built-in error boundary so a thrown handler
 * can't crash the rest of the page.
 *
 * The wrapper is async so it covers BOTH error shapes block authors hit:
 *   - sync throws inside `render(props, children, ctx)` itself
 *   - rejections from a returned `Promise<ReactElement>` (the RSC pattern
 *     for data-bound blocks like `stats.counter` / `latest-posts`)
 *
 * Without this, every data-bound block had to wrap its body in a manual
 * try/catch and emit its own placeholder — that boilerplate is now gone.
 *
 * In dev (`NODE_ENV !== "production"`) the placeholder shows the block
 * type + the error message, so authors get a fast visual signal. In prod
 * it renders an empty `<div>` so a single broken block doesn't visually
 * destroy a published page; the error still flows through React's
 * console + any RSC error reporter installed by the host.
 */
async function SafeBlock({
  definition,
  props,
  children,
  ctx,
}: {
  definition: NpBlockDefinition;
  props: Record<string, unknown>;
  children?: React.ReactNode;
  ctx: NpBlockRenderContext | undefined;
}): Promise<React.ReactElement> {
  try {
    const result = definition.render(props, children, ctx);
    const node = await result;
    return <>{node}</>;
  } catch (error) {
    // Always log so server-side observability picks it up — the host's
    // logger is wired through console by default and replaced with a
    // structured logger in production. We don't dynamic-import
    // `@nexpress/core`'s logger here because that would drag the server-
    // only package back into the client graph (the same trap that broke
    // the build in PR #465's earlier round). console.error is fine —
    // Next pipes it into its own error reporter.
    // eslint-disable-next-line no-console
    console.error(`[blocks] render failed for "${definition.type}"`, error);

    const isProd = typeof process !== "undefined" && process.env.NODE_ENV === "production";
    if (isProd) {
      return <div className="np-block-error" data-block-type={definition.type} hidden />;
    }
    const message = error instanceof Error ? error.message : String(error);
    return (
      <div
        className="np-block-error"
        data-block-type={definition.type}
        style={{
          margin: "1rem 0",
          padding: "0.875rem 1rem",
          borderRadius: "0.5rem",
          border: "1px dashed #fca5a5",
          backgroundColor: "#fef2f2",
          color: "#991b1b",
          fontSize: "0.85rem",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      >
        Block <strong>{definition.type}</strong> failed to render: {message}
      </div>
    );
  }
}

function renderBlock(
  instance: NpBlockInstance,
  registry: NpBlockRegistry,
  ctx: NpBlockRenderContext | undefined,
  parentType: string | undefined,
  previewMarkers: boolean,
): React.ReactElement {
  const definition = registry.get(instance.type);

  if (!definition) {
    return (
      <div key={instance.id} className="np-block-unknown">
        Unknown block type: {instance.type}
      </div>
    );
  }

  // Phase F.4 — when ctx supplies the active-source set and the
  // block's `source` isn't in it, the block came from an inactive
  // theme/plugin (e.g. operator switched themes; old instance
  // remains in the page document). Render a "from inactive
  // theme" placeholder instead of the block. Without ctx
  // (legacy callers), this guard is skipped — all registered
  // blocks render unconditionally.
  if (ctx?.activeSources) {
    const active = isBlockSourceActive(definition.source, ctx.activeSources);
    if (!active) {
      return (
        <div
          key={instance.id}
          className="np-block-stale"
          data-block-type={instance.type}
          style={{
            margin: "0.5rem 0",
            padding: "0.625rem 0.875rem",
            borderRadius: "0.375rem",
            border: "1px dashed rgba(148, 163, 184, 0.5)",
            backgroundColor: "rgba(241, 245, 249, 0.5)",
            color: "rgba(71, 85, 105, 0.85)",
            fontSize: "0.8125rem",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          Block <strong>{instance.type}</strong> is from a theme or plugin
          that isn't active for this site.
        </div>
      );
    }
  }

  let rendered: React.ReactNode = null;
  if (definition.acceptsChildren && Array.isArray(instance.children)) {
    // Recurse first, then hand the rendered tree to the parent's
    // render() so the parent decides where to place children
    // (inside its grid wrapper, columns, etc.).
    rendered = instance.children.map((child) =>
      renderBlock(child, registry, ctx, instance.type, previewMarkers),
    );
  }

  // SafeBlock is itself an async server component — it owns the try/catch
  // for both sync throws and Promise rejections from `definition.render`.
  // Returning the JSX element means React picks up the async resolution
  // through Suspense; the boundary stays at this single seam instead of
  // each block reimplementing it.
  const node = (
    <SafeBlock
      key={instance.id}
      definition={definition}
      props={instance.props}
      children={rendered}
      ctx={ctx}
    />
  );

  // Optional preview marker. `display: contents` keeps the wrapper
  // out of the layout / box flow — the rendered block looks
  // identical to a non-marker render, but a `querySelector` from
  // the editor's iframe parent can find it by id. Marker is added
  // BEFORE the grid-cell wrap so the cell's grid-column rule
  // applies to the actual visible element, not the marker.
  //
  // Empty-container fallback: when the block declares
  // `acceptsChildren` but has no children yet (operator just added
  // a Grid via the Doc canvas, hasn't dropped anything inside), the
  // real render emits a 0-height wrapper — nothing to hover, so the
  // operator can't reach the rail to delete it or open settings. In
  // preview-marker mode we substitute a dashed placeholder so the
  // marker has a real layout box. Non-preview renders are
  // unaffected; this is editor scaffolding, not public output.
  const isEmptyContainer =
    previewMarkers &&
    Boolean(definition.acceptsChildren) &&
    (!Array.isArray(instance.children) || instance.children.length === 0);

  const markedNode = previewMarkers ? (
    isEmptyContainer ? (
      <div
        key={instance.id}
        data-np-block-id={instance.id}
        data-np-block-type={instance.type}
        data-np-empty-container="true"
        style={{
          display: "block",
          minHeight: "80px",
          border: "2px dashed rgba(100, 116, 139, 0.35)",
          borderRadius: "8px",
          padding: "1.5rem 1rem",
          margin: "0.5rem 0",
          color: "rgba(71, 85, 105, 0.8)",
          textAlign: "center",
          fontSize: "0.85rem",
        }}
      >
        Empty {definition.label ?? instance.type} — switch to Page builder to drop blocks inside.
      </div>
    ) : (
      <div
        key={instance.id}
        data-np-block-id={instance.id}
        data-np-block-type={instance.type}
        style={{ display: "contents" }}
      >
        {node}
      </div>
    )
  ) : (
    node
  );

  // When this block is itself a grid child, wrap it in a cell
  // div whose `--np-cell-span*` CSS custom properties carry the
  // per-breakpoint spans. The grid block's scoped `<style>` block
  // applies them through media queries.
  if (parentType === "grid") {
    const { colSpan, mdColSpan, lgColSpan } = readGridChildLayout(
      instance.props,
      12,
    );
    // Compose the inline style with the base span fixed and the
    // optional md/lg overrides only when set — leaving them
    // unset keeps the CSS fallback chain (lg → md → base) intact.
    const cellStyle: Record<string, string | number> = {
      "--np-cell-span": colSpan,
    };
    if (mdColSpan !== undefined) cellStyle["--np-cell-span-md"] = mdColSpan;
    if (lgColSpan !== undefined) cellStyle["--np-cell-span-lg"] = lgColSpan;
    return (
      <div
        key={instance.id}
        className="np-block-grid-cell"
        style={cellStyle as React.CSSProperties}
      >
        {markedNode}
      </div>
    );
  }

  return markedNode;
}
