import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

export const heroBlock: NpBlockDefinition = {
  type: "hero",
  label: "Hero",
  description: "Large introductory section with headline, supporting copy, and a call to action.",
  icon: "🌅",
  summaryFields: ["title"],
  category: "Content",
  source: "built-in",
  keywords: ["headline", "banner", "intro", "landing"],
  defaultProps: {
    title: "Build pages block by block",
    subtitle:
      "Create elegant landing pages with composable content blocks that stay easy to render on the server.",
    ctaText: "Get started",
    ctaUrl: "/start",
    backgroundImage: "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1600&q=80",
  },
  propsSchema: [
    { name: "title", label: "Title", type: "text", required: true, defaultValue: "Build pages block by block" },
    {
      name: "subtitle",
      label: "Subtitle",
      type: "textarea",
      defaultValue:
        "Create elegant landing pages with composable content blocks that stay easy to render on the server.",
    },
    { name: "ctaText", label: "CTA Text", type: "text", defaultValue: "Get started" },
    { name: "ctaUrl", label: "CTA URL", type: "url", defaultValue: "/start" },
    {
      name: "backgroundImage",
      label: "Background Image",
      type: "image",
      defaultValue:
        "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1600&q=80",
    },
  ],
  render: (props) => {
    const title = readString(props.title, "Build pages block by block");
    const subtitle = readString(
      props.subtitle,
      "Create elegant landing pages with composable content blocks that stay easy to render on the server.",
    );
    const ctaText = readString(props.ctaText, "Get started");
    const ctaUrl = readString(props.ctaUrl, "/start");
    const backgroundImage = readString(
      props.backgroundImage,
      "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1600&q=80",
    );

    const sectionStyle: CSSProperties = {
      position: "relative",
      overflow: "hidden",
      padding: "7rem 1.5rem",
      color: "#f8fafc",
      backgroundColor: "#08111f",
      backgroundImage: `linear-gradient(135deg, rgba(8, 17, 31, 0.88), rgba(18, 57, 89, 0.52)), url(${backgroundImage})`,
      backgroundPosition: "center",
      backgroundSize: "cover",
    };

    const innerStyle: CSSProperties = {
      maxWidth: "52rem",
      margin: "0 auto",
      textAlign: "center",
      display: "grid",
      gap: "1.5rem",
    };

    const buttonStyle: CSSProperties = {
      display: "inline-flex",
      justifyContent: "center",
      alignItems: "center",
      padding: "0.9rem 1.6rem",
      borderRadius: "999px",
      background: "#f8fafc",
      color: "#08111f",
      textDecoration: "none",
      fontWeight: 700,
      width: "fit-content",
      margin: "0 auto",
      boxShadow: "0 18px 40px rgba(8, 17, 31, 0.3)",
    };

    return (
      <section className="np-block-hero" style={sectionStyle}>
        <div style={innerStyle}>
          <p style={{ letterSpacing: "0.22em", textTransform: "uppercase", opacity: 0.72, margin: 0 }}>Featured Block</p>
          <h1 style={{ fontSize: "clamp(2.8rem, 6vw, 4.8rem)", lineHeight: 1.02, margin: 0 }}>{title}</h1>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.7, margin: 0, opacity: 0.86 }}>{subtitle}</p>
          <a className="np-block-hero__cta" href={ctaUrl} style={buttonStyle}>
            {ctaText}
          </a>
        </div>
      </section>
    );
  },
};
