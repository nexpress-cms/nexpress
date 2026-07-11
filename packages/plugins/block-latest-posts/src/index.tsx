import type { CSSProperties } from "react";

import type { NpBlockDefinition, NpBlockRenderContext } from "@nexpress/blocks";
import { definePlugin } from "@nexpress/plugin-sdk";

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

function readLayout(value: unknown): "list" | "grid" {
  return value === "grid" ? "grid" : "list";
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" && !(value instanceof Date)) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface PostLike {
  id?: string;
  slug?: string;
  title?: string;
  excerpt?: string;
  publishedAt?: string;
  createdAt?: string;
  coverImage?: string;
}

function readPost(doc: unknown): PostLike | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  return {
    id: typeof d.id === "string" ? d.id : undefined,
    slug: typeof d.slug === "string" ? d.slug : undefined,
    title: typeof d.title === "string" ? d.title : undefined,
    excerpt: typeof d.excerpt === "string" ? d.excerpt : undefined,
    publishedAt: typeof d.publishedAt === "string" ? d.publishedAt : undefined,
    createdAt: typeof d.createdAt === "string" ? d.createdAt : undefined,
    coverImage: typeof d.coverImage === "string" ? d.coverImage : undefined,
  };
}

async function LatestPostsBody({
  collection,
  limit,
  layout,
  heading,
  ctx,
}: {
  collection: string;
  limit: number;
  layout: "list" | "grid";
  heading: string;
  ctx: NpBlockRenderContext;
}) {
  // No try/catch — `renderBlocks` wraps every block in `SafeBlock`,
  // which catches rejections from this Promise<ReactElement> and renders
  // the framework's error placeholder. We still want a graceful empty
  // state for the success-but-zero-rows case below.
  const result = await ctx.content.find(collection, {
    limit,
    sort: "-publishedAt",
    where: { status: "published" },
  });
  const posts = result.docs.map(readPost).filter((p): p is PostLike => p !== null);

  const wrapperStyle: CSSProperties = {
    margin: "1.5rem 0",
  };

  const headingStyle: CSSProperties = {
    fontSize: "1.5rem",
    fontWeight: 600,
    margin: "0 0 1rem",
    color: "#0f172a",
  };

  if (posts.length === 0) {
    return (
      <div className="np-block-latest-posts np-block-latest-posts--empty" style={wrapperStyle}>
        {heading.length > 0 ? <h2 style={headingStyle}>{heading}</h2> : null}
        <p style={{ color: "#64748b", fontStyle: "italic" }}>No posts to show yet.</p>
      </div>
    );
  }

  const listStyle: CSSProperties =
    layout === "grid"
      ? {
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))",
          listStyle: "none",
          padding: 0,
          margin: 0,
        }
      : {
          display: "flex",
          flexDirection: "column",
          gap: "0.875rem",
          listStyle: "none",
          padding: 0,
          margin: 0,
        };

  const cardStyle: CSSProperties = {
    padding: "1rem",
    borderRadius: "0.5rem",
    border: "1px solid #e2e8f0",
    backgroundColor: "#ffffff",
  };

  return (
    <div className="np-block-latest-posts" style={wrapperStyle}>
      {heading.length > 0 ? <h2 style={headingStyle}>{heading}</h2> : null}
      <ul style={listStyle}>
        {posts.map((post) => {
          const date = formatDate(post.publishedAt ?? post.createdAt);
          const href = post.slug ? `/${post.slug}` : "#";
          return (
            <li key={post.id ?? post.slug ?? post.title} style={cardStyle}>
              <a
                href={href}
                style={{
                  display: "block",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <h3
                  style={{
                    fontSize: "1.125rem",
                    fontWeight: 600,
                    margin: "0 0 0.25rem",
                    color: "#0f172a",
                  }}
                >
                  {post.title ?? post.slug ?? "(untitled)"}
                </h3>
                {date.length > 0 ? (
                  <time
                    style={{
                      fontSize: "0.75rem",
                      color: "#64748b",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    {date}
                  </time>
                ) : null}
                {post.excerpt ? (
                  <p
                    style={{
                      margin: "0.5rem 0 0",
                      color: "#475569",
                      fontSize: "0.875rem",
                      lineHeight: 1.55,
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 3,
                      overflow: "hidden",
                    }}
                  >
                    {post.excerpt}
                  </p>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const latestPostsBlock: NpBlockDefinition = {
  type: "latest-posts",
  label: "Latest posts",
  description: "Lists the most recent published documents from a collection.",
  icon: "📰",
  defaultProps: {
    collection: "posts",
    limit: 5,
    layout: "list",
    heading: "Latest posts",
  },
  propsSchema: [
    {
      name: "collection",
      label: "Collection",
      type: "collection",
      required: true,
      defaultValue: "posts",
      description: "Pick from the collections registered in this site.",
    },
    {
      name: "limit",
      label: "How many to show",
      type: "number",
      defaultValue: 5,
      description: "1–50.",
    },
    {
      name: "layout",
      label: "Layout",
      type: "select",
      defaultValue: "list",
      options: [
        { label: "List (stacked)", value: "list" },
        { label: "Grid (responsive)", value: "grid" },
      ],
    },
    {
      name: "heading",
      label: "Heading",
      type: "text",
      translatable: true,
      defaultValue: "Latest posts",
      description: "Leave empty to render without a heading.",
    },
  ],
  render: (props, _children, ctx) => {
    const collection = readString(props.collection, "posts");
    const limit = readNumber(props.limit, 5);
    const layout = readLayout(props.layout);
    const heading = readString(props.heading, "");

    if (!ctx) {
      return (
        <div className="np-block-latest-posts np-block-latest-posts--no-ctx">
          <p style={{ fontSize: "0.875rem", color: "#94a3b8" }}>
            Latest posts: data ctx unavailable. Pass <code>createDefaultBlockRenderContext()</code>{" "}
            from
            <code>@nexpress/next</code> to renderBlocks to enable.
          </p>
        </div>
      );
    }
    return (
      <LatestPostsBody
        collection={collection}
        limit={limit}
        layout={layout}
        heading={heading}
        ctx={ctx}
      />
    );
  },
};

export const latestPostsPlugin = definePlugin({
  manifest: {
    id: "block-latest-posts",
    version: "0.1.0",
    name: "Latest posts block",
    description: "Adds a server-rendered list of the most recent posts in a collection.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  blocks: [latestPostsBlock] satisfies NpBlockDefinition[],
});

export default latestPostsPlugin;
