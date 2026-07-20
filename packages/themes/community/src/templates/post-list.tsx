import type { NpTemplateRenderProps } from "@nexpress/theme";

import { hydrateCommunityPostTags, type CommunityTagValue } from "../post-tags.js";

export interface CommunityPostDoc {
  id?: string;
  slug?: string;
  title?: string;
  excerpt?: string;
  publishedAt?: string | Date;
  author?: string | { name?: string };
  authorName?: string;
  readingTime?: string | number;
  tags?: CommunityTagValue[];
}

interface CommunityPostListDoc {
  docs?: CommunityPostDoc[];
  heading?: string;
  intro?: string;
  home?: boolean;
}

function postHref(post: CommunityPostDoc): string {
  return post.slug ? `/blog/${post.slug}` : "#";
}

function compactDate(value: CommunityPostDoc["publishedAt"]): string {
  if (!value) return "새 글";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "새 글";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" })
    .format(date)
    .replace(/\.\s?/g, ".")
    .replace(/\.$/, "");
}

function authorLabel(post: CommunityPostDoc): string {
  if (post.authorName) return post.authorName;
  if (typeof post.author === "object" && post.author?.name) return post.author.name;
  if (typeof post.author === "string" && !/^[0-9a-f-]{36}$/i.test(post.author)) return post.author;
  return "커뮤니티 편집팀";
}

function readingLabel(value: CommunityPostDoc["readingTime"]): string | null {
  if (typeof value === "number") return `${value.toString()}분`;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function tagLabel(post: CommunityPostDoc): string {
  const first = post.tags?.[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object") return first.label ?? first.name ?? "이야기";
  return "이야기";
}

function monogram(post: CommunityPostDoc): string {
  const title = post.title?.trim();
  return title ? title.slice(0, 1) : "N";
}

export function CommunityPostList({
  docs,
  heading = "최근 이야기",
  intro,
  home = false,
}: {
  docs: CommunityPostDoc[];
  heading?: string;
  intro?: string;
  home?: boolean;
}) {
  if (docs.length === 0) {
    return (
      <section className="np-community-feed np-community-feed-empty">
        <div className="np-community-panel-head">
          {home ? <h2>{heading}</h2> : <h1>{heading}</h1>}
        </div>
        <p>아직 공개된 글이 없습니다. 첫 이야기를 기다리고 있어요.</p>
      </section>
    );
  }

  const [lead, ...rest] = docs;
  const highlights = rest.slice(0, 4);
  const latest = home ? rest.slice(4) : docs;
  const leadReading = lead ? readingLabel(lead.readingTime) : null;

  return (
    <div className="np-community-feed">
      {home && lead ? (
        <section className="np-community-highlights" aria-labelledby="np-community-highlight-title">
          <div className="np-community-panel-head">
            <div>
              <span>오늘의 추천</span>
              <h2 id="np-community-highlight-title">지금 함께 읽는 이야기</h2>
            </div>
            <a href="/blog">전체 글 보기</a>
          </div>
          <div className="np-community-highlight-grid">
            <article className="np-community-lead-card">
              <a href={postHref(lead)} className="np-community-lead-visual">
                <span>{monogram(lead)}</span>
                <small>COMMUNITY PICK</small>
              </a>
              <div className="np-community-lead-copy">
                <span className="np-community-kicker">{tagLabel(lead)}</span>
                <h3>
                  <a href={postHref(lead)}>{lead.title ?? "제목 없는 글"}</a>
                </h3>
                {lead.excerpt ? <p>{lead.excerpt}</p> : null}
                <div className="np-community-post-meta">
                  <span>{authorLabel(lead)}</span>
                  <time>{compactDate(lead.publishedAt)}</time>
                  {leadReading ? <span>{leadReading}</span> : null}
                </div>
              </div>
            </article>
            {highlights.length > 0 ? (
              <ol className="np-community-highlight-list">
                {highlights.map((post, index) => (
                  <li key={post.id ?? post.slug ?? `${post.title}-${index.toString()}`}>
                    <span className="np-community-highlight-number">
                      {(index + 1).toString().padStart(2, "0")}
                    </span>
                    <a href={postHref(post)}>
                      <span>{tagLabel(post)}</span>
                      <strong>{post.title ?? "제목 없는 글"}</strong>
                      <small>
                        {authorLabel(post)} · {compactDate(post.publishedAt)}
                      </small>
                    </a>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </section>
      ) : null}

      {latest.length > 0 ? (
        <section className="np-community-latest" aria-labelledby="np-community-latest-title">
          <div className="np-community-panel-head">
            <div>
              <span>{home ? "업데이트" : "아카이브"}</span>
              {home ? (
                <h2 id="np-community-latest-title">{heading}</h2>
              ) : (
                <h1 id="np-community-latest-title">{heading}</h1>
              )}
            </div>
            {intro ? <p>{intro}</p> : null}
          </div>
          <ol className="np-community-latest-list">
            {latest.map((post, index) => (
              <li key={post.id ?? post.slug ?? `${post.title}-${index.toString()}`}>
                <span className="np-community-latest-number">
                  {(index + 1).toString().padStart(2, "0")}
                </span>
                <div className="np-community-latest-copy">
                  <div>
                    <span className="np-community-kicker">{tagLabel(post)}</span>
                    <h2>
                      <a href={postHref(post)}>{post.title ?? "제목 없는 글"}</a>
                    </h2>
                  </div>
                  {post.excerpt ? <p>{post.excerpt}</p> : null}
                </div>
                <div className="np-community-latest-meta">
                  <span>{authorLabel(post)}</span>
                  <time>{compactDate(post.publishedAt)}</time>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

export async function PostListTemplate({ doc }: NpTemplateRenderProps) {
  const data = doc as CommunityPostListDoc;
  const docs = await hydrateCommunityPostTags(data.docs ?? []);
  return (
    <main className="np-community-page np-community-index-page">
      <div className="np-community-container np-community-content-grid">
        <CommunityPostList
          docs={docs}
          heading={data.heading ?? "모든 이야기"}
          intro={data.intro ?? "새로 올라온 글을 시간순으로 모았습니다."}
          home={data.home ?? false}
        />
        <CommunitySideRail />
      </div>
    </main>
  );
}

export function CommunitySideRail() {
  return (
    <aside className="np-community-side-rail" aria-label="커뮤니티 안내">
      <section className="np-community-side-card np-community-side-card-primary">
        <span>WELCOME</span>
        <h2>처음 오셨나요?</h2>
        <p>서로의 취향을 존중하고, 출처와 맥락을 함께 남겨 주세요.</p>
        <a href="/guidelines">이용 안내 읽기</a>
      </section>
      <section className="np-community-side-card">
        <h2>빠른 메뉴</h2>
        <ul>
          <li>
            <a href="/blog">전체 글 모아보기</a>
          </li>
          <li>
            <a href="/about">커뮤니티 소개</a>
          </li>
          <li>
            <a href="/members/me/notifications">내 알림 확인</a>
          </li>
          <li>
            <a href="/members/login">로그인·회원가입</a>
          </li>
        </ul>
      </section>
      <section className="np-community-side-card np-community-side-card-note">
        <strong>운영 원칙</strong>
        <p>사람을 향한 공격보다 경험과 생각을 나누는 대화를 지향합니다.</p>
      </section>
    </aside>
  );
}
