import { renderRichText } from "@nexpress/editor/server";
import type { NpRichTextContent } from "@nexpress/editor";
import type { NpTemplateRenderProps } from "@nexpress/theme";

import { hydrateCommunityPostTags, type CommunityTagValue } from "../post-tags.js";

interface CommunityArticle {
  title?: string;
  excerpt?: string;
  content?: NpRichTextContent;
  publishedAt?: string | Date;
  author?: string | { name?: string };
  authorName?: string;
  readingTime?: string | number;
  tags?: CommunityTagValue[];
}

function longDate(value: CommunityArticle["publishedAt"]): string | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function authorLabel(post: CommunityArticle): string {
  if (post.authorName) return post.authorName;
  if (typeof post.author === "object" && post.author?.name) return post.author.name;
  if (typeof post.author === "string" && !/^[0-9a-f-]{36}$/i.test(post.author)) return post.author;
  return "커뮤니티 편집팀";
}

function readingLabel(value: CommunityArticle["readingTime"]): string | null {
  if (typeof value === "number") return `${value.toString()}분 읽기`;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function tagsOf(post: CommunityArticle): string[] {
  return (post.tags ?? [])
    .map((tag) => (typeof tag === "string" ? tag : (tag.label ?? tag.name)))
    .filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
}

export async function PostDefaultTemplate({ doc }: NpTemplateRenderProps) {
  const [post] = await hydrateCommunityPostTags([doc as CommunityArticle]);
  if (!post) return null;
  const date = longDate(post.publishedAt);
  const reading = readingLabel(post.readingTime);
  const tags = tagsOf(post);

  return (
    <main className="np-community-page np-community-post-page">
      <article className="np-community-article">
        <nav className="np-community-breadcrumbs" aria-label="현재 위치">
          <a href="/">홈</a>
          <span>›</span>
          <a href="/blog">이야기</a>
        </nav>
        <header className="np-community-article-header">
          {tags[0] ? <span className="np-community-kicker">{tags[0]}</span> : null}
          <h1>{post.title ?? "제목 없는 글"}</h1>
          {post.excerpt ? <p>{post.excerpt}</p> : null}
          <div className="np-community-article-meta">
            <strong>{authorLabel(post)}</strong>
            {date ? <time>{date}</time> : null}
            {reading ? <span>{reading}</span> : null}
          </div>
        </header>
        <div className="np-community-article-body">
          {post.content ? renderRichText(post.content) : null}
        </div>
        <footer className="np-community-article-footer">
          {tags.length > 0 ? (
            <ul aria-label="태그">
              {tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          ) : null}
          <a href="/blog">목록으로 돌아가기</a>
        </footer>
      </article>
    </main>
  );
}
