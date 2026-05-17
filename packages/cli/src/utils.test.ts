import { describe, expect, it } from "vitest";

import { dbPortFromProject, formatProjectName, generateSecret } from "./utils.js";

describe("formatProjectName", () => {
  it("lowercases, hyphenates, and trims edges", () => {
    expect(formatProjectName("  My  New Site! ")).toBe("my-new-site");
  });
  it("falls back to a default when input collapses to empty", () => {
    expect(formatProjectName("!!!")).toBe("my-nexpress-site");
  });
});

describe("generateSecret", () => {
  it("returns a 64-character hex string (32 bytes)", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("dbPortFromProject", () => {
  it("always returns a port inside the 5433-6432 range", () => {
    const names = [
      "",
      "a",
      "my-site",
      "test-site",
      "another-project-with-a-long-name",
      "한글-이름",
    ];
    for (const name of names) {
      const port = dbPortFromProject(name);
      expect(port, `port for ${JSON.stringify(name)}`).toBeGreaterThanOrEqual(5433);
      expect(port).toBeLessThanOrEqual(6432);
    }
  });

  it("is deterministic — same name always returns the same port", () => {
    expect(dbPortFromProject("test-site")).toBe(dbPortFromProject("test-site"));
    expect(dbPortFromProject("another")).toBe(dbPortFromProject("another"));
  });

  it("returns different ports for different names (collision is rare in the typical case)", () => {
    // Not asserting "always different" because the algorithm is a
    // hash-modulo and collisions are mathematically possible.
    // The five names below empirically map to five distinct ports
    // with the current implementation; the test pins that so a
    // future hash change that broadly collides over short names
    // surfaces here.
    const names = ["site-a", "site-b", "site-c", "site-d", "site-e"];
    const ports = new Set(names.map(dbPortFromProject));
    expect(ports.size).toBe(names.length);
  });
});
