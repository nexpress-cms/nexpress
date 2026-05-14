import { defineTheme, type NpThemeSeedPost } from "@nexpress/theme";

import { DefaultFooter } from "./footer.js";
import { DefaultHeader } from "./header.js";
import { DefaultShell } from "./shell.js";
import { defaultThemeCss } from "./styles.js";
import { PageDefaultTemplate } from "./templates/page-default.js";
import { PageLandingTemplate } from "./templates/page-landing.js";
import { PageSidebarTemplate } from "./templates/page-sidebar.js";
import { PageWideTemplate } from "./templates/page-wide.js";
import { PostDefaultTemplate } from "./templates/post-default.js";
import { PostListTemplate } from "./templates/post-list.js";

/**
 * Build a minimal Lexical-shaped rich-text doc from a list of
 * paragraphs. The framework's renderer reads `root → paragraph →
 * text`, so this is the smallest valid shape that survives the
 * pipeline and renders as prose in the post-default template.
 *
 * Lives inline (not imported from `@nexpress/editor`) so the
 * theme package stays free of editor / Lexical dependencies — the
 * structure is stable enough that a small literal is cheaper
 * than pulling in the editor runtime just to call its serializer.
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
const daysAgo = (days: number): string =>
  new Date(SEED_NOW.getTime() - days * DAY).toISOString();

/**
 * Default theme seed posts — eight pieces that exercise the
 * post-list template's feature card + 3-up grid. Topics map to
 * the seeded `tags` rows so the kicker / category strip lights
 * up out of the box. Excerpts are intentionally short (one
 * paragraph each) and the Lexical body is two or three
 * paragraphs — enough to render a real-looking detail page
 * without filling the database with marketing copy.
 */
const SEED_POSTS: NpThemeSeedPost[] = [
  {
    title: "Read-your-writes without the asterisks",
    excerpt:
      "Postgres replicas are great until a write redirects to a different replica and reads stale data. Here's the small routing layer that follows a write within the request and kept our p99 reads under 12 ms.",
    content: lexicalDoc([
      "Read-replica routing is a cheap win for read-heavy workloads, but the moment a user writes a row and the next request lands on a different replica, you ship a stale view. The standard fixes — session affinity, "
        + "sticky cookies, replica lag thresholds — each have failure modes that are hard to reason about under load.",
      "We rebuilt routing as a small library that follows a write within the lifetime of the request that produced it. Writes go to the primary; subsequent reads in the same request are pinned to the primary; everything else flows to a replica. The lookup is one map operation per query.",
      "After two weeks at 10x load, p99 reads sat at 11.8 ms and zero stale-read complaints came in from the iOS team. The library is ~140 lines, no schema changes, no migration. The full annotated source is at the bottom of this post.",
    ]),
    publishedAt: daysAgo(0),
    tagNames: ["Engineering", "Postgres"],
  },
  {
    title: "Why your index is fine and your query planner isn't",
    excerpt:
      "Six query rewrites that survived a year in production — and the two that didn't. A practical tour of the cases where adding an index made the problem worse before it made it better.",
    content: lexicalDoc([
      "The first time the planner ignored a perfectly good index, I spent an hour writing increasingly specific `EXPLAIN ANALYZE` queries before I noticed the statistics were three days old. The second time, it was a parameter sniffing problem and the index was right; I just needed to teach the planner about it.",
      "This post walks through six rewrites — two `ROW_NUMBER()` cases, two correlated subqueries, a `LATERAL` join, and one CTE we ended up inlining — and the diagnostic we settled on for each. Three of the six are wins that survived a year of production traffic. Two regressed and got reverted. One is still in flight.",
    ]),
    publishedAt: daysAgo(2),
    tagNames: ["Postgres", "Indexes"],
  },
  {
    title: "Typing the unknown: branded IDs without the runtime tax",
    excerpt:
      "A pragmatic pattern for distinguishing `UserId` from `OrgId` in the type system, with no helpers and no `as` casts. The trick is doing the branding at the boundary so the rest of the codebase doesn't notice.",
    content: lexicalDoc([
      "Branded primitives in TypeScript usually come with helpers — `brand(value, \"UserId\")`, a runtime tag, a `Brand<T, K>` type. The cost is real: every call site that produces an id needs the helper, every consumer needs to remember the brand, and `as` casts creep back in.",
      "The pattern that survived for us: brand the id at the boundary (the DB row, the URL parser, the form decoder) once, and let the rest of the codebase treat it as the branded type. No helpers, no runtime cost. The boundary is the one place a new contributor has to think about it.",
    ]),
    publishedAt: daysAgo(5),
    tagNames: ["TypeScript", "Types"],
  },
  {
    title: "Outbox isn't a queue — it's a contract between two writers",
    excerpt:
      "Why every team eventually reinvents the transactional outbox, and how to pick the implementation that won't bite you. Spoiler: the answer is rarely \"use Kafka\".",
    content: lexicalDoc([
      "The outbox pattern shows up every time you need to do one thing in the database and a second thing somewhere else (a webhook, a search index, an email). The naive implementation — write the row, then do the second thing — is correct exactly until the second thing fails.",
      "Three implementations have lasted: a polling worker over an indexed `outbox` table; a logical-replication consumer; and a transactional CDC stream. Each has a different failure mode. This post walks through what we tried, what we picked, and why we'd pick differently for a smaller team.",
    ]),
    publishedAt: daysAgo(7),
    tagNames: ["Distributed", "Queues"],
  },
  {
    title: "Latency budgets are how you keep your roadmap honest",
    excerpt:
      "A four-quarter look at one team's p99 budget — what it bought, and the work that fell off the plan because of it. The number itself was less interesting than the conversations it forced.",
    content: lexicalDoc([
      "We had two latency budgets — p50 and p99 — and a rule that said no feature could ship if it pushed either one over the line for more than a sprint. The rule was annoying. It was also the single most useful thing we put on the roadmap that year.",
      "A budget doesn't tell you which optimization to do next. It tells you which optimization you can't afford not to do. Three of the four quarters, the budget rejected a feature we wanted. Two of those features came back smaller; one stayed off the board.",
    ]),
    publishedAt: daysAgo(10),
    tagNames: ["Product", "Notes"],
  },
  {
    title: "Two cache stampedes I wish I'd seen coming",
    excerpt:
      "A post-mortem on the day a featured-post invalidation pushed our origin from 200 rps to 18,000 in nine seconds. And the second time, six months later, when we caught it before any of the dashboards did.",
    content: lexicalDoc([
      "Stampedes don't look like what the textbooks describe. The first one we hit was a featured-post invalidation that triggered exactly one CDN miss per edge, which sounds fine until you remember the CDN has 400 edges. 18,000 requests/sec at the origin, all asking for the same warm key.",
      "The fix wasn't a bigger origin pool; it was an in-process single-flight with a 200 ms jitter. The second time it almost happened, the single-flight caught it. The dashboards didn't notice for forty minutes — which is its own lesson about which signals you actually need to monitor.",
    ]),
    publishedAt: daysAgo(13),
    tagNames: ["Engineering", "Caches"],
  },
  {
    title: "RFC: shorter, smaller, more of them",
    excerpt:
      "The RFC template our team converged on after eighteen months of over-scoped design docs and under-scoped Slack threads. Three sections, two pages, one decision per document.",
    content: lexicalDoc([
      "The first version of our RFC template had eleven sections. The current version has three: the question, the options we considered, and the choice. Anything else — risks, alternatives, prior art — lives in the body of the answer or doesn't make it into the document at all.",
      "Shorter RFCs are easier to review, easier to revise, and easier to find six months later. The number of decisions we documented went up; the number of words we wrote about each one went down. The template is at the end of this post. Steal it.",
    ]),
    publishedAt: daysAgo(16),
    tagNames: ["Notes", "RFC"],
  },
];

