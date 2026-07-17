import { describe, expect, it } from "vitest";

import { parseConfig, WpImportConfigError } from "./config.js";

describe("parseConfig", () => {
  it("parses an empty mappings list", () => {
    const out = parseConfig(`{ "mappings": [] }`);
    expect(out.collectionMappings).toEqual({});
  });

  it("parses a mapping with field overrides (camelCase keys)", () => {
    const out = parseConfig(
      JSON.stringify({
        mappings: [
          {
            wpType: "event",
            collection: "events",
            fieldOverrides: { _event_date: "eventDate" },
          },
        ],
      }),
    );
    expect(out.collectionMappings).toEqual({
      event: { collection: "events", fieldOverrides: { _event_date: "eventDate" } },
    });
  });

  it("accepts snake_case keys (wp_type / field_overrides) for TOML-translated configs", () => {
    const out = parseConfig(
      JSON.stringify({
        mappings: [
          {
            wp_type: "product",
            collection: "products",
            field_overrides: { _price: "price" },
          },
        ],
      }),
    );
    expect(out.collectionMappings.product).toEqual({
      collection: "products",
      fieldOverrides: { _price: "price" },
    });
  });

  it("rejects duplicate wpType entries", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          mappings: [
            { wpType: "x", collection: "a" },
            { wpType: "x", collection: "b" },
          ],
        }),
      ),
    ).toThrow(WpImportConfigError);
  });

  it("rejects mappings missing wpType", () => {
    expect(() => parseConfig(JSON.stringify({ mappings: [{ collection: "x" }] }))).toThrow(
      /wpType/,
    );
  });

  it("rejects mappings missing collection", () => {
    expect(() => parseConfig(JSON.stringify({ mappings: [{ wpType: "x" }] }))).toThrow(
      /collection/,
    );
  });

  it("rejects malformed JSON with a useful message", () => {
    expect(() => parseConfig("{not json")).toThrow(/invalid JSON/);
  });

  it("rejects non-object root", () => {
    expect(() => parseConfig("[]")).toThrow(/top-level/);
  });

  it("rejects fieldOverrides values that aren't strings", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          mappings: [{ wpType: "x", collection: "y", fieldOverrides: { a: 5 } }],
        }),
      ),
    ).toThrow(/fieldOverrides/);
  });
});
