import { findDocuments } from "@nexpress/core";
import { defineTheme, type NpThemeSeedPage, type NpThemeSeedPost } from "@nexpress/theme";

import { magazineArchives } from "./archives.js";
import { magazineBlocks } from "./blocks.js";
import { MagazineFooter } from "./footer.js";
import { MagazineHeader } from "./header.js";
import { MagazineMembersNotFound } from "./members-not-found.js";
import { MagazineMembersShell } from "./members-shell.js";
import { MagazineNotFound } from "./not-found.js";
import { magazinePatterns } from "./patterns.js";
import { MagazineSectionArchiveRoute } from "./routes/section-archive.js";
import { magazineSettingsSchema } from "./settings.js";
import { MagazineShell } from "./shell.js";
import { magazineCss } from "./styles.js";
import { PageDefaultTemplate } from "./templates/page-default.js";
import { PageCoverTemplate } from "./templates/page-cover.js";
import { PageFrontTemplate } from "./templates/page-front.js";
import { PageMastheadTemplate } from "./templates/page-masthead.js";
import { PostFeatureTemplate } from "./templates/post-feature.js";
import { PostListTemplate } from "./templates/post-list.js";

/**
 * Minimal Lexical-shaped rich-text doc helper. Inlined here so
 * the theme package stays free of an `@nexpress/editor`
 * dependency just for serialization — the structure is stable
 * enough that a small literal is cheaper than pulling in the
 * editor runtime.
 */
function lexicalDoc(paragraphs: string[]): unknown {
  return {
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
  };
}

const DAY = 1000 * 60 * 60 * 24;
const SEED_NOW = new Date("2026-05-08T12:00:00.000Z");
const at = (daysAgo: number, hour = 9, minute = 0): string => {
  const d = new Date(SEED_NOW.getTime() - daysAgo * DAY);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};

/**
 * Magazine demo set — 14 posts shaped to fill the index
 * template's editorial zones:
 *
 *   - 1 lead (`featured: true`) for the cover-story splash
 *   - 3 secondaries for the "In this issue" 3-up
 *   - 4 dispatches for the time-stamped dispatch column
 *   - 6 archive entries for the right-rail archive grid
 *
 * Topics span features, profiles, essays, reporting, and the
 * dispatch column — the same editorial register the design
 * targets. Sites override the demo by publishing real posts;
 * the template's positional split (`featured` + array order)
 * keeps working as the catalog grows.
 */
