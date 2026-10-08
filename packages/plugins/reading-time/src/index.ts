import { isNpRichTextContent } from "@nexpress/core/fields";
import { definePlugin } from "@nexpress/plugin-sdk";
import { z } from "zod";

// The auto-form saves this config; hooks and routes read the current ctx.config.
const configSchema = z.object({
  wordsPerMinute: z.number().int().min(50).max(800).default(220).describe("Words per minute"),
});

export type ReadingTimeConfig = z.infer<typeof configSchema>;

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

/** Exported for unit tests. Pure function — no side effects. */
export function estimateMinutes(text: string, wordsPerMinute: number): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount === 0) return 0;
  return Math.max(1, Math.round(wordCount / wordsPerMinute));
}

function extractDocText(doc: Record<string, unknown>): string {
  const content = doc.content;

  if (isNpRichTextContent(content)) {
    return extractText(content.document.root);
  }

  const excerpt = typeof doc.excerpt === "string" ? doc.excerpt : "";
  const title = typeof doc.title === "string" ? doc.title : "";
  return `${title} ${excerpt}`;
}

export const readingTimePlugin = definePlugin<ReadingTimeConfig>({
  manifest: {
    id: "reading-time",
    version: "0.2.0",
    name: "Reading Time",
    description:
      "Logs a word-count-based reading-time estimate whenever a post is created or updated, and exposes an HTTP endpoint that estimates reading time for a provided text. Reading speed (words per minute) is operator-configurable via the admin auto-form.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["hooks:content", "api:route"],
    allowedHosts: [],
    provides: {
      blocks: [],
      collections: [],
      adminExtensions: [],
      apiRoutes: ["/estimate"],
      hooks: ["content:afterCreate", "content:afterUpdate"],
    },
    agent: {
      description:
        "Adds a reading-time estimate to the site. Operator-configurable words-per-minute (50-800, default 220). Works on any collection with a richText 'content' field; falls back to title + excerpt when content is empty.",
      category: "content",
      tags: ["reading-time", "blog", "metadata"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  configSchema,
  hooks: {
    "content:afterCreate": ({ data, ctx }) => {
      const minutes = estimateMinutes(extractDocText(data.document), ctx.config.wordsPerMinute);
      console.log(`[reading-time] ${data.collection}/${data.documentId} — ${minutes} min read`);
    },
    "content:afterUpdate": ({ data, ctx }) => {
      const minutes = estimateMinutes(extractDocText(data.document), ctx.config.wordsPerMinute);
      console.log(
        `[reading-time] (updated) ${data.collection}/${data.documentId} — ${minutes} min read`,
      );
    },
  },
  routes: [
    {
      method: "GET",
      path: "/estimate",
      description: "Estimate reading time for a `?text=` query string (or a POST body).",
      handler: (req, ctx) => {
        const text = typeof req.query.text === "string" ? req.query.text : "";
        const wordsPerMinute = ctx.config.wordsPerMinute;
        const minutes = estimateMinutes(text, wordsPerMinute);
        return {
          status: 200,
          body: {
            minutes,
            wordsPerMinute,
            wordCount: text.trim().split(/\s+/).filter(Boolean).length,
          },
        };
      },
    },
  ],
});

export default readingTimePlugin;
