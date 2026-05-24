import { findDocuments } from "@nexpress/core";
import type { NpRouteRenderProps } from "@nexpress/theme";
import type { Metadata } from "next";
import * as React from "react";

import { findPublishedPostsForTag } from "../post-tags.js";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function formatDate(value: unknown): string {
  const iso = asString(value);
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10).replaceAll("-", "·");
  } catch {
    return "";
  }
}

interface TagSummary {
  id: string;
  name: string;
  slug: string;
  description?: string;
  count: number;
}

async function loadTagBySlug(slug: string): Promise<Record<string, unknown> | null> {
  const tagResult = await findDocuments<Record<string, unknown>>("tags", {
    where: { slug },
    limit: 1,
  });
  return tagResult.docs[0] ?? null;
}

async function countPostsForTag(tagId: string): Promise<number> {
  const result = await findPublishedPostsForTag(tagId, { limit: 1 });
  return result.totalDocs;
}

async function loadTagCloud(activeSlug: string): Promise<TagSummary[]> {
  const result = await findDocuments<Record<string, unknown>>("tags", {
    sort: "name",
    limit: 24,
  });

  const rows: TagSummary[] = [];
  for (const tag of result.docs) {
    const id = asString(tag.id);
    const name = asString(tag.name);
    const slug = asString(tag.slug);
    if (!id || !name || !slug) continue;

    rows.push({
      id,
      name,
      slug,
      description: asString(tag.description) ?? undefined,
      count: await countPostsForTag(id),
    });
  }

  return rows
    .filter((tag) => tag.count > 0 || tag.slug === activeSlug)
    .sort((a, b) => {
      if (a.slug === activeSlug) return -1;
      if (b.slug === activeSlug) return 1;
      return b.count - a.count || a.name.localeCompare(b.name);
    })
    .slice(0, 12);
}

export async function DefaultTagArchiveRoute({
  params,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const slug = params.slug ?? "";
  const tag = await loadTagBySlug(slug);
  const tagId = asString(tag?.id);
  const posts = tagId
    ? await findPublishedPostsForTag(tagId, { limit: 24 })
    : { docs: [], totalDocs: 0 };
  const tagCloud = await loadTagCloud(slug);
  const title = asString(tag?.name) ?? slug;
  const description =
    asString(tag?.description) ??
    `Posts tagged ${title}, collected from the default NexPress publication.`;
  const [feature, ...rest] = posts.docs;
  const hasPosts = posts.docs.length > 0;

  return (
    <main className="np-default-tag">
      <section className="np-default-tag-hero">
        <nav className="np-default-tag-crumbs" aria-label="Breadcrumb">
          <a href="/">Writing</a>
          <span>/</span>
          <a href="/blog">Archive</a>
        </nav>
        <span className="np-default-tag-mark">topic archive</span>
        <h1>
          {title} <span>{posts.totalDocs.toString()} posts</span>
        </h1>
        <p>{description}</p>
      </section>

      <section className="np-default-tag-metrics" aria-label="Archive metrics">
        <div>
          <span>Topic</span>
          <strong>{title}</strong>
          <p>{slug}</p>
        </div>
        <div>
          <span>Published</span>
          <strong>{posts.totalDocs.toString()}</strong>
          <p>{posts.totalDocs === 1 ? "post" : "posts"}</p>
        </div>
        <div>
          <span>Graph</span>
          <strong>{tagCloud.length.toString()}</strong>
          <p>active tags</p>
        </div>
      </section>

      {feature ? (
        <section className="np-default-tag-feature" aria-label="Featured post">
          <a href={`/blog/${asString(feature.slug) ?? ""}`}>
            <div className="np-default-tag-feature-cover" aria-hidden="true" />
            <div>
              <span>Featured · the long one</span>
              <h2>{asString(feature.title) ?? "Untitled"}</h2>
              {asString(feature.excerpt) ? <p>{asString(feature.excerpt)}</p> : null}
              <small>{formatDate(feature.publishedAt)}</small>
            </div>
          </a>
        </section>
      ) : null}

      <section className="np-default-tag-list-wrap">
        <div className="np-section-head">
          <h2>Archive</h2>
          <span className="np-section-head-meta">
            {posts.totalDocs.toString()} posts · newest first
          </span>
        </div>
        {rest.length > 0 ? (
          <ul className="np-default-tag-list">
            {rest.map((post, index) => {
              const href = `/blog/${asString(post.slug) ?? ""}`;
              return (
                <li key={asString(post.id) ?? `${href}-${index.toString()}`}>
                  <time>{formatDate(post.publishedAt)}</time>
                  <div>
                    <h3>
                      <a href={href}>{asString(post.title) ?? "Untitled"}</a>
                    </h3>
                    {asString(post.excerpt) ? <p>{asString(post.excerpt)}</p> : null}
                  </div>
                  <span>{(index + 2).toString().padStart(2, "0")}</span>
                </li>
              );
            })}
          </ul>
        ) : hasPosts ? null : (
          <p className="np-default-tag-empty">No posts in this tag yet.</p>
        )}
      </section>

      {tagCloud.length > 0 ? (
        <section className="np-default-tag-cloud" aria-label="Browse tags">
          <div className="np-section-head">
            <h2>Browse the graph</h2>
            <span className="np-section-head-meta">tags with live post counts</span>
          </div>
          <ul>
            {tagCloud.map((item) => (
              <li key={item.id}>
                <a href={`/tag/${item.slug}`} data-active={item.slug === slug ? "true" : undefined}>
                  <span>{item.name}</span>
                  <strong>{item.count.toString()}</strong>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

export async function defaultTagArchiveMetadata({ params }: NpRouteRenderProps): Promise<Metadata> {
  const slug = params.slug ?? "";
  const tag = await loadTagBySlug(slug);
  const title = asString(tag?.name) ?? slug;
  const description =
    asString(tag?.description) ??
    `Posts tagged ${title}, collected from the default NexPress publication.`;

  return {
    title: `${title} archive`,
    description,
    alternates: { canonical: `/tag/${slug}` },
  };
}