const SEED_POSTS: NpThemeSeedPost[] = [
  // ── Lead — cover story ────────────────────────────────────
  {
    title: "The cartographers of a city that won't sit still.",
    excerpt: "Thirty-two years redrawing Seoul, block by block — inside the last paper atlas.",
    content: lexicalDoc([
      "The third floor of the building on Hapjeong-ro is quieter than you would expect for a place that has been drawing Seoul, daily, since the Hangang was a different shape. There are eleven people here. They redraw the city's streets onto large rolls of paper, one neighbourhood at a time, and they have not yet finished — they will not yet finish, because the city keeps moving on without them.",
      "The room is lit with the kind of bright that print designers know: lamps low and angled, the windows half-shaded, the air slightly cooler than the hallway outside. The atlas they are working on is the forty-seventh edition. It will take another nineteen months. By the time it is delivered to its first subscribers, parts of it will already be wrong.",
      "When the office began in 1994 there were 1,032 paper subscribers. Today there are eighty-four — public libraries, mostly, plus a small ring of architects, urban planners, the city's own records office, and one private collector in Daegu who has ordered a copy of every edition since 1998 and writes a letter back, every spring, listing the corrections he has spotted in the previous year's run.",
    ]),
    publishedAt: at(0),
    categoryNames: ["Features"],
    data: {
      authorName: "Helena Park",
      featured: true,
      readingTime: "22 min",
    },
  },
  // ── Secondary 3-up ────────────────────────────────────────
  {
    title: "The last man who can still tune a player piano in this town",
    excerpt:
      "Eighty-one, sharp as glass, three apprentices, no plan to retire — and a workshop you can hear from the street if the door is open and the morning is right.",
    content: lexicalDoc([
      "There are sounds inside a player piano that have no equivalent on a regular one: a small mechanical breath that runs underneath every note, like a kettle just off the boil. Master Sohn has spent fifty-three years learning to hear it. He says the people who built these instruments left him notes he is still discovering.",
      "His workshop is on the second floor of a building that has otherwise been a noodle restaurant since the late nineties. The smell of broth gets into everything; the apprentices say it changes the way the wood ages.",
    ]),
    publishedAt: at(1),
    categoryNames: ["Profiles"],
  },
  {
    title: "In praise of the slow train, the long letter, the second draft",
    excerpt:
      "On the satisfactions of doing things the long way, in a year that keeps trying to talk us out of them.",
    content: lexicalDoc([
      "There is a four-hour train from Seoul to Gangneung that nobody takes anymore — the new express does the same trip in ninety minutes, and the slow line runs almost empty in the middle of the week. I have been taking it once a month for two years, and the trains are some of the most consistent rooms I have ever sat in.",
      "The argument for slowness is usually a moral one, which is the surest way to lose the argument. The better case is technical: a slow thing leaves room around it. The long letter has room for the question the short note didn't have time to ask. The second draft has room for the sentence the first draft made you write before you knew what you meant.",
    ]),
    publishedAt: at(2),
    categoryNames: ["Essays"],
  },
  {
    title: "A small republic of bicycle repairmen, in a courtyard nobody owns",
    excerpt:
      "Six men, four chairs, one electric kettle, and a tacit code older than any of them. We spent two weeks in the courtyard.",
    content: lexicalDoc([
      "The courtyard does not appear on any city register. It is, technically, a passageway between two buildings whose original developers went out of business in the early 2000s, and whose successors have, by some quiet mutual agreement, never bothered to claim it. Six bicycle repairmen work here, six days a week, between the hours of 8 a.m. and roughly whenever the light goes.",
      "There is no rent. There is no signage. The men do not advertise. The customers find them the same way customers found a barber forty years ago — by walking past, by asking a neighbour, by knowing somebody who already knew. The waiting time, on a good Friday, can be three hours.",
    ]),
    publishedAt: at(3),
    categoryNames: ["Reporting"],
  },
  // ── Dispatches (timed, short) ─────────────────────────────
  {
    title:
      "A standing-room crowd, a translator three sentences behind, and the most generous Q&A in the festival's history.",
    excerpt: "Notes from the Bucheon literature festival, day three.",
    content: lexicalDoc([
      "The Bucheon literature festival's third day belonged to the Q&A. Two writers, one translator, and a small room with the heating on too high — the kind of room a festival is supposed to outgrow. Nobody seemed to mind. The translator caught up gradually. The writers waited. The audience took notes in margins.",
    ]),
    publishedAt: at(0, 7, 42),
    categoryNames: ["Dispatches"],
  },
  {
    title:
      "The bakery that's been closed for renovations longer than some of its customers have been alive.",
    excerpt: "It opens again on Tuesday. We have the cake list.",
    content: lexicalDoc([
      "The bakery on Bukchon-ro 8-gil has been under renovation for fourteen years. The neighbours say the owner was waiting for the right baker. The right baker, it turns out, is the owner's granddaughter, who took over the lease at twenty-three and has spent six years figuring out how to bring back exactly seven recipes from the original menu and quietly add three of her own.",
    ]),
    publishedAt: at(1, 18, 10),
    categoryNames: ["Dispatches"],
  },
  {
    title: "What we read this week — and which one we'll be arguing about for the next six months.",
    excerpt: "The editors' weekly roundup, lightly fact-checked, generously opinionated.",
    content: lexicalDoc([
      "Three of the four editors agreed on the book. The fourth thinks the other three are wrong, and is preparing a long essay about it. We expect to publish it before the autumn, and we expect at least two of us to change our minds about something by the time it lands.",
    ]),
    publishedAt: at(2, 9, 0),
    categoryNames: ["Dispatches"],
  },
  {
    title:
      "Letter from Daegu: a public library, a private grief, and a reading room that fills up anyway.",
    excerpt: "A correspondent's fortnightly column.",
    content: lexicalDoc([
      "There is a particular kind of silence that happens in a reading room when nobody has anything urgent to do. The Daegu central library has it on Tuesday afternoons, between the school groups and the evening commuters. I have started timing my trips around it.",
    ]),
    publishedAt: at(3, 14, 30),
    categoryNames: ["Dispatches"],
  },
  // ── Archive ───────────────────────────────────────────────
  {
    title: "A theatre that survived three regimes, two fires, and one streaming era.",
    excerpt:
      "Two hundred seats, a wooden stage older than the building around it, and an audience that mostly arrives by bus.",
    content: lexicalDoc([
      "The Cheongun-dong theatre opened in 1949 with a borrowed projector and a leaking roof. It has been continuously open since — through war, censorship, the deflation of the 1990s arthouse circuit, and three separate seasons in which the building's structural engineer recommended closing it entirely. It is currently showing a Brakhage retrospective on Saturday mornings.",
    ]),
    publishedAt: at(28),
    categoryNames: ["Profiles"],
  },
  {
    title: "My grandmother could mend anything. I can barely sew a button.",
    excerpt:
      "On the small inheritances we don't bother to learn until the person who could teach them is no longer there.",
    content: lexicalDoc([
      "There are five drawers in the kitchen of my mother's house that I have not opened in twelve years. They contain — I am told — my grandmother's mending kit, her thimbles, the small wooden box she kept buttons in, and her bias-tape collection. I do not know what bias-tape is. I have been meaning to learn.",
    ]),
    publishedAt: at(32),
    categoryNames: ["Essays"],
  },
  {
    title: "The night porter knows whose flowers were delivered to which floor, and won't tell.",
    excerpt:
      "A profile of one of the last working hotel porters in the old downtown, and the discipline of professional discretion.",
    content: lexicalDoc([
      "Mr. Lee has worked the overnight shift at the Imperial since 1991. He is fifty-eight years old. He knows who left the building at 3 a.m. on the second Tuesday of last month, and who came back without their shoes. He will not tell you any of it. He will, on a slow night, tell you which corridor lamps need new bulbs.",
    ]),
    publishedAt: at(45),
    categoryNames: ["Profiles"],
  },
  {
    title: "Twenty-eight portraits, one barbershop, sixty-two years of haircuts.",
    excerpt:
      "A photographer's portrait series of the regulars at a barbershop that has changed hands twice and never closed.",
    content: lexicalDoc([
      "The barbershop on Jongno 5-ga is one of those rooms that arranges itself around its regulars. Mr. Park photographed twenty-eight of them, in sittings spread across a year, and arranged the prints in the order they first walked in — 1962 to 2024. The earliest sitter is now eighty-nine. The youngest is two months old.",
    ]),
    publishedAt: at(60),
    categoryNames: ["Photography"],
  },
  {
    title: "On the small uses of carrying a notebook, in a year of carrying nothing else.",
    excerpt:
      "Twelve months of paper notes, three notebooks, and the things that turned out to be worth writing down by hand.",
    content: lexicalDoc([
      "I spent last year trying to write every observation down by hand before it reached a screen. Twelve months, three notebooks, and a small collection of habits I did not expect. The biggest of them is that I have stopped pretending to remember things by the act of typing them. The second biggest is that my handwriting has, against my best efforts, slowly improved.",
    ]),
    publishedAt: at(75),
    categoryNames: ["Essays"],
  },
  {
    title: "The translator's translator: a quiet hand behind half the year's most-read books.",
    excerpt:
      "A profile of the editor most working literary translators send their first drafts to.",
    content: lexicalDoc([
      "Most working literary translators in this country know about Lim Hye-young. Few of them have met her. She works mostly from home — a small apartment in Seodaemun-gu with a desk by the window and three cats, one of whom likes to sit on whatever manuscript is currently being marked up — and she returns drafts within a fortnight, with margin notes that her translators describe, almost without exception, as ruthless and exactly right.",
    ]),
    publishedAt: at(95),
    categoryNames: ["Profiles"],
  },
];

