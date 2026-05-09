import * as React from "react";
import type { NpBlockDefinition } from "@nexpress/blocks";

/**
 * Phase F.9-C — portfolio-specific block types.
 *
 * Type prefix: `portfolio.*`. Bootstrap auto-stamps
 * `source: "theme:portfolio"` so multi-site processes scope
 * these correctly.
 *
 * Two blocks shipping with v0.2:
 *   - `portfolio.case-study-hero`: full-bleed image + project
 *     meta. Drop at the top of a case-study page.
 *   - `portfolio.image-grid`: responsive image gallery. The
 *     editorial alternative to a regular gridBlock for
 *     image-heavy case studies.
 */

interface CaseStudyHeroProps {
  title: string;
  subtitle?: string;
  client?: string;
  year?: string;
  role?: string;
  imageUrl?: string;
}

function CaseStudyHero(props: Record<string, unknown>): React.ReactElement {
  const { title, subtitle, client, year, role, imageUrl } =
    props as unknown as CaseStudyHeroProps;
  return (
    <section
      className="np-portfolio-case-study-hero"
      style={{
        position: "relative",
        margin: "0 0 2rem",
        padding: 0,
        minHeight: imageUrl ? "60vh" : "auto",
        backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: imageUrl ? "white" : "inherit",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <div
        style={{
          padding: "3rem 1.5rem 2rem",
          background: imageUrl
            ? "linear-gradient(180deg, transparent, rgba(0,0,0,0.65))"
            : undefined,
        }}
      >
        <h1
          style={{
            fontFamily: "var(--np-font-heading)",
            fontSize: "clamp(2rem, 5vw, 3.75rem)",
            fontWeight: 600,
            margin: 0,
            letterSpacing: "-0.02em",
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
              opacity: 0.9,
            }}
          >
            {subtitle}
          </p>
        ) : null}
        {(client || year || role) ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "2rem",
              marginTop: "1.5rem",
              fontSize: "0.875rem",
              opacity: 0.8,
            }}
          >
            {client ? (
              <div>
                <span style={{ display: "block", opacity: 0.6, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Client
                </span>
                {client}
              </div>
            ) : null}
            {year ? (
              <div>
                <span style={{ display: "block", opacity: 0.6, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Year
                </span>
                {year}
              </div>
            ) : null}
            {role ? (
              <div>
                <span style={{ display: "block", opacity: 0.6, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Role
                </span>
                {role}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

interface ImageGridItem {
  url: string;
  alt?: string;
  caption?: string;
}

interface ImageGridProps {
  columns?: number;
  items: ImageGridItem[];
}

function ImageGrid(props: Record<string, unknown>): React.ReactElement {
  const { columns, items } = props as unknown as ImageGridProps;
  const cols = typeof columns === "number" && columns > 0 ? columns : 2;
  return (
    <section
      className="np-portfolio-image-grid"
      style={{
        margin: "2rem 0",
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
      }}
    >
      {items.map((item, i) => (
        <figure key={i} style={{ margin: 0 }}>
          <img
            src={item.url}
            alt={item.alt ?? ""}
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              borderRadius: "0.25rem",
            }}
          />
          {item.caption ? (
            <figcaption
              style={{
                fontSize: "0.8125rem",
                color: "var(--np-color-muted-foreground)",
                marginTop: "0.5rem",
              }}
            >
              {item.caption}
            </figcaption>
          ) : null}
        </figure>
      ))}
    </section>
  );
}

export const portfolioBlocks: NpBlockDefinition[] = [
  {
    type: "portfolio.case-study-hero",
    label: "Case study hero",
    iconKind: "lucide",
    icon: "image",
    keywords: ["hero", "case-study", "portfolio", "project"],
    defaultProps: {
      title: "Project name",
      subtitle: "One-sentence project summary.",
      client: "Client name",
      year: "2026",
      role: "Design + Engineering",
      imageUrl: "",
    },
    propsSchema: [
      { name: "title", label: "Project title", type: "text" },
      { name: "subtitle", label: "Subtitle", type: "textarea" },
      { name: "client", label: "Client", type: "text" },
      { name: "year", label: "Year", type: "text" },
      { name: "role", label: "Role", type: "text" },
      { name: "imageUrl", label: "Hero image URL", type: "url" },
    ],
    render: (props) => <CaseStudyHero {...props} />,
  },
  {
    type: "portfolio.image-grid",
    label: "Image grid",
    iconKind: "lucide",
    icon: "grid-3x3",
    keywords: ["images", "gallery", "grid", "portfolio"],
    defaultProps: {
      columns: 2,
      items: [
        { url: "https://placehold.co/800x600", alt: "", caption: "" },
        { url: "https://placehold.co/800x600", alt: "", caption: "" },
      ],
    },
    propsSchema: [
      { name: "columns", label: "Columns", type: "number" },
      // `items` edited as JSON in v0.2; richer per-item editor
      // (drag-to-reorder, add/remove) tracked as F.5.1 polish.
      { name: "items", label: "Items (JSON)", type: "textarea" },
    ],
    render: (props) => <ImageGrid {...props} />,
  },
];
