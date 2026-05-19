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

  it("combines all flags in one call", () => {
    const out = parseCliArgs(["demo", "--yes", "--no-docker", "--local"]);
    expect(out.flags).toEqual({
      projectName: "demo",
      yes: true,
      dockerSetup: false,
    });
    expect(out.localMode).toBe(true);
  });
});
