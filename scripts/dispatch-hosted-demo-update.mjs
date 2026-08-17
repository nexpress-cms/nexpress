#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isTransientGitHubError, retryGitHubRequest } from "./github-status-retry.mjs";

const exactVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const commitShaPattern = /^[0-9a-f]{40}$/;
const releaseCommitPrefix = "chore(release): version packages";

export function planHostedDemoUpdate({
  eventName,
  headCommitMessage,
  sourceSha,
  currentVersion,
  previousVersion,
}) {
  if (eventName !== "push") {
    return { shouldDispatch: false, reason: `event ${eventName || "unknown"} is not a push` };
  }
  if (!headCommitMessage.startsWith(releaseCommitPrefix)) {
    return { shouldDispatch: false, reason: "commit is not a Version Packages merge" };
  }
  if (currentVersion === previousVersion) {
    return {
      shouldDispatch: false,
      reason: `NexPress family version stayed at ${currentVersion}`,
    };
  }
  if (!exactVersionPattern.test(currentVersion)) {
    throw new Error(`Invalid NexPress family version: ${currentVersion}`);
  }
  if (!commitShaPattern.test(sourceSha)) {
    throw new Error(`Invalid release commit SHA: ${sourceSha}`);
  }
  return {
    shouldDispatch: true,
    reason: `NexPress family advanced from ${previousVersion || "unreleased"} to ${currentVersion}`,
    version: currentVersion,
    sourceSha,
  };
}

export function hostedDemoRunName(version, sourceSha) {
  return `Update NexPress ${version} · ${sourceSha}`;
}

export async function dispatchHostedDemoUpdate({
  token,
  version,
  sourceSha,
  repository = "nexpress-cms/nexpress-hosted-demo",
  workflowFile = "update-nexpress.yml",
  ref = "main",
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
  sleepImpl = sleep,
  lookupTimeoutMs = 60_000,
  dispatchAttempts = 6,
  retryBaseDelayMs = 1_000,
  retryMaxDelayMs = 30_000,
  ambiguityLookupAttempts = 6,
  ambiguityLookupDelayMs = 2_000,
  onRetry = ({ attempt, attempts, delayMs, status, phase }) => {
    console.warn(
      `[hosted-demo] ${phase} received GitHub ${status}; retry ${attempt}/${attempts} in ${delayMs}ms.`,
    );
  },
}) {
  if (!token) throw new Error("GH_TOKEN is required for hosted demo dispatch.");
  if (!exactVersionPattern.test(version)) {
    throw new Error(`Invalid NexPress family version: ${version}`);
  }
  if (!commitShaPattern.test(sourceSha)) {
    throw new Error(`Invalid release commit SHA: ${sourceSha}`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`Invalid hosted demo repository: ${repository}`);
  }

  const workflowPath = encodeURIComponent(workflowFile);
  const expectedTitle = hostedDemoRunName(version, sourceSha);
  const lookupRun = () =>
    lookupHostedDemoRun({
      apiUrl,
      repository,
      workflowPath,
      ref,
      expectedTitle,
      token,
      fetchImpl,
    });
  const existingRun = await retryGitHubRequest(lookupRun, {
    attempts: dispatchAttempts,
    baseDelayMs: retryBaseDelayMs,
    maxDelayMs: retryMaxDelayMs,
    sleep: sleepImpl,
    onRetry: (retry) => onRetry({ ...retry, phase: "run lookup" }),
  });
  if (existingRun) return existingRun;

  const startedAt = Date.now();
  let dispatched = false;
  for (let attempt = 1; attempt <= dispatchAttempts; attempt += 1) {
    try {
      await githubRequest({
        apiUrl,
        repository,
        path: `/actions/workflows/${workflowPath}/dispatches`,
        token,
        fetchImpl,
        init: {
          method: "POST",
          body: JSON.stringify({ ref, inputs: { version, source_sha: sourceSha } }),
        },
      });
      dispatched = true;
      break;
    } catch (error) {
      if (!isTransientGitHubError(error)) throw error;

      const reconciled = await reconcileAmbiguousDispatch({
        lookupRun,
        attempts: ambiguityLookupAttempts,
        delayMs: ambiguityLookupDelayMs,
        sleepImpl,
        onRetry,
      });
      if (reconciled.run) return reconciled.run;
      if (!reconciled.observedSuccessfulLookup || attempt === dispatchAttempts) throw error;

      const delayMs = Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** (attempt - 1));
      onRetry({
        attempt,
        attempts: dispatchAttempts,
        delayMs,
        status: error.status,
        phase: "workflow dispatch",
      });
      await sleepImpl(delayMs);
    }
  }
  if (!dispatched) throw new Error("Hosted demo dispatch retry exhausted unexpectedly.");

  while (Date.now() - startedAt < lookupTimeoutMs) {
    try {
      const run = await lookupRun();
      if (run) return run;
    } catch (error) {
      if (!isTransientGitHubError(error)) throw error;
      onRetry({
        attempt: 1,
        attempts: 1,
        delayMs: 5_000,
        status: error.status,
        phase: "dispatched run lookup",
      });
    }
    await sleepImpl(5_000);
  }

  throw new Error(`Timed out waiting for hosted demo workflow run ${expectedTitle}.`);
}