const SEED_CATEGORIES = [
  { name: "Features", description: "Long-form reporting that anchors each issue." },
  { name: "Dispatches", description: "Short, time-stamped notes from the desk." },
  { name: "Profiles", description: "People doing the work; quietly, slowly, well." },
  { name: "Essays", description: "Thinking-out-loud pieces on craft and the long view." },
  { name: "Reporting", description: "On-the-ground stories that took weeks to chase." },
  { name: "Photography", description: "Portrait series, archive recoveries, photo essays." },
];

const SEED_NAV = {
  header: [
    { id: "nav-mag-front", label: "Front Page", type: "link" as const, url: "/" },
    { id: "nav-mag-features", label: "Features", type: "link" as const, url: "/features" },
    { id: "nav-mag-dispatches", label: "Dispatches", type: "link" as const, url: "/dispatches" },
    { id: "nav-mag-profiles", label: "Profiles", type: "link" as const, url: "/profiles" },
    { id: "nav-mag-essays", label: "Essays", type: "link" as const, url: "/essays" },
    { id: "nav-mag-photography", label: "Photography", type: "link" as const, url: "/photography" },
    { id: "nav-mag-masthead", label: "Masthead", type: "link" as const, url: "/masthead" },
  ],
  footer: [
    { id: "nav-mag-footer-features", label: "Features", type: "link" as const, url: "/features" },
    {
      id: "nav-mag-footer-dispatches",
      label: "Dispatches",
      type: "link" as const,
      url: "/dispatches",
    },
    { id: "nav-mag-footer-profiles", label: "Profiles", type: "link" as const, url: "/profiles" },
    { id: "nav-mag-footer-essays", label: "Essays", type: "link" as const, url: "/essays" },
    {
      id: "nav-mag-footer-photography",
      label: "Photography",
      type: "link" as const,
      url: "/photography",
    },
    { id: "nav-mag-footer-masthead", label: "Masthead", type: "link" as const, url: "/masthead" },
  ],
};

