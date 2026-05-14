import * as React from "react";
import { renderRichText } from "@nexpress/editor";
import type { NpRichTextContent } from "@nexpress/editor";

import type { NpTemplateRenderProps } from "@nexpress/theme";

import { resolveMagazineSettings } from "../settings-helpers.js";

interface FeatureDoc {
  title?: string;
  kicker?: string;
  deck?: string;
  excerpt?: string;
  content?: NpRichTextContent;
  publishedAt?: string;
  authorName?: string;
  author?: { name?: string } | string;
  readingTime?: number | string;
  categories?: Array<{ name?: string } | string>;
}

/**
 * Long-form post template — kicker eyebrow, centered display
 * headline, italic deck paragraph, centered byline rule, and a
 * Lexical body that pulls a drop cap on the first paragraph
 * (CSS-driven, see `styles.ts`).
 *
 * Field shape it reads from the doc:
 *
 *   - `kicker` (text) — small-caps eyebrow above the title.
 *     Falls back to the first category name when unset.
 *   - `title` (text)
 *   - `deck` (textarea) — short italic paragraph under the
 *     title. Falls back to `excerpt`.
 *   - `content` (richText) — Lexical body. First paragraph
 *     gets the drop cap.
 *   - `author` (relationship → authors) or `authorName` (text)
 *     for sites without the authors collection.
 *   - `publishedAt`, `readingTime` — meta row segments.
 *
 * Settings: `showAuthorByline` toggles the byline rule when
 * the operator prefers anonymous editorial.
 */
export async function PostFeatureTemplate({
  doc: rawDoc,
}: NpTemplateRenderProps): Promise<React.ReactElement> {
  const doc = rawDoc as FeatureDoc;
  const settings = await resolveMagazineSettings();
  const title = doc.title ?? "Untitled";
  const kicker = doc.kicker ?? deriveKicker(doc);
  const deck = doc.deck ?? doc.excerpt;
  const author = resolveAuthor(doc);
  const dateLabel = formatPublished(doc.publishedAt);
  const reading = readingLabel(doc.readingTime);

  return (
    <article className="np-magazine-feature">
      {kicker ? <p className="np-magazine-feature-kicker">{kicker}</p> : null}
      <h1 className="np-magazine-feature-title">{title}</h1>
      {deck ? <p className="np-magazine-feature-deck">{deck}</p> : null}
      {settings.showAuthorByline && (author || dateLabel || reading) ? (
        <p className="np-magazine-feature-byline">
          {author ? (
            <>
              By <strong>{author}</strong>
            </>
          ) : null}
          {author && (dateLabel || reading) ? " · " : null}
          {dateLabel}
          {dateLabel && reading ? " · " : null}
          {reading ? `${reading} read` : null}
        </p>
      ) : null}
      <div className="np-magazine-feature-body">
        {doc.content ? renderRichText(doc.content) : null}
      </div>
    </article>
  );
}

function deriveKicker(doc: FeatureDoc): string | null {
  if (Array.isArray(doc.categories) && doc.categories.length > 0) {
    const first = doc.categories[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "name" in first) {
      const name = (first as { name?: unknown }).name;
      if (typeof name === "string") return name;
    }
  }
  return null;
}

function resolveAuthor(doc: FeatureDoc): string | null {
  if (doc.authorName) return doc.authorName;
  if (!doc.author) return null;
  if (typeof doc.author === "string") return doc.author;
  return doc.author.name ?? null;
}

function formatPublished(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

function readingLabel(value: number | string | undefined): string | null {
  if (!value && value !== 0) return null;
  if (typeof value === "number") return `${value.toString()} min`;
  return value;
}
