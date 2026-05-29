import { defineTheme, type NpThemeSeedPage, type NpThemeSeedPost } from "@nexpress/theme";

import { portfolioBlocks } from "./blocks.js";
import { PortfolioMobileNav } from "./components/mobile-nav.js";
import { PortfolioFooter } from "./footer.js";
import { PortfolioHeader } from "./header.js";
import { PortfolioMembersNotFound } from "./members-not-found.js";
import { PortfolioMembersShell } from "./members-shell.js";
import { PortfolioNotFound } from "./not-found.js";
import { PortfolioProjectDetailRoute } from "./routes/project-detail.js";
import { portfolioSettingsSchema } from "./settings.js";
import { PortfolioShell } from "./shell.js";
import { portfolioCss } from "./styles.js";
import { PageDefaultTemplate } from "./templates/page-default.js";
import { PageFrontTemplate } from "./templates/page-front.js";
import { PageGalleryTemplate } from "./templates/page-gallery.js";
import { PageJournalTemplate } from "./templates/page-journal.js";
import { PagePressTemplate } from "./templates/page-press.js";
import { PageStudioTemplate } from "./templates/page-studio.js";
import { ProjectDetailTemplate } from "./templates/project-detail.js";
import { ProjectIndexTemplate, type PortfolioProjectDoc } from "./templates/project-index.js";

/**
 * Minimal Lexical-shaped rich-text doc helper. Inlined so the
 * theme package stays free of an `@nexpress/editor` dependency
 * just for serialization.
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

const ISO = (year: number, month = 1, day = 1): string =>
  new Date(Date.UTC(year, month - 1, day)).toISOString();

/**
 * Portfolio demo set — nine projects shaped to fill the
 * asymmetric grid's span pattern (7-5-4-4-8-6-6-12 mosaic).
 * Each entry sets `span` + `coverVariant` + `coverFigure`
 * explicitly so the visual reads as designed without
 * relying on the template's positional cycle. Disciplines and
 * years vary so the meta row + year filter pills carry weight.
 *
 * Project names are intentionally fictional — using real
 * institution names as demo clients would suggest
 * endorsement. Operators replace with their actual work once
 * they're set up.
 */
