#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const dependabotMergeRequiredChecks = [
  "typecheck + build + test",
  "integration tests (Postgres)",
  "E2E (Playwright)",
  "scaffold smoke (fresh scaffold journey)",
];

const dependabotLogins = new Set(["app/dependabot", "dependabot[bot]"]);
const expectedPostMergeWorkflows = ["CI", "Release"];
const defaultRunLookupTimeoutMs = 120_000;

export function parseDependabotMergeArgs(argv) {
  const options = { approve: null, execute: false, json: false, prNumber: null, repo: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--execute") {
      options.execute = true;
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--approve" || argument === "--repo") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      if (argument === "--approve") options.approve = value;
      else options.repo = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    if (options.prNumber !== null) throw new Error("Provide exactly one pull request number.");
    if (!/^[1-9]\d*$/.test(argument)) throw new Error(`Invalid pull request number: ${argument}`);
    options.prNumber = Number(argument);
  }
  if (options.prNumber === null) throw new Error("A pull request number is required.");
  if (!options.execute && options.approve) {
    throw new Error("--approve is valid only together with --execute.");
  }
  return options;
}

export function dependabotMergeApprovalToken(pr) {
  return `dependabot-merge:${pr.number}:${pr.headRefOid}`;
}

export function analyzeDependabotPullRequest(pr, repository) {
  const issues = [];
  if (!dependabotLogins.has(pr.author?.login)) {
    issues.push(`PR author must be Dependabot, received ${pr.author?.login || "unknown"}.`);
  }
  if (pr.baseRefName !== repository.defaultBranchRef?.name || pr.baseRefName !== "main") {
    issues.push(`PR base must be the repository default branch main, received ${pr.baseRefName}.`);
  }
  if (pr.state !== "OPEN") issues.push(`PR must be OPEN, received ${pr.state}.`);
  if (pr.isDraft) issues.push("PR must not be a draft.");
  if (pr.mergeable !== "MERGEABLE") {
    issues.push(`PR must be mergeable, received ${pr.mergeable || "unknown"}.`);
  }
  if (pr.mergeStateStatus !== "CLEAN") {
    issues.push(
      `PR must be current with main and have satisfied branch rules, received ${pr.mergeStateStatus || "unknown"}.`,
    );
  }

  const checks = new Map();
  for (const check of pr.statusCheckRollup ?? []) {
    if (typeof check?.name === "string") checks.set(check.name, check);
    const conclusion = check?.conclusion ?? check?.state;
    const status = check?.status;
    if (status && status !== "COMPLETED") {
      issues.push(`Check ${check.name || "unknown"} is ${status}, not COMPLETED.`);
    } else if (conclusion && !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) {
      issues.push(`Check ${check.name || "unknown"} concluded ${conclusion}.`);
    }
  }
  for (const name of dependabotMergeRequiredChecks) {
    const check = checks.get(name);
    if (!check) {
      issues.push(`Missing required check: ${name}.`);
      continue;
    }
    const conclusion = check.conclusion ?? check.state;
    if (check.status !== "COMPLETED" || conclusion !== "SUCCESS") {
      issues.push(`Required check ${name} must be COMPLETED/SUCCESS.`);
    }
  }

  return {
    approvalToken: dependabotMergeApprovalToken(pr),
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    headSha: pr.headRefOid,
    issues,
    ok: issues.length === 0,
    prNumber: pr.number,
    repository: repository.nameWithOwner,
    schemaVersion: "np.dependabot-merge.v1",
    strategy: "merge",
  };
}

export function selectPostMergeRuns(runs, mergeSha) {
  const selected = {};
  for (const workflowName of expectedPostMergeWorkflows) {
    selected[workflowName] =
      runs
        .filter(
          (run) =>
            run.workflowName === workflowName &&
            run.event === "push" &&
            (!run.headSha || run.headSha === mergeSha),
        )
        .sort((left, right) => Number(right.databaseId) - Number(left.databaseId))[0] ?? null;
  }
  return selected;
}

export function verifyDependabotMergeCommit(commit) {
  if (!Array.isArray(commit.parents) || commit.parents.length !== 2) {
    throw new Error(
      `Dependabot PR must create a two-parent merge commit; received ${commit.parents?.length ?? 0} parent(s).`,
    );
  }
}

function runGh(args, options = {}) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

function readGhJson(args) {
  return JSON.parse(runGh(args));
}

