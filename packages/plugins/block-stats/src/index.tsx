import type { CSSProperties } from "react";

import type { NpBlockDefinition, NpBlockRenderContext } from "@nexpress/blocks";
import { definePlugin } from "@nexpress/plugin-sdk";

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

async function StatsCounterBody({
  collection,
  label,
  ctx,
}: {
  collection: string;
  label: string;
  ctx: NpBlockRenderContext;
}) {
  // No try/catch — `renderBlocks` wraps every block in `SafeBlock`, which
  // catches both sync throws AND awaited rejections from a `Promise<ReactElement>`
  // return value. A failed `ctx.content.count` (collection doesn't exist,
  // DB unreachable, etc.) surfaces as the framework's red error placeholder
  // in dev and a hidden empty div in prod — the page itself still ships.
  const count = await ctx.content.count(collection);

  const wrapperStyle: CSSProperties = {
    display: "inline-flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "1.25rem 1.5rem",
    margin: "1rem 0",
    borderRadius: "0.75rem",
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    minWidth: "12rem",
  };

  const valueStyle: CSSProperties = {
    fontSize: "2.25rem",
    fontWeight: 700,
    lineHeight: 1.1,
    color: "#0f172a",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div className="np-block-stats" style={wrapperStyle}>
      <span style={valueStyle}>{formatNumber(count)}</span>
      <span style={{ fontSize: "0.875rem", color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
    </div>
  );
}

const statsCounterBlock: NpBlockDefinition = {
  type: "stats.counter",
  label: "Stats counter",
  description: "Live document count for any collection (server-rendered).",
  icon: "🔢",
  defaultProps: {
    collection: "posts",
    label: "Total posts",
  },
  propsSchema: [
    {
      name: "collection",
      label: "Collection",
      type: "collection",
      required: true,
      defaultValue: "posts",
    },
    {
      name: "label",
      label: "Display label",
      type: "text",
      defaultValue: "Total posts",
    },
  ],
  render: (props, _children, ctx) => {
    const collection = readString(props.collection, "posts");
    const label = readString(props.label, "Total posts");
    if (!ctx) {
      // No ctx supplied (legacy renderer call site) — fall back to a
      // static placeholder rather than throwing. Matches what the host
      // renders for unknown blocks.
      return (
        <div className="np-block-stats np-block-stats--no-ctx">
          <span>{label}: data ctx unavailable</span>
        </div>
      );
    }
    return <StatsCounterBody collection={collection} label={label} ctx={ctx} />;
  },
};

export const statsBlockPlugin = definePlugin({
  manifest: {
    id: "block-stats",
    version: "0.1.0",
    name: "Stats blocks",
    description: "Adds a live stats-counter block.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  blocks: [statsCounterBlock],
});

export default statsBlockPlugin;
