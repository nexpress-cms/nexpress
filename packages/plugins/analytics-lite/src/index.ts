import { definePlugin, npAdminMetric, npAdminTable } from "@nexpress/plugin-sdk";
import { z } from "zod";

const configSchema = z.object({
  enabled: z.boolean().default(true).describe("Enable analytics collection"),
  respectDoNotTrack: z.boolean().default(true).describe("Respect Do Not Track"),
  sampleRate: z.number().min(0).max(1).default(1).describe("Sampling rate"),
  scriptPath: z.string().default("/api/plugins/analytics-lite/event").describe("Event endpoint"),
  retentionDays: z.number().int().min(1).max(730).default(90).describe("Retention window"),
});

export type AnalyticsLiteConfig = z.infer<typeof configSchema>;

export interface AnalyticsEventInput {
  path?: unknown;
  referrer?: unknown;
  title?: unknown;
  at?: unknown;
}

export interface NormalizedAnalyticsEvent {
  path: string;
  referrer: string | null;
  title: string | null;
  at: string;
}

const EVENT_PREFIX = "events:";
const ROLLUP_PREFIX = "rollups:";

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function eventKey(date = new Date()): string {
  return `${EVENT_PREFIX}${dayKey(date)}:`;
}

function rollupKey(date = new Date()): string {
  return `${ROLLUP_PREFIX}${dayKey(date)}`;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function normalizeEvent(input: AnalyticsEventInput): NormalizedAnalyticsEvent {
  return {
    path: cleanString(input.path, 2048) ?? "/",
    referrer: cleanString(input.referrer, 2048),
    title: cleanString(input.title, 300),
    at: cleanString(input.at, 64) ?? new Date().toISOString(),
  };
}

export function rollupEvents(events: NormalizedAnalyticsEvent[]): {
  views: number;
  topPaths: Array<{ path: string; views: number }>;
  referrers: Array<{ referrer: string; views: number }>;
} {
  const paths = new Map<string, number>();
  const referrers = new Map<string, number>();

  for (const event of events) {
    paths.set(event.path, (paths.get(event.path) ?? 0) + 1);
    if (event.referrer) {
      referrers.set(event.referrer, (referrers.get(event.referrer) ?? 0) + 1);
    }
  }

  const sortCounts = (entries: IterableIterator<[string, number]>) =>
    [...entries].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return {
    views: events.length,
    topPaths: sortCounts(paths.entries()).map(([path, views]) => ({ path, views })),
    referrers: sortCounts(referrers.entries()).map(([referrer, views]) => ({
      referrer,
      views,
    })),
  };
}

export const analyticsLitePlugin = definePlugin<AnalyticsLiteConfig>({
  manifest: {
    id: "analytics-lite",
    version: "0.1.0",
    name: "Analytics Lite",
    description:
      "Adds a tiny first-party analytics collector with a render hook, plugin route, scheduled rollup, and admin metrics.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    allowedHosts: [],
    agent: {
      description:
        "First-party page view collection for small sites. Injects a small script, stores daily events in plugin storage, and rolls up top paths.",
      category: "analytics",
      tags: ["analytics", "render-hook", "scheduled-task", "storage"],
    },
  },
  configSchema,
  hooks: {
    "render:afterPage": ({ ctx }) => {
      if (!ctx.config.enabled) return undefined;

      const script = [
        "(() => {",
        "try {",
        ctx.config.respectDoNotTrack
          ? "if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;"
          : "",
        `if (Math.random() > ${JSON.stringify(ctx.config.sampleRate)}) return;`,
        `fetch(${JSON.stringify(ctx.config.scriptPath)}, {`,
        "'method': 'POST',",
        "'headers': { 'content-type': 'application/json' },",
        "'keepalive': true,",
        "'body': JSON.stringify({ path: location.pathname, referrer: document.referrer, title: document.title, at: new Date().toISOString() })",
        "});",
        "} catch {}",
        "})();",
      ].join("");

      return { bodyEnd: [{ tag: "script", children: script }] };
    },
  },
  routes: [
    {
      method: "POST",
      path: "/event",
      description: "Collect a page-view event.",
      handler: async (req, ctx) => {
        if (!ctx.config.enabled) {
          return { status: 204 };
        }

        const event = normalizeEvent(req.body && typeof req.body === "object" ? req.body : {});
        await ctx.storage.append(eventKey(new Date(event.at)), event, {
          ttl: ctx.config.retentionDays * 24 * 60 * 60,
        });

        return { status: 202, body: { ok: true } };
      },
    },
    {
      method: "GET",
      path: "/summary",
      description: "Return today's analytics rollup.",
      handler: async (_req, ctx) => {
        const date = new Date();
        const rollup =
          (await ctx.storage.get<ReturnType<typeof rollupEvents>>(rollupKey(date))) ??
          rollupEvents(
            (await ctx.storage.listValues<NormalizedAnalyticsEvent>(eventKey(date))).map(
              (row) => row.value,
            ),
          );

        return { status: 200, body: rollup };
      },
    },
  ],
  scheduled: [
    {
      id: "daily-rollup",
      cron: "5 0 * * *",
      description: "Roll up the current day's analytics events into summary counts.",
      handler: async (ctx) => {
        const date = new Date();
        const events = (await ctx.storage.listValues<NormalizedAnalyticsEvent>(eventKey(date))).map(
          (row) => row.value,
        );
        await ctx.storage.set(rollupKey(date), rollupEvents(events), {
          ttl: ctx.config.retentionDays * 24 * 60 * 60,
        });
      },
    },
  ],
  admin: {
    widgets: [
      {
        id: "today-views",
        label: "Today's views",
        kind: "metric",
        actionId: "todayViews",
      },
    ],
    tables: [
      {
        id: "top-paths",
        label: "Top paths today",
        columns: [
          { name: "path", label: "Path" },
          { name: "views", label: "Views" },
        ],
        rowsActionId: "topPaths",
        emptyMessage: "No views collected today.",
      },
    ],
    dashboardWidgets: [
      {
        id: "analytics-lite-today",
        label: "Views today",
        kind: "metric",
        actionId: "todayViews",
        priority: 30,
      },
    ],
  },
  setup: (ctx) => {
    ctx.actions.registerMetric("todayViews", async () => {
      const events = await ctx.storage.listValues<NormalizedAnalyticsEvent>(eventKey());
      return npAdminMetric(events.length, `${dayKey()} local UTC key`);
    });

    ctx.actions.registerTable("topPaths", async () => {
      const events = (await ctx.storage.listValues<NormalizedAnalyticsEvent>(eventKey())).map(
        (row) => row.value,
      );
      const rows = rollupEvents(events).topPaths;
      return npAdminTable(rows);
    });
  },
});

export default analyticsLitePlugin;
