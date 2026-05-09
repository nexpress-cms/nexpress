import { definePlugin } from "@nexpress/plugin-sdk";
import { z } from "zod";

/**
 * G.2.3 — operator-tunable thresholds via the framework's auto-form.
 *
 * Pre-G.2.3 the thresholds were hardcoded module-level constants
 * (TITLE_MIN / TITLE_MAX / DESCRIPTION_MIN / DESCRIPTION_MAX /
 * MIN_BODY_WORDS) AND the plugin declared an `admin.settings.fields`
 * form alongside — but the form's values were never read. Operators
 * could fill the form and nothing changed, which is worse than not
 * having the form at all. This release wires the operator config
 * into the audit logic via `ctx.config` and replaces the legacy
 * declarative form with the auto-form.
 */
// Note: cross-field validation (titleMin <= titleMax, descriptionMin
// <= descriptionMax) would naturally live as `.refine()` calls on the
// outer object — but adding a top-level effect/pipe wrapper currently
// breaks the F.3 introspector, which only unwraps default / optional
// / nullable. The form would render zero fields. Deferred until the
// introspector grows refine-passthrough; until then a misconfigured
// min/max pair is silently uncaught (the audit just never enters the
// "long-X" branch because "short-X" always wins).
const configSchema = z.object({
  titleMin: z
    .number()
    .int()
    .min(0)
    .max(200)
    .default(30)
    .describe("Minimum recommended title length (chars)"),
  titleMax: z
    .number()
    .int()
    .min(10)
    .max(300)
    .default(60)
    .describe("Maximum recommended title length (chars)"),
  descriptionMin: z
    .number()
    .int()
    .min(0)
    .max(500)
    .default(70)
    .describe("Minimum recommended description length (chars)"),
  descriptionMax: z
    .number()
    .int()
    .min(50)
    .max(500)
    .default(160)
    .describe("Maximum recommended description length (chars)"),
  minBodyWords: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .default(250)
    .describe("Minimum body word count before triggering a thin-content warning"),
  includeDescription: z
    .boolean()
    .default(true)
    .describe("Audit the meta description in addition to title and body"),
});

export type SeoAuditConfig = z.infer<typeof configSchema>;

const WORDS_PER_MINUTE = 200;

type JsonRecord = Record<string, unknown> & { id?: string; slug?: string };

interface SeoAuditInput {
  title: string;
  description: string;
  content: string;
  headings: string[];
}

interface SeoAuditIssue {
  level: "info" | "warning";
  code: string;
  message: string;
}

interface SeoAuditResult {
  score: number;
  wordCount: number;
  readingTimeMinutes: number;
  titleLength: number;
  descriptionLength: number;
  headingCount: number;
  issues: SeoAuditIssue[];
  suggestions: string[];
}

function collectRichText(node: unknown, headings: string[]): string[] {
  if (!node || typeof node !== "object") return [];

  const richNode = node as {
    type?: string;
    text?: string;
    tag?: string;
    children?: unknown[];
  };

  if (richNode.type === "text" && typeof richNode.text === "string") {
    return [richNode.text];
  }

  const childText = Array.isArray(richNode.children)
    ? richNode.children.flatMap((child) => collectRichText(child, headings))
    : [];

  if (
    richNode.type === "heading" &&
    childText.length > 0 &&
    (typeof richNode.tag !== "string" || richNode.tag !== "h1")
  ) {
    headings.push(childText.join(" ").trim());
  }

  return childText;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return normalizeWhitespace(value);
    }
  }
  return "";
}

function extractInputFromDocument(doc: JsonRecord): SeoAuditInput {
  const headings: string[] = [];
  const contentNode = doc.content as { root?: unknown } | undefined;
  const content = contentNode?.root
    ? normalizeWhitespace(collectRichText(contentNode.root, headings).join(" "))
    : "";

  return {
    title: pickFirstString(doc.seoTitle, doc.title, doc.name),
    description: pickFirstString(doc.seoDescription, doc.excerpt, doc.summary, doc.description),
    content,
    headings,
  };
}

