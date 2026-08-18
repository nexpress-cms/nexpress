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
  assert.match(bridge, /retryGitHubStatusWrite/);
  assert.match(bridge, /for \(const context of MIRRORED_CONTEXTS\)/);
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
  assert.match(
    workflow,
    /NP_NPM_BOOTSTRAP_PACKAGES:\s*\${{\s*vars\.NPM_BOOTSTRAP_PACKAGES\s*}}/,
    "the exact first-publish package allowlist must be an explicitly temporary Actions variable",
  );
  assert.doesNotMatch(
    workflow,
    /NPM_BOOTSTRAP_PACKAGE(?!S)/,
    "the obsolete single-package bootstrap setting must not remain",
  );
  assert.doesNotMatch(
    workflow,
    /secrets\.NPM_TOKEN/,
    "normal releases must not regain a standing npm token",
  );
  assert.ok(
    releaseScript.indexOf("delete process.env.NODE_AUTH_TOKEN") <
      releaseScript.indexOf("const packages = readPublishableWorkspacePackages"),
    "the temporary token must be removed before workspace commands execute",
  );
  assert.ok(
    releaseScript.indexOf('run("pnpm", ["typecheck"]') <
      releaseScript.lastIndexOf("await bootstrapNpmPackages"),
    "the package must build and pass its gates before its first publish",
  );
  assert.ok(
    releaseScript.lastIndexOf("await bootstrapNpmPackages") <
      releaseScript.indexOf('run("pnpm", ["exec", "changeset", "publish"'),
    "the new package names must be claimed before OIDC publishes the existing packages",
  );
  assert.ok(
    releaseScript.indexOf("await verifyVisibility(packages)") <
      releaseScript.indexOf('run("pnpm", ["exec", "changeset", "publish"'),
    "new package root metadata must converge before Changesets reads it",
  );
  assert.equal(rootManifest.scripts?.release, "tsx scripts/release.mts");
});

test("the Release workflow uses the complete Changesets v2 contract", async () => {
  const workflow = await readFile(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
  const releaseScript = await readFile(resolve(repoRoot, "scripts/release.mts"), "utf8");
  const rootManifest = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
  };
  const config = JSON.parse(
    await readFile(resolve(repoRoot, ".changeset/config.json"), "utf8"),
  ) as { $schema?: string };
  const stepStart = workflow.indexOf("- name: Create Release Pull Request or Publish");
  const stepEnd = workflow.indexOf("      # `changesets/action` uses", stepStart);
  assert.notEqual(stepStart, -1);
  assert.notEqual(stepEnd, -1);
  const changesetsStep = workflow.slice(stepStart, stepEnd);

  assert.match(changesetsStep, /uses: changesets\/action@v2/);
  assert.match(changesetsStep, /github-token:\s*\${{\s*secrets\.GITHUB_TOKEN\s*}}/);
  assert.match(changesetsStep, /version-script:\s*pnpm run version/);
  assert.match(changesetsStep, /publish-script:\s*pnpm run release/);
  assert.match(changesetsStep, /commit-message:\s*"chore\(release\): version packages"/);
  assert.match(changesetsStep, /pr-title:\s*"chore\(release\): version packages"/);
  assert.match(changesetsStep, /pr-draft:\s*always/);
  assert.match(changesetsStep, /pr-base-branch:\s*main/);
  assert.match(changesetsStep, /create-github-releases:\s*false/);
  assert.match(changesetsStep, /push-git-tags:\s*false/);
  assert.match(changesetsStep, /push-with-git-cli:\s*false/);
  assert.doesNotMatch(
    changesetsStep,
    /^\s+(?:version|publish|commit|title|branch|prDraft|createGithubReleases):/m,
    "v1 input names make changesets/action v2 fail before release work starts",
  );
  assert.doesNotMatch(
    changesetsStep,
    /^\s+GITHUB_TOKEN:/m,
    "v2 action authentication belongs in github-token, not the step environment",
  );
  assert.match(workflow, /VERSION_PR_NUMBER:\s*\${{\s*steps\.changesets\.outputs\.pr-number\s*}}/);
  assert.equal(rootManifest.devDependencies?.["@changesets/cli"], "^3.0.0");
  assert.equal(config.$schema, "https://unpkg.com/@changesets/config@4.0.0/schema.json");
  assert.match(releaseScript, /env: process\.env/);
  assert.match(releaseScript, /"changeset", "publish", "--no-git-tag"/);
  assert.ok(
    releaseScript.indexOf('"changeset", "publish", "--no-git-tag"') <
      releaseScript.indexOf('"scripts/tag-release.mts"'),
    "the single repository tag must remain downstream of verified package publication",
  );
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

test("a verified family release dispatches the hosted demo with short-lived app authority", async () => {
  const workflow = await readFile(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");

  assert.match(workflow, /node scripts\/dispatch-hosted-demo-update\.mjs plan/);
  assert.match(workflow, /steps\.hosted-demo\.outputs\.should_dispatch == 'true'/);
  assert.match(workflow, /uses: actions\/create-github-app-token@v3/);
  assert.match(workflow, /client-id:\s*\${{\s*vars\.HOSTED_DEMO_UPDATE_APP_CLIENT_ID\s*}}/);
  assert.match(workflow, /private-key:\s*\${{\s*secrets\.HOSTED_DEMO_UPDATE_APP_PRIVATE_KEY\s*}}/);
  assert.match(workflow, /repositories: nexpress-hosted-demo/);
  assert.match(workflow, /node scripts\/dispatch-hosted-demo-update\.mjs dispatch/);
  assert.ok(
    workflow.indexOf("Fail when Version PR merge left an orphan changeset") <
      workflow.indexOf("Plan hosted demo update"),
    "the demo handoff must happen only after release race detection",
  );
});
