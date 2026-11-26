import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildContractLimitsV1,
  npParseAgentSiteBriefV1,
  type NpAgentSiteBlueprintV1,
  type NpAgentSiteBriefV1,
} from "@nexpress/core/agent-contract";
import { createSiteBriefTemplateV1, runSiteCommandV1 } from "./command.js";
import { NP_SITE_BUILD_SKILL_V1 } from "./skill.js";
import { runNexpressCli } from "../index.js";
import * as generatorCommand from "./generator-command.js";
import { SiteBuildLinuxSandboxFailureV1 } from "./linux-sandbox.js";

const directories: string[] = [];
async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "np-site-build-"));
  directories.push(cwd);
  return cwd;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const out = ".nexpress/site/brief.canonical.json";
const validate = ["brief", "validate", "--file", "brief.json", "--out", out];

describe("local Build artifact CLI", () => {
  it.each(["timeout", null] as const)(
    "preserves the native browser diagnostic %s without inferring a fixture reason",
    async (reason) => {
      const cwd = await project();
      const diagnostic = reason
        ? {
            reason,
            loaded: false,
            inflight: 0,
            ready: 0,
            request: null,
            wait: {
              step: "font-and-frames" as const,
              elapsedMs: 120_005,
              stepElapsedMs: 40,
              pendingCount: 0,
              truncated: false,
              pending: [],
            },
          }
        : null;
      vi.spyOn(generatorCommand, "runSiteBuildGenerateV1").mockRejectedValue(
        new SiteBuildLinuxSandboxFailureV1(
          {
            schemaVersion: "np.site-build-linux-audit.v1",
            status: "failed",
            reason: "driver-exit",
            rootExitCode: 1,
            rootSignal: 0,
            tracedProcesses: 167,
            reapedProcesses: 167,
            descendantsReaped: true,
            argumentsFrozen: true,
            ownIpcReclaimed: true,
            forbiddenAttempts: 0,
          },
          "browser",
          null,
          null,
          null,
          "network-idle",
          diagnostic,
        ),
      );
      const result = await runSiteCommandV1(
        [
          "generate",
          "--brief",
          "brief.json",
          "--directions",
          "directions.json",
          "--blueprint",
          "blueprint.json",
          "--runtime",
          "runtime.json",
          "--out",
          ".nexpress/site/review/final/result.json",
        ],
        cwd,
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).failurePhase).toEqual({
        driver: "browser",
        browser: "network-idle",
        browserDiagnostic: diagnostic,
        fixture: null,
        reason: null,
        location: null,
        http: null,
      });
      expect(await readdir(cwd)).toEqual([]);
    },
  );
  it("copies only normalized browser fields while preserving separate fixture diagnostics", async () => {
    const cwd = await project();
    const privateMarker = "private-native-browser-marker";
    const request = Object.assign(
      { sink: "fetch", target: "other-local", query: "other", method: "GET" } as const,
      { url: `https://${privateMarker}.invalid/path?token=${privateMarker}` },
    );
    const failure = new SiteBuildLinuxSandboxFailureV1(
      {
        schemaVersion: "np.site-build-linux-audit.v1",
        status: "failed",
        reason: "driver-exit",
        rootExitCode: 1,
        rootSignal: 0,
        tracedProcesses: 167,
        reapedProcesses: 167,
        descendantsReaped: true,
        argumentsFrozen: true,
        ownIpcReclaimed: true,
        forbiddenAttempts: 0,
        stderr: privateMarker,
      },
      "browser",
      "documents",
      "missing-column",
      { owner: "worker", line: 10 },
      "network-idle",
      Object.assign(
        { reason: "request" as const, loaded: false, inflight: 256, ready: 32, request },
        { rawError: privateMarker, headers: { authorization: privateMarker } },
      ),
    );
    failure.message = privateMarker;
    failure.stack = privateMarker;
    vi.spyOn(generatorCommand, "runSiteBuildGenerateV1").mockRejectedValue(failure);
    const result = await runSiteCommandV1(
      [
        "generate",
        "--brief",
        "brief.json",
        "--directions",
        "directions.json",
        "--blueprint",
        "blueprint.json",
        "--runtime",
        "runtime.json",
        "--out",
        ".nexpress/site/review/final/result.json",
      ],
      cwd,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).failurePhase).toEqual({
      driver: "browser",
      browser: "network-idle",
      browserDiagnostic: {
        reason: "request",
        loaded: false,
        inflight: 256,
        ready: 32,
        request: { sink: "fetch", target: "other-local", query: "other", method: "GET" },
      },
      fixture: "documents",
      reason: "missing-column",
      location: { owner: "worker", line: 10 },
      http: null,
    });
    expect(result.stderr).not.toContain(privateMarker);
    expect(result.stderr).not.toContain(cwd);
    expect(await readdir(cwd)).toEqual([]);
  });
  it("transports source-precondition conflicts with plan-review guidance and fixed safe fields", async () => {
    const cwd = await project();
    const digest = `nb1:file-sha256:${"A".repeat(43)}`;
    const conflicts = [
      {
        path: "src/home.ts",
        expectedHash: digest,
        currentHash: null,
        plannedHash: digest,
        status: "missing" as const,
      },
    ];
    vi.spyOn(generatorCommand, "runSiteBuildGenerateV1").mockRejectedValue(
      new generatorCommand.NpSiteBuildGenerateSourcePreconditionConflictV1(conflicts),
    );
    const result = await runSiteCommandV1(
      [
        "generate",
        "--brief",
        "brief.json",
        "--directions",
        "directions.json",
        "--blueprint",
        "blueprint.json",
        "--runtime",
        "runtime.json",
        "--out",
        ".nexpress/site/review/final/result.json",
      ],
      cwd,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      schemaVersion: "np.site-build-cli-error.v1",
      reason: "conflict",
      message:
        "Source files no longer match this plan's preconditions. Review the reported files and create a new reviewed plan.",
      scope: "source-file-plan-preconditions",
      conflicts,
      sourceWrites: 0,
      requiresNewReviewedPlan: true,
    });
    expect(result.stderr).not.toContain(cwd);
    expect(await readdir(cwd)).toEqual([]);
  });
  it("advertises generation and rejects incomplete, repeated or value-bearing execute flags before project loading", async () => {
    const cwd = await project();
    expect((await runSiteCommandV1(["generate", "--help"], cwd)).stdout).toContain(
      "--acknowledge-plan <exact-blueprint-hash>",
    );
    const base = [
      "generate",
      "--brief",
      "brief.json",
      "--directions",
      "directions.json",
      "--blueprint",
      "blueprint.json",
      "--runtime",
      "runtime.json",
      "--out",
      ".nexpress/site/review/final/generation.json",
    ];
    for (const suffix of [
      ["--execute"],
      ["--acknowledge-plan", "hash"],
      ["--execute=true", "--acknowledge-plan", "hash"],
      ["--execute", "--execute", "--acknowledge-plan", "hash"],
    ]) {
      const result = await runSiteCommandV1([...base, ...suffix], cwd);
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stderr.split("\n")[0])).toMatchObject({ reason: "arguments" });
    }
    expect(await readdir(cwd)).toEqual([]);
  });
  it("rejects malformed render inputs before provisioning or loading project code", async () => {
    const cwd = await project();
    const config = "throw new Error('render-private-marker');\n";
    await writeFile(join(cwd, "nexpress.config.ts"), config);
    await writeFile(
      join(cwd, "fixtures.json"),
      JSON.stringify({
        schemaVersion: "np.site-build-fixture-files.v1",
        files: ["../outside.json"],
      }),
    );
    await writeFile(
      join(cwd, "brief.json"),
      JSON.stringify({ ...createSiteBriefTemplateV1(), unresolved: [] }),
    );
    await writeFile(
      join(cwd, "set.json"),
      JSON.stringify({ schemaVersion: "np.agent-design-direction-draft-set.v1" }),
    );
    await writeFile(join(cwd, "runtime.json"), JSON.stringify({ project: "/", approved: true }));
    for (const operation of [
      ["renderer", "prepare"],
      ["direction", "render"],
      ["direction", "validate"],
      ["plan", "validate"],
      ["seed", "source"],
      ["codegen", "source"],
      ["fixture", "inspect"],
      ["handoff", "export"],
    ]) {
      expect((await runSiteCommandV1([...operation, "--help"], cwd)).code).toBe(0);
    }
    const calls = [
      [
        "codegen",
        "source",
        "--brief",
        "brief.json",
        "--directions",
        "set.json",
        "--blueprint",
        "set.json",
        "--runtime",
        "runtime.json",
        "--out",
        ".nexpress/site/codegen-source.json",
      ],
      [
        "handoff",
        "export",
        "--brief",
        "brief.json",
        "--directions",
        "set.json",
        "--blueprint",
        "set.json",
        "--out",
        ".nexpress/site/review/final/handoff.json",
      ],
      [
        "fixture",
        "inspect",
        "--brief",
        "brief.json",
        "--draft",
        "set.json",
        "--direction",
        "one",
        "--runtime",
        "runtime.json",
        "--out",
        ".nexpress/site/projected-fixture.json",
      ],
      [
        "renderer",
        "prepare",
        "--config",
        "nexpress.config.ts",
        "--fixtures",
        "fixtures.json",
        "--out",
        ".nexpress/site/runtime.json",
        "--catalog-out",
        ".nexpress/site/catalog.json",
      ],
      [
        "direction",
        "render",
        "--brief",
        "brief.json",
        "--draft",
        "set.json",
        "--runtime",
        "runtime.json",
        "--out",
        ".nexpress/site/directions.json",
      ],
      [
        "direction",
        "validate",
        "--brief",
        "brief.json",
        "--file",
        "set.json",
        "--runtime",
        "runtime.json",
        "--out",
        ".nexpress/site/directions.json",
      ],
      [
        "plan",
        "validate",
        "--brief",
        "brief.json",
        "--directions",
        "set.json",
        "--blueprint",
        "set.json",
        "--runtime",
        "runtime.json",
        "--out",
        ".nexpress/site/blueprint.validated.json",
      ],
    ];
    for (const args of calls) {
      const result = await runSiteCommandV1(args, cwd);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("render-private-marker");
    }
    expect(await readFile(join(cwd, "nexpress.config.ts"), "utf8")).toBe(config);
    expect(await readdir(cwd)).toEqual([
      "brief.json",
      "fixtures.json",
      "nexpress.config.ts",
      "runtime.json",
      "set.json",
    ]);
  });
  it("advertises installed direction validation while malformed proposals cannot load project code", async () => {
    const cwd = await project();
    const config = "throw new Error('synthetic-private-marker');\n";
    await writeFile(join(cwd, "nexpress.config.ts"), config);
    expect((await runSiteCommandV1(["directions", "validate", "--help"], cwd)).stdout).toContain(
      "site directions validate",
    );
    await writeFile(
      join(cwd, "brief.json"),
      JSON.stringify({ ...createSiteBriefTemplateV1(), unresolved: [] }),
    );
    await writeFile(join(cwd, "drafts.json"), '{"schemaVersion":"private-marker"}');
    const args = [
      "directions",
      "validate",
      "--brief",
      "brief.json",
      "--drafts",
      "drafts.json",
      "--config",
      "nexpress.config.ts",
      "--out",
      ".nexpress/site/drafts.validated.json",
    ];
    const result = await runSiteCommandV1(args, cwd);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("private-marker");
    expect(await readdir(cwd)).toEqual(["brief.json", "drafts.json", "nexpress.config.ts"]);
    expect(await readFile(join(cwd, "nexpress.config.ts"), "utf8")).toBe(config);
  });
  it("advertises isolated catalog inspection and rejects malformed flags/paths without loading project code", async () => {
    const cwd = await project();
    const config = "throw new Error('synthetic-private-marker');\n";
    await writeFile(join(cwd, "nexpress.config.ts"), config);
    expect((await runSiteCommandV1(["catalog", "inspect", "--help"], cwd)).stdout).toContain(
      "site catalog inspect",
    );
    for (const args of [
      ["catalog", "inspect", "--config", "../outside.ts", "--out", ".nexpress/site/catalog.json"],
      [
        "catalog",
        "inspect",
        "--config",
        "nexpress.config.ts",
        "--out",
        ".nexpress/site/catalog.json",
        "--config",
        "nexpress.config.ts",
      ],
    ]) {
      const result = await runSiteCommandV1(args, cwd);
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("synthetic-private-marker");
    }
    expect(await readFile(join(cwd, "nexpress.config.ts"), "utf8")).toBe(config);
    expect(await readdir(cwd)).toEqual(["nexpress.config.ts"]);
  });
  it("creates a schema-complete, deliberately unresolved template and reruns without overwriting", async () => {
    const cwd = await project();
    const args = ["brief", "init", "--out", out];
    const first = await runSiteCommandV1(args, cwd);
    expect(first.code).toBe(0);
    const summary = JSON.parse(first.stdout);
    expect(summary).toMatchObject({ status: "written", executable: false, unresolvedCount: 3 });
    const raw = await readFile(join(cwd, out), "utf8");
    const brief = npParseAgentSiteBriefV1(raw);
    expect(brief).toEqual(createSiteBriefTemplateV1());
    expect(summary.digest).toBe(await npBuildCanonicalDigest("np.build-site-brief.v1", brief));
    expect(JSON.parse((await runSiteCommandV1(args, cwd)).stdout).status).toBe("unchanged");
  });

  it("canonicalizes JSON bytes independently of source formatting and preserves dirty files", async () => {
    const cwd = await project();
    const brief: NpAgentSiteBriefV1 = { ...createSiteBriefTemplateV1(), unresolved: [] };
    brief.project.name = "한글 커뮤니티";
    await writeFile(join(cwd, "brief.json"), JSON.stringify(brief, null, 4));
    await writeFile(join(cwd, "unrelated.ts"), "local dirty work\n");
    const result = await runSiteCommandV1(validate, cwd);
    expect(result.code).toBe(0);
    expect(await readFile(join(cwd, out))).toEqual(
      Buffer.from(npBuildCanonicalBytes("np.build-site-brief.v1", brief).canonicalJsonUtf8),
    );
    expect(await readFile(join(cwd, "unrelated.ts"), "utf8")).toBe("local dirty work\n");
    expect(JSON.parse(result.stdout).unresolvedCount).toBe(0);
  });

  it("refuses conflicting output rather than replacing the user's artifact", async () => {
    const cwd = await project();
    await runSiteCommandV1(["brief", "init", "--out", out], cwd);
    const before = await readFile(join(cwd, out));
    await writeFile(
      join(cwd, "brief.json"),
      JSON.stringify({ ...createSiteBriefTemplateV1(), unresolved: [] }),
    );
    const result = await runSiteCommandV1(validate, cwd);
    expect(result.code).toBe(1);
    expect(await readFile(join(cwd, out))).toEqual(before);
  });

  it("checks an exact proposal/brief pair without asserting catalog, render or execution evidence", async () => {
    const cwd = await project();
    const vectors = JSON.parse(
      await readFile(
        new URL("../../../core/src/build-contract/__fixtures__/canonical-v1.json", import.meta.url),
        "utf8",
      ),
    ) as { structured: Array<{ purpose: string; canonical: string }> };
    const blueprint = JSON.parse(
      vectors.structured.find((item) => item.purpose === "np.build-site-blueprint.v1")!.canonical,
    ) as NpAgentSiteBlueprintV1;
    const brief: NpAgentSiteBriefV1 = { ...createSiteBriefTemplateV1(), unresolved: [] };
    blueprint.briefHash = await npBuildCanonicalDigest("np.build-site-brief.v1", brief);
    await writeFile(join(cwd, "brief.json"), JSON.stringify(brief));
    await writeFile(join(cwd, "blueprint.json"), JSON.stringify(blueprint));
    const args = [
      "proposal",
      "validate",
      "--brief",
      "brief.json",
      "--blueprint",
      "blueprint.json",
      "--out",
      ".nexpress/site/proposal.json",
    ];
    expect(JSON.parse((await runSiteCommandV1(args, cwd)).stdout)).toMatchObject({
      validationScope: "proposal-only",
      executable: false,
    });
    brief.unresolved = ["Which author model?"];
    await writeFile(join(cwd, "brief.json"), JSON.stringify(brief));
    expect((await runSiteCommandV1(args, cwd)).code).toBe(1);
    brief.unresolved = [];
    brief.project.name = "Changed intent";
    await writeFile(join(cwd, "brief.json"), JSON.stringify(brief));
    expect((await runSiteCommandV1(args, cwd)).code).toBe(1);
  });

  it("rejects duplicate keys, malformed UTF-8 and oversized files without emitting input prose", async () => {
    const cwd = await project();
    for (const bytes of [
      Buffer.from('{"password":"private-value","password":"private-value"}'),
      Buffer.from([0xff, 0xfe, 0x7b, 0x7d]),
      Buffer.alloc(npBuildContractLimitsV1.brief.bytes + 1, "x"),
    ]) {
      await writeFile(join(cwd, "brief.json"), bytes);
      const result = await runSiteCommandV1(validate, cwd);
      expect(result.code).toBe(1);
      expect(result.stderr).not.toContain("private-value");
      expect(result.stdout).toBe("");
    }
    expect(await readdir(cwd)).toEqual(["brief.json"]);
  });

  it("rejects input symlinks, hard links, directories and output parent symlinks", async () => {
    const cwd = await project();
    const other = await project();
    await writeFile(join(other, "valid.json"), JSON.stringify(createSiteBriefTemplateV1()));
    await symlink(join(other, "valid.json"), join(cwd, "brief.json"));
    expect((await runSiteCommandV1(validate, cwd)).code).toBe(1);
    await rm(join(cwd, "brief.json"));
    await link(join(other, "valid.json"), join(cwd, "brief.json"));
    expect((await runSiteCommandV1(validate, cwd)).code).toBe(1);
    await rm(join(cwd, "brief.json"));
    await mkdir(join(cwd, "brief.json"));
    expect((await runSiteCommandV1(validate, cwd)).code).toBe(1);
    await symlink(other, join(cwd, ".nexpress"));
    expect((await runSiteCommandV1(["brief", "init", "--out", out], cwd)).code).toBe(1);
    expect(await readdir(other)).toEqual(["valid.json"]);
  });

  it("confines outputs to local artifact paths and never reprints hostile arguments", async () => {
    const cwd = await project();
    for (const path of [
      "../outside.json",
      "/tmp/outside.json",
      "package.json",
      ".nexpress/site/../evil.json",
      ".nexpress/site/review/receipt.json",
      ".nexpress/site/CON.json",
    ]) {
      expect((await runSiteCommandV1(["brief", "init", "--out", path], cwd)).code).toBe(1);
    }
    const result = await runSiteCommandV1(["brief", "init", "--token=private-value"], cwd);
    expect(result.code).toBe(2);
    expect(result.stderr).not.toContain("private-value");
    expect((await runSiteCommandV1(["brief", "init", "--out", out, "--out", out], cwd)).code).toBe(
      2,
    );
    expect((await runSiteCommandV1(["generate", "build a secret site"], cwd)).code).toBe(2);
  });

  it("plans skill installation without writes and applies the same packaged skill for either client", async () => {
    const cwd = await project();
    for (const client of ["codex", "claude"]) {
      const args = ["skill", "install", "--client", client];
      const plan = JSON.parse((await runSiteCommandV1(args, cwd)).stdout);
      expect(plan.status).toBe("planned");
      if (client === "codex") expect(await readdir(cwd)).toEqual([]);
      expect(JSON.parse((await runSiteCommandV1([...args, "--apply"], cwd)).stdout).status).toBe(
        "written",
      );
      expect(await readFile(join(cwd, plan.path), "utf8")).toBe(NP_SITE_BUILD_SKILL_V1);
      expect(JSON.parse((await runSiteCommandV1([...args, "--apply"], cwd)).stdout).status).toBe(
        "unchanged",
      );
      await writeFile(join(cwd, plan.path), "user's custom skill");
      expect((await runSiteCommandV1([...args, "--apply"], cwd)).code).toBe(1);
      expect(await readFile(join(cwd, plan.path), "utf8")).toBe("user's custom skill");
    }
  });

  it("dispatches the site namespace without invoking a project script or package manager", async () => {
    const cwd = await project();
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const runProjectScript = vi.fn();
    const runPackageManager = vi.fn();
    expect(
      await runNexpressCli(["node", "nexpress", "site", "brief", "init", "--out", out], {
        cwd,
        runProjectScript,
        runPackageManager,
      }),
    ).toBe(0);
    expect(runProjectScript).not.toHaveBeenCalled();
    expect(runPackageManager).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalled();
  });
});
