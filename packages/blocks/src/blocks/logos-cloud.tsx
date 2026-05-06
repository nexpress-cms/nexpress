import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

interface LogoItem {
  src: string;
  alt: string;
  href?: string;
}

const readItem = (raw: unknown): LogoItem | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const src = typeof obj.src === "string" ? obj.src.trim() : "";
  if (!src) return null;
  return {
    src,
    alt: typeof obj.alt === "string" ? obj.alt : "",
    href: typeof obj.href === "string" && obj.href.length > 0 ? obj.href : undefined,
  };
};

/**
 * Logos cloud — grayscale strip of customer / partner / press
 * logos. Renders each logo at a capped height so logos with
 * different aspect ratios (long word-marks vs square icons) sit on
 * the same baseline without each author having to crop their
 * source asset. Optional `href` per logo turns it into a link;
 * absent `href` renders an inert `<img>` so the strip can pull
 * double duty as "as seen in" press marks.
 */
export const logosCloudBlock: NpBlockDefinition = {
  type: "logos-cloud",
  label: "Logos cloud",
  description: "Grayscale strip of customer / partner logos. Use for trust signals.",
  icon: "Building2",
  iconKind: "lucide",
  docBodyKind: "complex",
  summaryFields: ["heading"],
  category: "Content",
  source: "built-in",
  keywords: ["logos", "trust", "customers", "partners", "press"],
  defaultProps: {
    heading: "Trusted by teams shipping production sites",
    items: [
      { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Northwind", alt: "Northwind" },
      { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Aurora", alt: "Aurora" },
      { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Switchback", alt: "Switchback" },
      { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Larkfield", alt: "Larkfield" },
      { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Meridian", alt: "Meridian" },
      { src: "https://placehold.co/200x60/cbd5e1/64748b?text=Halcyon", alt: "Halcyon" },
    ],
  },
  propsSchema: [
    {
      name: "heading",
      label: "Heading (optional)",
      type: "text",
      defaultValue: "Trusted by teams shipping production sites",
    },
    {
      name: "items",
      label: "Logos",
      type: "array",
      itemSchema: [
        { name: "src", label: "Image URL", type: "url", required: true },
        { name: "alt", label: "Alt text", type: "text" },
        { name: "href", label: "Link URL (optional)", type: "url" },
      ],
      itemDefault: { src: "", alt: "" },
    },
  ],
  render: (props) => {
    const heading = readString(props.heading, "");
    const items = Array.isArray(props.items)
      ? (props.items.map(readItem).filter(Boolean) as LogoItem[])
      : [];

    const sectionStyle: CSSProperties = {
      padding: "3rem 1.5rem",
      background: "var(--np-color-background, #ffffff)",
    };
    const wrapperStyle: CSSProperties = {
      maxWidth: "72rem",
      margin: "0 auto",
      display: "grid",
      gap: "1.5rem",
    };
    const stripStyle: CSSProperties = {
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "center",
      alignItems: "center",
      gap: "2.5rem",
    };
    const logoStyle: CSSProperties = {
      maxHeight: "2.25rem",
      width: "auto",
      filter: "grayscale(1)",
      opacity: 0.7,
    };

    return (
      <section className="np-block-logos-cloud" style={sectionStyle}>
        <div style={wrapperStyle}>
          {heading ? (
            <p
              style={{
                margin: 0,
                textAlign: "center",
                fontSize: "0.85rem",
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--np-color-muted-foreground, #64748b)",
              }}
            >
              {heading}
            </p>
          ) : null}
          {items.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--np-color-muted-foreground, #94a3b8)" }}>
              Add logo entries in the block editor.
            </p>
          ) : (
            <div style={stripStyle}>
              {items.map((item, index) => {
                // eslint-disable-next-line @next/next/no-img-element
                const img = (
                  <img
                    src={item.src}
                    alt={item.alt}
                    style={logoStyle}
                    loading="lazy"
                    decoding="async"
                  />
                );
                return item.href ? (
                  <a
                    key={index}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "inline-flex" }}
                  >
                    {img}
                  </a>
                ) : (
                  <span key={index} style={{ display: "inline-flex" }}>
                    {img}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </section>
    );
  },
};
