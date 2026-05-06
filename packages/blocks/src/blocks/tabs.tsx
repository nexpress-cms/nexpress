import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

interface TabItem {
  label: string;
  content: string;
}

const readItem = (raw: unknown): TabItem | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const label = typeof obj.label === "string" ? obj.label.trim() : "";
  const content = typeof obj.content === "string" ? obj.content : "";
  if (!label) return null;
  return { label, content };
};

/**
 * Tabs block — exclusive accordion using HTML5's `<details
 * name="...">` group. Browsers that honor the spec render this as
 * native exclusive accordion (only one panel open at a time, like
 * tabs); browsers that don't fall back to plain accordion (each
 * panel toggles independently). Either way the content stays
 * accessible without any client JS, so this block stays SSR-pure.
 *
 * The first tab opens by default. Content is plain text /
 * paragraphs (whitespace preserved); for richer content, compose
 * the tab itself out of multiple blocks via the page builder's
 * grid + section-header — tabs deliberately stays a leaf block in
 * v1 to keep the propsSchema simple.
 */
export const tabsBlock: NpBlockDefinition = {
  type: "tabs",
  label: "Tabs",
  description: "Exclusive accordion (one panel open at a time). Use for product features or docs sections.",
  icon: "🗂️",
  summaryFields: ["heading"],
  category: "Content",
  source: "built-in",
  keywords: ["tabs", "accordion", "sections", "expandable"],
  defaultProps: {
    heading: "How NexPress fits your stack",
    items: [
      {
        label: "Page builder",
        content:
          "Drop blocks into a 12-column grid. Per-breakpoint column spans, container contracts, multi-select bulk actions, and live preview. The same editor your operators already know — minus the migrations.",
      },
      {
        label: "Plugin SDK",
        content:
          "Seven required manifest fields and definePlugin() figures out the rest. Hooks, routes, scheduled tasks, admin extensions, and page-builder block contributions all live in the same file.",
      },
      {
        label: "Theme system",
        content:
          "Themes register with defineTheme(): tokens for colors / fonts / radii, a CSS string, and per-collection page templates. Swap a theme without redeploying the site.",
      },
    ],
  },
  propsSchema: [
    {
      name: "heading",
      label: "Heading (optional)",
      type: "text",
      defaultValue: "",
    },
    {
      name: "items",
      label: "Tabs",
      type: "array",
      itemSchema: [
        { name: "label", label: "Tab label", type: "text", required: true },
        { name: "content", label: "Panel content", type: "textarea", rows: 6 },
      ],
      itemDefault: { label: "New tab", content: "Tab body." },
    },
  ],
  render: (props) => {
    const heading = readString(props.heading, "");
    const items = Array.isArray(props.items)
      ? (props.items.map(readItem).filter(Boolean) as TabItem[])
      : [];
    // Same `name` across <details> within this group is what makes
    // them mutually exclusive in browsers that support it. The
    // hash is opportunistic — two tabs blocks on the same page
    // render with different group names so they don't fight each
    // other for "open" state.
    const groupName = `np-tabs-${items
      .map((i) => i.label)
      .join("-")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .slice(0, 32)}`;

    const sectionStyle: CSSProperties = {
      padding: "3rem 1.5rem",
      background: "#ffffff",
    };
    const wrapperStyle: CSSProperties = {
      maxWidth: "56rem",
      margin: "0 auto",
      display: "grid",
      gap: "1.5rem",
    };

    return (
      <section className="np-block-tabs" style={sectionStyle}>
        <div style={wrapperStyle}>
          {heading ? (
            <h2
              style={{
                margin: 0,
                fontSize: "clamp(1.5rem, 3vw, 2rem)",
                color: "#0f172a",
              }}
            >
              {heading}
            </h2>
          ) : null}
          {items.length === 0 ? (
            <p style={{ color: "#64748b" }}>Add tab items in the block editor.</p>
          ) : (
            <div className="np-block-tabs__group" style={{ display: "grid", gap: "0.5rem" }}>
              {items.map((item, index) => (
                <details
                  key={index}
                  name={groupName}
                  open={index === 0}
                  className="np-block-tabs__panel"
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.75rem",
                    background: "#ffffff",
                    overflow: "hidden",
                  }}
                >
                  <summary
                    style={{
                      cursor: "pointer",
                      padding: "1rem 1.25rem",
                      fontWeight: 600,
                      color: "#0f172a",
                      listStyle: "none",
                    }}
                  >
                    {item.label}
                  </summary>
                  <div
                    style={{
                      padding: "0 1.25rem 1.25rem",
                      lineHeight: 1.65,
                      color: "#334155",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {item.content}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  },
};
