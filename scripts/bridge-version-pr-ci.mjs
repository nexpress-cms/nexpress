#!/usr/bin/env node

/**
 * Bridge CI results onto the Changesets Version PR head commit.
 *
 * Why this exists:
 * - `changesets/action` creates `changeset-release/main` with `GITHUB_TOKEN`.
 * - GitHub intentionally does not fire `pull_request` workflows for commits
 *   made by `GITHUB_TOKEN`.
 * - The repository ruleset still requires the PR contexts named below.
 *
 * The Release workflow calls this script after `changesets/action` opens or
 * updates the Version PR. We keep it in draft, dispatch `ci.yml` manually for
 * the Version PR branch, and require the whole workflow plus scaffold smoke to
 * pass before mirroring the three context names the ruleset already requires.
 */

const MIRRORED_CONTEXTS = [
  "typecheck + build + test",
  "integration tests (Postgres)",
  "E2E (Playwright)",
];
const REQUIRED_JOBS = [...MIRRORED_CONTEXTS, "scaffold smoke (fresh scaffold journey)"];

const repo = requireEnv("GITHUB_REPOSITORY");
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
const graphqlUrl = process.env.GITHUB_GRAPHQL_URL || "https://api.github.com/graphql";
const workflowFile = process.env.CI_WORKFLOW_FILE || "ci.yml";
const versionPrBranch = process.env.VERSION_PR_BRANCH || "changeset-release/main";
const versionPrBase = process.env.VERSION_PR_BASE || "main";
const versionPrNumber = normalized(process.env.VERSION_PR_NUMBER);
const lookupTimeoutSeconds = Number(process.env.BRIDGE_RUN_LOOKUP_SECONDS || "120");
const ciTimeoutSeconds = Number(process.env.BRIDGE_CI_TIMEOUT_SECONDS || "900");

if (!token) {
  throw new Error("GITHUB_TOKEN or GH_TOKEN is required.");
}

let currentHeadSha = "";

