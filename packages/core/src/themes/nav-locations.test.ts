import { describe, expect, it } from "vitest";

import { extractNavLocationsFromImpl } from "./nav-locations.js";

describe("extractNavLocationsFromImpl", () => {
  it("returns empty when impl is undefined", () => {
    expect(extractNavLocationsFromImpl(undefined)).toEqual([]);
  });

  it("returns empty when impl has no navLocations", () => {
    expect(extractNavLocationsFromImpl({})).toEqual([]);
  });

  it("returns empty when navLocations is not an object", () => {
    expect(extractNavLocationsFromImpl({ navLocations: "wrong" })).toEqual([]);
  });

  it("extracts declared locations with all fields", () => {
    const locations = extractNavLocationsFromImpl({
      navLocations: {
        primary: {
          label: "Primary header nav",
          description: "Sticky top bar",
          maxItems: 8,
        },
        footerLinks: { label: "Footer links" },
      },
    });
    expect(locations).toHaveLength(2);
    expect(locations[0]).toEqual({
      key: "primary",
      label: "Primary header nav",
      description: "Sticky top bar",
      maxItems: 8,
    });
    expect(locations[1]).toEqual({
      key: "footerLinks",
      label: "Footer links",
    });
  });

  it("skips entries missing a label (malformed)", () => {
    const locations = extractNavLocationsFromImpl({
      navLocations: {
        good: { label: "OK" },
        broken: {},
      },
    });
    expect(locations.map((l) => l.key)).toEqual(["good"]);
  });

  it("ignores non-string description / non-number maxItems", () => {
    const locations = extractNavLocationsFromImpl({
      navLocations: {
        x: {
          label: "X",
          description: 42,
          maxItems: "10",
        },
      },
    });
    expect(locations[0]?.description).toBeUndefined();
    expect(locations[0]?.maxItems).toBeUndefined();
  });
});
