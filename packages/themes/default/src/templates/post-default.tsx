import { renderRichText } from "@nexpress/editor/server";
import type { NpRichTextContent } from "@nexpress/editor";
import { getMediaUrl } from "@nexpress/core";
import Link from "next/link";

import type { NpTemplateRenderProps } from "@nexpress/theme";
import {
  findPublishedPostsForTag,
  loadTagIdsForPost,
  loadTagsByIds,
  type DefaultThemeTagItem,
} from "../post-tags.js";

/**
 * Post detail template. Produces a centered article column with
 * a small meta header (date / author / reading time) and the
 * Lexical body. Renders defensively — sites can attach extra
 * fields (cover, tags, related) and the template surfaces what
 * exists without breaking when fields are missing.
 *
 * The hero / cover image, when present, sits above the title in
 * a constrained 16:9 frame so portrait images don't blow up the
 * viewport. Tags render as small badges at the top of the meta
 * row when the doc carries them; otherwise we skip the row.
 */

interface PostDoc {
  id?: string;
  slug?: string;
  title?: string;
  excerpt?: string;
  content?: NpRichTextContent;
  publishedAt?: string | Date;
  author?: { name?: string; slug?: string } | string;
  authorName?: string;
  wpOriginalAuthor?: string;
  readingTime?: number | string;
  cover?: { url?: string; alt?: string } | string | null;
  coverImage?: string | null;
  tags?: Array<string | { id?: string; name?: string; label?: string; slug?: string }> | null;
}

interface RelatedPost {
  id?: string;
  slug?: string;
  title?: string;
  excerpt?: string;
  publishedAt?: string | Date;
  readingTime?: number | string;
}

function localCoverUrl(value: PostDoc["cover"]): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.url ?? null;
}

function coverAlt(value: PostDoc["cover"], fallback: string): string {
  if (value && typeof value === "object" && value.alt) return value.alt;
  return fallback;
}

