import { describe, expect, it } from "vitest";

import { getLocaleDirection } from "./direction.js";

describe("getLocaleDirection (Phase 12.8)", () => {
  it("returns rtl for Arabic, Hebrew, Persian, Urdu", () => {
    expect(getLocaleDirection("ar")).toBe("rtl");
    expect(getLocaleDirection("he")).toBe("rtl");
    expect(getLocaleDirection("fa")).toBe("rtl");
    expect(getLocaleDirection("ur")).toBe("rtl");
  });

  it("returns rtl for region-tagged Arabic variants", () => {
    expect(getLocaleDirection("ar-EG")).toBe("rtl");
    expect(getLocaleDirection("ar-SA")).toBe("rtl");
  });

  it("returns ltr for English, Korean, Japanese, Chinese, Spanish", () => {
    expect(getLocaleDirection("en")).toBe("ltr");
    expect(getLocaleDirection("en-US")).toBe("ltr");
    expect(getLocaleDirection("ko")).toBe("ltr");
    expect(getLocaleDirection("ja")).toBe("ltr");
    expect(getLocaleDirection("zh-CN")).toBe("ltr");
    expect(getLocaleDirection("es")).toBe("ltr");
  });

  it("returns ltr for empty / non-string / malformed input (no throw)", () => {
    expect(getLocaleDirection("")).toBe("ltr");
    expect(getLocaleDirection("not a tag at all !!!")).toBe("ltr");
    // @ts-expect-error — verifying runtime tolerance to non-string
    expect(getLocaleDirection(undefined)).toBe("ltr");
    // @ts-expect-error — verifying runtime tolerance to non-string
    expect(getLocaleDirection(null)).toBe("ltr");
  });

  it("respects the script subtag for languages with both directions", () => {
    // Kurdish in Arabic script is RTL; Kurdish in Latin script
    // is LTR. Sanity-check that the textInfo lookup follows
    // the script subtag rather than guessing from the language
    // alone.
    expect(getLocaleDirection("ku-Arab")).toBe("rtl");
    expect(getLocaleDirection("ku-Latn")).toBe("ltr");
  });
});