const SEED_TAGS = [
  { name: "Engineering", description: "Architecture, system design, and the day-to-day of shipping." },
  { name: "Postgres", description: "Query planners, indexes, replication, and other database concerns." },
  { name: "TypeScript", description: "Type-system patterns, ergonomics, and runtime trade-offs." },
  { name: "Distributed", description: "Queues, contracts, and the failure modes between two writers." },
  { name: "Product", description: "Roadmap, decisions, and the conversations that drive them." },
  { name: "Notes", description: "Shorter pieces — observations, references, opinions in passing." },
  { name: "RFC", description: "Decision records and the discussions that produced them." },
  { name: "Caches", description: "Invalidation, stampedes, and the layers between user and origin." },
  { name: "Indexes", description: "Index design patterns and when adding one makes things worse." },
  { name: "Types", description: "Branded primitives, exhaustiveness, and other type-level work." },
  { name: "Queues", description: "Outbox, CDC, replication slots, and other message-passing patterns." },
];

const SEED_NAV = {
  header: [
    { id: "nav-default-writing", label: "Writing", type: "link" as const, url: "/blog" },
    { id: "nav-default-notes", label: "Notes", type: "link" as const, url: "/notes" },
    { id: "nav-default-talks", label: "Talks", type: "link" as const, url: "/talks" },
    { id: "nav-default-about", label: "About", type: "link" as const, url: "/about" },
  ],
  footer: [
    { id: "nav-default-footer-writing", label: "Writing", type: "link" as const, url: "/blog" },
    { id: "nav-default-footer-notes", label: "Notes", type: "link" as const, url: "/notes" },
    { id: "nav-default-footer-talks", label: "Talks", type: "link" as const, url: "/talks" },
    { id: "nav-default-footer-about", label: "About", type: "link" as const, url: "/about" },
    { id: "nav-default-footer-archive", label: "Archive", type: "link" as const, url: "/blog/archive" },
  ],
};

