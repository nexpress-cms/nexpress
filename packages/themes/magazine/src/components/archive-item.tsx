import * as React from "react";

import { toRoman } from "../lib/roman.js";

export interface MagazineArchiveItemDoc {
  id?: string;
  slug?: string;
  title?: string;
  excerpt?: string;
  publishedAt?: string | Date;
  authorName?: string;
  author?: { name?: string } | string | null;
  categories?: Array<{ name?: string } | string>;
  tags?: Array<{ name?: string } | string>;
  coverImage?: { url?: string; alt?: string } | string | null;
}

export interface MagazineArchiveItemProps {
  doc: MagazineArchiveItemDoc;
  /** Override the link target. Defaults to `/blog/<slug>`. */
  href?: string;
  /** Roman-numeral fallback figure when no cover image is present. */
  romanIndex?: number;
  /** Gradient variant when no cover image is present (2–7). */
  coverVariant?: 2 | 3 | 4 | 5 | 6 | 7;
}

const COVER_VARIANTS: Array<2 | 3 | 4 | 5 | 6 | 7> = [2, 3, 4, 5, 6, 7];

function bylineLabel(doc: MagazineArchiveItemDoc): string {
  if (doc.authorName) return doc.authorName;
  if (doc.author && typeof doc.author === "object" && doc.author.name) {
    return doc.author.name;
  }
  if (typeof doc.author === "string") return doc.author;
  return "Editorial";
}

function archiveSection(doc: MagazineArchiveItemDoc): string {
  if (Array.isArray(doc.categories) && doc.categories.length > 0) {
    const first = doc.categories[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "name" in first) {
      const name = (first as { name?: unknown }).name;
      if (typeof name === "string") return name;
    }
  }
  if (Array.isArray(doc.tags) && doc.tags.length > 0) {
    const first = doc.tags[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "name" in first) {
      const name = (first as { name?: unknown }).name;
      if (typeof name === "string") return name;
    }
  }
  return "Story";
}

function dateLabel(value: MagazineArchiveItemDoc["publishedAt"]): string {
  if (!value) return "";
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

function coverImage(
  value: MagazineArchiveItemDoc["coverImage"],
): { url: string; alt: string } | null {
  if (!value) return null;
  if (typeof value === "string") return { url: value, alt: "" };
  if (typeof value.url !== "string" || value.url.length === 0) return null;
  return { url: value.url, alt: value.alt ?? "" };
}

function postHref(doc: MagazineArchiveItemDoc): string {
  if (!doc.slug) return "#";
  return doc.slug.startsWith("/") ? doc.slug : `/blog/${doc.slug}`;
}

export function MagazineArchiveItem({
  doc,
  href,
  romanIndex,
  coverVariant,
}: MagazineArchiveItemProps): React.ReactElement {
  const cover = coverImage(doc.coverImage);
  const variant =
    coverVariant ?? COVER_VARIANTS[(romanIndex ?? 0) % COVER_VARIANTS.length]!;
  const sectionLabel = archiveSection(doc);
  const date = dateLabel(doc.publishedAt);
  const linkTarget = href ?? postHref(doc);

  return (
    <a className="np-magazine-archive-item" href={linkTarget}>
      <div
        className={`np-magazine-archive-item-cover np-magazine-cover-${variant.toString()}`}
        data-has-image={cover ? "true" : undefined}
      >
        {cover ? (
          <img
            className="np-magazine-cover-image"
            src={cover.url}
            alt={cover.alt}
            loading="lazy"
          />
        ) : (
          <div className="np-magazine-archive-item-cover-fig">
            {toRoman((romanIndex ?? 0) + 1)}
          </div>
        )}
      </div>
      <div>
        <p className="np-magazine-archive-item-section">
          {date ? `${sectionLabel} · ${date}` : sectionLabel}
        </p>
        <h3 className="np-magazine-archive-item-title">
          {doc.title ?? "Untitled"}
        </h3>
        <p className="np-magazine-archive-item-byline">{bylineLabel(doc)}</p>
      </div>
    </a>
  );
}