const SEED_PROJECTS: NpThemeSeedPost[] = [
  {
    title: "Hanmi Gallery — <em>complete identity</em>",
    slug: "hanmi-gallery-complete-identity",
    excerpt:
      "Identity, custom display type, and signage for a contemporary gallery in Mapo. A one-year engagement covering everything from the wordmark to the door hardware.",
    content: lexicalDoc([
      "The Hanmi Gallery opened on a side street in Mapo in spring 2025 with a permanent collection of late-20th-century Korean photography and a programming calendar that runs four shows a year. We were brought on a year ahead to draw the identity, the signage, and a small in-house display typeface used across the wall labels.",
      "The wordmark is set in a single drawn pair of letters — H and G — at the size you'd want them to read across a gallery's facade. Underneath sits a quiet sans for the chrome (wall labels, ticketing, the website's tertiary type). The display face is used sparingly: titles, chapter markers, and the door numbers on the four ground-floor exhibit rooms.",
    ]),
    publishedAt: ISO(2026, 3, 1),
    kind: "project",
    tagNames: ["Identity"],
    data: {
      year: 2026,
      role: "Identity · Custom type · Signage",
      discipline: "Identity · Custom type · Signage",
      span: 7,
      coverVariant: "a",
      coverFigure: "Aa",
      badge: "Featured",
    },
  },
  {
    title: "Aperture — <em>journal redesign</em>",
    excerpt:
      "Two-year redesign of an independent design journal's print + web surfaces. Editorial type system, custom display cuts, three issues shipped.",
    content: lexicalDoc([
      "Aperture is a quarterly design journal published from a desk in Bukchon-dong; its editors had been running on a custom Bembo + sans pairing they'd outgrown by their thirty-fourth issue. We redrew the editorial system from the ground up — body type, display, captions, and a small set of secondary cuts for the digital surface.",
      "Three issues have shipped under the new system. The fourth is in production. The editors say the most useful thing about the new type stack is that it survives bad paper.",
    ]),
    publishedAt: ISO(2026, 1, 14),
    kind: "project",
    tagNames: ["Editorial"],
    data: {
      year: 2026,
      role: "Editorial · Art direction",
      discipline: "Editorial · Art direction",
      span: 5,
      coverVariant: "b",
      coverFigure: "No.\u00a001",
    },
  },
  {
    title: "Ø Studio — <em>display typeface</em>",
    excerpt:
      "Three-weight display typeface released as a single OTF. Sold direct, no marketplace, no license tiers — one font, one price.",
    content: lexicalDoc([
      "Ø is a display sans we drew over the course of fourteen months for a project that ended up not needing it. Rather than shelve the drawings, we released the family as a single OTF at a flat price — three weights, no marketing kit, no license tiers.",
      "It is most useful at sizes you would normally describe in points rather than pixels: 96, 144, 216. At 12 it loses what makes it interesting.",
    ]),
    publishedAt: ISO(2025, 9, 8),
    kind: "project",
    tagNames: ["Typography"],
    data: {
      year: 2025,
      role: "Typography · 3 weights",
      discipline: "Typography · 3 weights",
      span: 4,
      coverVariant: "c",
      coverFigure: "\u00c6",
    },
  },
  {
    title: "MoMA PS1 — <em>exhibit graphics</em>",
    excerpt:
      "Environmental graphics for a single autumn exhibition at MoMA PS1. Six-week engagement, six rooms, one set of large-format wall types.",
    content: lexicalDoc([
      "The exhibition opened in early autumn and ran through the end of the year. Our work covered the wall types — exhibition title, room markers, artist labels, and the small set of tertiary labels around the audio guide stations.",
      "Everything is set in a single drawn face. The labels are printed at three sizes; the rest of the system follows from there.",
    ]),
    publishedAt: ISO(2025, 6, 4),
    kind: "project",
    tagNames: ["Environmental"],
    data: {
      year: 2025,
      role: "Environmental · Print",
      discipline: "Environmental · Print",
      span: 4,
      coverVariant: "d",
      coverFigure: "PS1",
    },
  },
  {
    title: "Hanok Press — <em>book series</em>",
    excerpt:
      "Sixteen-volume editorial series on Korean vernacular architecture. Editorial system + cover series + a small set of in-text marginal marks.",
    content: lexicalDoc([
      "The Hanok Press series runs sixteen short-form titles on aspects of Korean vernacular architecture — courtyards, paper windows, roof tiles, ondol heating, and twelve others. Each volume is around 12,000 words and 64 pages.",
      "We designed the cover series as a system rather than sixteen individual covers: a fixed grid, a fixed display face, a shifting accent color drawn from each book's lead photograph.",
    ]),
    publishedAt: ISO(2025, 4, 22),
    kind: "project",
    tagNames: ["Editorial"],
    data: {
      year: 2025,
      role: "Editorial · 16 vols.",
      discipline: "Editorial · 16 vols.",
      span: 4,
      coverVariant: "e",
      coverFigure: "Hanok",
      badge: "Press",
    },
  },
  {
    title: "S\u014den Coffee — <em>packaging system</em>",
    excerpt:
      "Identity + 12-SKU packaging system for a small-batch coffee roaster. Two-color print on uncoated kraft, single bag size, twelve labels.",
    content: lexicalDoc([
      "S\u014den roasts in small batches out of a warehouse in Yeonnam-dong and sells through one shop and two cafes. They asked for a packaging system that could run twelve coffees off a single bag size and a two-color print, on the assumption (correct) that their best decisions would be made later, in the shop, not earlier, in the design.",
      "The system is a fixed bag, a fixed bag color, a fixed type stack — and twelve labels we redraw every season.",
    ]),
    publishedAt: ISO(2024, 11, 17),
    kind: "project",
    tagNames: ["Packaging"],
    data: {
      year: 2024,
      role: "Packaging · Identity · 12 SKUs",
      discipline: "Packaging · Identity · 12 SKUs",
      span: 8,
      coverVariant: "f",
      coverFigure: "S\u014den",
    },
  },
  {
    title: "City of Seoul — <em>centennial mark</em>",
    excerpt:
      "Bilingual centennial mark for a municipal centennial year. One mark, two scripts, four primary uses.",
    content: lexicalDoc([
      "The mark was drawn to read at four sizes — letterhead, a public banner along the river promenade, a small enamel pin, and a transit-station vinyl. It needed to work bilingually (Korean + English) at every size, with neither script reading as primary.",
      "We worked through forty-three rounds. The version that shipped is the thirty-eighth.",
    ]),
    publishedAt: ISO(2024, 8, 9),
    kind: "project",
    tagNames: ["Identity"],
    data: {
      year: 2024,
      role: "Identity · Bilingual",
      discipline: "Identity · Bilingual",
      span: 6,
      coverVariant: "g",
      coverFigure: "100\u00d7",
    },
  },
  {
    title: "Field Notebooks — <em>full rebrand</em>",
    excerpt:
      "Identity + packaging rebrand for an independent stationery line. Six product families, one new wordmark, three new pattern families.",
    content: lexicalDoc([
      "Field Notebooks have been made out of the same workshop for nine years and shipped under the same identity for seven. The rebrand was a full-package job: new wordmark, new product photography, new pattern families on the cover boards, and a stripped-down internal label that runs on three SKUs instead of the previous fifteen.",
      "The wordmark is set tighter than the old one and is a touch lighter at small sizes; the difference is visible on the spine more than on the cover.",
    ]),
    publishedAt: ISO(2023, 10, 30),
    kind: "project",
    tagNames: ["Identity"],
    data: {
      year: 2023,
      role: "Identity · Packaging",
      discipline: "Identity · Packaging",
      span: 6,
      coverVariant: "h",
      coverFigure: "Field",
    },
  },
  {
    title: "Pentagram (NY) — <em>collaborative type cut</em>",
    excerpt:
      "Eight-month collaboration with a New York office on a custom display cut. Three weights, one mock italic, used internally only.",
    content: lexicalDoc([
      "The office reached out about a custom display cut they wanted to use across their internal presentations and a small set of client deliverables. We split the work: they drew the master shapes, we drew the spacing and the secondary weights.",
      "The face is not for sale. Three of us in this studio still get to use it on the work we do for them; everyone else, including their clients, only ever sees the output.",
    ]),
    publishedAt: ISO(2023, 5, 12),
    kind: "project",
    tagNames: ["Typography"],
    data: {
      year: 2023,
      role: "Typography · Custom commission",
      discipline: "Typography · Custom commission",
      span: 12,
      coverVariant: "a",
      coverFigure: "Pentagram, NY",
      badge: "D&AD \u00b7 Yellow Pencil",
    },
  },
];

