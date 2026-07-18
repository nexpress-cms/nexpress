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
  const rootManifest = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.doesNotMatch(workflow, /^\s+- name: Build$/m);
  assert.doesNotMatch(workflow, /^\s+- name: Typecheck$/m);
  assert.equal(rootManifest.scripts?.release, "tsx scripts/release.mts");
});