function authorLabel(author: PostDoc["author"]): string | null {
  if (!author) return null;
  if (typeof author === "string") {
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(author) ? null : author;
  }
  return author.name ?? null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function resolveCover(post: PostDoc): Promise<string | null> {
  const local = localCoverUrl(post.cover);
  if (local) return local;
  if (!post.coverImage) return null;
  return getMediaUrl(post.coverImage, { variant: "large" });
}

async function resolveTagItems(post: PostDoc): Promise<DefaultThemeTagItem[]> {
  const tags = post.tags;
  if (!tags || tags.length === 0) {
    return post.id ? loadTagsByIds(await loadTagIdsForPost(post.id)) : [];
  }

  const resolved: DefaultThemeTagItem[] = [];
  for (const tag of tags) {
    if (typeof tag === "string") {
      resolved.push(...(await loadTagsByIds([tag])));
      continue;
    }
    const label = tag.label ?? tag.name ?? tag.slug ?? tag.id ?? "tag";
    if (tag.id && tag.slug) {
      resolved.push({ id: tag.id, label, slug: tag.slug });
    }
  }

  return resolved;
}

async function resolveRelatedPosts(
  post: PostDoc,
  tags: DefaultThemeTagItem[],
): Promise<RelatedPost[]> {
  if (tags.length === 0) return [];

  const results = await Promise.all(
    tags.map((tag) => findPublishedPostsForTag(tag.id, { limit: 6 })),
  );
  const related = new Map<string, RelatedPost>();

  for (const result of results) {
    for (const candidate of result.docs) {
      const id = asString(candidate.id);
      const slug = asString(candidate.slug);
      if (id === post.id || slug === post.slug) continue;
      const key = id ?? slug;
      if (!key || related.has(key)) continue;

      related.set(key, {
        id: asString(candidate.id) ?? undefined,
        slug: asString(candidate.slug) ?? undefined,
        title: asString(candidate.title) ?? "Untitled",
        excerpt: asString(candidate.excerpt) ?? undefined,
        publishedAt: candidate.publishedAt as string | Date | undefined,
        readingTime: candidate.readingTime as number | string | undefined,
      });
    }
  }

  return Array.from(related.values())
    .sort((a, b) => dateValue(b.publishedAt) - dateValue(a.publishedAt))
    .slice(0, 3);
}

function formatDate(value: PostDoc["publishedAt"]): string | null {
  if (!value) return null;
  try {
    const d = typeof value === "string" ? new Date(value) : value;
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

function readingTimeLabel(value: PostDoc["readingTime"]): string | null {
  if (!value && value !== 0) return null;
  if (typeof value === "number") return `${value.toString()} min read`;
  return value;
}

function compactDate(value: PostDoc["publishedAt"]): string | null {
  if (!value) return null;
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10).replaceAll("-", ".");
  } catch {
    return null;
  }
}

function dateValue(value: PostDoc["publishedAt"]): number {
  if (!value) return 0;
  const d = typeof value === "string" ? new Date(value) : value;
  const ms = d.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function tagHref(tag: DefaultThemeTagItem): string {
  return `/tag/${tag.slug}`;
}

function postHref(post: RelatedPost): string {
  return post.slug ? `/blog/${post.slug}` : "#";
}

export async function PostDefaultTemplate({ doc }: NpTemplateRenderProps) {
  const post = doc as PostDoc;
  const title = post.title ?? "Untitled";
  const cover = await resolveCover(post);
  const author = post.authorName ?? post.wpOriginalAuthor ?? authorLabel(post.author);
  const date = formatDate(post.publishedAt);
  const dateCompact = compactDate(post.publishedAt);
  const reading = readingTimeLabel(post.readingTime);
  const tags = await resolveTagItems(post);
  const related = await resolveRelatedPosts(post, tags);
  const primaryTag = tags[0];

  return (
    <article className="np-post np-post-default">
      <nav className="np-post-crumbs" aria-label="Breadcrumb">
        <Link href="/">Writing</Link>
        <span>/</span>
        {primaryTag ? (
          <Link href={tagHref(primaryTag)}>{primaryTag.label}</Link>
        ) : (
          <span>Article</span>
        )}
      </nav>

      <header className="np-post-hero">
        <div className="np-post-hero-copy">
          {primaryTag ? <span className="np-post-kicker">{primaryTag.label}</span> : null}
          <h1 className="np-post-title">{title}</h1>
          {post.excerpt ? <p className="np-post-excerpt">{post.excerpt}</p> : null}
        </div>
        <aside className="np-post-rail" aria-label="Article metadata">
          <dl>
            {author ? (
              <div>
                <dt>Author</dt>
                <dd>{author}</dd>
              </div>
            ) : null}
            {date ? (
              <div>
                <dt>Published</dt>
                <dd>
                  <time dateTime={String(post.publishedAt)}>{date}</time>
                </dd>
              </div>
            ) : null}
            {reading ? (
              <div>
                <dt>Reading time</dt>
                <dd>{reading}</dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </header>

      <figure className={cover ? "np-post-cover" : "np-post-cover np-post-cover-fallback"}>
        {cover ? (
          <img src={cover} alt={coverAlt(post.cover, title)} />
        ) : (
          <>
            <span>{dateCompact ?? "Article"}</span>
            <strong>{title.slice(0, 2).toUpperCase()}</strong>
          </>
        )}
      </figure>

      <div className="np-post-body">{post.content ? renderRichText(post.content) : null}</div>

      {tags.length > 0 ? (
        <footer className="np-post-footer">
          <span>Filed under</span>
          <ul className="np-post-tags">
            {tags.map((tag) => {
              const href = tagHref(tag);
              return (
                <li key={tag.id}>
                  <Link href={href}>{tag.label}</Link>
                </li>
              );
            })}
          </ul>
        </footer>
      ) : null}

      {related.length > 0 ? (
        <section className="np-post-related" aria-label="Related posts">
          <div className="np-section-head">
            <h2>Related notes</h2>
            <span className="np-section-head-meta">via {primaryTag?.label ?? "shared tags"}</span>
          </div>
          <ul className="np-post-related-list">
            {related.map((item) => (
              <li key={item.id ?? item.slug ?? item.title}>
                <Link href={postHref(item)}>
                  <span>{compactDate(item.publishedAt) ?? "Read next"}</span>
                  <strong>{item.title ?? "Untitled"}</strong>
                  {item.excerpt ? <p>{item.excerpt}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