const SEED_NAV = {
  header: [
    { id: "nav-portfolio-work", label: "Work", type: "link" as const, url: "/" },
    { id: "nav-portfolio-studio", label: "Studio", type: "link" as const, url: "/studio" },
    { id: "nav-portfolio-journal", label: "Journal", type: "link" as const, url: "/journal" },
  ],
  footer: [
    { id: "nav-portfolio-footer-index", label: "Index", type: "link" as const, url: "/" },
    { id: "nav-portfolio-footer-colophon", label: "Studio", type: "link" as const, url: "/studio" },
  ],
};

const SEED_JOURNAL_POSTS: NpThemeSeedPost[] = [
  {
    title: "Why the first round is never for approval",
    excerpt:
      "A studio note on keeping early identity work exploratory before the system starts asking for rules.",
    content: lexicalDoc([
      "The first round is for range, not approval. We use it to test the edges of the brief while the stakes are still low and the vocabulary is still flexible.",
      "The strongest projects usually keep one surprising artifact from that round. It may not survive intact, but it keeps the later system from collapsing into the obvious.",
    ]),
    publishedAt: ISO(2026, 2, 18),
    kind: "article",
    tagNames: ["Process"],
  },
  {
    title: "A shelf of paper that keeps saving us",
    excerpt:
      "Four paper samples, two binding references, and the dull magic of having physical constraints nearby.",
    content: lexicalDoc([
      "A good paper shelf is less about taste than memory. It keeps old constraints close enough that they can become useful again.",
      "The samples we return to most often are not precious. They are the ones that explain a production tradeoff at a glance.",
    ]),
    publishedAt: ISO(2025, 12, 4),
    kind: "article",
    tagNames: ["References"],
  },
  {
    title: "On display type that refuses to behave at 12px",
    excerpt:
      "Not every typeface needs to be a system font. Some drawings are better when they stay loud.",
    content: lexicalDoc([
      "There is a temptation to make every custom display face behave everywhere. Usually that is a mistake.",
      "Some drawings are useful because they are specific. They start working at 96 points and get better as the room gets bigger.",
    ]),
    publishedAt: ISO(2025, 8, 21),
    kind: "article",
    tagNames: ["Typography"],
  },
];

/**
 * Portfolio theme home page + ancillary pages.
 *
 * Home (`/`) ships with `template: "front"` so the catch-all dispatches
 * into `PageFrontTemplate`, which pulls projects at render time and
 * lays them out as the 12-col asymmetric grid + studio strip + contact
 * strip. The page row has no blocks — the template owns the visual.
 *
 * Studio and Journal ship dedicated templates so the design
 * bundle's ancillary pages render without relying on rich-text
 * stubs. Journal posts stay `kind: "article"` so the project
 * grid only receives `kind: "project"` work.
 */
