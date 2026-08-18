import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeDependabotPullRequest,
  dependabotMergeApprovalToken,
  dependabotMergeRequiredChecks,
  parseDependabotMergeArgs,
  selectPostMergeRuns,
  verifyDependabotMergeCommit,
} from "./merge-dependabot.mjs";

const headSha = "a".repeat(40);
const repository = {
  defaultBranchRef: { name: "main" },
  nameWithOwner: "nexpress-cms/nexpress",
};
const pullRequest = {
  author: { login: "app/dependabot" },
  baseRefName: "main",
  headRefName: "dependabot/github_actions/example-2",
  headRefOid: headSha,
  isDraft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  number: 1400,
  state: "OPEN",
  statusCheckRollup: dependabotMergeRequiredChecks.map((name) => ({
    conclusion: "SUCCESS",
    name,
    status: "COMPLETED",
  })),
};

test("parses an explicit dry-run or approval-gated execute request", () => {
  assert.deepEqual(parseDependabotMergeArgs(["--", "1400", "--json"]), {
    approve: null,
    execute: false,
    json: true,
    prNumber: 1400,
    repo: null,
  });
  assert.deepEqual(
    parseDependabotMergeArgs([
      "1400",
      "--repo",
      "nexpress-cms/nexpress",
      "--execute",
      "--approve",
      `dependabot-merge:1400:${headSha}`,
    ]),
    {
      approve: `dependabot-merge:1400:${headSha}`,
      execute: true,
      json: false,
      prNumber: 1400,
      repo: "nexpress-cms/nexpress",
    },
  );
  assert.throws(() => parseDependabotMergeArgs([]), /number is required/);
  assert.throws(() => parseDependabotMergeArgs(["nope"]), /Invalid pull request number/);
  assert.throws(() => parseDependabotMergeArgs(["1400", "--approve", "token"]), /--execute/);
});

test("accepts only a current green Dependabot PR targeting main", () => {
  const plan = analyzeDependabotPullRequest(pullRequest, repository);
  assert.equal(plan.ok, true);
  assert.equal(plan.strategy, "merge");
  assert.equal(plan.approvalToken, dependabotMergeApprovalToken(pullRequest));

  const wrongAuthor = analyzeDependabotPullRequest(
    { ...pullRequest, author: { login: "maintainer" } },
    repository,
  );
  assert.equal(wrongAuthor.ok, false);
  assert.match(wrongAuthor.issues.join("\n"), /author must be Dependabot/);

  const behindMain = analyzeDependabotPullRequest(
    { ...pullRequest, mergeStateStatus: "BEHIND" },
    repository,
  );
  assert.equal(behindMain.ok, false);
  assert.match(behindMain.issues.join("\n"), /current with main/);

  const missingCheck = analyzeDependabotPullRequest(
    { ...pullRequest, statusCheckRollup: pullRequest.statusCheckRollup.slice(1) },
    repository,
  );
  assert.equal(missingCheck.ok, false);
  assert.match(missingCheck.issues.join("\n"), /Missing required check/);

  const failedCheck = analyzeDependabotPullRequest(
    {
      ...pullRequest,
      statusCheckRollup: pullRequest.statusCheckRollup.map((check, index) =>
        index === 0 ? { ...check, conclusion: "FAILURE" } : check,
      ),
    },
    repository,
  );
  assert.equal(failedCheck.ok, false);
  assert.match(failedCheck.issues.join("\n"), /concluded FAILURE/);
});

test("selects only exact push runs for the Dependabot merge SHA", () => {
  const runs = [
    {
      databaseId: 1,
      event: "workflow_dispatch",
      headSha,
      workflowName: "Release",
    },
    { databaseId: 2, event: "push", headSha: "b".repeat(40), workflowName: "CI" },
    { databaseId: 3, event: "push", headSha, workflowName: "CI" },
    { databaseId: 4, event: "push", headSha, workflowName: "Release" },
  ];
  assert.deepEqual(selectPostMergeRuns(runs, headSha), {
    CI: runs[2],
    Release: runs[3],
  });
});

test("requires a real two-parent merge commit", () => {
  assert.doesNotThrow(() => verifyDependabotMergeCommit({ parents: [{ sha: "a" }, { sha: "b" }] }));
  assert.throws(
    () => verifyDependabotMergeCommit({ parents: [{ sha: "a" }] }),
    /two-parent merge commit/,
  );
});