/**
 * `@nexpress/theme-default` — production-grade blog baseline.
 *
 * Post-redesign visual identity: hairline sticky header with a
 * Subscribe CTA, indigo accent on a near-white surface, big
 * feature card above a three-up post grid, dark inline newsletter
 * slab, four-column footer. The aesthetic target is a low-key
 * publication site for an engineering team — calm, terse,
 * legible-first.
 *
 * Sticky header has a mobile drawer; the four-column footer
 * carries brand / sitemap / resources / newsletter columns and
 * collapses to two columns under 800px. Page templates ship
 * default (centered column), wide (edge-to-edge), landing
 * (full-bleed marketing), and sidebar (two-column doc-style)
 * variants. All CSS is theme-owned and ships as a single
 * `<style data-np-theme="default">` tag at SSR time.
 *
 * Tokens override `colors.primary` (indigo), `typography.font*`
 * (system sans + system mono — no webfont request at boot), and
 * the radii scale. Sites brand by overriding the same custom
 * properties — this theme is structural.
 *
 * Ships `seedContent`: seven demo posts, eleven tags, header +
 * footer nav. First-boot wizard pours these through the
 * framework's seeder so a fresh install lands on a populated
 * blog rather than the generic "Welcome to NexPress" copy.
 */
export const defaultTheme = defineTheme({
  manifest: {
    id: "default",
    name: "NexPress Default",
    version: "0.2.0",
    description:
      "Production-grade blog baseline. Sticky header with mobile drawer + Subscribe CTA, feature card + 3-up post grid, inline newsletter, four-column footer. Indigo accent on a near-white surface; ships system sans (Geist) + system mono token overrides and seven demo posts so a fresh install renders a real-looking blog.",
    author: { name: "NexPress" },
    nexpress: { minVersion: "0.1.0" },
  },
  impl: {
    shell: DefaultShell,
    slots: {
      header: DefaultHeader,
      footer: DefaultFooter,
    },
    css: defaultThemeCss,
    tokens: {
      colors: {
        primary: "#4f46e5",
        primaryForeground: "#ffffff",
        background: "#ffffff",
        foreground: "#0a0a0c",
        muted: "#f5f5f7",
        mutedForeground: "#6b6b74",
        border: "#ececef",
      },
      typography: {
        fontHeading:
          '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontBody:
          '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontMono:
          '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      },
      shape: {
        radiusSm: "6px",
        radiusMd: "10px",
        radiusLg: "14px",
      },
    },
    seedContent: {
      tags: SEED_TAGS,
      posts: SEED_POSTS,
      navigation: SEED_NAV,
    },
    templates: {
      pages: {
        default: {
          label: "Default",
          description: "Centered content container with the standard reading width.",
          component: PageDefaultTemplate,
        },
        wide: {
          label: "Wide",
          description:
            "Edge-to-edge layout with no max-width. Best for galleries and immersive media.",
          component: PageWideTemplate,
        },
        landing: {
          label: "Landing",
          description:
            "Marketing-style template — full-bleed hero from the first block, then sections render edge-to-edge so Hero / FeatureGrid / CTA blocks span the viewport.",
          component: PageLandingTemplate,
        },
        sidebar: {
          label: "Sidebar",
          description:
            "Two-column layout with a sticky right sidebar. Suited to docs / knowledge bases. Sites can populate the aside with a `sidebar` field on their pages collection.",
          component: PageSidebarTemplate,
        },
      },
      posts: {
        default: {
          label: "Article",
          description:
            "Centered article column with cover image, tags, byline, reading time, and Lexical body.",
          component: PostDefaultTemplate,
        },
        list: {
          label: "List view",
          description:
            "Blog-index template: feature card + 3-column grid with category strip and inline newsletter. Suits any collection that ships PostCard-shaped docs.",
          component: PostListTemplate,
        },
      },
    },
  },
});

export { DefaultShell } from "./shell.js";
export { DefaultHeader } from "./header.js";
export { DefaultFooter } from "./footer.js";
export { MemberStatusWidget } from "./components/member-status-widget.js";
export { MobileNav } from "./components/mobile-nav.js";
export { SocialLinks } from "./components/social-links.js";
export { NewsletterForm } from "./components/newsletter-form.js";
export { PostCard, type PostCardDoc, type PostCardProps } from "./components/post-card.js";
export { Pagination, type PaginationProps } from "./components/pagination.js";
export { PageLandingTemplate } from "./templates/page-landing.js";
export { PageSidebarTemplate } from "./templates/page-sidebar.js";
export { PostDefaultTemplate } from "./templates/post-default.js";
export { PostListTemplate } from "./templates/post-list.js";
export { defaultThemeCss } from "./styles.js";