function readRepository(repoOverride) {
  const repository = readGhJson([
    "repo",
    "view",
    ...(repoOverride ? [repoOverride] : []),
    "--json",
    "nameWithOwner,defaultBranchRef",
  ]);
  const settings = readGhJson(["api", `repos/${repository.nameWithOwner}`]);
  const rulesets = readGhJson(["api", `repos/${repository.nameWithOwner}/rulesets`]);
  const mainRuleset = rulesets.find(
    (ruleset) => ruleset.name === "main branch protection" && ruleset.enforcement === "active",
  );
  const mainRulesetDetails = mainRuleset
    ? readGhJson(["api", `repos/${repository.nameWithOwner}/rulesets/${mainRuleset.id}`])
    : null;
  const allowedMergeMethods =
    mainRulesetDetails?.rules?.find((rule) => rule.type === "pull_request")?.parameters
      ?.allowed_merge_methods ?? [];
  return {
    ...repository,
    allowMergeCommit: settings.allow_merge_commit === true,
    rulesetAllowsMergeCommit: allowedMergeMethods.includes("merge"),
  };
}

function readPullRequest(prNumber, repository) {
  return readGhJson([
    "pr",
    "view",
    String(prNumber),
    "--repo",
    repository,
    "--json",
    [
      "author",
      "baseRefName",
      "headRefName",
      "headRefOid",
      "isDraft",
      "mergeable",
      "mergeStateStatus",
      "number",
      "state",
      "statusCheckRollup",
      "title",
      "url",
    ].join(","),
  ]);
}

async function waitForPostMergeRuns({
  mergeSha,
  repository,
  timeoutMs = defaultRunLookupTimeoutMs,
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const runs = readGhJson([
      "run",
      "list",
      "--repo",
      repository,
      "--commit",
      mergeSha,
      "--limit",
      "20",
      "--json",
      "databaseId,workflowName,event,headSha,status,conclusion,url",
    ]);
    const selected = selectPostMergeRuns(runs, mergeSha);
    if (expectedPostMergeWorkflows.every((name) => selected[name])) return selected;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000));
  }
  throw new Error(
    [
      `Timed out waiting for CI and Release push runs at ${mergeSha}.`,
      "Do not assume the release ran. Confirm main still points to this SHA, then use:",
      "  gh workflow run ci.yml --ref main",
      "  gh workflow run release.yml --ref main",
    ].join("\n"),
  );
}

function printPlan(plan, asJson) {
  if (asJson) {
    console.log(JSON.stringify(plan));
    return;
  }
  console.log(
    [
      `Dependabot PR #${plan.prNumber} @ ${plan.headSha}`,
      `Repository: ${plan.repository}`,
      `Strategy: ${plan.strategy} commit (never squash)`,
      `Status: ${plan.ok ? "ready" : "blocked"}`,
      ...(plan.issues.length > 0 ? plan.issues.map((issue) => `- ${issue}`) : []),
      `Approval token: ${plan.approvalToken}`,
    ].join("\n"),
  );
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseDependabotMergeArgs(argv);
  runGh(["auth", "status"], { stdio: "ignore" });
  const repository = readRepository(options.repo);
  const pr = readPullRequest(options.prNumber, repository.nameWithOwner);
  const plan = analyzeDependabotPullRequest(pr, repository);
  if (!repository.allowMergeCommit) {
    plan.ok = false;
    plan.issues.push(
      "Repository merge commits are disabled; enable allow_merge_commit before executing this plan.",
    );
  }
  if (!repository.rulesetAllowsMergeCommit) {
    plan.ok = false;
    plan.issues.push(
      "The active main branch protection ruleset does not allow the merge commit method.",
    );
  }
  printPlan(plan, options.json);
  if (!plan.ok) throw new Error("Dependabot merge preflight failed.");
  if (!options.execute) return;
  if (options.approve !== plan.approvalToken) {
    throw new Error(`Approval token mismatch; expected ${plan.approvalToken}.`);
  }

  runGh(
    [
      "pr",
      "merge",
      String(plan.prNumber),
      "--repo",
      plan.repository,
      "--merge",
      "--delete-branch",
      "--match-head-commit",
      plan.headSha,
    ],
    { stdio: "inherit" },
  );
  const merged = readGhJson([
    "pr",
    "view",
    String(plan.prNumber),
    "--repo",
    plan.repository,
    "--json",
    "state,mergeCommit,url",
  ]);
  const mergeSha = merged.mergeCommit?.oid;
  if (merged.state !== "MERGED" || !/^[0-9a-f]{40}$/.test(mergeSha ?? "")) {
    throw new Error("GitHub did not return an exact merged commit SHA.");
  }
  const commit = readGhJson(["api", `repos/${plan.repository}/commits/${mergeSha}`]);
  verifyDependabotMergeCommit(commit);
  console.log(`[dependabot-merge] merged as two-parent commit ${mergeSha}.`);

  const runs = await waitForPostMergeRuns({ mergeSha, repository: plan.repository });
  for (const workflowName of expectedPostMergeWorkflows) {
    const run = runs[workflowName];
    console.log(`[dependabot-merge] waiting for ${workflowName}: ${run.url}`);
    runGh(["run", "watch", String(run.databaseId), "--repo", plan.repository, "--exit-status"], {
      stdio: "inherit",
    });
  }
  console.log(`[dependabot-merge] CI and Release passed for ${mergeSha}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
