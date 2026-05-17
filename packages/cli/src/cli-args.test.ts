import { describe, expect, it } from "vitest";

import { parseCliArgs } from "./index.js";

describe("parseCliArgs", () => {
  it("captures the project name positional", () => {
    const out = parseCliArgs(["my-site"]);
    expect(out.flags.projectName).toBe("my-site");
  });

  it("supports --yes / -y as the umbrella default-everything switch", () => {
    expect(parseCliArgs(["--yes"]).flags.yes).toBe(true);
    expect(parseCliArgs(["-y"]).flags.yes).toBe(true);
  });

  it("supports --example / --no-example pair", () => {
    expect(parseCliArgs(["--example"]).flags.includeExampleContent).toBe(true);
    expect(parseCliArgs(["--no-example"]).flags.includeExampleContent).toBe(false);
    expect(parseCliArgs([]).flags.includeExampleContent).toBeUndefined();
  });

  it("supports --docker / --no-docker pair", () => {
    expect(parseCliArgs(["--docker"]).flags.dockerSetup).toBe(true);
    expect(parseCliArgs(["--no-docker"]).flags.dockerSetup).toBe(false);
  });

  it("captures --local separately from prompt flags", () => {
    expect(parseCliArgs(["--local"]).localMode).toBe(true);
    expect(parseCliArgs([]).localMode).toBe(false);
  });

  it("rejects unknown flags rather than silently defaulting", () => {
    expect(() => parseCliArgs(["--foo"])).toThrow(/Unknown flag/);
  });

  it("rejects a second positional", () => {
    expect(() => parseCliArgs(["a", "b"])).toThrow(/Unexpected positional/);
  });

  it("supports --theme <id> in space form (headless escape hatch)", () => {
    expect(parseCliArgs(["--theme", "magazine"]).flags.themeId).toBe("magazine");
  });

  it("supports --theme=<id> in equals form", () => {
    expect(parseCliArgs(["--theme=portfolio"]).flags.themeId).toBe("portfolio");
  });

  it("rejects --theme without a value", () => {
    expect(() => parseCliArgs(["--theme"])).toThrow(/--theme requires a value/);
    expect(() => parseCliArgs(["--theme", "--yes"])).toThrow(/--theme requires a value/);
  });

  it("supports --starter <id> as a friendly alias (blog → default)", () => {
    expect(parseCliArgs(["--starter", "blog"]).flags.themeId).toBe("default");
    expect(parseCliArgs(["--starter=blog"]).flags.themeId).toBe("default");
  });

  it("--starter passes raw theme ids through unchanged", () => {
    expect(parseCliArgs(["--starter", "magazine"]).flags.themeId).toBe("magazine");
    expect(parseCliArgs(["--starter=docs"]).flags.themeId).toBe("docs");
  });

  it("rejects --starter without a value", () => {
    expect(() => parseCliArgs(["--starter"])).toThrow(/--starter requires a value/);
    expect(() => parseCliArgs(["--starter", "--yes"])).toThrow(/--starter requires a value/);
  });

  it("last-wins when both --theme and --starter are passed", () => {
    // The two flags are aliases; mixing them is a no-op error case
    // (no one writes both deliberately). Last-wins keeps the parser
    // simple and matches standard CLI convention.
    expect(
      parseCliArgs(["--theme=magazine", "--starter=docs"]).flags.themeId,
    ).toBe("docs");
    expect(
      parseCliArgs(["--starter=blog", "--theme=portfolio"]).flags.themeId,
    ).toBe("portfolio");
  });

  it("combines all flags in one call", () => {
    const out = parseCliArgs([
      "demo",
      "--yes",
      "--no-example",
      "--no-docker",
      "--local",
      "--theme",
      "magazine",
    ]);
    expect(out.flags).toEqual({
      projectName: "demo",
      yes: true,
      includeExampleContent: false,
      dockerSetup: false,
      themeId: "magazine",
    });
    expect(out.localMode).toBe(true);
  });
});
