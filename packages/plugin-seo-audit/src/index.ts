import { definePlugin } from "@nexpress/plugin-sdk";

const WORDS_PER_MINUTE = 200;
const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 160;
const MIN_BODY_WORDS = 250;

type JsonRecord = Record<string, unknown>;

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

function auditSeo(input: SeoAuditInput): SeoAuditResult {
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
  } else if (input.title.length < TITLE_MIN) {
    issues.push({
      level: "info",
      code: "short-title",
      message: `Title is short (${input.title.length} chars). Aim for ${TITLE_MIN}-${TITLE_MAX} characters.`,
    });
    suggestions.add("Expand the title with a clearer keyword or benefit.");
  } else if (input.title.length > TITLE_MAX) {
    issues.push({
      level: "info",
      code: "long-title",
      message: `Title is long (${input.title.length} chars). Keep it under ${TITLE_MAX} characters when possible.`,
    });
    suggestions.add("Trim the title so the most important phrase appears earlier.");
  }

  if (!input.description) {
    issues.push({
      level: "warning",
      code: "missing-description",
      message: "Description is missing. Add a summary for search and sharing previews.",
    });
    suggestions.add("Write a one-sentence meta description that explains the page value.");
  } else if (input.description.length < DESCRIPTION_MIN) {
    issues.push({
      level: "info",
      code: "short-description",
      message:
        `Description is short (${input.description.length} chars). ` +
        `Aim for ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters.`,
    });
    suggestions.add("Add more context to the description so the result is more compelling in search.");
  } else if (input.description.length > DESCRIPTION_MAX) {
    issues.push({
      level: "info",
      code: "long-description",
      message:
        `Description is long (${input.description.length} chars). ` +
        `Keep it under ${DESCRIPTION_MAX} characters when possible.`,
    });
    suggestions.add("Shorten the description to keep the strongest message visible in search snippets.");
  }

  if (wordCount === 0) {
    issues.push({
      level: "warning",
      code: "missing-body",
      message: "Body content is empty. Search engines and readers both need meaningful page copy.",
    });
    suggestions.add("Add body copy with concrete details, examples, or supporting explanations.");
  } else if (wordCount < MIN_BODY_WORDS) {
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

function buildAuditResponse(payload: unknown): SeoAuditResult {
  return auditSeo(extractInputFromPayload(payload));
}

export const seoAuditPlugin = definePlugin({
  manifest: {
    id: "seo-audit",
    version: "0.1.0",
    name: "SEO Audit",
    description:
      "Analyzes content quality and metadata after saves, then exposes a plugin API route for SEO/content audits.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["hooks:content", "api:route"],
    allowedHosts: [],
    provides: {
      blocks: [],
      fields: [],
      collections: [],
      adminExtensions: [],
      apiRoutes: ["/analyze"],
      hooks: ["content:afterCreate", "content:afterUpdate"],
    },
    agent: {
      description:
        "Audits a document's title, description, headings, and body length to spot common SEO/content issues. Useful as an example of combining lifecycle hooks with a plugin API route.",
      category: "seo",
      tags: ["seo", "audit", "content-quality", "example"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  hooks: {
    "content:afterCreate": ({ data }) => {
      const doc = (data.doc ?? data) as JsonRecord;
      const collection = typeof data.collection === "string" ? data.collection : "unknown";
      const result = auditSeo(extractInputFromDocument(doc));

      console.log(
        `[seo-audit] ${collection}/${String(doc.id ?? "?")} ` +
          `score=${result.score} words=${result.wordCount} issues=${result.issues.length}`,
      );
    },
    "content:afterUpdate": ({ data }) => {
      const doc = (data.doc ?? data) as JsonRecord;
      const collection = typeof data.collection === "string" ? data.collection : "unknown";
      const result = auditSeo(extractInputFromDocument(doc));

      console.log(
        `[seo-audit] (updated) ${collection}/${String(doc.id ?? "?")} ` +
          `score=${result.score} words=${result.wordCount} issues=${result.issues.length}`,
      );
    },
  },
  routes: [
    {
      method: "GET",
      path: "/analyze",
      description: "Audit title, description, and content provided by query string or JSON body.",
      handler: async (req) => {
        const input =
          Object.keys(req.query).length > 0
            ? {
                title: req.query.title,
                description: req.query.description,
                content: req.query.content,
              }
            : req.body;

        return {
          status: 200,
          body: buildAuditResponse(input),
        };
      },
    },
    {
      method: "POST",
      path: "/analyze",
      description: "Audit title, description, and content provided as JSON.",
      handler: async (req) => ({
        status: 200,
        body: buildAuditResponse(req.body),
      }),
    },
  ],
});

export default seoAuditPlugin;