function extractInputFromPayload(payload: unknown): SeoAuditInput {
  const data = payload && typeof payload === "object" ? (payload as JsonRecord) : {};
  const headingsFromBody = Array.isArray(data.headings)
    ? data.headings.filter((value): value is string => typeof value === "string").map(normalizeWhitespace)
    : [];

  return {
    title: pickFirstString(data.title, data.seoTitle),
    description: pickFirstString(data.description, data.seoDescription, data.excerpt, data.summary),
    content: pickFirstString(data.content, data.body, data.text),
    headings: headingsFromBody.filter(Boolean),
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function estimateReadingTime(wordCount: number): number {
  if (wordCount === 0) return 0;
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}

function scorePenalty(level: SeoAuditIssue["level"]): number {
  return level === "warning" ? 12 : 5;
}

/** Exported for unit tests. Pure function, no side effects. */
export function auditSeo(input: SeoAuditInput, config: SeoAuditConfig): SeoAuditResult {
  const issues: SeoAuditIssue[] = [];
  const suggestions = new Set<string>();
  const wordCount = countWords(input.content);

  if (!input.title) {
    issues.push({
      level: "warning",
      code: "missing-title",
      message: "Title is missing. Add a clear page title before publishing.",
    });
    suggestions.add("Add a descriptive title that tells readers and search engines what the page is about.");
  } else if (input.title.length < config.titleMin) {
    issues.push({
      level: "info",
      code: "short-title",
      message: `Title is short (${input.title.length} chars). Aim for ${config.titleMin}-${config.titleMax} characters.`,
    });
    suggestions.add("Expand the title with a clearer keyword or benefit.");
  } else if (input.title.length > config.titleMax) {
    issues.push({
      level: "info",
      code: "long-title",
      message: `Title is long (${input.title.length} chars). Keep it under ${config.titleMax} characters when possible.`,
    });
    suggestions.add("Trim the title so the most important phrase appears earlier.");
  }

  if (config.includeDescription) {
    if (!input.description) {
      issues.push({
        level: "warning",
        code: "missing-description",
        message: "Description is missing. Add a summary for search and sharing previews.",
      });
      suggestions.add("Write a one-sentence meta description that explains the page value.");
    } else if (input.description.length < config.descriptionMin) {
      issues.push({
        level: "info",
        code: "short-description",
        message:
          `Description is short (${input.description.length} chars). ` +
          `Aim for ${config.descriptionMin}-${config.descriptionMax} characters.`,
      });
      suggestions.add("Add more context to the description so the result is more compelling in search.");
    } else if (input.description.length > config.descriptionMax) {
      issues.push({
        level: "info",
        code: "long-description",
        message:
          `Description is long (${input.description.length} chars). ` +
          `Keep it under ${config.descriptionMax} characters when possible.`,
      });
      suggestions.add("Shorten the description to keep the strongest message visible in search snippets.");
    }
  }

  if (wordCount === 0) {
    issues.push({
      level: "warning",
      code: "missing-body",
      message: "Body content is empty. Search engines and readers both need meaningful page copy.",
    });
    suggestions.add("Add body copy with concrete details, examples, or supporting explanations.");
  } else if (wordCount < config.minBodyWords) {
    issues.push({
      level: "info",
      code: "thin-body",
      message: `Body content is thin (${wordCount} words). Consider adding more depth.`,
    });
    suggestions.add("Expand the body with examples, FAQs, steps, or supporting details.");
  }

  if (input.headings.length === 0 && wordCount >= 120) {
    issues.push({
      level: "info",
      code: "missing-headings",
      message: "No secondary headings were found. Longer content is easier to scan with headings.",
    });
    suggestions.add("Break long content into sections with descriptive headings.");
  }

  const score = Math.max(
    0,
    Math.min(
      100,
      100 - issues.reduce((total, issue) => total + scorePenalty(issue.level), 0),
    ),
  );

  return {
    score,
    wordCount,
    readingTimeMinutes: estimateReadingTime(wordCount),
    titleLength: input.title.length,
    descriptionLength: input.description.length,
    headingCount: input.headings.length,
    issues,
    suggestions: [...suggestions],
  };
}

function buildAuditResponse(payload: unknown, config: SeoAuditConfig): SeoAuditResult {
  return auditSeo(extractInputFromPayload(payload), config);
}

export const seoAuditPlugin = definePlugin<SeoAuditConfig>({
  manifest: {
    id: "seo-audit",
    version: "0.2.0",
    name: "SEO Audit",
    description:
      "Analyzes content quality and metadata after saves, then exposes a plugin API route for SEO/content audits. Thresholds (title length, description length, body word count) are operator-configurable via the admin auto-form.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: [
      "hooks:content",
      "hooks:render",
      "api:route",
      "content:read",
      "admin:collection-tab",
      "admin:dashboard",
    ],
    allowedHosts: [],
    provides: {
      blocks: [],
      fields: [],
      collections: [],
      adminExtensions: [],
      apiRoutes: ["/analyze"],
      hooks: ["content:afterCreate", "content:afterUpdate", "render:beforePage"],
    },
    agent: {
      description:
        "Audits a document's title, description, headings, and body length to spot common SEO/content issues. Operator-configurable thresholds via the auto-form. Useful as an example of combining lifecycle hooks with a plugin API route.",
      category: "seo",
      tags: ["seo", "audit", "content-quality", "example"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  configSchema,
  hooks: {
    "content:afterCreate": ({ data, ctx }) => {
      const doc = (data.doc ?? data) as JsonRecord;
      const collection = typeof data.collection === "string" ? data.collection : "unknown";
      const result = auditSeo(extractInputFromDocument(doc), ctx.config);

      console.log(
        `[seo-audit] ${collection}/${doc.id ?? "?"} ` +
          `score=${result.score} words=${result.wordCount} issues=${result.issues.length}`,
      );
    },
    "content:afterUpdate": ({ data, ctx }) => {
      const doc = (data.doc ?? data) as JsonRecord;
      const collection = typeof data.collection === "string" ? data.collection : "unknown";
      const result = auditSeo(extractInputFromDocument(doc), ctx.config);

      console.log(
        `[seo-audit] (updated) ${collection}/${doc.id ?? "?"} ` +
          `score=${result.score} words=${result.wordCount} issues=${result.issues.length}`,
      );
    },
    "render:beforePage": ({ data }) => {
      const doc = (data.document ?? {}) as JsonRecord;
      const input = extractInputFromDocument(doc);
      const head: Array<
        | { tag: "meta"; attrs: Record<string, string> }
        | { tag: "link"; attrs: Record<string, string> }
      > = [];

      if (input.description) {
        head.push({
          tag: "meta",
          attrs: { name: "description", content: input.description },
        });
        head.push({
          tag: "meta",
          attrs: { property: "og:description", content: input.description },
        });
      }
      if (input.title) {
        head.push({
          tag: "meta",
          attrs: { property: "og:title", content: input.title },
        });
      }
      head.push({
        tag: "meta",
        attrs: {
          property: "og:type",
          content: data.collection === "posts" ? "article" : "website",
        },
      });

      const dataSlug = typeof data.slug === "string" ? data.slug : "";
      const canonicalSlug = typeof doc.slug === "string" ? doc.slug : dataSlug;
      if (canonicalSlug) {
        const path =
          data.collection === "posts" ? `/blog/${canonicalSlug}` : `/${canonicalSlug}`;
        head.push({ tag: "link", attrs: { rel: "canonical", href: path } });
      }

      return head.length > 0 ? { head } : undefined;
    },
  },
  admin: {
    widgets: [
      {
        id: "last-audit",
        label: "Last audit score",
        kind: "metric",
        actionId: "lastAuditScore",
        description: "Demo metric — returns a static sample value for now.",
      },
    ],
    actions: [
      {
        id: "rescan",
        label: "Re-scan latest post",
        actionId: "rescanLatest",
        description: "Demo action — runs the audit against a synthetic payload.",
      },
    ],
    dashboardWidgets: [
      {
        id: "site-seo-score",
        label: "Avg. SEO score",
        kind: "metric",
        actionId: "lastAuditScore",
        description: "Rolling average across recent posts.",
        priority: 10,
      },
    ],
    collectionTabs: [
      {
        id: "seo",
        label: "SEO audit",
        collections: ["posts"],
        description:
          "Live-audits the post you are editing. Widget shows the score; action re-runs the audit on demand.",
        widgets: [
          {
            id: "doc-score",
            label: "SEO score",
            kind: "metric",
            actionId: "auditDocument",
          },
        ],
        actions: [
          {
            id: "rescan-doc",
            label: "Re-scan this post",
            actionId: "auditDocument",
            description: "Re-audit the current post and return an updated score.",
          },
        ],
      },
    ],
  },
  setup: (ctx) => {
    // These demo handlers prove the declarative admin surface end-to-end.
    // Real implementations would use ctx.content.find() to iterate posts
    // and store results somewhere the widget can read.
    ctx.actions.register("lastAuditScore", () =>
      Promise.resolve({
        ok: true,
        data: { value: 87, delta: "+3 vs last week" },
      }),
    );
    ctx.actions.register("rescanLatest", () => {
      const sample = buildAuditResponse(
        {
          title: "Example post title that is long enough",
          description: "A reasonable meta description that describes the content well.",
          content: "This is a demo. ".repeat(40),
        },
        ctx.config,
      );
      return Promise.resolve({
        ok: true,
        data: `Score: ${sample.score}, issues: ${sample.issues.length}`,
      });
    });

    // Powers the per-document collection tab: widget shows the score, action
    // re-runs the audit on demand. Both share the same handler — widget reads
    // `{ value, delta }`; action displays a success toast.
    ctx.actions.register("auditDocument", async (payload) => {
      const data = payload && typeof payload === "object" ? (payload as JsonRecord) : {};
      const collection = typeof data.collection === "string" ? data.collection : "";
      const documentId = typeof data.documentId === "string" ? data.documentId : "";
      if (!collection || !documentId) {
        return { ok: false, error: "auditDocument requires { collection, documentId }" };
      }
      const doc = (await ctx.content.findOne(collection, documentId)) as JsonRecord | null;
      if (!doc) {
        return { ok: false, error: `Document ${collection}/${documentId} not found` };
      }
      const result = auditSeo(extractInputFromDocument(doc), ctx.config);
      return {
        ok: true,
        data: {
          value: result.score,
          delta: `${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}`,
        },
      };
    });
  },
  routes: [
    {
      method: "GET",
      path: "/analyze",
      description: "Audit title, description, and content provided by query string or JSON body.",
      handler: (req, ctx) => {
        const input =
          Object.keys(req.query).length > 0
            ? {
                title: req.query.title,
                description: req.query.description,
                content: req.query.content,
              }
            : req.body;

        return Promise.resolve({
          status: 200,
          body: buildAuditResponse(input, ctx.config),
        });
      },
    },
    {
      method: "POST",
      path: "/analyze",
      description: "Audit title, description, and content provided as JSON.",
      handler: (req, ctx) =>
        Promise.resolve({
          status: 200,
          body: buildAuditResponse(req.body, ctx.config),
        }),
    },
  ],
});

export default seoAuditPlugin;
