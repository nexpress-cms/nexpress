import { renderBlocks } from "@nexpress/blocks";
import type { NpPageBlocks } from "@nexpress/blocks";
import { fetchFrontListPosts } from "@nexpress/next";
import type { NpTemplateRenderProps } from "@nexpress/theme";

import { hydrateCommunityPostTags } from "../post-tags.js";
import { resolveCommunitySettings } from "../settings-helpers.js";
import { CommunityPostList, CommunitySideRail, type CommunityPostDoc } from "./post-list.js";

export async function PageFrontTemplate({ doc, blockCtx }: NpTemplateRenderProps) {
  const [docs, settings] = await Promise.all([
    fetchFrontListPosts({ kind: "article", limit: 24 }),
    resolveCommunitySettings(),
  ]);
  const hydratedDocs = await hydrateCommunityPostTags(docs as CommunityPostDoc[]);
  const page = doc as { blocks?: NpPageBlocks };
  const blocks = page.blocks ?? [];

  return (
    <main className="np-community-page np-community-home">
      <section className="np-community-home-intro">
        <div className="np-community-container np-community-home-intro-inner">
          <div>
            <span className="np-community-home-eyebrow">NEXPRESS COMMUNITY</span>
            <h1>{settings.communityName}</h1>
            <p>{settings.tagline}</p>
          </div>
          <dl className="np-community-home-stats">
            <div>
              <dt>공개 이야기</dt>
              <dd>{docs.length.toString().padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>오늘의 약속</dt>
              <dd>존중</dd>
            </div>
          </dl>
        </div>
      </section>

      {blocks.length > 0 ? (
        <section
          className="np-community-home-extensions"
          data-np-community-home-slot="extensions"
          aria-label="커뮤니티 바로가기"
        >
          <div className="np-community-container">{renderBlocks(blocks, { ctx: blockCtx })}</div>
        </section>
      ) : null}

      <div className="np-community-container np-community-content-grid">
        <CommunityPostList docs={hydratedDocs} heading="방금 올라온 이야기" home />
        <CommunitySideRail />
      </div>
    </main>
  );
}
