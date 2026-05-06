import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

interface TestimonialItem {
  quote: string;
  name: string;
  role?: string;
  avatar?: string;
  rating?: number;
}

const readItem = (raw: unknown): TestimonialItem | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const quote = typeof obj.quote === "string" ? obj.quote.trim() : "";
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!quote || !name) return null;
  return {
    quote,
    name,
    role: typeof obj.role === "string" ? obj.role : undefined,
    avatar: typeof obj.avatar === "string" && obj.avatar.length > 0 ? obj.avatar : undefined,
    rating:
      typeof obj.rating === "number" && obj.rating >= 0 && obj.rating <= 5
        ? Math.round(obj.rating)
        : undefined,
  };
};

/**
 * Testimonials block — quote cards in a responsive grid. Layout
 * collapses to one column on mobile and scales up to three on
 * desktop based on item count, so adding a fourth card pushes the
 * row to wrap rather than shrink to four cramped columns.
 */
export const testimonialsBlock: NpBlockDefinition = {
  type: "testimonials",
  label: "Testimonials",
  description: "Customer quote cards. Use as social proof under a hero or above a CTA.",
  icon: "💬",
  summaryFields: ["heading"],
  category: "Content",
  source: "built-in",
  keywords: ["quotes", "testimonials", "social proof", "reviews"],
  defaultProps: {
    heading: "Loved by teams shipping faster",
    items: [
      {
        quote:
          "We rebuilt our marketing site in a weekend. The block library and theme system fit our brand without forking templates.",
        name: "Mei Tanaka",
        role: "Engineering Lead, Aurora",
        rating: 5,
      },
      {
        quote:
          "The plugin SDK gave us a clean place to land custom CMS logic. Six months in and our site has grown without spaghetti.",
        name: "Carlos Mendes",
        role: "Founder, Switchback",
        rating: 5,
      },
      {
        quote:
          "Editors stopped opening tickets the day we shipped the page builder. Container contracts mean nobody can break a layout.",
        name: "Priya Raman",
        role: "Head of Content, Larkfield",
        rating: 5,
      },
    ],
  },
  propsSchema: [
    {
      name: "heading",
      label: "Heading",
      type: "text",
      defaultValue: "Loved by teams shipping faster",
    },
    {
      name: "items",
      label: "Testimonials",
      type: "array",
      itemSchema: [
        { name: "quote", label: "Quote", type: "textarea", required: true },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "role", label: "Role / company", type: "text" },
        { name: "avatar", label: "Avatar URL", type: "url" },
        {
          name: "rating",
          label: "Rating (0–5)",
          type: "number",
          min: 0,
          max: 5,
          step: 1,
        },
      ],
      itemDefault: {
        quote: "Add a memorable quote.",
        name: "Customer name",
        role: "Role, Company",
        rating: 5,
      },
    },
  ],
  render: (props) => {
    const heading = readString(props.heading, "Loved by teams shipping faster");
    const items = Array.isArray(props.items)
      ? (props.items.map(readItem).filter(Boolean) as TestimonialItem[])
      : [];

    const sectionStyle: CSSProperties = {
      padding: "4rem 1.5rem",
      background: "var(--np-color-muted, #f8fafc)",
    };
    const wrapperStyle: CSSProperties = {
      maxWidth: "72rem",
      margin: "0 auto",
      display: "grid",
      gap: "2rem",
    };
    // `auto-fit` + an 18rem floor lets the grid pack as many columns
    // as fit within the 72rem wrapper (typically 1–4 depending on
    // viewport). Rows wrap on overflow, and `min(100%, 18rem)` lets
    // a single card still fill the wrapper on phones instead of
    // snapping to 18rem.
    const gridStyle: CSSProperties = {
      display: "grid",
      gap: "1.5rem",
      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
    };

    return (
      <section className="np-block-testimonials" style={sectionStyle}>
        <div style={wrapperStyle}>
          {heading ? (
            <h2
              style={{
                margin: 0,
                textAlign: "center",
                fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)",
                color: "var(--np-color-foreground, #0f172a)",
              }}
            >
              {heading}
            </h2>
          ) : null}
          {items.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--np-color-muted-foreground, #64748b)" }}>
              Add testimonial items in the block editor.
            </p>
          ) : (
            <div style={gridStyle}>
              {items.map((item, index) => (
                <article
                  key={index}
                  className="np-block-testimonials__card"
                  style={{
                    background: "var(--np-color-card, #ffffff)",
                    border: "1px solid var(--np-color-border, #e2e8f0)",
                    borderRadius: "1rem",
                    padding: "1.75rem",
                    // Flex column so the footer's `marginTop: auto`
                    // pushes it to the bottom — that's how cards in
                    // a row line up their author footers when the
                    // quotes above are different lengths.
                    display: "flex",
                    flexDirection: "column",
                    gap: "1rem",
                    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
                  }}
                >
                  {item.rating !== undefined ? (
                    <div
                      aria-label={`Rated ${item.rating} out of 5`}
                      style={{ color: "#f59e0b", letterSpacing: "0.15em" }}
                    >
                      {/* Star colors stay literal — amber/gray is
                          semantic to "rating", not part of the brand
                          palette. Themes that want a different rating
                          color override `.np-block-testimonials__card
                          [aria-label^="Rated"]` from their CSS. */}
                      {"★".repeat(item.rating)}
                      <span style={{ color: "#cbd5e1" }}>
                        {"★".repeat(5 - item.rating)}
                      </span>
                    </div>
                  ) : null}
                  <blockquote
                    style={{
                      margin: 0,
                      fontSize: "1.05rem",
                      lineHeight: 1.65,
                      color: "var(--np-color-card-foreground, #1e293b)",
                    }}
                  >
                    “{item.quote}”
                  </blockquote>
                  <footer
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      marginTop: "auto",
                    }}
                  >
                    {item.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.avatar}
                        alt=""
                        width={40}
                        height={40}
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "999px",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <div
                        aria-hidden
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "999px",
                          background: "var(--np-color-accent, #e0e7ff)",
                          color: "var(--np-color-accent-foreground, #4338ca)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          fontSize: "0.95rem",
                        }}
                      >
                        {/* `Array.from` splits on grapheme-ish
                            boundaries so the first letter of "한
                            국" / "🚀 Rocket" / etc. doesn't tear a
                            surrogate pair into a replacement
                            character. */}
                        {(Array.from(item.name)[0] ?? "?").toUpperCase()}
                      </div>
                    )}
                    <div style={{ display: "grid" }}>
                      <span style={{ fontWeight: 600, color: "var(--np-color-card-foreground, #0f172a)" }}>
                        {item.name}
                      </span>
                      {item.role ? (
                        <span style={{ fontSize: "0.85rem", color: "var(--np-color-muted-foreground, #64748b)" }}>
                          {item.role}
                        </span>
                      ) : null}
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  },
};
