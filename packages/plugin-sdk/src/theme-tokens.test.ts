import { describe, expectTypeOf, it } from "vitest";

import type { NpPluginContext, NpThemeTokens, NpThemeTokensOverlay } from "./types.js";

describe("plugin theme token types", () => {
  it("binds runtime reads to full tokens and writes to nested overlays", () => {
    expectTypeOf<ReturnType<NpPluginContext["theme"]["getTokens"]>>().toEqualTypeOf<
      Promise<NpThemeTokens>
    >();
    expectTypeOf<
      Parameters<NpPluginContext["theme"]["setTokens"]>[0]
    >().toEqualTypeOf<NpThemeTokensOverlay>();
  });
});
