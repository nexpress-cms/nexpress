import { describe, expect, it } from "vitest";

import {
  createNextConfig,
  defaultOutputFileTracingIncludes,
  defaultTranspilePackages,
} from "./next-config.js";

describe("createNextConfig", () => {
  it("traces sharp native packages through pnpm real paths for standalone deploys", () => {
    const config = createNextConfig();
    const includes = config.outputFileTracingIncludes?.["/*"] ?? [];

    expect(config.output).toBe("standalone");
    expect(includes).toEqual(expect.arrayContaining(defaultOutputFileTracingIncludes["/*"]));
    expect(includes).toContain("./node_modules/.pnpm/sharp@*/node_modules/sharp/**/*");
    expect(includes).toContain(
      "./node_modules/.pnpm/@img+sharp-libvips-linux-*/node_modules/@img/sharp-libvips-linux-*/**/*",
    );
    expect(includes.every((include) => include.startsWith("./node_modules/.pnpm/"))).toBe(true);
    expect(includes.some((include) => include.startsWith("./node_modules/sharp"))).toBe(false);
  });

  it("appends custom output tracing includes without dropping the sharp guard", () => {
    const config = createNextConfig({
      outputFileTracingIncludes: {
        "/*": ["./runtime-assets/**/*"],
        "/api/plugins/*": ["./plugins/**/*"],
      },
    });

    expect(config.outputFileTracingIncludes?.["/*"]).toEqual(
      expect.arrayContaining([
        "./node_modules/.pnpm/sharp@*/node_modules/sharp/**/*",
        "./runtime-assets/**/*",
      ]),
    );
    expect(config.outputFileTracingIncludes?.["/api/plugins/*"]).toEqual(["./plugins/**/*"]);
  });

  it("still lets callers replace array-based Next defaults explicitly", () => {
    const config = createNextConfig({
      transpilePackages: [...defaultTranspilePackages, "@acme/site-ui"],
      serverExternalPackages: ["sharp"],
    });

    expect(config.transpilePackages).toContain("@acme/site-ui");
    expect(config.serverExternalPackages).toEqual(["sharp"]);
  });
});
