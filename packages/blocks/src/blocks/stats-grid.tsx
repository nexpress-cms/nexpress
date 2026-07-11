import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

interface StatItem {
  value: string;
  label: string;
  hint?: string;
}

const readItem = (raw: unknown): StatItem | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const value = typeof obj.value === "string" ? obj.value.trim() : "";
  const label = typeof obj.label === "string" ? obj.label.trim() : "";
  if (!value || !label) return null;
  return {
    value,
    label,
    hint: typeof obj.hint === "string" && obj.hint.length > 0 ? obj.hint : undefined,
  };
};

/**
 * Stats strip — N number+label cells side by side. Distinct from
 * the plugin's `stats.counter`, which queries a live document
 * count; this block is for static, opinionated headline numbers
 * (years in business, % uptime, customers shipped, etc.). The
 * value field is `string` not `number` so authors can include
 * suffixes ("99.9%", "10k+", "$2.4M").
 */
export const statsGridBlock: NpBlockDefinition = {
  type: "stats-grid",
  label: "Stats grid",
  description: "Numbers + labels in a horizontal strip. For trust signals and headline metrics.",
  icon: "BarChart3",
  iconKind: "lucide",
  summaryFields: ["heading"],
  category: "Content",
  source: "built-in",
  keywords: ["stats", "metrics", "numbers", "trust", "headline"],
  defaultProps: {
    heading: "",
    items: [
      { value: "99.9%", label: "Uptime", hint: "Across 30 days" },
      { value: "12k+", label: "Sites in production" },
      { value: "<50ms", label: "p50 page render" },
      { value: "5min", label: "From clone to deploy" },
    ],
  },
  propsSchema: [
    {
      name: "heading",
      label: "Heading (optional)",
      type: "text",
      translatable: true,
      defaultValue: "",
      description: "Leave blank to render just the strip without a heading.",
    },
    {
      name: "items",
      label: "Stats",
      type: "array",
      itemSchema: [
        {
          name: "value",
          label: "Value",
          type: "text",
          translatable: false,
          required: true,
          description: "Free text — '99.9%', '10k+', '$2.4M' all work.",
        },
        { name: "label", label: "Label", type: "text", translatable: true, required: true },
        { name: "hint", label: "Hint (optional)", type: "text", translatable: true },
      ],
      itemDefault: { value: "100%", label: "Coverage" },
    },
  ],
  render: (props) => {
    const heading = readString(props.heading, "");
    const items = Array.isArray(props.items)
      ? (props.items.map(readItem).filter(Boolean) as StatItem[])
      : [];

    const sectionStyle: CSSProperties = {
      padding: "3rem 1.5rem",
      background: "var(--np-color-background, #ffffff)",
    };
    const wrapperStyle: CSSProperties = {
      maxWidth: "72rem",
      margin: "0 auto",
      display: "grid",
      gap: "2rem",
    };
    const gridStyle: CSSProperties = {
      display: "grid",
      gap: "1.5rem",
      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
    };

    return (
      <section className="np-block-stats-grid" style={sectionStyle}>
        <div style={wrapperStyle}>
          {heading ? (
            <h2
              style={{
                margin: 0,
                textAlign: "center",
                fontSize: "clamp(1.5rem, 3vw, 2rem)",
                color: "var(--np-color-foreground, #0f172a)",
              }}
            >
              {heading}
            </h2>
          ) : null}
          {items.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--np-color-muted-foreground, #64748b)" }}>
              Add stat items in the block editor.
            </p>
          ) : (
            <div style={gridStyle}>
              {items.map((item, index) => (
                <div
                  key={index}
                  className="np-block-stats-grid__cell"
                  style={{
                    display: "grid",
                    gap: "0.35rem",
                    textAlign: "center",
                    padding: "1rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "clamp(2.25rem, 5vw, 3rem)",
                      fontWeight: 700,
                      lineHeight: 1.1,
                      color: "var(--np-color-primary, #6366f1)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {item.value}
                  </span>
                  <span
                    style={{
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      color: "var(--np-color-foreground, #0f172a)",
                    }}
                  >
                    {item.label}
                  </span>
                  {item.hint ? (
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--np-color-muted-foreground, #64748b)",
                      }}
                    >
                      {item.hint}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  },
};
