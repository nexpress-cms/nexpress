import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

interface FeatureItem {
  icon: string;
  title: string;
  description: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const readNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const DEFAULT_FEATURES: FeatureItem[] = [
  { icon: "⚡", title: "Fast to launch", description: "Compose sections quickly with reusable defaults." },
  { icon: "🧩", title: "Modular", description: "Mix content patterns without rebuilding the page shell." },
  { icon: "🖥️", title: "Server-friendly", description: "Render blocks into stable markup for production pages." },
];

const parseFeatures = (value: unknown): FeatureItem[] => {
  // Backward-compat: legacy pages stored a JSON string in this prop.
  const source =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return DEFAULT_FEATURES;
          }
        })()
      : value;

  if (!Array.isArray(source)) {
    return DEFAULT_FEATURES;
  }

  const features = source
    .filter(isRecord)
    .map((item) => ({
      icon: readString(item.icon, "✨"),
      title: readString(item.title, "Feature"),
      description: readString(item.description, "Add a short explanation for this feature."),
    }));

  return features.length > 0 ? features : DEFAULT_FEATURES;
};

export const featureGridBlock: NpBlockDefinition = {
  type: "feature-grid",
  label: "Feature Grid",
  description: "Highlights key product capabilities in a flexible multi-column layout.",
  icon: "LayoutGrid",
  iconKind: "lucide",
  docBodyKind: "complex",
  summaryFields: ["heading"],
  category: "Content",
  source: "built-in",
  keywords: ["features", "benefits", "tiles", "capabilities"],
  defaultProps: {
    heading: "Everything your team needs",
    columns: 3,
    features: DEFAULT_FEATURES,
  },
  propsSchema: [
    { name: "heading", label: "Heading", type: "text", defaultValue: "Everything your team needs" },
    { name: "columns", label: "Columns", type: "number", defaultValue: 3 },
    {
      name: "features",
      label: "Features",
      type: "array",
      defaultValue: DEFAULT_FEATURES,
      itemDefault: { icon: "✨", title: "New feature", description: "Add a short explanation for this feature." },
      itemSchema: [
        { name: "icon", label: "Icon", type: "text", defaultValue: "✨", description: "Emoji or short symbol." },
        { name: "title", label: "Title", type: "text", defaultValue: "New feature" },
        { name: "description", label: "Description", type: "textarea", defaultValue: "Add a short explanation for this feature." },
      ],
    },
  ],
  render: (props) => {
    const heading = readString(props.heading, "Everything your team needs");
    const columns = Math.max(1, Math.min(4, readNumber(props.columns, 3)));
    const features = parseFeatures(props.features);

    const gridStyle: CSSProperties = {
      display: "grid",
      gap: "1.25rem",
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    };

    return (
      <section
        className="np-block-feature-grid"
        style={{
          padding: "4rem 1.5rem",
          background: "var(--np-color-muted, #f8fafc)",
        }}
      >
        <div style={{ maxWidth: "72rem", margin: "0 auto", display: "grid", gap: "1.75rem" }}>
          <header>
            <h2
              style={{
                margin: 0,
                fontSize: "clamp(2rem, 4vw, 3rem)",
                color: "var(--np-color-foreground, #0f172a)",
              }}
            >
              {heading}
            </h2>
          </header>
          <div style={gridStyle}>
            {features.map((feature) => (
              <article
                key={`${feature.title}-${feature.icon}`}
                className="np-block-feature-grid__card"
                style={{
                  padding: "1.5rem",
                  borderRadius: "1.25rem",
                  background: "var(--np-color-card, #ffffff)",
                  border: "1px solid var(--np-color-border, rgba(15, 23, 42, 0.08))",
                  boxShadow: "0 14px 35px rgba(15, 23, 42, 0.08)",
                }}
              >
                <div style={{ fontSize: "1.8rem", marginBottom: "0.9rem" }}>{feature.icon}</div>
                <h3 style={{ margin: "0 0 0.6rem", color: "var(--np-color-card-foreground, #0f172a)" }}>{feature.title}</h3>
                <p style={{ margin: 0, lineHeight: 1.7, color: "var(--np-color-muted-foreground, #475569)" }}>{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    );
  },
};
