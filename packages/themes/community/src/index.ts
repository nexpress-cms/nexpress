import { defineTheme, type NpThemeSeedPost } from "@nexpress/theme";

import { CommunityFooter } from "./footer.js";
import { CommunityHeader } from "./header.js";
import { CommunityMembersNotFound } from "./members-not-found.js";
import { CommunityMembersShell } from "./members-shell.js";
import { CommunityMemberProfile } from "./member-profile.js";
import { CommunityNotFound } from "./not-found.js";
import { communitySettingsSchema } from "./settings.js";
import { CommunityShell } from "./shell.js";
import { communityCss } from "./styles.js";
import { PageDefaultTemplate } from "./templates/page-default.js";
import { PageFrontTemplate } from "./templates/page-front.js";
import { PostDefaultTemplate } from "./templates/post-default.js";
import { PostListTemplate } from "./templates/post-list.js";

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

const SEED_NOW = new Date("2026-07-19T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(SEED_NOW.getTime() - days * DAY).toISOString();

const SEED_POSTS: NpThemeSeedPost[] = [
  {
    title: "오래 머무는 커뮤니티를 만드는 작은 규칙들",
    slug: "small-rules-for-a-lasting-community",
    excerpt: "빠른 반응보다 좋은 맥락, 많은 글보다 다시 찾게 되는 기록을 선택한 운영 노트입니다.",
    content: richText([
      "커뮤니티의 분위기는 거창한 선언보다 매일 반복되는 작은 선택에서 만들어집니다. 질문에 맥락을 덧붙이고, 다른 경험을 틀렸다고 단정하지 않고, 정보의 출처를 함께 남기는 일부터 시작할 수 있습니다.",
      "운영자는 규칙을 늘리기보다 좋은 대화가 눈에 띄는 구조를 만들고, 회원은 답을 서두르기보다 상대가 무엇을 해결하려는지 한 번 더 읽습니다. 이 두 가지가 만나면 새로 온 사람도 안전하게 첫 글을 쓸 수 있습니다.",
      "이곳은 완성된 정답보다 시행착오와 배운 점을 환영합니다. 오래 남을 기록을 함께 만들어 주세요.",
    ]),
    publishedAt: daysAgo(0),
    tagNames: ["운영", "커뮤니티"],
  },
  {
    title: "서울 골목의 여름을 기록하는 열두 가지 방법",
    slug: "twelve-ways-to-record-seoul-summer",
    excerpt: "사진, 소리, 지도와 짧은 인터뷰로 동네의 계절을 남긴 회원들의 공동 기록입니다.",
    content: richText([
      "같은 골목도 기록하는 사람에 따라 전혀 다른 장소가 됩니다. 누군가는 간판의 색을 모으고, 누군가는 오후 네 시의 그늘을 따라 걷고, 또 누군가는 오래 일한 가게 주인의 목소리를 남겼습니다.",
      "이번 공동 기록은 잘 찍은 사진보다 다시 찾아갈 수 있는 단서를 중요하게 생각했습니다. 날짜와 대략적인 위치, 날씨와 기록자의 짧은 감상을 함께 적었습니다.",
    ]),
    publishedAt: daysAgo(1),
    tagNames: ["동네", "기록"],
  },
  {
    title: "처음 조립한 키보드에서 배운 것",
    slug: "lessons-from-first-custom-keyboard",
    excerpt: "스위치 선택부터 흡음재까지, 초보자가 놓치기 쉬운 순서를 실패담과 함께 정리했습니다.",
    content: richText([
      "첫 조립에서 가장 오래 걸린 건 납땜이 아니라 선택이었습니다. 정보가 많을수록 내게 필요한 기준을 세우기 어려웠고, 결국 소리보다 손의 피로를 먼저 확인했어야 한다는 걸 뒤늦게 알았습니다.",
      "두 번째 조립에서는 스위치를 적게 사서 일주일씩 써 보고, 책상 높이와 손목 받침을 먼저 맞췄습니다. 결과적으로 더 저렴했고 훨씬 오래 사용할 수 있는 구성이 되었습니다.",
    ]),
    publishedAt: daysAgo(2),
    tagNames: ["취미", "도구"],
  },
  {
    title: "주말 한 끼를 함께 준비하는 모임의 레시피",
    slug: "recipe-for-a-weekend-table",
    excerpt:
      "요리를 잘하는 사람보다 역할을 자연스럽게 나누는 사람이 필요한 작은 식탁 모임 이야기입니다.",
    content: richText([
      "메뉴는 한 사람이 정하지 않습니다. 먹고 싶은 것 하나와 피하고 싶은 것 하나를 적고, 장보기와 손질, 설거지 역할을 먼저 나눕니다.",
      "완벽한 한 상보다 다음 모임을 약속할 여유를 남기는 것이 이 모임의 규칙입니다. 그래서 마지막 요리는 늘 과일이나 차처럼 준비가 간단한 것으로 끝냅니다.",
    ]),
    publishedAt: daysAgo(3),
    tagNames: ["모임", "생활"],
  },
  {
    title: "작은 오픈소스 프로젝트의 첫 기여 안내서",
    slug: "first-contribution-to-small-open-source",
    excerpt: "코드 한 줄을 고치기 전에 이슈의 맥락을 읽고 안전하게 대화를 시작하는 방법입니다.",
    content: richText([
      "첫 기여는 코드보다 질문에서 시작됩니다. 재현 방법과 기대한 결과, 실제 결과를 짧게 정리하면 유지보수자는 문제를 훨씬 빠르게 이해할 수 있습니다.",
      "수정 범위를 작게 유지하고 기존 테스트가 말하는 계약을 먼저 읽으세요. 좋은 풀 리퀘스트는 영리한 코드보다 검토자가 안심할 수 있는 근거를 남깁니다.",
    ]),
    publishedAt: daysAgo(5),
    tagNames: ["개발", "오픈소스"],
  },
  {
    title: "한 달 동안 알림을 절반으로 줄여 봤습니다",
    slug: "one-month-with-fewer-notifications",
    excerpt: "중요한 소식을 놓치지 않으면서도 집중 시간을 되찾은 현실적인 설정 목록입니다.",
    content: richText([
      "모든 알림을 끄는 극단적인 방법은 오래가지 못했습니다. 대신 사람의 직접 메시지, 일정 변경, 결제처럼 즉시 행동이 필요한 알림만 남겼습니다.",
      "나머지는 하루 두 번 확인하는 묶음으로 옮겼습니다. 놓친 정보는 거의 없었고, 작업을 다시 시작하는 데 드는 시간이 크게 줄었습니다.",
    ]),
    publishedAt: daysAgo(7),
    tagNames: ["생산성", "생활"],
  },
  {
    title: "사진 없이도 여행을 오래 기억하는 법",
    slug: "remembering-a-trip-without-photos",
    excerpt: "장소마다 한 문장과 한 가지 소리만 남기는 느린 여행 기록법을 소개합니다.",
    content: richText([
      "카메라를 꺼내지 않는 대신 장소를 떠나기 전 한 문장을 적었습니다. 무엇을 봤는지보다 몸이 어떻게 느꼈는지, 주변에서 어떤 소리가 났는지를 남겼습니다.",
      "돌아와서 읽어 보니 사진보다 빈 곳이 많았고, 그 빈 곳 덕분에 기억을 더 천천히 꺼내 볼 수 있었습니다.",
    ]),
    publishedAt: daysAgo(10),
    tagNames: ["여행", "기록"],
  },
  {
    title: "질문이 좋은 답을 부르는 순간",
    slug: "when-a-question-invites-a-good-answer",
    excerpt:
      "도움을 요청할 때 시도한 것과 막힌 지점을 함께 적으면 대화가 어떻게 달라지는지 살펴봅니다.",
    content: richText([
      "좋은 질문은 많이 아는 사람이 쓰는 문장이 아닙니다. 해결하려는 목표와 지금까지 확인한 사실, 어디서 판단이 어려운지를 상대가 따라갈 수 있게 적은 문장입니다.",
      "질문을 정리하는 동안 스스로 답을 찾기도 하지만, 그렇지 않더라도 다음 사람이 같은 길을 반복하지 않게 만드는 기록이 남습니다.",
    ]),
    publishedAt: daysAgo(14),
    tagNames: ["커뮤니티", "대화"],
  },
];

const SEED_TAGS = [
  { name: "커뮤니티", description: "함께 대화하고 운영하는 방법" },
  { name: "운영", description: "건강한 공간을 지속하는 실무" },
  { name: "기록", description: "사진과 글로 일상을 남기는 방법" },
  { name: "동네", description: "가까운 장소와 사람들의 이야기" },
  { name: "취미", description: "도구와 취향을 깊이 알아가는 과정" },
  { name: "도구", description: "생활과 작업을 돕는 물건과 기술" },
  { name: "모임", description: "함께 만들고 배우는 작은 모임" },
  { name: "생활", description: "매일을 조금 더 편안하게 만드는 경험" },
  { name: "개발", description: "소프트웨어를 만들며 배운 것" },
  { name: "오픈소스", description: "열린 협업과 기여 경험" },
  { name: "생산성", description: "집중과 회복을 위한 실험" },
  { name: "여행", description: "천천히 보고 오래 기억하는 여행" },
  { name: "대화", description: "좋은 질문과 답을 만드는 태도" },
];

const SEED_PAGES = [
  {
    title: "모두의 광장",
    slug: "/",
    template: "front",
    seoDescription: "취향과 경험이 모이는 열린 한국형 커뮤니티",
    blocks: [],
  },
  {
    title: "커뮤니티 소개",
    slug: "about",
    template: "default",
    seoDescription: "모두의 광장이 지향하는 대화와 기록",
    blocks: [
      {
        id: "community-about-copy",
        type: "rich-text",
        props: {
          content: richText([
            "모두의 광장은 서로 다른 취향과 경험을 안전하게 나누는 공간입니다. 빠르게 사라지는 반응보다 다시 찾을 수 있는 기록을, 정답을 겨루는 대화보다 맥락을 이해하는 질문을 소중하게 생각합니다.",
            "테마는 게시판 플러그인 없이도 글 중심 커뮤니티로 완전히 동작합니다. 필요한 경우 운영자가 포럼을 설치하고 홈 편집기에서 게시판 블록을 추가해 더 넓은 참여 공간으로 확장할 수 있습니다.",
          ]),
        },
      },
    ],
  },
  {
    title: "이용 안내",
    slug: "guidelines",
    template: "default",
    seoDescription: "모두가 편안하게 참여하기 위한 커뮤니티 이용 원칙",
    blocks: [
      {
        id: "community-guidelines-copy",
        type: "rich-text",
        props: {
          content: richText([
            "사람이 아니라 생각과 경험을 이야기해 주세요. 동의하지 않을 때는 상대의 의도를 단정하기보다 어떤 부분이 다른지 구체적으로 적어 주세요.",
            "다른 사람의 글과 사진을 가져올 때는 출처를 밝혀 주세요. 개인 정보, 광고성 반복 게시물, 혐오와 괴롭힘은 운영 정책에 따라 제한될 수 있습니다.",
            "처음 쓰는 글이라면 완벽하게 정리하지 않아도 괜찮습니다. 무엇을 나누고 싶은지, 어떤 답을 기다리는지만 알려 주세요.",
          ]),
        },
      },
    ],
  },
];

const SEED_NAVIGATION = {
  header: [
    { id: "community-nav-home", label: "홈", type: "link" as const, url: "/" },
    { id: "community-nav-stories", label: "모든 이야기", type: "link" as const, url: "/blog" },
    { id: "community-nav-about", label: "커뮤니티 소개", type: "link" as const, url: "/about" },
    { id: "community-nav-guide", label: "이용 안내", type: "link" as const, url: "/guidelines" },
  ],
  footer: [
    { id: "community-footer-home", label: "홈", type: "link" as const, url: "/" },
    { id: "community-footer-stories", label: "모든 이야기", type: "link" as const, url: "/blog" },
    { id: "community-footer-about", label: "소개", type: "link" as const, url: "/about" },
    { id: "community-footer-guide", label: "이용 안내", type: "link" as const, url: "/guidelines" },
  ],
};

/**
 * Korean community portal theme. It owns generic article/page/member chrome
 * and deliberately has no forum dependency or collection requirement. The
 * optional forum integration is CSS-only through the plugin's stable public
 * variables and data attributes.
 */
export const communityTheme = defineTheme({
  manifest: {
    id: "community",
    name: "Community",
    version: "0.4.1",
    description:
      "한국형 커뮤니티 포털 테마. 조밀한 글 피드, 추천 영역, 안내 사이드바, 회원 화면과 포럼 공개 스타일 훅을 제공하며 포럼 없이도 독립적으로 동작합니다.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.4.1" },
    settingsSchema: communitySettingsSchema,
  },
  impl: {
    shell: CommunityShell,
    slots: {
      header: CommunityHeader,
      footer: CommunityFooter,
    },
    tokens: {
      colors: {
        primary: "#246bfd",
        primaryForeground: "#ffffff",
        background: "#f7f8fa",
        foreground: "#172033",
        muted: "#f3f5f8",
        mutedForeground: "#697386",
        border: "#dfe4ea",
        card: "#ffffff",
      },
      typography: {
        fontHeading:
          'Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontBody:
          'Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontMono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      },
      shape: {
        radiusSm: "0.3rem",
        radiusMd: "0.5rem",
        radiusLg: "0.7rem",
      },
    },
    css: communityCss,
    i18n: {
      ko: {
        "community.name": "모두의 광장",
        "community.tagline": "취향과 경험이 모이는 열린 커뮤니티",
      },
      en: {
        "community.name": "Open Square",
        "community.tagline": "A welcoming place for shared interests and experience",
      },
    },
    templates: {
      pages: {
        default: {
          label: "기본 페이지",
          description: "제목과 블록 콘텐츠를 읽기 좋은 카드 안에 표시합니다.",
          component: PageDefaultTemplate,
        },
        front: {
          label: "커뮤니티 홈",
          description:
            "추천 글, 최신 글, 안내 사이드바와 선택적 확장 블록 영역을 조합한 포털 홈입니다.",
          component: PageFrontTemplate,
        },
      },
      posts: {
        default: {
          label: "커뮤니티 글",
          description: "작성자·날짜·태그와 긴 본문을 표시하는 글 상세 화면입니다.",
          component: PostDefaultTemplate,
        },
        list: {
          label: "커뮤니티 글 목록",
          description: "조밀한 행 목록과 안내 사이드바를 사용하는 전체 글 화면입니다.",
          component: PostListTemplate,
        },
      },
    },
    navLocations: {
      header: {
        label: "커뮤니티 주 메뉴",
        description: "로고 아래 데스크톱·모바일 메뉴에 표시합니다.",
        maxItems: 8,
      },
      footer: {
        label: "커뮤니티 푸터 메뉴",
        description: "푸터 가운데에 표시하는 보조 링크입니다.",
        maxItems: 8,
      },
    },
    notFound: CommunityNotFound,
    members: {
      shell: CommunityMembersShell,
      publicProfile: CommunityMemberProfile,
      notFound: CommunityMembersNotFound,
      pageTitle: {
        login: "커뮤니티 로그인",
        register: "커뮤니티 가입",
        forgotPassword: "비밀번호 찾기",
        resetPassword: "비밀번호 다시 설정",
        verify: "이메일 인증",
        notifications: "내 알림",
      },
    },
    seedContent: {
      tags: SEED_TAGS,
      pages: SEED_PAGES,
      posts: SEED_POSTS,
      navigation: SEED_NAVIGATION,
    },
  },
});

export { CommunityFooter } from "./footer.js";
export { CommunityHeader } from "./header.js";
export { CommunityMembersShell } from "./members-shell.js";
export { CommunityMemberProfile } from "./member-profile.js";
export { CommunityShell } from "./shell.js";
export { communityCss } from "./styles.js";
export { communitySettingsSchema, type CommunitySettings } from "./settings.js";
export { PageFrontTemplate as CommunityFrontTemplate } from "./templates/page-front.js";
export { PostListTemplate as CommunityPostListTemplate } from "./templates/post-list.js";
