import { describe, expect, it } from "vitest";

import { buildRunScriptArgs } from "./ops-command.js";

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
});
