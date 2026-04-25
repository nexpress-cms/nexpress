import { definePlugin } from "@nexpress/plugin-sdk";

const WORDS_PER_MINUTE = 200;

function extractText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const anyNode = node as {
    type?: string;
    text?: string;
    children?: unknown[];
  };

  if (anyNode.type === "text" && typeof anyNode.text === "string") {
    return anyNode.text;
  }

  if (Array.isArray(anyNode.children)) {
    return anyNode.children.map(extractText).join(" ");
  }

  return "";
}

function estimateMinutes(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount === 0) return 0;
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}

function extractDocText(doc: Record<string, unknown>): string {
  const content = doc.content as { root?: { children?: unknown[] } } | undefined;

  if (content?.root?.children) {
    return extractText(content.root);
  }

  const excerpt = typeof doc.excerpt === "string" ? doc.excerpt : "";
  const title = typeof doc.title === "string" ? doc.title : "";
  return `${title} ${excerpt}`;
}

export const readingTimePlugin = definePlugin({
  manifest: {
    id: "reading-time",
    version: "0.1.0",
    name: "Reading Time",
    description:
      "Logs a word-count-based reading-time estimate whenever a post is created or updated, and exposes an HTTP endpoint that estimates reading time for a provided text.",
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
      apiRoutes: ["/estimate"],
      hooks: ["content:afterCreate", "content:afterUpdate"],
    },
    agent: {
      description:
        "Adds a reading-time estimate to the site. Works on any collection with a richText 'content' field; falls back to title + excerpt when content is empty.",
      category: "content",
      tags: ["reading-time", "blog", "metadata"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  hooks: {
    "content:afterCreate": ({ data }) => {
      const doc = (data.doc ?? data) as Record<string, unknown>;
      const collection = typeof data.collection === "string" ? data.collection : "unknown";
      const minutes = estimateMinutes(extractDocText(doc));
      console.log(`[reading-time] ${collection}/${doc.id ?? "?"} — ${minutes} min read`);
    },
    "content:afterUpdate": ({ data }) => {
      const doc = (data.doc ?? data) as Record<string, unknown>;
      const collection = typeof data.collection === "string" ? data.collection : "unknown";
      const minutes = estimateMinutes(extractDocText(doc));
      console.log(`[reading-time] (updated) ${collection}/${doc.id ?? "?"} — ${minutes} min read`);
    },
  },
  routes: [
    {
      method: "GET",
      path: "/estimate",
      description: "Estimate reading time for a `?text=` query string (or a POST body).",
      handler: async (req) => {
        const text = typeof req.query.text === "string" ? req.query.text : "";
        const minutes = estimateMinutes(text);
        return {
          status: 200,
          body: {
            minutes,
            wordsPerMinute: WORDS_PER_MINUTE,
            wordCount: text.trim().split(/\s+/).filter(Boolean).length,
          },
        };
      },
    },
  ],
});

export default readingTimePlugin;
