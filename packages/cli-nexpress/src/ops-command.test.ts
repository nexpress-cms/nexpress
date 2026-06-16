import { describe, expect, it } from "vitest";

import { buildRunScriptArgs, resolveOpsScriptInvocation } from "./ops-command.js";

describe("buildRunScriptArgs", () => {
  it("passes ops status flags through package-manager run scripts", () => {
    expect(buildRunScriptArgs("pnpm", "ops:status", ["--json"])).toEqual([
      "--silent",
      "run",
      "ops:status",
      "--",
      "--json",
    ]);
    expect(buildRunScriptArgs("npm", "ops:status", ["--json"])).toEqual([
      "--silent",
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
    expect(resolveOpsScriptInvocation("contracts", ["--json"])).toEqual({
      script: "ops:contracts",
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
    expect(resolveOpsScriptInvocation("backup", ["status", "--json"])).toEqual({
      script: "ops:backup",
      args: ["status", "--json"],
    });
    expect(resolveOpsScriptInvocation("backup", ["create", "--json"])).toEqual({
      script: "ops:backup",
      args: ["create", "--json"],
    });
    expect(resolveOpsScriptInvocation("backup", ["verify", "latest", "--json"])).toEqual({
      script: "ops:backup",
      args: ["verify", "latest", "--json"],
    });
    expect(resolveOpsScriptInvocation("backup", ["restore-plan", "latest", "--json"])).toEqual({
      script: "ops:backup",
      args: ["restore-plan", "latest", "--json"],
    });
    expect(resolveOpsScriptInvocation("jobs", ["status", "--json"])).toEqual({
      script: "ops:jobs",
      args: ["--json"],
    });
    expect(resolveOpsScriptInvocation("jobs", ["pause", "--reason", "maintenance"])).toEqual({
      script: "ops:jobs",
      args: ["pause", "--reason", "maintenance"],
    });
    expect(resolveOpsScriptInvocation("jobs", ["resume", "--json"])).toEqual({
      script: "ops:jobs",
      args: ["resume", "--json"],
    });
    expect(
      resolveOpsScriptInvocation("jobs", ["retry-all", "--state", "failed", "--json"]),
    ).toEqual({
      script: "ops:jobs",
      args: ["retry-all", "--state", "failed", "--json"],
    });
    expect(resolveOpsScriptInvocation("jobs", ["drain", "--json"])).toEqual({
      script: "ops:jobs",
      args: ["drain", "--json"],
    });
    expect(resolveOpsScriptInvocation("migrate", ["plan", "--json"])).toEqual({
      script: "ops:migrate",
      args: ["plan", "--json"],
    });
    expect(resolveOpsScriptInvocation("migrate", ["rollback-plan", "--json"])).toEqual({
      script: "ops:migrate",
      args: ["rollback-plan", "--json"],
    });
    expect(resolveOpsScriptInvocation("storage", ["status", "--json"])).toEqual({
      script: "ops:storage",
      args: ["--json"],
    });
    expect(resolveOpsScriptInvocation("storage", ["verify", "--json"])).toEqual({
      script: "ops:storage",
      args: ["verify", "--json"],
    });
    expect(resolveOpsScriptInvocation("storage", ["missing-files", "--json"])).toEqual({
      script: "ops:storage",
      args: ["missing-files", "--json"],
    });
    expect(resolveOpsScriptInvocation("storage", ["orphaned-files", "--json"])).toEqual({
      script: "ops:storage",
      args: ["orphaned-files", "--json"],
    });
    expect(
      resolveOpsScriptInvocation("storage", ["migrate", "plan", "--target", "s3", "--json"]),
    ).toEqual({
      script: "ops:storage",
      args: ["migrate", "plan", "--target", "s3", "--json"],
    });
    expect(
      resolveOpsScriptInvocation("storage", [
        "test",
        "--execute",
        "--approve",
        "storage-test",
        "--json",
      ]),
    ).toEqual({
      script: "ops:storage",
      args: ["test", "--execute", "--approve", "storage-test", "--json"],
    });
    expect(resolveOpsScriptInvocation("plugins", ["list", "--json"])).toEqual({
      script: "ops:plugins",
      args: ["list", "--json"],
    });
    expect(resolveOpsScriptInvocation("plugins", ["doctor", "--brief"])).toEqual({
      script: "ops:plugins",
      args: ["doctor", "--brief"],
    });
    expect(resolveOpsScriptInvocation("plugins", ["inspect", "reading-time", "--json"])).toEqual({
      script: "ops:plugins",
      args: ["inspect", "reading-time", "--json"],
    });
    expect(resolveOpsScriptInvocation("plugins", ["upgrade-plan", "--json"])).toEqual({
      script: "ops:plugins",
      args: ["upgrade-plan", "--json"],
    });
    expect(resolveOpsScriptInvocation("release", ["check", "--target", "vercel"])).toEqual({
      script: "release",
      args: ["check", "--target", "vercel"],
    });
    expect(resolveOpsScriptInvocation("release", ["plan", "--target", "vercel"])).toEqual({
      script: "release",
      args: ["plan", "--target", "vercel"],
    });
    expect(resolveOpsScriptInvocation("release", ["apply", "--plan", "release.json"])).toEqual({
      script: "release",
      args: ["apply", "--plan", "release.json"],
    });
    expect(
      resolveOpsScriptInvocation("release", ["verify", "--url", "https://example.com"]),
    ).toEqual({
      script: "release",
      args: ["verify", "--url", "https://example.com"],
    });
    expect(resolveOpsScriptInvocation("runbook", ["worker-not-draining", "--json"])).toEqual({
      script: "runbook",
      args: ["worker-not-draining", "--json"],
    });
    expect(resolveOpsScriptInvocation("jobs", ["queues", "--json"])).toBeNull();
    expect(resolveOpsScriptInvocation("backup", ["delete", "--json"])).toBeNull();
    expect(resolveOpsScriptInvocation("backup", ["verify", "--json"])).toBeNull();
    expect(resolveOpsScriptInvocation("migrate", ["apply", "--safe"])).toBeNull();
    expect(
      resolveOpsScriptInvocation("storage", ["migrate", "apply", "--target", "s3"]),
    ).toBeNull();
    expect(resolveOpsScriptInvocation("plugins", ["enable", "demo"])).toBeNull();
    expect(resolveOpsScriptInvocation("plugins", ["inspect", "--json"])).toBeNull();
    expect(resolveOpsScriptInvocation("runbook", ["--json"])).toBeNull();
    expect(resolveOpsScriptInvocation("wat", [])).toBeNull();
  });
});
