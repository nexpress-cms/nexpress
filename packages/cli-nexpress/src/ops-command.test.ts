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
    expect(buildRunScriptArgs("yarn", "ops:status", ["--json"])).toEqual([
      "ops:status",
      "--json",
    ]);
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
    expect(resolveOpsScriptInvocation("wat", [])).toBeNull();
  });
});
