import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const readVariant = (value: unknown): "primary" | "secondary" =>
  value === "secondary" ? "secondary" : "primary";

export const ctaBlock: NpBlockDefinition = {
  type: "cta",
  label: "Call to Action",
  description: "Focused conversion block with a single message and button.",
  icon: "📣",
  summaryFields: ["heading", "buttonText"],
  category: "Content",
  source: "built-in",
  keywords: ["call to action", "button banner", "conversion", "signup"],
  defaultProps: {
    heading: "Launch your next page faster",
    description: "Turn structured content into polished pages with reusable server-renderable blocks.",
    buttonText: "Start building",
    buttonUrl: "/start",
    variant: "primary",
  },
  propsSchema: [
    { name: "heading", label: "Heading", type: "text", defaultValue: "Launch your next page faster" },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      defaultValue: "Turn structured content into polished pages with reusable server-renderable blocks.",
    },
    { name: "buttonText", label: "Button Text", type: "text", defaultValue: "Start building" },
    { name: "buttonUrl", label: "Button URL", type: "url", defaultValue: "/start" },
    {
      name: "variant",
      label: "Variant",
      type: "select",
      defaultValue: "primary",
      options: [
        { label: "Primary", value: "primary" },
        { label: "Secondary", value: "secondary" },
      ],
    },
  ],
  render: (props) => {
    const heading = readString(props.heading, "Launch your next page faster");
    const description = readString(
      props.description,
      "Turn structured content into polished pages with reusable server-renderable blocks.",
    );
    const buttonText = readString(props.buttonText, "Start building");
    const buttonUrl = readString(props.buttonUrl, "/start");
    const variant = readVariant(props.variant);

    const sectionStyle: CSSProperties = {
      padding: "4rem 1.5rem",
      background: variant === "primary" ? "linear-gradient(135deg, #1d4ed8, #0f172a)" : "#e2e8f0",
      color: variant === "primary" ? "#eff6ff" : "#0f172a",
    };

    return (
      <section className="np-block-cta" style={sectionStyle}>
        <div style={{ maxWidth: "48rem", margin: "0 auto", textAlign: "center", display: "grid", gap: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 3rem)" }}>{heading}</h2>
          <p style={{ margin: 0, lineHeight: 1.75, opacity: 0.86 }}>{description}</p>
          <div>
            <a
              className="np-block-cta__button"
              href={buttonUrl}
              style={{
                display: "inline-flex",
                justifyContent: "center",
                alignItems: "center",
                padding: "0.9rem 1.6rem",
                borderRadius: "999px",
                background: variant === "primary" ? "#ffffff" : "#0f172a",
                color: variant === "primary" ? "#0f172a" : "#ffffff",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              {buttonText}
            </a>
          </div>
        </div>
      </section>
    );
  },
};
