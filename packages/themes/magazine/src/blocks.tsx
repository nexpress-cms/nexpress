import * as React from "react";
import type { NpBlockDefinition } from "@nexpress/blocks";

import { resolveMagazineSettings } from "./settings-helpers.js";

/**
 * Phase F.9 / F.9.2 — magazine-specific block types.
 *
 * Type prefix: `magazine.*`. Bootstrap auto-stamps
 * `source: "theme:magazine"` so the active-source filter scopes
 * these to sites with magazine active.
 *
 * Blocks shipping with v0.2:
 *
 * - `magazine.hero-feature` — adaptive hero. Renders one of
 *   three layouts based on the operator's `heroStyle` setting
 *   (featured / carousel / grid). The block prop `styleOverride`
 *   pins a specific layout per-instance; "auto" (default)
 *   defers to settings (F.9.2).
 * - `magazine.section-strip` — three-column "section in
 *   progress" strip used to break up an editorial archive page.
 */

interface HeroItem {
  title: string;
  url?: string;
  imageUrl?: string;
  category?: string;
}

interface HeroFeatureProps {
  title: string;
  subtitle?: string;
  ctaText?: string;
  ctaUrl?: string;
  imageUrl?: string;
  items?: HeroItem[];
  styleOverride?: "auto" | "featured" | "carousel" | "grid";
}

type HeroStyle = "featured" | "carousel" | "grid";

/**
 * Parse a textarea-driven items prop. The admin's JSON-textarea
 * field-control stores its value AS A STRING — so when an operator
 * edits `items` in the props form, what comes back at render time
 * is the JSON string, not a parsed array. Newly-inserted blocks
 * still hit the `defaultProps` array branch (no operator edit yet),
 * so we have to handle both shapes.
 *
 * Returns `[]` for any unparseable input — the block surfaces an
 * "Add items" placeholder, never throws on malformed JSON.
 */
function parseItems(raw: unknown): HeroItem[] {
  const arr =
    Array.isArray(raw)
      ? raw
      : typeof raw === "string" && raw.trim().length > 0
        ? safeJsonArray(raw)
        : [];
  // Filter to objects only — null / number / string array elements
  // (e.g. from a malformed operator paste) are dropped silently
  // rather than tripping `item.title` access on a non-object.
  return arr.filter(
    (item): item is HeroItem =>
      typeof item === "object" && item !== null,
  );
}

