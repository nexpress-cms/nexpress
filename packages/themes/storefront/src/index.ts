import { defineTheme, type NpThemeSeedPost } from "@nexpress/theme";

import { StorefrontFooter } from "./footer.js";
import { StorefrontHeader } from "./header.js";
import { storefrontSettingsSchema } from "./settings.js";
import { StorefrontShell } from "./shell.js";
import { storefrontCss } from "./styles.js";
import { StorefrontPageDefault } from "./templates/page-default.js";
import { StorefrontPageFront } from "./templates/page-front.js";
import { StorefrontPostDefault } from "./templates/post-default.js";
import { StorefrontPostList } from "./templates/post-list.js";

function richText(paragraphs: string[]): unknown {
  return {
    version: 1,
    document: {
      root: {
        type: "root",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children: paragraphs.map((text) => ({
          type: "paragraph",
          version: 1,
          direction: null,
          format: "",
          indent: 0,
          children: [
            {
              type: "text",
              version: 1,
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text,
            },
          ],
        })),
      },
    },
  };
}

const SEED_NOW = new Date("2026-07-28T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(SEED_NOW.getTime() - days * DAY).toISOString();

const SEED_POSTS: NpThemeSeedPost[] = [
  {
    title: "매일 쓰는 물건을 고르는 세 가지 기준",
    slug: "three-ways-to-choose-everyday-objects",
    excerpt: "유행보다 손에 닿는 감각, 수리 가능성, 오래 두어도 편안한 형태를 먼저 봅니다.",
    content: richText([
      "매일 쓰는 물건은 처음 보았을 때의 인상보다 백 번째 사용할 때의 감각이 중요합니다. 손이 자연스럽게 닿는지, 힘을 많이 주지 않아도 되는지, 사용하지 않을 때 주변과 조용히 어울리는지를 살펴봅니다.",
      "고장 났을 때 부품을 바꿀 수 있는지도 확인합니다. 완벽하게 튼튼한 물건보다 문제를 이해하고 다시 사용할 수 있는 물건이 더 오래 남습니다.",
    ]),
    publishedAt: daysAgo(0),
    tagNames: ["생활", "선택"],
  },
  {
    title: "작은 공방과 오래 일하는 방법",
    slug: "working-with-small-studios",
    excerpt: "납기를 재촉하기보다 재료와 공정의 리듬을 이해하며 관계를 이어가는 운영 기록입니다.",
    content: richText([
      "작은 공방의 생산 일정은 숫자만으로 설명되지 않습니다. 날씨에 따라 건조 시간이 달라지고, 한 사람이 여러 공정을 맡기도 합니다.",
      "그래서 출시일보다 먼저 확인하는 것은 품질을 지킬 수 있는 수량과 다음 생산을 준비할 수 있는 간격입니다. 오래 함께 일하려면 한 번의 큰 주문보다 예측 가능한 반복이 중요합니다.",
    ]),
    publishedAt: daysAgo(4),
    tagNames: ["제작", "파트너"],
  },
  {
    title: "포장을 줄이고도 안전하게 보내기",
    slug: "less-packaging-safe-delivery",
    excerpt: "상자를 작게 만들고 완충재를 단순화하며 파손률을 함께 낮춘 실험입니다.",
    content: richText([
      "포장을 줄이는 일은 재료를 빼는 것만으로 끝나지 않습니다. 제품이 상자 안에서 움직이지 않도록 형태를 다시 설계하고, 배송 중 가장 자주 충격을 받는 방향을 찾아야 합니다.",
      "세 번의 테스트를 거쳐 상자 부피를 줄이고 종이 완충재만 사용하게 되었습니다. 포장 시간도 짧아졌고 고객이 분리배출해야 하는 재료도 줄었습니다.",
    ]),
    publishedAt: daysAgo(8),
    tagNames: ["배송", "지속가능성"],
  },
];

const SEED_PAGES = [
  {
    title: "Atelier Market",
    slug: "/",
    template: "front",
    seoDescription: "오래 쓰고 자주 손이 가는 물건과 그 뒤의 이야기를 소개합니다.",
    blocks: [],
  },
  {
    title: "브랜드 소개",
    slug: "about",
    template: "default",
    seoDescription: "Atelier Market이 물건을 고르고 소개하는 기준",
    blocks: [
      {
        id: "storefront-about",
        type: "rich-text",
        props: {
          content: richText([
            "Atelier Market은 일상에서 오래 쓰고 자주 손이 가는 물건을 소개합니다. 화려한 기능보다 재료와 쓰임, 만든 사람과 사용하는 사람 사이의 관계를 중요하게 생각합니다.",
            "이 테마는 Shop 플러그인 없이도 브랜드와 저널 사이트로 완전히 동작합니다. 카탈로그가 필요할 때 Shop을 설치하고 홈 편집기에서 상품 블록을 추가할 수 있습니다.",
          ]),
        },
      },
    ],
  },
  {
    title: "배송과 교환 안내",
    slug: "shipping",
    template: "default",
    seoDescription: "배송, 포장, 교환 원칙을 안내합니다.",
    blocks: [
      {
        id: "storefront-shipping",
        type: "rich-text",
        props: {
          content: richText([
            "이 데모 테마의 안내 문구는 실제 쇼핑몰 정책이 아닙니다. 배송 지역, 요금, 반품 기간과 환불 조건은 운영자가 적용 법률과 사업 정책에 맞게 작성해야 합니다.",
            "결제와 주문 기능은 별도의 Shop 거래 확장으로 제공되며, 현재 카탈로그 화면만으로 구매가 처리되지 않습니다.",
          ]),
        },
      },
    ],
  },
];

const SEED_NAVIGATION = {
  header: [
    { id: "storefront-nav-home", label: "홈", type: "link" as const, url: "/" },
    { id: "storefront-nav-journal", label: "저널", type: "link" as const, url: "/blog" },
    { id: "storefront-nav-about", label: "브랜드", type: "link" as const, url: "/about" },
    { id: "storefront-nav-shipping", label: "안내", type: "link" as const, url: "/shipping" },
  ],
  footer: [
    { id: "storefront-footer-home", label: "홈", type: "link" as const, url: "/" },
    { id: "storefront-footer-journal", label: "저널", type: "link" as const, url: "/blog" },
    { id: "storefront-footer-about", label: "브랜드 소개", type: "link" as const, url: "/about" },
    {
      id: "storefront-footer-shipping",
      label: "배송 안내",
      type: "link" as const,
      url: "/shipping",
    },
  ],
};

/**
 * Independent brand/storefront theme. It imports no Shop code and declares no
 * Shop collection requirement. Optional catalog integration uses only the
 * plugin's documented CSS variables, classes, data hooks, and page blocks.
 */
export const storefrontTheme = defineTheme({
  manifest: {
    id: "storefront",
    name: "Storefront",
    version: "0.4.2",
    description:
      "브랜드·카탈로그 준비형 테마. 페이지와 저널만으로 독립 동작하며 Shop이 설치되면 공개 스타일 훅으로 상품 화면을 강화합니다.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.4.2" },
    settingsSchema: storefrontSettingsSchema,
  },
  impl: {
    shell: StorefrontShell,
    slots: {
      header: StorefrontHeader,
      footer: StorefrontFooter,
    },
    tokens: {
      colors: {
        primary: "#315f46",
        primaryForeground: "#ffffff",
        background: "#fbf9f3",
        foreground: "#23251f",
        muted: "#f3efe5",
        mutedForeground: "#6f7168",
        border: "#ded8cb",
        card: "#fffdf8",
      },
      typography: {
        fontHeading: 'Georgia, "Times New Roman", serif',
        fontBody:
          'Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontMono: '"SFMono-Regular", Consolas, monospace',
      },
      shape: {
        radiusSm: "0.15rem",
        radiusMd: "0.25rem",
        radiusLg: "0.35rem",
      },
    },
    css: storefrontCss,
    templates: {
      pages: {
        default: {
          label: "Storefront page",
          description: "브랜드 콘텐츠를 넓고 정돈된 본문으로 표시합니다.",
          component: StorefrontPageDefault,
        },
        front: {
          label: "Storefront home",
          description: "브랜드 히어로, 선택적 확장 블록, 저널 카드로 구성한 홈입니다.",
          component: StorefrontPageFront,
        },
      },
      posts: {
        default: {
          label: "Storefront journal article",
          description: "큰 제목과 읽기 좋은 본문을 사용하는 브랜드 저널 화면입니다.",
          component: StorefrontPostDefault,
        },
        list: {
          label: "Storefront journal",
          description: "번호와 요약을 사용하는 절제된 저널 목록입니다.",
          component: StorefrontPostList,
        },
      },
    },
    navLocations: {
      header: {
        label: "Storefront main menu",
        description: "브랜드 로고 가운데에 표시하는 주 메뉴입니다.",
        maxItems: 8,
      },
      footer: {
        label: "Storefront footer menu",
        description: "푸터의 사이트 안내 링크입니다.",
        maxItems: 8,
      },
    },
    seedContent: {
      pages: SEED_PAGES,
      posts: SEED_POSTS,
      tags: [
        { name: "생활", description: "매일 사용하는 물건과 습관" },
        { name: "선택", description: "제품과 재료를 고르는 기준" },
        { name: "제작", description: "공방과 생산 과정" },
        { name: "파트너", description: "함께 만드는 사람과 관계" },
        { name: "배송", description: "안전하고 단순한 배송" },
        { name: "지속가능성", description: "오래 쓰고 덜 버리는 방법" },
      ],
      navigation: SEED_NAVIGATION,
    },
  },
});

export { StorefrontFooter } from "./footer.js";
export { StorefrontHeader } from "./header.js";
export { StorefrontShell } from "./shell.js";
export { storefrontCss } from "./styles.js";
export { storefrontSettingsSchema, type StorefrontSettings } from "./settings.js";
export { StorefrontPageFront } from "./templates/page-front.js";
export { StorefrontPostList } from "./templates/post-list.js";

export default storefrontTheme;
