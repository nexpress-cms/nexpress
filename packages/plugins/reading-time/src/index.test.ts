import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import { readingTimePlugin } from "./index.js";

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