async function lookupHostedDemoRun({
  apiUrl,
  repository,
  workflowPath,
  ref,
  expectedTitle,
  token,
  fetchImpl,
}) {
  const params = new URLSearchParams({ branch: ref, event: "workflow_dispatch", per_page: "100" });
  const result = await githubRequest({
    apiUrl,
    repository,
    path: `/actions/workflows/${workflowPath}/runs?${params.toString()}`,
    token,
    fetchImpl,
  });
  return (
    result.workflow_runs
      ?.filter((candidate) => candidate.display_title === expectedTitle && candidate.html_url)
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0] ?? null
  );
}

async function reconcileAmbiguousDispatch({ lookupRun, attempts, delayMs, sleepImpl, onRetry }) {
  let observedSuccessfulLookup = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await sleepImpl(delayMs);
    try {
      const run = await lookupRun();
      observedSuccessfulLookup = true;
      if (run) return { run, observedSuccessfulLookup };
    } catch (error) {
      if (!isTransientGitHubError(error)) throw error;
      onRetry({
        attempt,
        attempts,
        delayMs,
        status: error.status,
        phase: "ambiguous dispatch reconciliation",
      });
    }
  }
  return { run: null, observedSuccessfulLookup };
}

function readPackageVersion(repoRoot) {
  return JSON.parse(readFileSync(resolve(repoRoot, "packages/core/package.json"), "utf8")).version;
}

function readPreviousPackageVersion(repoRoot) {
  try {
    const manifest = execFileSync("git", ["show", "HEAD^:packages/core/package.json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return JSON.parse(manifest).version;
  } catch {
    return null;
  }
}

function appendWorkflowFile(envName, contents) {
  const path = process.env[envName];
  if (!path) throw new Error(`${envName} is required.`);
  appendFileSync(path, `${contents}\n`, "utf8");
}

async function githubRequest({ apiUrl, repository, path, token, fetchImpl, init = {} }) {
  const response = await fetchImpl(`${apiUrl}/repos/${repository}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  if (response.status === 204) return null;
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`${init.method || "GET"} ${path} failed (${response.status}): ${body}`);
    error.status = response.status;
    throw error;
  }
  return body ? JSON.parse(body) : null;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function main() {
  const command = process.argv[2];
  const repoRoot = resolve(import.meta.dirname, "..");
  if (command === "plan") {
    const plan = planHostedDemoUpdate({
      eventName: process.env.GITHUB_EVENT_NAME || "",
      headCommitMessage: process.env.NP_RELEASE_COMMIT_MESSAGE || "",
      sourceSha: process.env.GITHUB_SHA || "",
      currentVersion: readPackageVersion(repoRoot),
      previousVersion: readPreviousPackageVersion(repoRoot),
    });
    appendWorkflowFile("GITHUB_OUTPUT", `should_dispatch=${plan.shouldDispatch}`);
    if (plan.shouldDispatch) {
      appendWorkflowFile("GITHUB_OUTPUT", `version=${plan.version}`);
      appendWorkflowFile("GITHUB_OUTPUT", `source_sha=${plan.sourceSha}`);
    }
    appendWorkflowFile(
      "GITHUB_STEP_SUMMARY",
      plan.shouldDispatch
        ? `Hosted demo update planned: NexPress \`${plan.version}\` from \`${plan.sourceSha}\`.`
        : `Hosted demo update skipped: ${plan.reason}.`,
    );
    console.log(`[hosted-demo] ${plan.reason}.`);
    return;
  }
  if (command === "dispatch") {
    const run = await dispatchHostedDemoUpdate({
      token: process.env.GH_TOKEN || "",
      version: process.env.NP_HOSTED_DEMO_VERSION || "",
      sourceSha: process.env.NP_HOSTED_DEMO_SOURCE_SHA || "",
      repository: process.env.NP_HOSTED_DEMO_REPOSITORY || "nexpress-cms/nexpress-hosted-demo",
      apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
    });
    appendWorkflowFile(
      "GITHUB_STEP_SUMMARY",
      `Hosted demo update dispatched: [${run.html_url}](${run.html_url}).`,
    );
    console.log(`[hosted-demo] workflow run: ${run.html_url}`);
    return;
  }
  throw new Error("Usage: node scripts/dispatch-hosted-demo-update.mjs <plan|dispatch>");
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
