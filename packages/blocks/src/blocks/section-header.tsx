import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const readAlign = (value: unknown): "left" | "center" =>
  value === "left" ? "left" : "center";

/**
 * Section header — eyebrow + heading + optional subtitle. Drop above
 * any content section that needs a labeled intro. Renders as a
 * compact `<header>` so SR users get the right landmark, and the
 * eyebrow is a small uppercase tag rather than a heading element so
 * the document outline only carries the real `<h2>`.
 */
export const sectionHeaderBlock: NpBlockDefinition = {
  type: "section-header",
  label: "Section header",
  description: "Eyebrow + heading + subtitle. Use as the intro for any content section.",
  icon: "Heading",
  iconKind: "lucide",
  docBodyKind: "complex",
  summaryFields: ["heading", "eyebrow"],
  category: "Content",
  source: "built-in",
  keywords: ["heading", "title", "eyebrow", "intro", "section"],
  defaultProps: {
    eyebrow: "Why teams choose this",
    heading: "A clean section header",
    subtitle: "One short sentence to set up the section that follows.",
    align: "center",
  },
  propsSchema: [
    {
      name: "eyebrow",
      label: "Eyebrow",
      type: "text",
      defaultValue: "Why teams choose this",
      description: "Small uppercase label above the heading. Leave blank to omit.",
    },
    {
      name: "heading",
      label: "Heading",
      type: "text",
      defaultValue: "A clean section header",
      required: true,
    },
    {
      name: "subtitle",
      label: "Subtitle",
      type: "textarea",
      defaultValue: "One short sentence to set up the section that follows.",
    },
    {
      name: "align",
      label: "Alignment",
      type: "select",
      defaultValue: "center",
      options: [
        { label: "Center", value: "center" },
        { label: "Left", value: "left" },
      ],
    },
  ],
  render: (props) => {
    const eyebrow = readString(props.eyebrow, "");
    const heading = readString(props.heading, "A clean section header");
    const subtitle = readString(props.subtitle, "");
    const align = readAlign(props.align);

    const wrapperStyle: CSSProperties = {
      padding: "3rem 1.5rem 1rem",
      maxWidth: "56rem",
      margin: "0 auto",
      textAlign: align,
      display: "grid",
      gap: "0.75rem",
    };

    return (
      <header className="np-block-section-header" style={wrapperStyle}>
        {eyebrow ? (
          <span
            className="np-block-section-header__eyebrow"
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--np-color-primary, #6366f1)",
            }}
          >
            {eyebrow}
          </span>
        ) : null}
        <h2
          className="np-block-section-header__heading"
          style={{
            margin: 0,
            fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)",
            lineHeight: 1.2,
            color: "var(--np-color-foreground, #0f172a)",
          }}
        >
          {heading}
        </h2>
        {subtitle ? (
          <p
            className="np-block-section-header__subtitle"
            style={{
              margin: 0,
              fontSize: "1.05rem",
              lineHeight: 1.65,
              color: "var(--np-color-muted-foreground, #475569)",
              maxWidth: align === "center" ? "42rem" : "none",
              marginInline: align === "center" ? "auto" : undefined,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </header>
    );
  },
};
