import * as React from "react";
import type { NpBlockDefinition } from "@nexpress/blocks";

/**
 * Phase F.9 — magazine-specific block types.
 *
 * Type prefix: `magazine.*`. Bootstrap auto-stamps
 * `source: "theme:magazine"` so the active-source filter scopes
 * these to sites with magazine active.
 *
 * Two representative blocks shipping with v0.2:
 *
 * - `magazine.hero-feature` — large lead image + headline +
 *   deck. The homepage's `featured` hero variant.
 * - `magazine.section-strip` — three-column "section in
 *   progress" strip used to break up an editorial archive page.
 *
 * More blocks (newsletter inline form, image quote, audio
 * embed, etc.) are recorded as F.9.1 follow-up — these two
 * exercise the contract end-to-end.
 */

interface HeroFeatureProps {
  title: string;
  subtitle?: string;
  ctaText?: string;
  ctaUrl?: string;
  imageUrl?: string;
}

function HeroFeature(props: Record<string, unknown>): React.ReactElement {
  const { title, subtitle, ctaText, ctaUrl, imageUrl } =
    props as unknown as HeroFeatureProps;
  return (
    <section
      className="np-magazine-hero-feature"
      style={{
        position: "relative",
        margin: "2rem 0",
        padding: "3rem 1.5rem",
        borderTop: "3px double var(--np-color-foreground)",
        borderBottom: "1px solid var(--np-color-border)",
        backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: imageUrl ? "white" : "inherit",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--np-font-heading)",
          fontSize: "clamp(2rem, 5vw, 3.5rem)",
          margin: 0,
          textShadow: imageUrl ? "0 2px 8px rgba(0,0,0,0.4)" : undefined,
        }}
      >
        {title}
      </h1>
      {subtitle ? (
        <p
          style={{
            margin: "0.75rem 0 0",
            fontSize: "1.125rem",
            maxWidth: "60ch",
          }}
        >
          {subtitle}
        </p>
      ) : null}
      {ctaText && ctaUrl ? (
        <a
          href={ctaUrl}
          style={{
            display: "inline-block",
            marginTop: "1.5rem",
            padding: "0.5rem 1.25rem",
            borderRadius: "0.25rem",
            background: "var(--np-color-primary)",
            color: "var(--np-color-primary-foreground)",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          {ctaText}
        </a>
      ) : null}
    </section>
  );
}

interface SectionStripItem {
  title: string;
  url: string;
  category?: string;
}

interface SectionStripProps {
  heading?: string;
  items: SectionStripItem[];
}

function SectionStrip(props: Record<string, unknown>): React.ReactElement {
  const { heading, items } = props as unknown as SectionStripProps;
  return (
    <section
      className="np-magazine-section-strip"
      style={{ margin: "2.5rem 0", padding: "1.5rem 0" }}
    >
      {heading ? (
        <h2
          style={{
            fontFamily: "var(--np-font-heading)",
            fontSize: "1rem",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            margin: "0 0 1rem",
            color: "var(--np-color-muted-foreground)",
            borderBottom: "1px solid var(--np-color-border)",
            paddingBottom: "0.5rem",
          }}
        >
          {heading}
        </h2>
      ) : null}
      <div
        style={{
          display: "grid",
          gap: "1.5rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
        }}
      >
        {items.map((item, i) => (
          <article key={i}>
            {item.category ? (
              <p
                style={{
                  fontSize: "0.75rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--np-color-primary)",
                  margin: 0,
                }}
              >
                {item.category}
              </p>
            ) : null}
            <h3 style={{ margin: "0.25rem 0 0", fontSize: "1.125rem" }}>
              <a
                href={item.url}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                {item.title}
              </a>
            </h3>
          </article>
        ))}
      </div>
    </section>
  );
}

export const magazineBlocks: NpBlockDefinition[] = [
  {
    type: "magazine.hero-feature",
    label: "Hero Feature",
    iconKind: "lucide",
    icon: "newspaper",
    keywords: ["hero", "magazine", "lead", "feature"],
    defaultProps: {
      title: "The Story Above the Fold",
      subtitle:
        "Subdeck — a one- or two-line summary of the lead piece.",
      ctaText: "Read the article",
      ctaUrl: "#",
      imageUrl: "",
    },
    propsSchema: [
      { name: "title", label: "Headline", type: "text" },
      { name: "subtitle", label: "Subdeck", type: "textarea" },
      { name: "ctaText", label: "CTA text", type: "text" },
      { name: "ctaUrl", label: "CTA URL", type: "url" },
      { name: "imageUrl", label: "Background image URL", type: "url" },
    ],
    render: (props) => <HeroFeature {...props} />,
  },
  {
    type: "magazine.section-strip",
    label: "Section Strip",
    iconKind: "lucide",
    icon: "layout-grid",
    keywords: ["section", "magazine", "archive", "strip"],
    defaultProps: {
      heading: "More from this section",
      items: [
        { title: "Story headline", url: "#", category: "Politics" },
        { title: "Story headline", url: "#", category: "Culture" },
        { title: "Story headline", url: "#", category: "Tech" },
      ],
    },
    propsSchema: [
      { name: "heading", label: "Section heading", type: "text" },
      // The `items` array is edited as JSON in v0.2; a richer
      // editor (drag-to-reorder, item picker) is F.5.1 polish.
      { name: "items", label: "Items (JSON)", type: "textarea" },
    ],
    render: (props) => <SectionStrip {...props} />,
  },
];