const SEED_PAGES: NpThemeSeedPage[] = [
  {
    title: "Owen & Spruce",
    slug: "/",
    seoDescription:
      "A studio for studios. Identity, type, and editorial systems for brands at the inflection.",
    blocks: [],
    template: "front",
  },
  {
    title: "Studio",
    slug: "studio",
    seoDescription: "About the studio — what we do, who we work with, and how we work.",
    blocks: [],
    template: "studio",
  },
  {
    title: "Journal",
    slug: "journal",
    seoDescription:
      "Notes from the studio — process, references, occasional opinions on type and editorial.",
    blocks: [],
    template: "journal",
  },
];

/**
 * `@nexpress/theme-portfolio` — image-led dark studio theme.
 *
 * Post-redesign visual: sticky blurred masthead with a display-
 * italic wordmark (the ampersand accents in the brand color),
 * primary nav, local-time pill, and a Start-a-project CTA;
 * generous hero with an eyebrow + Instrument Serif display
 * headline + three meta blocks (What we do / Selected clients
 * / Recognition); filter tablist + grid/list view toggle;
 * 12-column asymmetric project grid where each card declares
 * its own `span` and `coverVariant`; studio strip with a 2-col
 * text + 2x2 stats grid; centered contact strip with a large
 * mailto link.
 *
 * Tokens: off-black `#0a0a0a` surface, warm terracotta accent
 * `#d97a4f`, Instrument Serif for display + Hanken Grotesk for
 * chrome. `color-scheme: dark` baked into the styles so admin
 * + framework chrome render right against the dark canvas.
 *
 * `requires.collections.posts` gains the visual hint fields
 * the index template reads (span / coverVariant / coverFigure /
 * badge / discipline). All optional, `hard: false` — operator-
 * declared shapes win on collision.
 *
 * `seedContent.posts` ships nine demo projects shaped for the
 * asymmetric grid's span pattern. All projects attach to the
 * seeding admin user; per-author seed wiring is on the
 * deferred queue (`NpThemeSeedContent` needs a `documents?` /
 * authors-aware extension first).
 */
