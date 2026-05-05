import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "../types.js";

interface GalleryImage {
  src: string;
  alt: string;
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

const parseImages = (value: unknown): GalleryImage[] => {
  const fallback: GalleryImage[] = [
    {
      src: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80",
      alt: "Workspace setup",
    },
    {
      src: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
      alt: "Team collaboration",
    },
    {
      src: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80",
      alt: "Product planning board",
    },
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

  const images = source
    .filter(isRecord)
    .map((item) => ({
      src: readString(item.src, fallback[0]?.src ?? ""),
      alt: readString(item.alt, "Gallery image"),
    }))
    .filter((item) => item.src.length > 0);

  return images.length > 0 ? images : fallback;
};

export const imageGalleryBlock: NpBlockDefinition = {
  type: "image-gallery",
  label: "Image Gallery",
  description: "Responsive gallery block for portfolios, campaigns, or product storytelling.",
  icon: "🖼️",
  defaultProps: {
    heading: "Moments from the workflow",
    columns: 3,
    images: JSON.stringify(
      [
        {
          src: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80",
          alt: "Workspace setup",
        },
        {
          src: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
          alt: "Team collaboration",
        },
        {
          src: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80",
          alt: "Product planning board",
        },
      ],
      null,
      2,
    ),
  },
  propsSchema: [
    { name: "heading", label: "Heading", type: "text", defaultValue: "Moments from the workflow" },
    { name: "columns", label: "Columns", type: "number", defaultValue: 3 },
    {
      name: "images",
      label: "Images",
      type: "textarea",
      defaultValue: JSON.stringify(
        [
          {
            src: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80",
            alt: "Workspace setup",
          },
          {
            src: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
            alt: "Team collaboration",
          },
          {
            src: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80",
            alt: "Product planning board",
          },
        ],
        null,
        2,
      ),
    },
  ],
  render: (props) => {
    const heading = readString(props.heading, "Moments from the workflow");
    const columns = Math.max(1, Math.min(4, readNumber(props.columns, 3)));
    const images = parseImages(props.images);

    const gridStyle: CSSProperties = {
      display: "grid",
      gap: "1rem",
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    };

    return (
      <section className="nx-block-image-gallery" style={{ padding: "4rem 1.5rem", background: "#ffffff" }}>
        <div style={{ maxWidth: "72rem", margin: "0 auto", display: "grid", gap: "1.5rem" }}>
          <h2 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 2.8rem)", color: "#111827" }}>{heading}</h2>
          <div style={gridStyle}>
            {images.map((image) => (
              <figure
                key={`${image.src}-${image.alt}`}
                className="nx-block-image-gallery__item"
                style={{ margin: 0, overflow: "hidden", borderRadius: "1.25rem", background: "#e5e7eb" }}
              >
                <img src={image.src} alt={image.alt} style={{ display: "block", width: "100%", height: "18rem", objectFit: "cover" }} />
              </figure>
            ))}
          </div>
        </div>
      </section>
    );
  },
};
