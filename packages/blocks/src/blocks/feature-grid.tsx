import type { CSSProperties } from "react";

import type { NxBlockDefinition } from "../types.js";

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

const parseFeatures = (value: unknown): FeatureItem[] => {
  const fallback: FeatureItem[] = [
    { icon: "⚡", title: "Fast to launch", description: "Compose sections quickly with reusable defaults." },
    { icon: "🧩", title: "Modular", description: "Mix content patterns without rebuilding the page shell." },
    { icon: "🖥️", title: "Server-friendly", description: "Render blocks into stable markup for production pages." },
  ];

  const source = typeof value === "string" ? (() => {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    } catch {
      return fallback;
    }
  })() : value;

  if (!Array.isArray(source)) {
    return fallback;
  }

  const features = source
    .filter(isRecord)
    .map((item) => ({
      icon: readString(item.icon, "✨"),
      title: readString(item.title, "Feature"),
      description: readString(item.description, "Add a short explanation for this feature."),
    }));

  return features.length > 0 ? features : fallback;
};

export const featureGridBlock: NxBlockDefinition = {
  type: "feature-grid",
  label: "Feature Grid",
  description: "Highlights key product capabilities in a flexible multi-column layout.",
  icon: "🧱",
  defaultProps: {
    heading: "Everything your team needs",
    columns: 3,
    features: JSON.stringify(
      [
        { icon: "⚡", title: "Fast to launch", description: "Compose sections quickly with reusable defaults." },
        { icon: "🧩", title: "Modular", description: "Mix content patterns without rebuilding the page shell." },
        { icon: "🖥️", title: "Server-friendly", description: "Render blocks into stable markup for production pages." },
      ],
      null,
      2,
    ),
  },
  propsSchema: [
    { name: "heading", label: "Heading", type: "text", defaultValue: "Everything your team needs" },
    { name: "columns", label: "Columns", type: "number", defaultValue: 3 },
    {
      name: "features",
      label: "Features",
      type: "textarea",
      defaultValue: JSON.stringify(
        [
          { icon: "⚡", title: "Fast to launch", description: "Compose sections quickly with reusable defaults." },
          { icon: "🧩", title: "Modular", description: "Mix content patterns without rebuilding the page shell." },
          { icon: "🖥️", title: "Server-friendly", description: "Render blocks into stable markup for production pages." },
        ],
        null,
        2,
      ),
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
      <section className="nx-block-feature-grid" style={{ padding: "4rem 1.5rem", background: "#f8fafc" }}>
        <div style={{ maxWidth: "72rem", margin: "0 auto", display: "grid", gap: "1.75rem" }}>
          <header>
            <h2 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 3rem)", color: "#0f172a" }}>{heading}</h2>
          </header>
          <div style={gridStyle}>
            {features.map((feature) => (
              <article
                key={`${feature.title}-${feature.icon}`}
                className="nx-block-feature-grid__card"
                style={{
                  padding: "1.5rem",
                  borderRadius: "1.25rem",
                  background: "#ffffff",
                  border: "1px solid rgba(15, 23, 42, 0.08)",
                  boxShadow: "0 14px 35px rgba(15, 23, 42, 0.08)",
                }}
              >
                <div style={{ fontSize: "1.8rem", marginBottom: "0.9rem" }}>{feature.icon}</div>
                <h3 style={{ margin: "0 0 0.6rem", color: "#0f172a" }}>{feature.title}</h3>
                <p style={{ margin: 0, lineHeight: 1.7, color: "#475569" }}>{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    );
  },
};
