import * as React from "react";

import { readGridChildLayout } from "./blocks/grid.js";
import { getSharedRegistry } from "./registry.js";
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

  return (
    <div className="np-blocks">
      {pageBlocks.map((b) => renderBlock(b, registry, ctx))}
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
  parentType?: string,
): React.ReactElement {
  const definition = registry.get(instance.type);

  if (!definition) {
    return (
      <div key={instance.id} className="np-block-unknown">
        Unknown block type: {instance.type}
      </div>
    );
  }

  let rendered: React.ReactNode = null;
  if (definition.acceptsChildren && Array.isArray(instance.children)) {
    // Recurse first, then hand the rendered tree to the parent's
    // render() so the parent decides where to place children
    // (inside its grid wrapper, columns, etc.).
    rendered = instance.children.map((child) =>
      renderBlock(child, registry, ctx, instance.type),
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

  // When this block is itself a grid child, wrap it in a span div
  // so the grid layout reads the colSpan meta off `props._layout`.
  // We do this at the renderer (not inside each leaf block) so
  // every existing block reuses the same wrapper without changes.
  if (parentType === "grid") {
    const { colSpan } = readGridChildLayout(instance.props, 12);
    return (
      <div
        key={instance.id}
        className="np-block-grid-cell"
        style={{ gridColumn: `span ${colSpan} / span ${colSpan}` }}
      >
        {node}
      </div>
    );
  }

  return node;
}
