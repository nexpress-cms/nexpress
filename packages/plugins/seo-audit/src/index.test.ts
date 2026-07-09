import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import { auditSeo, seoAuditPlugin, type SeoAuditConfig } from "./index.js";

const DEFAULT_CONFIG: SeoAuditConfig = {
  titleMin: 30,
  titleMax: 60,
  descriptionMin: 70,
  descriptionMax: 160,
  minBodyWords: 250,
  includeDescription: true,
};

describe("seo-audit configSchema", () => {
  const schema = seoAuditPlugin.configSchema as ZodTypeAny;

  it("provides sensible defaults for an empty input", () => {
    const parsed = schema.parse({});
    expect(parsed).toEqual(DEFAULT_CONFIG);
  });

  it("accepts custom thresholds within range", () => {
    const parsed = schema.parse({
      titleMin: 20,
      titleMax: 80,
      descriptionMin: 50,
      descriptionMax: 200,
      minBodyWords: 400,
      includeDescription: false,
    }) as SeoAuditConfig;
    expect(parsed.titleMin).toBe(20);
    expect(parsed.titleMax).toBe(80);
    expect(parsed.minBodyWords).toBe(400);
    expect(parsed.includeDescription).toBe(false);
  });

  it("rejects non-integer thresholds", () => {
    expect(() => schema.parse({ titleMin: 30.5 })).toThrow();
  });

  it("rejects out-of-range thresholds", () => {
    // titleMax must be >= 10
    expect(() => schema.parse({ titleMax: 5 })).toThrow();
    // descriptionMax must be <= 500
    expect(() => schema.parse({ descriptionMax: 999 })).toThrow();
  });
});

describe("plugin metadata", () => {
  it("registers id, version, and capabilities", () => {
    expect(seoAuditPlugin.manifest.id).toBe("seo-audit");
    expect(seoAuditPlugin.manifest.version).toBe("0.2.0");
    expect(seoAuditPlugin.manifest.capabilities).toContain("hooks:content");
    expect(seoAuditPlugin.manifest.capabilities).toContain("admin:dashboard");
  });

  it("does NOT declare admin.settings.fields (auto-form replaces it)", () => {
    // Pre-G.2.3 the plugin shipped a hand-rolled settings form whose
    // values were never read — a textbook "auto-form wins" migration.
    expect(seoAuditPlugin.admin?.settings).toBeUndefined();
  });

  it("keeps the rest of the admin extension (widgets / actions / tables / dashboard / collectionTabs)", () => {
    // The migration scope was settings-only; non-settings parts of
    // admin.* must keep working.
    expect(seoAuditPlugin.admin?.widgets?.length).toBeGreaterThan(0);
    expect(seoAuditPlugin.admin?.actions?.length).toBeGreaterThan(0);
    expect(seoAuditPlugin.admin?.dashboardWidgets?.length).toBeGreaterThan(0);
    expect(seoAuditPlugin.admin?.collectionTabs?.length).toBeGreaterThan(0);
  });

  it("declares the admin action id and kind inventory", () => {
    expect(
      Object.entries(seoAuditPlugin.actions ?? {}).map(([id, action]) => ({
        id,
        kind: action.kind,
      })),
    ).toEqual([
      { id: "lastAuditScore", kind: "metric" },
      { id: "rescanLatest", kind: "action" },
      { id: "auditDocument", kind: "metric" },
    ]);
  });
});

describe("auditSeo (with operator-tuned config)", () => {
  // Wires the operator's thresholds into the audit logic. Pre-G.2.3
  // the same constants were hardcoded; this suite proves the
  // operator-tuned values actually take effect.
  it("flags titles shorter than the operator's titleMin", () => {
    const tightConfig: SeoAuditConfig = { ...DEFAULT_CONFIG, titleMin: 50 };
    const result = auditSeo(
      {
        title: "Short title here", // 16 chars
        description:
          "A reasonable meta description that explains the content well enough for search.",
        content: "Body text. ".repeat(60), // 120 words
        headings: [],
      },
      tightConfig,
    );
    expect(result.issues.some((i) => i.code === "short-title")).toBe(true);
  });

  it("does NOT flag a 50-char title under the default config (titleMin=30)", () => {
    const result = auditSeo(
      {
        title: "A reasonably descriptive title that fits the range",
        description:
          "A reasonable meta description that explains the content well enough for search.",
        content: "Body text. ".repeat(60),
        headings: [],
      },
      DEFAULT_CONFIG,
    );
    expect(result.issues.some((i) => i.code === "short-title")).toBe(false);
    expect(result.issues.some((i) => i.code === "long-title")).toBe(false);
  });

  it("respects includeDescription=false (skips description checks)", () => {
    const result = auditSeo(
      {
        title: "A reasonably descriptive title that fits",
        description: "", // would normally trigger missing-description warning
        content: "Body text. ".repeat(60),
        headings: [],
      },
      { ...DEFAULT_CONFIG, includeDescription: false },
    );
    expect(result.issues.some((i) => i.code === "missing-description")).toBe(false);
  });

  it("respects custom minBodyWords (raised threshold flags more docs as thin)", () => {
    const strictConfig: SeoAuditConfig = { ...DEFAULT_CONFIG, minBodyWords: 1000 };
    const result = auditSeo(
      {
        title: "A reasonably descriptive title that fits the range",
        description:
          "A reasonable meta description that explains the content well enough for search.",
        content: "Body text. ".repeat(60), // ~120 words
        headings: [],
      },
      strictConfig,
    );
    expect(result.issues.some((i) => i.code === "thin-body")).toBe(true);
  });

  it("emits no issues for a doc that meets all thresholds", () => {
    const result = auditSeo(
      {
        title: "A reasonably descriptive title that fits the range nicely",
        description:
          "A reasonable meta description that explains the content well enough for search and previews.",
        content: "Body text with substantial content. ".repeat(60), // ~360 words
        headings: ["Section one", "Section two"],
      },
      DEFAULT_CONFIG,
    );
    expect(result.issues).toEqual([]);
    expect(result.score).toBe(100);
  });
});