/**
 * Magazine theme home page + ancillary pages.
 *
 * Home (`/`) ships with `template: "front"` so the catch-all dispatches
 * into `PageFrontTemplate`, which pulls posts at render time and lays
 * them out as the editorial index (lead + 3-up + dispatches + archive
 * + subscribe). The page itself carries no blocks — the template owns
 * the visual; the page row is essentially a route facade.
 *
 * About + Contact stubs match the magazine voice. Both use the default
 * template (centered prose column).
 */
const SEED_PAGES: NpThemeSeedPage[] = [
  {
    title: "The Northbound Review",
    slug: "/",
    seoDescription:
      "A small editorial review, published every other Sunday — features, dispatches, profiles, and photography from Seoul, New York, and the long road between them.",
    blocks: [],
    template: "front",
  },
  {
    title: "Masthead",
    slug: "masthead",
    seoDescription: "About The Northbound Review — editors, principles, and publishing cadence.",
    blocks: [],
    template: "masthead",
  },
  {
    title: "Issue Twelve",
    slug: "issue-12",
    seoDescription:
      "The Northbound Review issue twelve — cover note, table of contents, and editor's letter.",
    blocks: [
      {
        type: "rich-text",
        id: "seed-mag-issue-12-body",
        props: {
          content: lexicalDoc([
            "Issue Twelve opens with a city that keeps redrawing itself, then moves outward: a piano workshop above a noodle shop, a courtyard full of bicycle repairmen, a library reading room in Daegu, and a theatre that refuses to close.",
            "The cover line is deliberately quiet because the work inside is not. Every piece in this issue follows someone keeping a craft alive after the obvious market for it has moved on.",
            "For operators evaluating NexPress, this page is a seeded example of the magazine cover template: a full-width title treatment with editable body blocks beneath it.",
          ]),
        },
      },
    ],
    template: "cover",
  },
  {
    title: "Colophon",
    slug: "colophon",
    seoDescription:
      "About The Northbound Review — its founding, its editors, and the type and paper it's set in.",
    blocks: [
      {
        type: "rich-text",
        id: "seed-mag-colophon-body",
        props: {
          content: lexicalDoc([
            "The Northbound Review was founded in 2014, in a third-floor office above a bookstore in Hapjeong-dong. Twelve volumes in, we still publish every other Sunday — by post for subscribers who prefer paper, by inbox for everyone else.",
            "We commission long-form reporting, profiles, essays, and photography from writers and photographers working in Korea, Japan, the Pacific Northwest, and occasionally somewhere unexpected. We pay on acceptance, edit lightly, and run the work the writer brought us — not the work we wished they had.",
            "The Review is set in Newsreader for body and display, with Hanken Grotesk for the small-caps chrome. It prints on Mohawk Superfine 80lb text in eggshell. It runs on NexPress.",
          ]),
        },
      },
    ],
  },
  {
    title: "Contact",
    slug: "contact",
    seoDescription:
      "How to reach The Northbound Review — pitches, subscriptions, press, and the address for letters.",
    blocks: [
      {
        type: "rich-text",
        id: "seed-mag-contact-body",
        props: {
          content: lexicalDoc([
            "Pitches: pitches@northbound.review. We read every one, and we respond — usually within ten working days, sometimes sooner.",
            "Subscriptions and circulation: hello@northbound.review.",
            "Press, syndication, and rights: press@northbound.review.",
            "Letters to the editor: editor@northbound.review. We publish a selection in the second issue of each volume.",
            "The Review · 3F, 14 Yanghwa-ro, Mapo-gu, Seoul 04035.",
          ]),
        },
      },
    ],
  },
];

