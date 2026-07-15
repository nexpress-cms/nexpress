import { afterEach, describe, expect, it } from "vitest";

import { getI18nConfig, resetI18nConfig, setI18nConfig } from "./registry.js";

afterEach(() => resetI18nConfig());

describe("i18n runtime registry", () => {
  it("stores a detached immutable config snapshot", () => {
    const config = { locales: ["en", "ko"], defaultLocale: "en" };
    setI18nConfig(config);
    config.locales[0] = "fr";

    const registered = getI18nConfig();
    expect(registered).toEqual({ locales: ["en", "ko"], defaultLocale: "en" });
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered?.locales)).toBe(true);
  });

  it("rejects invalid SDK-bypassing runtime config", () => {
    expect(() => setI18nConfig({ locales: ["en-us"], defaultLocale: "en-us" })).toThrow(
      /canonical BCP 47/u,
    );
    expect(getI18nConfig()).toBeNull();
  });
});
