import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { NpCollectionConfig, NpFieldConfig } from "../config/types.js";

const { collections, update } = vi.hoisted(() => ({
  collections: new Map<string, NpCollectionConfig>(),
  update: vi.fn(),
}));
vi.mock("../db/runtime.js", () => ({ getDb: () => ({ update }) }));
vi.mock("./registry.js", () => ({
  getAllCollectionSlugs: () => [...collections.keys()],
  getCollectionConfig: (slug: string) => collections.get(slug),
  getCollectionTable: () => table,
}));
vi.mock("./pipeline.js", () => ({}));
vi.mock("../jobs/queue.js", () => ({}));
vi.mock("../plugins/host.js", () => ({}));

import { publishScheduledDocuments } from "./scheduled.js";

const table = pgTable("scheduled_selection", {
  status: text("status"),
  publishedAt: timestamp("published_at"),
});

describe("publishScheduledDocuments collection selection", () => {
  it("scans declared top-level dates and framework-managed draft dates only", async () => {
    const date: NpFieldConfig = { type: "date", name: "publishedAt" };
    const inputs: Array<{
      slug: string;
      fields: NpFieldConfig[];
      versions?: NpCollectionConfig["versions"];
      selected: boolean;
    }> = [
      { slug: "date", fields: [date], selected: true },
      { slug: "wrong-type", fields: [{ type: "text", name: "publishedAt" }], selected: false },
      { slug: "wrong-name", fields: [{ type: "date", name: "scheduledFor" }], selected: false },
      { slug: "row", fields: [{ type: "row", fields: [date] }], selected: true },
      {
        slug: "collapsible",
        fields: [{ type: "collapsible", label: "Meta", fields: [date] }],
        selected: true,
      },
      {
        slug: "group",
        fields: [{ type: "group", name: "publishing", fields: [date] }],
        selected: false,
      },
      {
        slug: "array",
        fields: [{ type: "array", name: "drops", fields: [date] }],
        selected: false,
      },
      { slug: "empty", fields: [], selected: false },
      { slug: "drafts", fields: [], versions: { drafts: true }, selected: true },
    ];
    for (const { slug, fields, versions } of inputs) {
      collections.set(slug, { slug, labels: { singular: slug, plural: slug }, fields, versions });
    }
    update.mockReturnValue({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    });

    const result = await publishScheduledDocuments(new Date("2026-10-01T00:00:00.000Z"));

    expect(result.published).toBe(0);
    for (const { slug, selected } of inputs) {
      expect(result.byCollection[slug], slug).toEqual(selected ? [] : undefined);
    }
    expect(update).toHaveBeenCalledTimes(4);
  });
});
