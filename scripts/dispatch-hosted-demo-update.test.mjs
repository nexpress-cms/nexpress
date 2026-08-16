import assert from "node:assert/strict";
import test from "node:test";

import {
  dispatchHostedDemoUpdate,
  hostedDemoRunName,
  planHostedDemoUpdate,
} from "./dispatch-hosted-demo-update.mjs";

const release = {
  eventName: "push",
  headCommitMessage: "chore(release): version packages (#1400)",
  sourceSha: "a".repeat(40),
  currentVersion: "0.4.4",
  previousVersion: "0.4.3",
};

test("plans only a family Version Packages release", () => {
  assert.deepEqual(planHostedDemoUpdate(release), {
    shouldDispatch: true,
    reason: "NexPress family advanced from 0.4.3 to 0.4.4",
    version: "0.4.4",
    sourceSha: "a".repeat(40),
  });
  assert.equal(
    planHostedDemoUpdate({ ...release, headCommitMessage: "feat: ordinary change" }).shouldDispatch,
    false,
  );
  assert.equal(planHostedDemoUpdate({ ...release, currentVersion: "0.4.3" }).shouldDispatch, false);
  assert.equal(
    planHostedDemoUpdate({ ...release, eventName: "workflow_dispatch" }).shouldDispatch,
    false,
  );
  assert.throws(
    () => planHostedDemoUpdate({ ...release, sourceSha: "not-a-sha" }),
    /Invalid release commit SHA/,
  );
});

test("dispatches the exact version and finds its correlated demo run", async () => {
  const requests = [];
  const sourceSha = "b".repeat(40);
  const runUrl = "https://github.com/nexpress-cms/nexpress-hosted-demo/actions/runs/123";
  const fetchImpl = async (input, init = {}) => {
    requests.push({ input: String(input), init });
    if (init.method === "POST") return new Response(null, { status: 204 });
    return new Response(
      JSON.stringify({
        workflow_runs: [
          {
            display_title: hostedDemoRunName("0.4.4", sourceSha),
            created_at: new Date().toISOString(),
            html_url: runUrl,
          },
        ],
      }),
      { status: 200 },
    );
  };

  const run = await dispatchHostedDemoUpdate({
    token: "test-token",
    version: "0.4.4",
    sourceSha,
    fetchImpl,
    sleepImpl: async () => {},
  });

  assert.equal(run.html_url, runUrl);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    ref: "main",
    inputs: { version: "0.4.4", source_sha: sourceSha },
  });
  assert.match(requests[1].input, /event=workflow_dispatch/);
  assert.equal(requests[0].init.headers.authorization, "Bearer test-token");
});

test("rejects malformed dispatch authority inputs before I/O", async () => {
  let calls = 0;
  await assert.rejects(
    dispatchHostedDemoUpdate({
      token: "test-token",
      version: "latest",
      sourceSha: "c".repeat(40),
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 204 });
      },
    }),
    /Invalid NexPress family version/,
  );
  assert.equal(calls, 0);
});