/**
 * `@nexpress/theme-magazine` — editorial magazine identity.
 *
 * Post-redesign visual: full-width dateline strip at the top,
 * double-rule masthead with a Newsreader display-italic logo
 * and small-caps ornamental rules, primary section nav under a
 * single-line border, cover-story 2-col lead with a 5/6 hero
 * cover, "In this issue" 3-up secondary row, dispatches /
 * archive split (1-col + 2-col grid), full-bleed subscribe band
 * on a deep-ink surface, three-column colophon footer.
 *
 * Tokens: warm cream surface (#f6f1e7), terracotta accent
 * (#b04a26), deep ink foreground (#1a1411). Editorial type is
 * Newsreader (display-italic for the masthead, regular for
 * body); chrome (eyebrows, kickers, bylines, nav) is Hanken
 * Grotesk with letter-spacing wide enough to read as small-caps
 * even at the smallest sizes.
 *
 * `requires.collections`:
 *   - `posts` extended with `featured`, `coverImage`,
 *     `categories`, `author` (relationship → users).
 *   - `categories` created via `createIfAbsent`.
 *
 * Bylines resolve through `np_users` — the same user rows that
 * authenticate into the admin. A site that wants guest authors
 * without admin access can add a custom collection later, but
 * the default reuses the user table so a fresh install doesn't
 * carry a parallel "authors" table that's just a name + bio.
 *
 * `seedContent` ships 14 demo posts laid out for the index
 * template's editorial zones (1 lead + 3 secondary + 4
 * dispatches + 6 archive), six categories, and primary +
 * footer navigation. All posts attach to the seeding admin
 * user as their author.
 */
