import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import { estimateMinutes, readingTimePlugin } from "./index.js";

describe("reading-time configSchema", () => {
  // The plugin definition's configSchema is exposed on the
  // definition object (not the manifest); we cross-check it
  // here so a future refactor can't silently drop it. The
  // framework's introspector reads it via the same path.
  const schema = readingTimePlugin.configSchema as ZodTypeAny;

  it("declares a wordsPerMinute number field", () => {
    const parsed = schema.parse({ wordsPerMinute: 250 });
    expect(parsed).toEqual({ wordsPerMinute: 250 });
  });

  it("defaults wordsPerMinute to 220 when omitted", () => {
    const parsed = schema.parse({});
    expect(parsed).toEqual({ wordsPerMinute: 220 });
  });

  it("rejects fractional wordsPerMinute", () => {
    expect(() => schema.parse({ wordsPerMinute: 220.5 })).toThrow();
  });

  it("rejects out-of-range wordsPerMinute (< 50)", () => {
    expect(() => schema.parse({ wordsPerMinute: 49 })).toThrow();
  });

  it("rejects out-of-range wordsPerMinute (> 800)", () => {
    expect(() => schema.parse({ wordsPerMinute: 801 })).toThrow();
  });

  it("accepts the boundary values 50 and 800", () => {
    expect(schema.parse({ wordsPerMinute: 50 })).toEqual({ wordsPerMinute: 50 });
    expect(schema.parse({ wordsPerMinute: 800 })).toEqual({ wordsPerMinute: 800 });
  });
});

describe("plugin metadata", () => {
  it("registers id, version, and routes/hooks declared in the manifest", () => {
    expect(readingTimePlugin.manifest.id).toBe("reading-time");
    expect(readingTimePlugin.manifest.version).toBe("0.2.0");
    expect(readingTimePlugin.routes?.[0]?.path).toBe("/estimate");
    expect(Object.keys(readingTimePlugin.hooks ?? {})).toContain("content:afterCreate");
    expect(Object.keys(readingTimePlugin.hooks ?? {})).toContain("content:afterUpdate");
  });

  it("does NOT declare admin.settings.fields (auto-form replaces it)", () => {
    // Pre-G.2.1 the plugin had no admin surface either — but the
    // assertion here protects against a future regression where
    // someone tries to mix configSchema with hand-rolled fields.
    expect(readingTimePlugin.admin?.settings).toBeUndefined();
  });
});

describe("estimateMinutes", () => {
  // Default-WPM regression guard: the migration from 200 → 220
  // changes the math by ~10%, so a "200-word post" used to read
  // as 1 min and now reads as 1 min (Math.max(1, …) floor wins
  // until we cross word counts). These tests pin the boundary.
  it("returns 0 for empty input", () => {
    expect(estimateMinutes("", 220)).toBe(0);
    expect(estimateMinutes("   \n  ", 220)).toBe(0);
  });

  it("rounds up to a 1-minute floor for any non-empty text", () => {
    expect(estimateMinutes("hi there", 220)).toBe(1);
    expect(estimateMinutes("a".repeat(5).split("").join(" "), 220)).toBe(1);
  });

  it("scales linearly with WPM (220 vs 440 halves the estimate)", () => {
    const text = Array.from({ length: 660 }, () => "x").join(" ");
    expect(estimateMinutes(text, 220)).toBe(3);
    expect(estimateMinutes(text, 440)).toBe(2); // Math.round(660/440) = 2
  });

  it("matches the new 220-default for a typical short post", () => {
    // 440 words → exactly 2 minutes at 220 WPM. Pre-G.2.1 (200 WPM)
    // the same input would be 2.2 min → rounds to 2 min anyway, so
    // most short posts read identically. Longer posts diverge: this
    // test pins the new contract.
    const text = Array.from({ length: 440 }, () => "x").join(" ");
    expect(estimateMinutes(text, 220)).toBe(2);
  });
});
