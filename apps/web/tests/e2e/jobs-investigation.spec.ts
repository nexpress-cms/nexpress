import { npRequireJobsHealthWire } from "@nexpress/core/jobs-contract";
import { expect, test } from "@playwright/test";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";

test("Health queue investigation preserves scope through lifecycle tabs and refresh", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(page.context(), 252 + testInfo.retry);
  await signInAsE2EAdmin(page);
  const requests: URL[] = [];
  let supported = true;
  let holdPending: Promise<void> | undefined;
  let heldPending = false;
  let releasedPending = false;
  await page.route("**/api/admin/jobs?*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const state = url.searchParams.get("state");
    if (state === "created" && holdPending) {
      heldPending = true;
      await holdPending;
    }
    const terminal = state === "completed" || state === "failed";
    const source = terminal ? "archive" : "live";
    const matches =
      url.searchParams.get("source") === source &&
      (url.searchParams.get("name") === "agent.runExecute" || !url.searchParams.has("name"));
    const jobs =
      supported &&
      matches &&
      ["created", "retry", "active", "completed", "failed"].includes(state ?? "")
        ? [
            {
              id: `investigation-${state}`,
              name: "agent.runExecute",
              state,
              source,
              data: { siteId: "default", runId: "00000000-0000-4000-8000-000000000001" },
              retryCount: 0,
              output: null,
              createdOn: new Date().toISOString(),
              ...(state === "created" ? { startAfter: "2099-01-01T12:00:00.000Z" } : {}),
              startedOn: state === "active" ? new Date().toISOString() : null,
              completedOn: terminal ? new Date().toISOString() : null,
            },
          ]
        : [];
    await route.fulfill({
      json: { supported, jobs, total: supported && state === "created" ? 101 : jobs.length },
    });
    if (state === "created" && heldPending) releasedPending = true;
  });
  await page.goto("/admin/health");
  const link = page.getByRole("link", { name: "Inspect agent.runExecute jobs", exact: true });
  await expect(link).toHaveAttribute("href", "/admin/jobs?name=agent.runExecute");
  await link.click();
  await expect(page).toHaveURL(/\/admin\/jobs\?name=agent\.runExecute$/);
  await expect(page.getByText("investigation-created", { exact: true })).toBeVisible();
  await expect(page.getByText("Showing 2 of 102 reported matches", { exact: true })).toBeVisible();
  await expect(page.getByText(/Scheduled not before/)).toContainText("2099");
  await expect(page.getByText("Retry not before Unknown", { exact: true })).toBeVisible();
  await expect(page.getByText(/Up to 100 newest jobs per state/)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("jobs-timing-320.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  // A slow Pending refresh must not overwrite a later Active selection.
  let releasePending: (() => void) | undefined;
  holdPending = new Promise<void>((resolve) => {
    releasePending = resolve;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => heldPending).toBe(true);
  await page.getByRole("tab", { name: "Active", exact: true }).click();
  await expect(page.getByText("investigation-active", { exact: true })).toBeVisible();
  await expect(page.getByText("Showing 1 of 1 reported matches", { exact: true })).toBeVisible();
  await expect(page.getByText(/Last started/)).not.toContainText("Not recorded");
  releasePending?.();
  await expect.poll(() => releasedPending).toBe(true);
  await expect(page.getByText("investigation-created", { exact: true })).toHaveCount(0);
  holdPending = undefined;
  for (const [tab, state] of [
    ["Active", "active"],
    ["Completed", "completed"],
    ["Failed", "failed"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByText(`investigation-${state}`, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Retry all failed", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Last 24 h", exact: true }).click();
  await expect
    .poll(() => requests.filter((url) => url.searchParams.has("since")).length)
    .toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  const beforeRefresh = requests.length;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(beforeRefresh);
  expect(requests.every((url) => url.searchParams.get("name") === "agent.runExecute")).toBe(true);
  expect(requests.slice(beforeRefresh).every((url) => url.searchParams.has("since"))).toBe(true);

  // Unsupported observation must replace the previous successful list.
  supported = false;
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Job listing unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText("investigation-failed", { exact: true })).toHaveCount(0);
  supported = true;
  await page.goto("/admin/jobs");
  await page.getByRole("tab", { name: "Failed", exact: true }).click();
  await expect(page.getByText("investigation-failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry all failed", exact: true })).toBeVisible();

  const beforeInvalid = requests.length;
  await page.goto("/admin/jobs?name=agent.runExecute&name=other.queue");
  await expect(
    page.getByText("The queue filter is invalid. No jobs were requested.", { exact: true }),
  ).toBeVisible();
  expect(requests.length).toBe(beforeInvalid);
});

test("Jobs logs load slowly, page, refresh, retry and discard obsolete responses", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    217 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const jobId = "log-navigation-created";
  await page.route("**/api/admin/jobs?*", async (route) => {
    const pending = new URL(route.request().url()).searchParams.get("state") === "created";
    const jobs = pending
      ? [
          {
            id: jobId,
            name: "agent.runExecute",
            state: "created",
            source: "live",
            data: { siteId: "default", runId: "00000000-0000-4000-8000-000000000001" },
            retryCount: 0,
            output: null,
            createdOn: "2026-09-23T00:00:00.000Z",
            startedOn: null,
            completedOn: null,
          },
        ]
      : [];
    await route.fulfill({ json: { supported: true, jobs, total: jobs.length } });
  });

  function entry(index: number, message = `Captured log ${index}`) {
    return {
      id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      level: "info",
      message,
      context: null,
      createdAt: index < 500 ? "2026-09-23T23:59:00.000Z" : "2026-09-24T00:01:00.000Z",
    };
  }
  function gate() {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }
  const firstLoad = gate();
  const obsoleteLoad = gate();
  const requests: URL[] = [];
  let mode: "normal" | "denied" | "mismatched" | "obsolete" | "current" = "normal";
  let obsoleteReleased = false;
  await page.route(`**/api/admin/jobs/${jobId}/logs?*`, async (route) => {
    const url = new URL(route.request().url());
    const responseMode = mode;
    requests.push(url);
    if (requests.length === 1) await firstLoad.promise;
    if (responseMode === "obsolete") await obsoleteLoad.promise;
    if (responseMode === "denied") {
      await route.fulfill({ status: 403, json: { error: "Private diagnostic must not appear" } });
      return;
    }
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const responseJobId = responseMode === "mismatched" ? "other-job" : jobId;
    const entries =
      responseMode === "normal"
        ? offset === 0
          ? Array.from({ length: 500 }, (_, index) => entry(index + 1))
          : [entry(501)]
        : [entry(1, `${responseMode} log response`)];
    await route.fulfill({
      json: { jobId: responseJobId, entries, total: responseMode === "normal" ? 501 : 1 },
    });
    if (responseMode === "obsolete") obsoleteReleased = true;
  });

  await page.goto("/admin/jobs");
  await expect(page.getByText(jobId, { exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  const summary = page.locator("summary").filter({ hasText: /^Logs/ });
  const panel = summary.locator("..");
  await summary.press("Enter");
  await expect(page.getByText("Loading logs…", { exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  firstLoad.release();
  await expect(page.getByText("Captured log 1", { exact: true })).toBeVisible();
  await expect(panel.locator("ol > li")).toHaveCount(500);
  await expect(page.getByText("Entries 1–500 · 501 reported total", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("jobs-logs-320.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("button", { name: "Previous logs", exact: true })).toBeDisabled();
  const next = page.getByRole("button", { name: "Next logs", exact: true });
  await next.click();
  await expect(page.getByText("Captured log 501", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Entries 501–501 · 501 reported total", { exact: true }),
  ).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("offset")).toBe("500");
  await expect(page.getByText("Captured log 1", { exact: true })).toHaveCount(0);
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Previous logs", exact: true }).click();
  await expect(page.getByText("Captured log 1", { exact: true })).toBeVisible();
  await next.click();
  await expect(page.getByText("Captured log 501", { exact: true })).toBeVisible();
  const refresh = page.getByRole("button", { name: "Refresh logs", exact: true });
  await refresh.click();
  await expect(page.getByText("Captured log 1", { exact: true })).toBeVisible();
  expect(Number(requests.at(-1)?.searchParams.get("offset") ?? "0")).toBe(0);

  mode = "denied";
  await next.click();
  const retry = page.getByRole("button", { name: "Retry logs", exact: true });
  await expect(retry).toBeVisible();
  await expect(panel.locator("ol > li")).toHaveCount(0);
  await expect(page.getByText("Private diagnostic must not appear", { exact: true })).toHaveCount(
    0,
  );
  mode = "normal";
  await retry.click();
  await expect(page.getByText("Captured log 501", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("offset")).toBe("500");
  mode = "mismatched";
  await refresh.click();
  await expect(retry).toBeVisible();
  await expect(page.getByText("mismatched log response", { exact: true })).toHaveCount(0);
  await expect(panel.locator("ol > li")).toHaveCount(0);

  mode = "obsolete";
  const beforeRetry = requests.length;
  await retry.click();
  await expect(page.getByText("Loading logs…", { exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBe(beforeRetry + 1);
  const beforeReopen = requests.length;
  await summary.press("Enter");
  await expect(page.getByText("Loading logs…", { exact: true })).toHaveCount(0);
  mode = "current";
  await summary.press("Enter");
  await expect(page.getByText("current log response", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(beforeReopen + 1);
  expect(Number(requests.at(-1)?.searchParams.get("offset") ?? "0")).toBe(0);
  obsoleteLoad.release();
  await expect.poll(() => obsoleteReleased).toBe(true);
  await expect(page.getByText("obsolete log response", { exact: true })).toHaveCount(0);
  await expect(page.getByText("current log response", { exact: true })).toBeVisible();
  expect(requests.every((url) => url.searchParams.get("limit") === "500")).toBe(true);
});

test("Jobs list pages preserve scope, retry the same window and discard obsolete responses", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(page.context(), 170 + testInfo.retry);
  await signInAsE2EAdmin(page);
  const now = Date.now();
  await page.clock.setFixedTime(now);
  const requests: URL[] = [];
  let mode: "normal" | "denied" | "held" = "normal";
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldRequested = false;
  let heldReleased = false;
  await page.route("**/api/admin/jobs?*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const state = url.searchParams.get("state") ?? "created";
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const requestMode = mode;
    if (requestMode === "held") {
      heldRequested = true;
      await held;
    }
    if (requestMode === "denied") {
      await route.fulfill({ status: 403, json: { error: "Private paging diagnostic" } });
      return;
    }
    const source = ["created", "retry", "active"].includes(state) ? "live" : "archive";
    const jobs = Array.from({ length: offset === 0 ? 100 : 1 }, (_, index) => ({
      id: `page-${state}-${offset + index + 1}${requestMode === "held" ? "-obsolete" : ""}`,
      name: url.searchParams.get("name") ?? "agent.runExecute",
      state,
      source,
      data: { siteId: "default", runId: "00000000-0000-4000-8000-000000000001" },
      retryCount: 0,
      output: null,
      createdOn: "2026-09-23T00:00:00.000Z",
      startedOn: null,
      completedOn: null,
    }));
    await route.fulfill({ json: { supported: true, jobs, total: 101 } });
    if (requestMode === "held") heldReleased = true;
  });
  await page.goto("/admin/jobs?name=agent.runExecute");
  await expect(
    page.getByText("Showing 200 of 202 reported matches", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next jobs", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Job state", exact: true }).selectOption("created");
  await expect(
    page.getByText("Showing 100 of 101 reported matches", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Last 24 h", exact: true }).click();
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next jobs", exact: true })).toBeEnabled();
  const cutoff = requests.at(-1)!.searchParams.get("since");
  expect(cutoff).toBe(new Date(now - 86_400_000).toISOString());
  await page.clock.setFixedTime(now + 60_000);
  await page.getByRole("button", { name: "Next jobs", exact: true }).click();
  await expect(page.getByText("page-created-101", { exact: true })).toBeVisible();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  expect(requests.at(-1)!.searchParams.get("offset")).toBe("100");
  expect(requests.at(-1)!.searchParams.get("since")).toBe(cutoff);
  await expect(page.getByRole("button", { name: "Next jobs", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Previous jobs", exact: true }).click();
  await expect(page.getByText("page-created-1", { exact: true })).toBeVisible();
  expect(requests.at(-1)!.searchParams.get("since")).toBe(cutoff);

  mode = "denied";
  await page.getByRole("button", { name: "Next jobs", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry page", exact: true })).toBeVisible();
  await expect(page.getByText("page-created-1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Private paging diagnostic", { exact: true })).toHaveCount(0);
  mode = "normal";
  await page.getByRole("button", { name: "Retry page", exact: true }).click();
  await expect(page.getByText("page-created-101", { exact: true })).toBeVisible();
  expect(requests.at(-1)!.searchParams.get("offset")).toBe("100");
  expect(requests.at(-1)!.searchParams.get("since")).toBe(cutoff);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("page-created-1", { exact: true })).toBeVisible();
  expect(Number(requests.at(-1)!.searchParams.get("offset") ?? "0")).toBe(0);
  expect(requests.at(-1)!.searchParams.get("since")).toBe(
    new Date(now + 60_000 - 86_400_000).toISOString(),
  );

  await page.getByRole("button", { name: "Next jobs", exact: true }).click();
  await expect(page.getByText("page-created-101", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Job state", exact: true }).selectOption("retry");
  await expect(page.getByText("page-retry-1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next jobs", exact: true }).click();
  await expect(page.getByText("page-retry-101", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await expect(page.getByText("page-retry-1", { exact: true })).toBeVisible();
  expect(requests.at(-1)!.searchParams.has("since")).toBe(false);

  mode = "held";
  await page.getByRole("button", { name: "Next jobs", exact: true }).click();
  await expect.poll(() => heldRequested).toBe(true);
  mode = "normal";
  await page.getByRole("tab", { name: "Active", exact: true }).click();
  await expect(page.getByText("page-active-1", { exact: true })).toBeVisible();
  release();
  await expect.poll(() => heldReleased).toBe(true);
  await expect(page.getByText("page-retry-101-obsolete", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next jobs", exact: true })).toBeEnabled();
  expect(requests.every((url) => url.searchParams.get("name") === "agent.runExecute")).toBe(true);
  expect(requests.every((url) => url.searchParams.get("limit") === "100")).toBe(true);
  await page.getByRole("button", { name: "Next jobs", exact: true }).click();
  await expect(page.getByText("page-active-101", { exact: true })).toBeVisible();
  await page.goto("/admin/jobs?name=other.queue");
  await page.getByRole("combobox", { name: "Job state", exact: true }).selectOption("created");
  await expect(page.getByText("page-created-1", { exact: true })).toBeVisible();
  expect(requests.at(-1)!.searchParams.get("name")).toBe("other.queue");
  expect(Number(requests.at(-1)!.searchParams.get("offset") ?? "0")).toBe(0);
  await page.getByRole("button", { name: "Next jobs", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("page-created-101", { exact: true })).toBeVisible();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("jobs-list-pages-320.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("Worker health keeps loading visible, labels retained refresh data and recovers safely", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    150 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  await page.route("**/api/admin/jobs?*", (route) =>
    route.fulfill({ json: { supported: true, jobs: [], total: 0 } }),
  );
  function health(alive: boolean) {
    return npRequireJobsHealthWire({
      workers: [
        {
          id: "browser-worker",
          status: "running",
          startedAt: "2026-09-24T00:00:00.000Z",
          lastSeenAt: "2026-09-24T00:01:00.000Z",
          meta: {},
          alive,
          lastSeenAgoMs: alive ? 1000 : 120000,
        },
      ],
      aliveCount: alive ? 1 : 0,
      totalCount: 1,
      newestHeartbeat: "2026-09-24T00:01:00.000Z",
      pause: {
        paused: false,
        changedAt: "2026-09-24T00:00:00.000Z",
        changedByUserId: null,
        reason: null,
      },
      stuck: null,
      recentFailures: [],
    });
  }
  function gate() {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }
  const initial = gate();
  const refreshing = gate();
  const obsolete = gate();
  let mode: "initial" | "refresh" | "denied" | "malformed" | "obsolete" | "current" = "initial";
  let requests = 0;
  let obsoleteReleased = false;
  await page.route("**/api/admin/jobs/health", async (route) => {
    requests += 1;
    const responseMode = mode;
    if (responseMode === "initial") await initial.promise;
    if (responseMode === "refresh") await refreshing.promise;
    if (responseMode === "obsolete") await obsolete.promise;
    if (responseMode === "denied") {
      await route.fulfill({ status: 403, json: { error: "Private worker diagnostic" } });
    } else {
      await route.fulfill({
        json:
          responseMode === "malformed"
            ? { ...health(true), aliveCount: 99 }
            : health(responseMode !== "current"),
      });
    }
    if (responseMode === "obsolete") obsoleteReleased = true;
  });

  await page.goto("/admin/jobs?name=agent.runExecute");
  const card = page.getByRole("region", { name: "Worker health", exact: true });
  const refresh = card.getByRole("button", { name: "Refresh worker health", exact: true });
  const retry = card.getByRole("button", { name: "Retry worker health", exact: true });
  await expect(card.getByRole("status")).toHaveText("Loading worker health…");
  await expect(refresh).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  initial.release();
  await expect(card.getByText("Workers: 1 alive / 1 total", { exact: true })).toBeVisible();
  await expect(card.locator("time[dateTime]")).not.toHaveCount(0);

  mode = "refresh";
  await refresh.click();
  await expect.poll(() => requests).toBe(2);
  await expect(
    card.getByText("Previously received data — refresh in progress.", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Workers: 1 alive / 1 total", { exact: true })).toBeVisible();
  await expect(refresh).toBeDisabled();
  refreshing.release();
  await expect(refresh).toBeEnabled();

  mode = "denied";
  await refresh.click();
  await expect(card.getByRole("alert")).toHaveText("Access to worker health is unavailable.");
  await expect(card.getByText(/^Workers:/)).toHaveCount(0);
  await expect(page.getByText("Private worker diagnostic", { exact: true })).toHaveCount(0);
  await expect(retry).toBeEnabled();
  mode = "current";
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(card.getByText("Workers: 0 alive / 1 total", { exact: true })).toBeVisible();

  mode = "malformed";
  await refresh.click();
  await expect(card.getByRole("alert")).toHaveText("Worker health unavailable.");
  await expect(card.getByText(/^Workers:/)).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("worker-health-retry-320.png"),
    fullPage: true,
    animations: "disabled",
  });

  mode = "obsolete";
  await retry.click();
  await expect.poll(() => requests).toBe(6);
  await expect(card.getByRole("status")).toHaveText("Loading worker health…");
  mode = "current";
  await page.getByRole("link", { name: "Show all queues", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/jobs$/);
  await expect(card.getByText("Workers: 0 alive / 1 total", { exact: true })).toBeVisible();
  obsolete.release();
  await expect.poll(() => obsoleteReleased).toBe(true);
  await expect(card.getByText("Workers: 1 alive / 1 total", { exact: true })).toHaveCount(0);
  await expect(card.getByText("Workers: 0 alive / 1 total", { exact: true })).toBeVisible();
  expect(requests).toBe(7);
});
