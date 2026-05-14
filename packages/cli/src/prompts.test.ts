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
      themeId: "default",
    });
  });

  it("flags override the defaults under --yes", async () => {
    const out = await promptForProjectConfig({
      yes: true,
      projectName: "demo",
      includeExampleContent: false,
      dockerSetup: false,
      themeId: "magazine",
    });
    expect(out).toEqual({
      projectName: "demo",
      includeExampleContent: false,
      dockerSetup: false,
      themeId: "magazine",
    });
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
