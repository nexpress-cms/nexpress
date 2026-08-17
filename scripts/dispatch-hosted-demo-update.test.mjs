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
  let lookups = 0;
  const fetchImpl = async (input, init = {}) => {
    requests.push({ input: String(input), init });
    if (init.method === "POST") return new Response(null, { status: 204 });
    lookups += 1;
    return new Response(
      JSON.stringify({
        workflow_runs:
          lookups === 1
            ? []
            : [
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
  assert.equal(requests.length, 3);
  assert.equal(requests[0].init.method, undefined);
  assert.equal(requests[1].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    ref: "main",
    inputs: { version: "0.4.4", source_sha: sourceSha },
  });
  assert.match(requests[2].input, /event=workflow_dispatch/);
  assert.equal(requests[1].init.headers.authorization, "Bearer test-token");
});

test("returns an existing exact run without dispatching again", async () => {
  const sourceSha = "d".repeat(40);
  const runUrl = "https://github.com/nexpress-cms/nexpress-hosted-demo/actions/runs/456";
  let posts = 0;
  const run = await dispatchHostedDemoUpdate({
    token: "test-token",
    version: "0.4.5",
    sourceSha,
    fetchImpl: async (_input, init = {}) => {
      if (init.method === "POST") posts += 1;
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              display_title: hostedDemoRunName("0.4.5", sourceSha),
              created_at: "2026-08-17T00:00:00.000Z",
              html_url: runUrl,
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(run.html_url, runUrl);
  assert.equal(posts, 0);
});

test("reconciles an ambiguous transient dispatch without duplicating provider I/O", async () => {
  const sourceSha = "e".repeat(40);
  const runUrl = "https://github.com/nexpress-cms/nexpress-hosted-demo/actions/runs/789";
  let posts = 0;
  let lookups = 0;
  const delays = [];
  const run = await dispatchHostedDemoUpdate({
    token: "test-token",
    version: "0.4.5",
    sourceSha,
    ambiguityLookupDelayMs: 7,
    sleepImpl: async (delayMs) => delays.push(delayMs),
    fetchImpl: async (_input, init = {}) => {
      if (init.method === "POST") {
        posts += 1;
        return new Response("temporarily unavailable", { status: 503 });
      }
      lookups += 1;
      return new Response(
        JSON.stringify({
          workflow_runs:
            lookups === 1
              ? []
              : [
                  {
                    display_title: hostedDemoRunName("0.4.5", sourceSha),
                    created_at: new Date().toISOString(),
                    html_url: runUrl,
                  },
                ],
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(run.html_url, runUrl);
  assert.equal(posts, 1);
  assert.deepEqual(delays, [7]);
});

test("retries a transient dispatch only after successful no-run reconciliation", async () => {
  const sourceSha = "f".repeat(40);
  const runUrl = "https://github.com/nexpress-cms/nexpress-hosted-demo/actions/runs/999";
  let posts = 0;
  const retries = [];
  const run = await dispatchHostedDemoUpdate({
    token: "test-token",
    version: "0.4.5",
    sourceSha,
    ambiguityLookupAttempts: 2,
    ambiguityLookupDelayMs: 0,
    retryBaseDelayMs: 0,
    sleepImpl: async () => {},
    onRetry: (retry) => retries.push(retry),
    fetchImpl: async (_input, init = {}) => {
      if (init.method === "POST") {
        posts += 1;
        return posts === 1
          ? new Response("temporarily unavailable", { status: 503 })
          : new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({
          workflow_runs:
            posts === 2
              ? [
                  {
                    display_title: hostedDemoRunName("0.4.5", sourceSha),
                    created_at: new Date().toISOString(),
                    html_url: runUrl,
                  },
                ]
              : [],
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(run.html_url, runUrl);
  assert.equal(posts, 2);
  assert.equal(retries.filter(({ phase }) => phase === "workflow dispatch").length, 1);
});

test("does not retry a permanent dispatch rejection", async () => {
  let posts = 0;
  await assert.rejects(
    dispatchHostedDemoUpdate({
      token: "test-token",
      version: "0.4.5",
      sourceSha: "1".repeat(40),
      fetchImpl: async (_input, init = {}) => {
        if (init.method !== "POST") {
          return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
        }
        posts += 1;
        return new Response("invalid", { status: 422 });
      },
    }),
    /failed \(422\)/,
  );
  assert.equal(posts, 1);
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
