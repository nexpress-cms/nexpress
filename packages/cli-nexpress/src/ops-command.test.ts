import { describe, expect, it } from "vitest";

import { buildRunScriptArgs, resolveOpsScriptInvocation } from "./ops-command.js";

describe("buildRunScriptArgs", () => {
  it("passes ops status flags through package-manager run scripts", () => {
    expect(buildRunScriptArgs("pnpm", "ops:status", ["--json"])).toEqual([
      "run",
      "ops:status",
      "--",
      "--json",
    ]);
    expect(buildRunScriptArgs("npm", "ops:status", ["--brief", "--no-color"])).toEqual([
      "run",
      "ops:status",
      "--",
      "--brief",
      "--no-color",
    ]);
    expect(buildRunScriptArgs("yarn", "ops:status", ["--json"])).toEqual(["ops:status", "--json"]);
  });

  it("maps ops subcommands to project scripts", () => {
    expect(resolveOpsScriptInvocation("status", ["--json"])).toEqual({
      script: "ops:status",
      args: ["--json"],
    });
    expect(resolveOpsScriptInvocation("doctor", ["--prod", "--json"])).toEqual({
      script: "doctor",
      args: ["--prod", "--json"],
    });
    expect(resolveOpsScriptInvocation("preflight", ["--target", "vercel"])).toEqual({
      script: "ops:preflight",
      args: ["--target", "vercel"],
    });
    expect(resolveOpsScriptInvocation("health", ["--url", "http://localhost:3000"])).toEqual({
      script: "ops:health",
      args: ["--url", "http://localhost:3000"],
    });
    expect(resolveOpsScriptInvocation("jobs", ["status", "--json"])).toEqual({
      script: "ops:jobs",
      args: ["--json"],
    });
    expect(resolveOpsScriptInvocation("storage", ["status", "--json"])).toEqual({
      script: "ops:storage",
      args: ["--json"],
    });
    expect(resolveOpsScriptInvocation("plugins", ["list", "--json"])).toEqual({
      script: "ops:plugins",
      args: ["list", "--json"],
    });
    expect(resolveOpsScriptInvocation("plugins", ["doctor", "--brief"])).toEqual({
      script: "ops:plugins",
      args: ["doctor", "--brief"],
    });
    expect(resolveOpsScriptInvocation("release", ["check", "--target", "vercel"])).toEqual({
      script: "release",
      args: ["check", "--target", "vercel"],
    });
    expect(
      resolveOpsScriptInvocation("release", ["verify", "--url", "https://example.com"]),
    ).toEqual({
      script: "release",
      args: ["verify", "--url", "https://example.com"],
    });
    expect(resolveOpsScriptInvocation("jobs", ["queues", "--json"])).toBeNull();
    expect(resolveOpsScriptInvocation("storage", ["verify", "--json"])).toBeNull();
    expect(resolveOpsScriptInvocation("plugins", ["enable", "demo"])).toBeNull();
    expect(resolveOpsScriptInvocation("release", ["apply", "--yes"])).toBeNull();
    expect(resolveOpsScriptInvocation("wat", [])).toBeNull();
  });
});
