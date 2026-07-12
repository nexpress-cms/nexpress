import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  npAnalyzePluginDefinitionContract,
  npPluginTranslationKeys,
  npValidatePluginVoidResult,
} from "./definition-contract.js";

describe("remaining plugin definition contracts", () => {
  it("accepts typed config, lifecycle callbacks, and ICU translations", () => {
    const definition = {
      configSchema: z.object({ enabled: z.boolean().default(true) }),
      configVersion: 2,
      configMigrate: (old: unknown) => old,
      setup: () => undefined,
      teardown: () => undefined,
      i18n: {
        en: { "demo.count": "{count, plural, one {# item} other {# items}}" },
      },
    };
    expect(npAnalyzePluginDefinitionContract(definition)).toEqual([]);
    expect(npPluginTranslationKeys(definition.i18n)).toEqual(["en:demo.count"]);
  });

  it.each([
    [{ manifest: { id: "x".repeat(129) } }, /at most 128 characters/],
    [{ manifest: { id: "bad id" } }, /npm-shaped id/],
    [{ configSchema: {} }, /Zod-compatible/],
    [{ configSchema: z.string() }, /top-level Zod object/],
    [{ configVersion: 0 }, /positive integer/],
    [{ configVersion: 2 }, /require configSchema/],
    [{ configSchema: z.object({}), configVersion: 2 }, /requires configMigrate/],
    [{ setup: true }, /setup must be a function/],
    [{ teardown: "later" }, /teardown must be a function/],
    [{ i18n: { "en-us": { key: "value" } } }, /canonical BCP 47/],
    [{ i18n: { en: { key: "{count, plural," } } }, /invalid ICU/],
  ])("rejects malformed remaining definition surfaces", (value, message) => {
    expect(npAnalyzePluginDefinitionContract(value)[0]?.message).toMatch(message);
  });

  it("requires setup and teardown to resolve to void", () => {
    expect(npValidatePluginVoidResult("setup", undefined)).toEqual({ ok: true });
    expect(npValidatePluginVoidResult("teardown", "leak")).toEqual({
      ok: false,
      message: "teardown must resolve to void.",
    });
  });
});
