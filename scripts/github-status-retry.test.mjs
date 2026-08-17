import assert from "node:assert/strict";
import { test } from "node:test";

import { retryGitHubStatusWrite } from "./github-status-retry.mjs";

test("retries transient GitHub status failures with bounded exponential backoff", async () => {
  const delays = [];
  const retries = [];
  let writes = 0;

  const result = await retryGitHubStatusWrite(
    async () => {
      writes += 1;
      if (writes < 4) {
        throw statusError(writes === 1 ? 502 : writes === 2 ? 503 : 504);
      }
      return "written";
    },
    {
      baseDelayMs: 10,
      maxDelayMs: 25,
      onRetry: (retry) => retries.push(retry),
      sleep: async (delayMs) => delays.push(delayMs),
    },
  );

  assert.equal(result, "written");
  assert.equal(writes, 4);
  assert.deepEqual(delays, [10, 20, 25]);
  assert.deepEqual(
    retries.map(({ attempt, attempts, status }) => ({ attempt, attempts, status })),
    [
      { attempt: 1, attempts: 6, status: 502 },
      { attempt: 2, attempts: 6, status: 503 },
      { attempt: 3, attempts: 6, status: 504 },
    ],
  );
});

test("does not retry permanent status failures", async () => {
  const error = statusError(422);
  let writes = 0;

  await assert.rejects(
    retryGitHubStatusWrite(
      async () => {
        writes += 1;
        throw error;
      },
      { sleep: async () => assert.fail("permanent failures must not sleep") },
    ),
    (received) => received === error,
  );
  assert.equal(writes, 1);
});

test("stops after the bounded transient retry budget", async () => {
  const error = statusError(503);
  const delays = [];
  let writes = 0;

  await assert.rejects(
    retryGitHubStatusWrite(
      async () => {
        writes += 1;
        throw error;
      },
      { attempts: 3, sleep: async (delayMs) => delays.push(delayMs) },
    ),
    (received) => received === error,
  );
  assert.equal(writes, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
});

function statusError(status) {
  const error = new Error(`GitHub ${status}`);
  error.status = status;
  return error;
}
