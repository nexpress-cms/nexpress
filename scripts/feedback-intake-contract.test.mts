import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

async function read(relativePath: string) {
  return readFile(resolve(repoRoot, relativePath), "utf8");
}

function formField(source: string, id: string) {
  const marker = `    id: ${id}\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing issue-form field ${id}`);
  const next = source.indexOf("\n  - type:", start);
  return source.slice(start, next === -1 ? source.length : next);
}

test("bug intake asks for a reproducible installed environment", async () => {
  const form = await read(".github/ISSUE_TEMPLATE/bug_report.yml");

  assert.match(form, /labels: \["bug"\]/);
  for (const id of ["affected-surface", "reproduce", "nexpress-version", "env"]) {
    assert.match(formField(form, id), /required: true/);
  }
  assert.match(formField(form, "nexpress-version"), /pnpm list @nexpress\/core --depth 0/);
  assert.doesNotMatch(form, /npm view @nexpress\/core version/);
  assert.match(formField(form, "logs"), /Strip secrets and personal data/);
});

test("first-run feedback captures the failing journey without secrets", async () => {
  const form = await read(".github/ISSUE_TEMPLATE/install_feedback.yml");

  assert.match(form, /labels: \["feedback"\]/);
  for (const id of ["stage", "friction", "reproduce", "nexpress-version", "environment"]) {
    assert.match(formField(form, id), /required: true/);
  }
  assert.match(formField(form, "reproduce"), /Strip secrets and personal data/);
});

test("the chooser routes security and discussion away from public issue forms", async () => {
  const config = await read(".github/ISSUE_TEMPLATE/config.yml");

  assert.match(config, /blank_issues_enabled: false/);
  assert.match(config, /security\/advisories\/new/);
  assert.match(config, /nexpress-cms\/nexpress\/discussions/);
});

test("new and reopened issues enter the maintainer triage queue", async () => {
  const workflow = await read(".github/workflows/issue-triage.yml");

  assert.match(workflow, /types: \[opened, reopened\]/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /gh issue edit[\s\S]*--add-label triage/);
});

test("public docs expose intake routes and a bounded triage policy", async () => {
  const readme = await read("README.md");
  const triage = await read("docs/triage.md");

  for (const template of ["bug_report.yml", "install_feedback.yml", "feature_request.yml"]) {
    assert.match(readme, new RegExp(`issues/new\\?template=${template.replace(".", "\\.")}`));
  }
  assert.match(triage, /at least once each week/);
  assert.match(triage, /priority: high/);
  assert.match(triage, /priority: medium/);
  assert.match(triage, /priority: low/);
  assert.match(triage, /Security vulnerabilities must be reported privately/);
  assert.match(triage, /Consumer-visible[\s\S]*require a changeset/);
});