function safeJsonArray(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function HeroFeature(
  props: Record<string, unknown>,
): Promise<React.ReactElement> {
  const {
    title,
    subtitle,
    ctaText,
    ctaUrl,
    imageUrl,
    styleOverride = "auto",
  } = props as unknown as HeroFeatureProps;
  const items = parseItems(props.items);

  // Resolve the layout: per-block override wins, otherwise pull
  // from theme settings. The cached read shares one DB hit
  // across multiple block instances on the same page.
  const settings = await resolveMagazineSettings();
  const style: HeroStyle =
    styleOverride !== "auto" ? styleOverride : settings.heroStyle;

  if (style === "carousel") {
    return (
      <HeroCarousel
        title={title}
        subtitle={subtitle}
        ctaText={ctaText}
        ctaUrl={ctaUrl}
        items={items}
      />
    );
  }
  if (style === "grid") {
    return (
      <HeroGrid
        title={title}
        subtitle={subtitle}
        ctaText={ctaText}
        ctaUrl={ctaUrl}
        items={items}
      />
    );
  }
  return (
    <HeroFeaturedSingle
      title={title}
      subtitle={subtitle}
      ctaText={ctaText}
      ctaUrl={ctaUrl}
      imageUrl={imageUrl}
    />
  );
}

interface FeaturedSingleProps {
  title: string;
  subtitle?: string;
  ctaText?: string;
  ctaUrl?: string;
  imageUrl?: string;
}

function HeroFeaturedSingle({
  title,
  subtitle,
  ctaText,
  ctaUrl,
  imageUrl,
}: FeaturedSingleProps): React.ReactElement {
  return (
    <section
      className="np-magazine-hero-feature"
      data-hero-style="featured"
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

interface MultiHeroProps {
  title: string;
  subtitle?: string;
  ctaText?: string;
  ctaUrl?: string;
  items: HeroItem[];
}

/** Carousel layout — heading row + horizontally scrollable
 *  cards. CSS scroll-snap keeps each card centered when the
 *  reader pages through with arrow keys / touch swipe. */
function HeroCarousel({
  title,
  subtitle,
  ctaText,
  ctaUrl,
  items,
}: MultiHeroProps): React.ReactElement {
  return (
    <section
      className="np-magazine-hero-feature np-magazine-hero-carousel"
      data-hero-style="carousel"
    >
      <header className="np-magazine-hero-header">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
        {ctaText && ctaUrl ? (
          <a className="np-magazine-hero-cta" href={ctaUrl}>
            {ctaText}
          </a>
        ) : null}
      </header>
      {items.length > 0 ? (
        <div className="np-magazine-hero-carousel-track" role="list">
          {items.map((item, i) => (
            <article
              key={i}
              className="np-magazine-hero-carousel-card"
              role="listitem"
            >
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" loading="lazy" />
              ) : null}
              <div>
                {item.category ? (
                  <p className="np-magazine-hero-card-category">
                    {item.category}
                  </p>
                ) : null}
                <h2>
                  {item.url ? <a href={item.url}>{item.title}</a> : item.title}
                </h2>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="np-magazine-hero-empty">
          Add items in the block&apos;s props to populate the carousel.
        </p>
      )}
    </section>
  );
}

/** Grid layout — heading row + 3-column responsive grid of
 *  story tiles. Same items shape as carousel; CSS handles the
 *  layout switch. */
function HeroGrid({
  title,
  subtitle,
  ctaText,
  ctaUrl,
  items,
}: MultiHeroProps): React.ReactElement {
  return (
    <section
      className="np-magazine-hero-feature np-magazine-hero-grid"
      data-hero-style="grid"
    >
      <header className="np-magazine-hero-header">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
        {ctaText && ctaUrl ? (
          <a className="np-magazine-hero-cta" href={ctaUrl}>
            {ctaText}
          </a>
        ) : null}
      </header>
      {items.length > 0 ? (
        <div className="np-magazine-hero-grid-tiles">
          {items.map((item, i) => (
            <article key={i} className="np-magazine-hero-grid-tile">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" loading="lazy" />
              ) : null}
              <div>
                {item.category ? (
                  <p className="np-magazine-hero-card-category">
                    {item.category}
                  </p>
                ) : null}
                <h2>
                  {item.url ? <a href={item.url}>{item.title}</a> : item.title}
                </h2>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="np-magazine-hero-empty">
          Add items in the block&apos;s props to populate the grid.
        </p>
      )}
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

function parseSectionStripItems(raw: unknown): SectionStripItem[] {
  if (Array.isArray(raw)) return raw as SectionStripItem[];
  if (typeof raw === "string" && raw.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as SectionStripItem[];
    } catch {
      return [];
    }
  }
  return [];
}

function SectionStrip(props: Record<string, unknown>): React.ReactElement {
  const { heading } = props as unknown as SectionStripProps;
  const items = parseSectionStripItems(props.items);
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
      // F.9.2 — `auto` defers to the theme-level `heroStyle`
      // setting (default: featured). Operators pin per-block
      // by editing this in the props form.
      styleOverride: "auto",
      items: [],
    },
    propsSchema: [
      { name: "title", label: "Headline", type: "text" },
      { name: "subtitle", label: "Subdeck", type: "textarea" },
      { name: "ctaText", label: "CTA text", type: "text" },
      { name: "ctaUrl", label: "CTA URL", type: "url" },
      // Featured-only — ignored by carousel/grid variants which
      // pull imagery from per-item entries instead.
      { name: "imageUrl", label: "Background image URL (featured only)", type: "url" },
      // F.9.2 — pin a specific layout per-block, or "auto" to
      // follow the theme-level `heroStyle` setting.
      {
        name: "styleOverride",
        label: "Layout",
        type: "select",
        options: [
          { label: "Auto (use theme setting)", value: "auto" },
          { label: "Featured (single story)", value: "featured" },
          { label: "Carousel (horizontal cards)", value: "carousel" },
          { label: "Grid (3-column tiles)", value: "grid" },
        ],
      },
      // Items array used by carousel/grid variants. Edited as
      // JSON in v0.2 — same UX as section-strip's `items`.
      // Featured layout ignores this field.
      {
        name: "items",
        label: "Items (carousel/grid only, JSON)",
        type: "textarea",
      },
    ],
    render: (props) => HeroFeature(props),
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
