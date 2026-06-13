import { describe, expect, it } from "vitest";

import { promptForProjectConfig, resolveProjectTarget } from "./prompts.js";

describe("promptForProjectConfig — non-interactive paths", () => {
  it("returns defaults when --yes is set and no flags override them", async () => {
    const out = await promptForProjectConfig({
      yes: true,
      projectName: "demo",
    });
    expect(out).toEqual({
      projectName: "demo",
      projectPath: "demo",
      dockerSetup: true,
    });
  });

  it("flags override the defaults under --yes", async () => {
    const out = await promptForProjectConfig({
      yes: true,
      projectName: "demo",
      dockerSetup: false,
    });
    expect(out).toEqual({
      projectName: "demo",
      projectPath: "demo",
      dockerSetup: false,
    });
  });

  it("normalizes the project name (whitespace / case / spaces → kebab)", async () => {
    const out = await promptForProjectConfig({
      yes: true,
      projectName: "  My Site  ",
    });
    expect(out.projectName).toBe("my-site");
    expect(out.projectPath).toBe("my-site");
  });

  it("falls back to the canonical default name on empty input", async () => {
    // formatProjectName already coerces empty strings → "my-nexpress-site".
    const out = await promptForProjectConfig({ yes: true, projectName: "" });
    expect(out.projectName).toBe("my-nexpress-site");
    expect(out.projectPath).toBe("my-nexpress-site");
  });

  it("preserves target paths while deriving a package-safe project name", () => {
    expect(resolveProjectTarget("/Users/example/My Site")).toEqual({
      projectName: "my-site",
      projectPath: "/Users/example/my-site",
    });
    expect(resolveProjectTarget("../Demo Site")).toEqual({
      projectName: "demo-site",
      projectPath: "../demo-site",
    });
  });
});
