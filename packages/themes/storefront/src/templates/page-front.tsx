import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";
import { fetchFrontListPosts } from "@nexpress/next";
import type { NpTemplateRenderProps } from "@nexpress/theme";
import Link from "next/link";

interface StoryDoc {
  id?: string;
  slug?: string;
  title?: string;
  excerpt?: string;
  coverImage?: string | null;
}

export async function StorefrontPageFront({ doc, blockCtx }: NpTemplateRenderProps) {
  const page = doc as { blocks?: NpPageBlocks };
  const blocks = page.blocks ?? [];
  const result = await fetchFrontListPosts({ kind: "article", limit: 3 });
  const stories = result as StoryDoc[];
  return (
    <main className="np-storefront-home">
      <section className="np-storefront-hero">
        <div className="np-storefront-container">
          <p>Independent storefront theme</p>
          <h1>Objects for everyday rituals.</h1>
          <span>
            콘텐츠 사이트로 먼저 시작하고, Shop 플러그인을 설치하면 같은 시각 언어로 카탈로그를
            확장할 수 있습니다.
          </span>
          <div>
            <Link href="/blog">브랜드 이야기</Link>
            <Link href="/about">브랜드 소개</Link>
          </div>
        </div>
      </section>
      {blocks.length > 0 ? (
        <section className="np-storefront-container np-storefront-extension-blocks">
          {renderBlocks(blocks, { ctx: blockCtx })}
        </section>
      ) : null}
      <section className="np-storefront-container np-storefront-story-section">
        <header>
          <p>Journal</p>
          <h2>물건 뒤에 있는 생각</h2>
          <Link href="/blog">모든 글 보기</Link>
        </header>
        <div className="np-storefront-story-grid">
          {stories.map((story) => (
            <article key={story.id ?? story.slug ?? story.title}>
              <span aria-hidden="true">{story.title?.slice(0, 1) ?? "A"}</span>
              <h3>
                <Link href={`/blog/${story.slug ?? ""}`}>{story.title ?? "Untitled"}</Link>
              </h3>
              {story.excerpt ? <p>{story.excerpt}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