export const magazineTheme = defineTheme({
  manifest: {
    id: "magazine",
    name: "Magazine",
    version: "0.2.0",
    description:
      "Editorial magazine layout — dateline + double-rule masthead with Newsreader display-italic logo, cover-story lead + 3-up secondary + dispatches/archive split, full-bleed subscribe band, three-column colophon footer. Warm cream + terracotta accent.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
    requires: {
      collections: {
        posts: {
          fields: {
            featured: {
              type: "checkbox",
              admin: {
                position: "sidebar",
                group: "Magazine",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
            coverImage: { type: "upload", relationTo: "media" },
            categories: {
              type: "relationship",
              relationTo: "categories",
              hasMany: true,
            },
            author: {
              type: "relationship",
              relationTo: "users",
              hard: false,
            },
            authorName: {
              type: "text",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Magazine",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
            readingTime: {
              type: "text",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Magazine",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
          },
          // Editor sidebar icon for the theme's own group
          // (#8 of the editor progressive-disclosure track).
          // Merged into the collection's `admin.groupMeta` via
          // mergeThemeRequirements; the bundled-themes prebake
          // means every site that registers any theme gets this
          // entry, but it only renders when an active field
          // declares `admin.group: "Magazine"`.
          groupMeta: {
            Magazine: { icon: "Newspaper", description: "Cover-story + featured controls." },
          },
        },
        categories: {
          createIfAbsent: true,
          fields: {
            name: { type: "text", required: true },
            description: { type: "textarea", hard: false },
          },
        },
      },
    },
    settingsSchema: magazineSettingsSchema,
  },
  impl: {
    shell: MagazineShell,
    slots: {
      header: MagazineHeader,
      footer: MagazineFooter,
    },
    tokens: {
      colors: {
        primary: "#b04a26",
        primaryForeground: "#fcfaf3",
        background: "#f6f1e7",
        foreground: "#1a1411",
        muted: "#ece4d3",
        mutedForeground: "#6a5a48",
        border: "#d8ccb4",
        card: "#fcfaf3",
      },
      typography: {
        fontHeading: '"Newsreader", "EB Garamond", Georgia, "Times New Roman", serif',
        fontBody: '"Newsreader", Georgia, "Times New Roman", serif',
        fontMono:
          '"Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      },
    },
    css: magazineCss,
    i18n: {
      en: {
        "magazine.title": "The Northbound Review",
        "magazine.ornament": "Est. 2014 · Seoul · New York",
        "magazine.tagline":
          "Long-form reporting on craft, cities, and the people who keep them moving.",
      },
      ko: {
        "magazine.title": "더 노스바운드 리뷰",
        "magazine.ornament": "Est. 2014 · 서울 · 뉴욕",
        "magazine.tagline": "장인, 도시, 그리고 그들을 움직이는 사람들에 관한 장문 리포팅.",
      },
    },
    seedContent: {
      categories: SEED_CATEGORIES,
      pages: SEED_PAGES,
      posts: SEED_POSTS,
      navigation: SEED_NAV,
    },
    templates: {
      pages: {
        default: {
          label: "Default",
          description: "Centered article column with magazine type ramp.",
          component: PageDefaultTemplate,
        },
        cover: {
          label: "Cover",
          description:
            "Full-bleed hero at the top with the page title overlaid; body content flows below in the standard column.",
          component: PageCoverTemplate,
        },
        masthead: {
          label: "Masthead",
          description: "Magazine about page with manifesto, editor cards, and publication stats.",
          component: PageMastheadTemplate,
        },
        front: {
          label: "Front page",
          description:
            "Editorial index — lead cover story + 'In this issue' three-up + dispatch desk + archive grid + subscribe band. Pulls posts from the server at render time. The seeded home page (slug \"/\") ships with this template.",
          component: PageFrontTemplate,
        },
      },
      posts: {
        feature: {
          label: "Feature article",
          description:
            "Centered display headline, italic deck, byline rule, drop cap on the first paragraph. Best for long-form posts.",
          component: PostFeatureTemplate,
        },
        list: {
          label: "Index",
          description:
            "Magazine-style index — cover-story lead, three-up secondary row, dispatches / archive split, subscribe band.",
          component: PostListTemplate,
        },
      },
    },
    archives: magazineArchives,
    routes: [
      {
        pattern: "/:section(features|dispatches|profiles|essays|photography)",
        component: MagazineSectionArchiveRoute,
      },
    ],
    blocks: magazineBlocks,
    patterns: magazinePatterns,
    navLocations: {
      primary: {
        label: "Masthead nav",
        description: "Sections shown in the masthead header.",
        maxItems: 7,
      },
      footerSections: {
        label: "Footer sections",
        description: "Sections column in the three-column footer.",
        maxItems: 8,
      },
      footerColophon: {
        label: "Footer colophon",
        description: "About / contact links beside the colophon.",
        maxItems: 6,
      },
    },
    notFound: MagazineNotFound,
    members: {
      shell: MagazineMembersShell,
      notFound: MagazineMembersNotFound,
    },
    seo: {
      sitemapEntries: async () => {
        // Re-query categories to surface every category archive
        // page in the sitemap. Lightweight (categories collection
        // is small and capped); runs once per cache window.
        const result = await findDocuments<Record<string, unknown>>("categories", {
          where: { status: "published" },
          limit: 200,
        });
        return result.docs
          .filter((d) => typeof d.slug === "string")
          .map((d) => {
            const updatedAt = d.updatedAt;
            return {
              loc: `/category/${d.slug as string}`,
              lastmod: updatedAt instanceof Date ? updatedAt.toISOString() : undefined,
              changefreq: "daily" as const,
              priority: 0.7,
            };
          });
      },
    },
  },
});

export { MagazineHeader, MagazineFooter, MagazineShell };
export { MagazineSectionArchiveRoute } from "./routes/section-archive.js";
export { PageMastheadTemplate } from "./templates/page-masthead.js";
export { magazineCss };
export {
  MagazineArchiveItem,
  type MagazineArchiveItemDoc,
  type MagazineArchiveItemProps,
} from "./components/archive-item.js";
export { MagazineMobileNav } from "./components/mobile-nav.js";
export { MagazineNewsletterForm } from "./components/newsletter-form.js";
export {
  MagazinePostCard,
  type MagazinePostCardDoc,
  type MagazinePostCardProps,
} from "./components/post-card.js";
export { PostListTemplate as MagazinePostListTemplate } from "./templates/post-list.js";
