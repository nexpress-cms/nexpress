import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

test("scaffold CI runs the packed create-nexpress CLI without adding another job", async () => {
  const workflow = await readFile(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /\.name == "create-nexpress"/);
  assert.match(workflow, /pnpm dlx --package "\$cli_tarball" create-nexpress/);
  assert.equal(workflow.match(/^  scaffold-smoke:$/gm)?.length, 1);
});

test("the Version PR bridge keeps releases draft and gates on scaffold smoke", async () => {
  const bridge = await readFile(resolve(repoRoot, "scripts/bridge-version-pr-ci.mjs"), "utf8");
  assert.match(bridge, /scaffold smoke \(fresh scaffold journey\)/);
  assert.match(bridge, /convertPullRequestToDraft/);
  assert.match(bridge, /completedRun\.conclusion !== "success"/);
  assert.ok(
    bridge.indexOf("currentHeadSha = branchHeadSha || prHeadSha") <
      bridge.indexOf("await ensureVersionPrDraft(versionPr)"),
    "the bridge must know which statuses to fail before draft conversion can fail",
  );
});

test("the Release workflow delegates conditional verification to the release script", async () => {
  const workflow = await readFile(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
  const releaseScript = await readFile(resolve(repoRoot, "scripts/release.mts"), "utf8");
  const rootManifest = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.doesNotMatch(workflow, /^\s+- name: Build$/m);
  assert.doesNotMatch(workflow, /^\s+- name: Typecheck$/m);
  assert.match(
    workflow,
    /NODE_AUTH_TOKEN:\s*\${{\s*secrets\.NPM_BOOTSTRAP_TOKEN\s*}}/,
    "new package names need an explicitly temporary CI bootstrap credential",
  );
  assert.doesNotMatch(
    workflow,
    /secrets\.NPM_TOKEN/,
    "normal releases must not regain a standing npm token",
  );
  assert.match(workflow, /NP_NPM_BOOTSTRAP_PACKAGE:\s*"@nexpress\/theme-community"/);
  assert.match(workflow, /NP_RELEASE_REPAIR_FROM:\s*"0\.5\.0"/);
  assert.match(workflow, /NP_RELEASE_REPAIR_TO:\s*"0\.4\.2"/);
  assert.ok(
    releaseScript.indexOf("delete process.env.NODE_AUTH_TOKEN") <
      releaseScript.indexOf('run("pnpm", ["test:repo"]'),
    "the temporary token must be removed before repository code executes",
  );
  assert.ok(
    releaseScript.indexOf('run("pnpm", ["typecheck"]') <
      releaseScript.indexOf("[release] bootstrapping new npm package"),
    "the package must build and pass its gates before its first publish",
  );
  assert.ok(
    releaseScript.indexOf("[release] bootstrapping new npm package") <
      releaseScript.indexOf('run("pnpm", ["exec", "changeset", "publish"'),
    "the new package name must be claimed before OIDC publishes the existing packages",
  );
  assert.equal(rootManifest.scripts?.release, "tsx scripts/release.mts");
});

test("Version PR generation synchronizes and rechecks public release docs", async () => {
  const rootManifest = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(
    rootManifest.scripts?.version,
    "pnpm test:repo && changeset version && tsx scripts/sync-release-docs.mts && pnpm test:repo",
  );
});
