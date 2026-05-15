import { describe, expect, it } from "vitest";

import { promptForProjectConfig } from "./prompts.js";

describe("promptForProjectConfig — non-interactive paths", () => {
  it("returns defaults when --yes is set and no flags override them", async () => {
    const out = await promptForProjectConfig({
      yes: true,
      projectName: "demo",
    });
    expect(out).toEqual({
      projectName: "demo",
      includeExampleContent: true,
      dockerSetup: true,
    });
  });

  it("flags override the defaults under --yes", async () => {
    const out = await promptForProjectConfig({
      yes: true,
      projectName: "demo",
      includeExampleContent: false,
      dockerSetup: false,
    });
    expect(out).toEqual({
      projectName: "demo",
      includeExampleContent: false,
      dockerSetup: false,
    });
  });

  it("threads --theme through when set; omits it otherwise", async () => {
    const withTheme = await promptForProjectConfig({
      yes: true,
      projectName: "demo",
      themeId: "magazine",
    });
    expect(withTheme.themeId).toBe("magazine");
    const withoutTheme = await promptForProjectConfig({
      yes: true,
      projectName: "demo",
    });
    expect(withoutTheme.themeId).toBeUndefined();
  });

  it("rejects an unknown --theme value", async () => {
    await expect(
      promptForProjectConfig({
        yes: true,
        projectName: "demo",
        themeId: "no-such-theme",
      }),
    ).rejects.toThrow(/Unknown --theme value/);
  });

  it("normalizes the project name (whitespace / case / spaces → kebab)", async () => {
    const out = await promptForProjectConfig({
      yes: true,
      projectName: "  My Site  ",
    });
    expect(out.projectName).toBe("my-site");
  });

  it("falls back to the canonical default name on empty input", async () => {
    // formatProjectName already coerces empty strings → "my-nexpress-site".
    const out = await promptForProjectConfig({ yes: true, projectName: "" });
    expect(out.projectName).toBe("my-nexpress-site");
  });
});
