import { findDocuments } from "@nexpress/core";
import type { NpRouteRenderProps } from "@nexpress/theme";
import * as React from "react";

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

export async function DefaultTagArchiveRoute({
  params,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const slug = params.slug ?? "";
  const tagResult = await findDocuments<Record<string, unknown>>("tags", {
    where: { slug },
    limit: 1,
  });
  const tag = tagResult.docs[0] ?? null;
  const tagId = asString(tag?.id);
  const posts = tagId
    ? await findDocuments<Record<string, unknown>>("posts", {
        where: { status: "published", tags: tagId },
        sort: "-publishedAt",
        limit: 24,
      })
    : { docs: [], totalDocs: 0 };
  const title = asString(tag?.name) ?? slug;
  const description =
    asString(tag?.description) ??
    `Posts tagged ${title}, collected from the default NexPress publication.`;
  const [feature, ...rest] = posts.docs;

  return (
    <main className="np-default-tag">
      <section className="np-default-tag-hero">
        <nav className="np-default-tag-crumbs" aria-label="Breadcrumb">
          <a href="/">Writing</a>
          <span>/</span>
          <span>Tags</span>
        </nav>
        <span className="np-default-tag-mark">{slug}</span>
        <h1>
          {title} <span>{posts.totalDocs.toString()} posts</span>
        </h1>
        <p>{description}</p>
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
        ) : (
          <p className="np-default-tag-empty">No posts in this tag yet.</p>
        )}
      </section>
    </main>
  );
}
