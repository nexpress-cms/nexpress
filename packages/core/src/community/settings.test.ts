import { describe, expect, it } from "vitest";

import { npRequireCommunitySettings } from "./settings.js";

const exact = {
  reactionKinds: ["like", "celebrate"],
  registrationEnabled: true,
  memberUploadQuota: { perDay: 5, total: null },
};

describe("persisted community settings contract", () => {
  it("accepts the exact registered value", () => {
    expect(npRequireCommunitySettings(exact)).toEqual(exact);
  });

  it("rejects missing nested quota fields", () => {
    expect(() =>
      npRequireCommunitySettings({
        ...exact,
        memberUploadQuota: { perDay: 5 },
      }),
    ).toThrow("Invalid persisted community settings");
  });

  it("rejects unknown fields", () => {
    expect(() => npRequireCommunitySettings({ ...exact, typo: true })).toThrow(
      "Invalid persisted community settings",
    );
  });
});
