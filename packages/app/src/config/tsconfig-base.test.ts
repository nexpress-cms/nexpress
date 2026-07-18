import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("shared TypeScript config", () => {
  it("leaves consumer-relative roots and aliases to the generated project", () => {
    const config = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "tsconfig.base.json"), "utf8"),
    ) as {
      include?: unknown;
      exclude?: unknown;
      compilerOptions?: { paths?: unknown };
    };

    expect(config).not.toHaveProperty("include");
    expect(config).not.toHaveProperty("exclude");
    expect(config.compilerOptions).not.toHaveProperty("paths");
  });
});