try {
  const versionPr = await findVersionPr();
  if (!versionPr) {
    console.log(
      `[version-pr-ci] no open Version PR found for ${versionPrBranch}; nothing to bridge.`,
    );
    process.exit(0);
  }

  const prHeadSha = versionPr.head.sha;
  const branchHeadSha = await resolveBranchHeadSha(versionPr.head.ref);
  currentHeadSha = branchHeadSha || prHeadSha;

  await ensureVersionPrDraft(versionPr);

  if (branchHeadSha && branchHeadSha !== prHeadSha) {
    console.log(
      `[version-pr-ci] PR head API reported ${prHeadSha.slice(0, 8)}, ` +
        `but ${versionPr.head.ref} currently points at ${branchHeadSha.slice(0, 8)}; ` +
        "using branch ref HEAD.",
    );
  }

  console.log(
    `[version-pr-ci] bridging CI for PR #${versionPr.number} ` +
      `(${versionPr.head.ref} @ ${currentHeadSha.slice(0, 8)})`,
  );

  await setAllStatuses("pending", "CI bridge: dispatching workflow", actionsUrl());
  await dispatchCi(versionPr.head.ref);
  const run = await waitForWorkflowRun(versionPr.head.ref, currentHeadSha);
  await setAllStatuses("pending", "CI bridge: workflow running", run.html_url);

  const completedRun = await waitForCompletion(run.id);
  const jobs = await listRunJobs(completedRun.id);
  const failedJobs = [];

  for (const jobName of REQUIRED_JOBS) {
    const job = jobs.find((candidate) => candidate.name === jobName);
    const state = statusStateForJob(job);
    const conclusion = job?.conclusion || job?.status || "missing";

    if (state !== "success") {
      failedJobs.push(`${jobName}: ${conclusion}`);
    }
  }

  if (completedRun.conclusion !== "success") {
    failedJobs.push(`workflow: ${completedRun.conclusion || completedRun.status}`);
  }

  if (failedJobs.length > 0) {
    await setAllStatuses("failure", `CI bridge failed: ${failedJobs[0]}`, completedRun.html_url);
    console.error("[version-pr-ci] required Version PR jobs failed:");
    for (const failure of failedJobs) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  for (const context of MIRRORED_CONTEXTS) {
    const job = jobs.find((candidate) => candidate.name === context);
    await setStatus(
      currentHeadSha,
      context,
      "success",
      "CI bridge: success",
      job?.html_url || completedRun.html_url,
    );
  }

  console.log("[version-pr-ci] required Version PR jobs are green.");
} catch (error) {
  console.error(`[version-pr-ci] ${error instanceof Error ? error.message : String(error)}`);

  if (currentHeadSha) {
    try {
      await setAllStatuses("failure", "CI bridge failed", actionsUrl());
    } catch (statusError) {
      console.error(
        `[version-pr-ci] failed to mark contexts as failure: ${
          statusError instanceof Error ? statusError.message : String(statusError)
        }`,
      );
    }
  }

  process.exit(1);
}

async function findVersionPr() {
  if (versionPrNumber) {
    const pr = await request(`/pulls/${versionPrNumber}`);
    if (pr.state === "open") {
      return pr;
    }
  }

  const [owner] = repo.split("/");
  const params = new URLSearchParams({
    state: "open",
    base: versionPrBase,
    head: `${owner}:${versionPrBranch}`,
    per_page: "10",
  });
  const prs = await request(`/pulls?${params.toString()}`);
  return prs[0] || null;
}

async function ensureVersionPrDraft(versionPr) {
  if (versionPr.draft) {
    console.log(`[version-pr-ci] PR #${versionPr.number} is already a draft accumulator.`);
    return;
  }
  if (!versionPr.node_id) {
    throw new Error(`PR #${versionPr.number} did not include a GraphQL node id.`);
  }

  const result = await graphqlRequest(
    `mutation ConvertVersionPrToDraft($pullRequestId: ID!) {
      convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
        pullRequest { number isDraft }
      }
    }`,
    { pullRequestId: versionPr.node_id },
  );
  const converted = result.data?.convertPullRequestToDraft?.pullRequest;
  if (!converted?.isDraft) {
    throw new Error(`GitHub did not convert Version PR #${versionPr.number} to draft.`);
  }

  console.log(`[version-pr-ci] converted PR #${versionPr.number} to a draft accumulator.`);
}

async function dispatchCi(ref) {
  console.log(`[version-pr-ci] dispatching ${workflowFile} on ${ref}`);
  await request(`/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref }),
  });
}

async function resolveBranchHeadSha(ref) {
  try {
    const gitRef = await request(`/git/ref/heads/${encodeGitRef(ref)}`);
    return normalized(gitRef?.object?.sha);
  } catch (error) {
    console.warn(
      `[version-pr-ci] failed to resolve branch ref ${ref}: ${
        error instanceof Error ? error.message : String(error)
      }; falling back to PR head SHA.`,
    );
    return "";
  }
}

async function waitForWorkflowRun(branch, headSha) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < lookupTimeoutSeconds * 1000) {
    const params = new URLSearchParams({
      branch,
      event: "workflow_dispatch",
      per_page: "20",
    });
    const runs = await request(
      `/actions/workflows/${encodeURIComponent(workflowFile)}/runs?${params.toString()}`,
    );
    const run = runs.workflow_runs
      .filter(
        (candidate) =>
          candidate.head_sha === headSha && Date.parse(candidate.created_at) >= startedAt - 30000,
      )
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];

    if (run) {
      console.log(`[version-pr-ci] CI run found: ${run.html_url}`);
      return run;
    }

    await sleep(5000);
  }

  throw new Error(
    `timed out waiting for ${workflowFile} workflow_dispatch run on ${branch} @ ${headSha}`,
  );
}

async function waitForCompletion(runId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < ciTimeoutSeconds * 1000) {
    const run = await request(`/actions/runs/${runId}`);
    if (run.status === "completed") {
      console.log(`[version-pr-ci] CI run completed with ${run.conclusion}`);
      return run;
    }

    await sleep(10000);
  }

  throw new Error(`timed out waiting for CI run ${runId} to complete`);
}

async function listRunJobs(runId) {
  const jobs = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({ per_page: "100", page: String(page) });
    const result = await request(`/actions/runs/${runId}/jobs?${params.toString()}`);
    jobs.push(...result.jobs);

    if (result.jobs.length < 100) {
      return jobs;
    }

    page += 1;
  }
}

function statusStateForJob(job) {
  if (!job) {
    return "failure";
  }

  return job.conclusion === "success" ? "success" : "failure";
}

async function setAllStatuses(state, description, targetUrl) {
  await Promise.all(
    MIRRORED_CONTEXTS.map((context) =>
      setStatus(currentHeadSha, context, state, description, targetUrl),
    ),
  );
}

async function setStatus(sha, context, state, description, targetUrl) {
  await request(`/statuses/${sha}`, {
    method: "POST",
    body: JSON.stringify({
      state,
      context,
      description: description.slice(0, 140),
      target_url: targetUrl,
    }),
  });
  console.log(`[version-pr-ci] ${context}: ${state}`);
}

async function request(path, init = {}) {
  const response = await fetch(`${apiUrl}/repos/${repo}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} failed (${response.status}): ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

async function graphqlRequest(query, variables) {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed (${response.status}): ${text}`);
  }

  const result = text ? JSON.parse(text) : {};
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    throw new Error(`GitHub GraphQL request failed: ${JSON.stringify(result.errors)}`);
  }
  return result;
}

function actionsUrl() {
  return `${serverUrl}/${repo}/actions`;
}

function requireEnv(name) {
  const value = normalized(process.env[name]);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function normalized(value) {
  if (!value || value === "null" || value === "undefined") {
    return "";
  }
  return value;
}

function encodeGitRef(ref) {
  return ref.split("/").map(encodeURIComponent).join("/");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