export const portfolioTheme = defineTheme({
  manifest: {
    id: "portfolio",
    name: "Portfolio",
    version: "0.2.0",
    description:
      "Image-led dark studio theme. Sticky blurred masthead with local time + Start-a-project CTA, display-italic hero with three meta blocks, 12-col asymmetric project grid, studio strip + contact strip, thin clock-lit footer. Off-black surface + warm accent.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
    requires: {
      collections: {
        posts: {
          fields: {
            // Register `kind="project"` so the merge-requirements
            // union surfaces it as a selectable option in the
            // admin (alongside whatever other themes contribute)
            // and so `seo.urlPath` reads `kinds.project.urlPattern`
            // to emit `/work/<slug>` instead of the article
            // fallback `/blog/<slug>`.
            kind: {
              type: "select",
              options: [{ label: "Project", value: "project" }],
            },
            // All portfolio-contributed fields share two admin
            // hints: `group: "Portfolio"` (one sidebar Card)
            // and `condition: (data) => data.kind !== "doc"`
            // (irrelevant for documentation pages). When the
            // editor's active kind is `"doc"`, the whole
            // Portfolio group hides; on `"article"` or operator-
            // added kinds, the fields show.
            heroImage: {
              type: "upload",
              relationTo: "media",
              admin: {
                position: "sidebar",
                group: "Portfolio",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
            client: {
              type: "text",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Portfolio",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
            year: {
              type: "number",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Portfolio",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
            role: {
              type: "text",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Portfolio",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
            // New fields the redesigned index template reads.
            // All optional + hard: false so operator-authored
            // posts collections don't break on a theme swap.
            // Note: `featured: checkbox` is intentionally NOT
            // declared here — magazine's `requires` already
            // contributes that field to the prebake union, so
            // re-declaring would trip the same-field-two-themes
            // gate test. The portfolio template reads
            // `doc.featured` regardless; the column exists in
            // the merged schema.
            discipline: {
              type: "text",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Portfolio",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
            span: {
              type: "number",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Portfolio",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
            coverVariant: {
              type: "text",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Portfolio",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
            coverFigure: {
              type: "text",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Portfolio",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
            badge: {
              type: "text",
              hard: false,
              admin: {
                position: "sidebar",
                group: "Portfolio",
                condition: { when: "kind", notEquals: "doc" },
              },
            },
          },
          groupMeta: {
            Portfolio: {
              icon: "Briefcase",
              description: "Project metadata — hero, client, year, role, cover treatment.",
            },
          },
          kinds: {
            project: {
              label: "Project",
              labelPlural: "Projects",
              icon: "Briefcase",
              // Canonical public-site URL pattern. The framework's
              // `seo.urlPath` reads this so a kind="project" post
              // emits `/work/<slug>` for permalinks / sitemap /
              // feeds. The actual route component lives under
              // `routes: [{ pattern: "/work/:slug", ... }]` below
              // — kinds.urlPattern is metadata only; it does not
              // auto-register a route.
              urlPattern: "/work/:slug",
            },
          },
        },
      },
    },
    settingsSchema: portfolioSettingsSchema,
  },
  impl: {
    shell: PortfolioShell,
    slots: {
      header: PortfolioHeader,
      footer: PortfolioFooter,
    },
    tokens: {
      colors: {
        primary: "#f5f1ea",
        primaryForeground: "#0a0a0a",
        background: "#0a0a0a",
        foreground: "#f5f1ea",
        muted: "#1a1a1a",
        mutedForeground: "#8a857d",
        border: "#232323",
        card: "#141414",
        accent: "#d97a4f",
      },
      typography: {
        fontHeading: '"Instrument Serif", "Times New Roman", Georgia, serif',
        fontBody:
          '"Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontMono:
          '"Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      },
    },
    css: portfolioCss,
    seedContent: {
      pages: SEED_PAGES,
      posts: [...SEED_PROJECTS, ...SEED_JOURNAL_POSTS],
      navigation: SEED_NAV,
    },
    templates: {
      pages: {
        default: {
          label: "Default",
          description: "Centered text column on the dark canvas.",
          component: PageDefaultTemplate,
        },
        gallery: {
          label: "Gallery",
          description: "Auto-fill block grid for image-led project pages and case studies.",
          component: PageGalleryTemplate,
        },
        front: {
          label: "Front page",
          description:
            'Studio front page — hero + filter tablist + 12-col asymmetric project grid + studio strip + contact strip. Pulls projects from the server at render time. The seeded home page (slug "/") ships with this template.',
          component: PageFrontTemplate,
        },
        studio: {
          label: "Studio",
          description: "Studio profile page with services and team roster.",
          component: PageStudioTemplate,
        },
        journal: {
          label: "Journal",
          description:
            "Studio journal index that lists article posts separately from project work.",
          component: PageJournalTemplate,
        },
        press: {
          label: "Press",
          description:
            "Press and recognition page for studio coverage. Kept available for existing sites; the built-in demo seed now follows the design handoff's Work/Project/Studio/Journal set.",
          component: PagePressTemplate,
        },
      },
      posts: {
        detail: {
          label: "Project detail",
          description:
            "Hero image, display title, role / year / client meta strip, then the body blocks.",
          component: ProjectDetailTemplate,
        },
        index: {
          label: "Project index",
          description:
            "Full front page — hero + filter tablist + 12-col asymmetric grid + studio strip + contact strip. Each card's `span` drives its grid width (7 / 5 / 4 / 4 / 8 / 6 / 6 / 12 by default).",
          component: ProjectIndexTemplate,
        },
      },
    },
    routes: [{ pattern: "/work/:slug", component: PortfolioProjectDetailRoute }],
    blocks: portfolioBlocks,
    navLocations: {
      primary: {
        label: "Primary nav",
        description: "Top nav links (Work / Studio / Journal).",
        maxItems: 5,
      },
      footerSecondary: {
        label: "Footer secondary links",
        description:
          "Meta links shown on the right of the footer (Index / Colophon / etc.). Falls back to a default Index + Colophon pair when empty.",
        maxItems: 6,
      },
      footerSocial: {
        label: "Footer social links",
        description: "Social profile links shown in the footer.",
        maxItems: 6,
      },
    },
    notFound: PortfolioNotFound,
    members: {
      shell: PortfolioMembersShell,
      notFound: PortfolioMembersNotFound,
    },
  },
});

export {
  PortfolioHeader,
  PortfolioFooter,
  PortfolioShell,
  PortfolioMembersShell,
  PortfolioMembersNotFound,
  PortfolioMobileNav,
  PortfolioNotFound,
};
export { PageJournalTemplate, PagePressTemplate, PageStudioTemplate };
export { portfolioCss };
export type { PortfolioProjectDoc };
export { portfolioSettingsSchema, type PortfolioSettings } from "./settings.js";
