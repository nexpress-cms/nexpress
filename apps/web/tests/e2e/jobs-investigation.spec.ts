import { npRequireJobListWire, npRequireJobsHealthWire } from "@nexpress/core/jobs-contract";
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

test("Jobs investigation links restore scope, cutoff and page across reload and history", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    130 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const now = Date.now();
  const at = new Date(now).toISOString();
  const since = new Date(now - 86_400_000).toISOString();
  await page.clock.setFixedTime(now);
  const requests: URL[] = [];
  let jobsReads = 0;
  page.on("request", (request) => {
    if (/^\/api\/admin\/jobs(?:\/|$)/.test(new URL(request.url()).pathname)) jobsReads += 1;
  });
  await page.route("**/api/admin/jobs?*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const state = url.searchParams.get("state") ?? "created";
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const jobs = [
      {
        id: `linked-${state}-${offset + 1}`,
        name: url.searchParams.get("name") ?? "agent.runExecute",
        state,
        source: ["created", "retry", "active"].includes(state) ? "live" : "archive",
        data: { siteId: "default", runId: "00000000-0000-4000-8000-000000000001" },
        retryCount: 0,
        output: null,
        createdOn: at,
        startedOn: null,
        completedOn: null,
      },
    ];
    await route.fulfill({ json: npRequireJobListWire({ supported: true, jobs, total: 101 }) });
  });
  const query = new URLSearchParams({
    name: "agent.runExecute",
    tab: "failed",
    state: "expired",
    window: "24h",
    offset: "100",
    at,
  });
  await page.goto(`/admin/jobs?${query}`);
  const copiedLink = page.url();
  async function expectSecondPage() {
    await expect(page.getByRole("tab", { name: "Failed", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("combobox", { name: "Job state", exact: true })).toHaveValue(
      "expired",
    );
    await expect(page.getByText("linked-expired-101", { exact: true })).toBeVisible();
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    expect(requests.at(-1)!.searchParams.get("name")).toBe("agent.runExecute");
    expect(requests.at(-1)!.searchParams.get("state")).toBe("expired");
    expect(requests.at(-1)!.searchParams.get("source")).toBe("archive");
    expect(requests.at(-1)!.searchParams.get("offset")).toBe("100");
    expect(requests.at(-1)!.searchParams.get("since")).toBe(since);
  }
  await expectSecondPage();
  await expect(
    page.getByText(`Created since ${since}. Refresh to update this cutoff.`, { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("jobs-linked-320.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expectSecondPage();
  await page.getByRole("button", { name: "Previous jobs", exact: true }).click();
  await expect(page.getByText("linked-expired-1", { exact: true })).toBeVisible();
  const firstPageLink = page.url();
  expect(Number(new URL(firstPageLink).searchParams.get("offset") ?? "0")).toBe(0);
  expect(new URL(firstPageLink).searchParams.get("at")).toBe(at);
  await page.goBack();
  await expectSecondPage();
  await page.goForward();
  await expect(page).toHaveURL(firstPageLink);
  await expect(page.getByText("linked-expired-1", { exact: true })).toBeVisible();

  // A copied address restores the exact investigation in a fresh document.
  await page.goto(copiedLink);
  await expectSecondPage();
  await page.getByRole("tab", { name: "Active", exact: true }).click();
  await expect(page.getByText("linked-active-1", { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("active");
  await page.goBack();
  await expectSecondPage();
  await page.goForward();
  await expect(page.getByText("linked-active-1", { exact: true })).toBeVisible();
  await page.goto(copiedLink);
  await expectSecondPage();
  await page.clock.setFixedTime(now + 60_000);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("linked-expired-1", { exact: true })).toBeVisible();
  expect(Number(new URL(page.url()).searchParams.get("offset") ?? "0")).toBe(0);
  expect(new URL(page.url()).searchParams.get("at")).toBe(new Date(now + 60_000).toISOString());
  expect(requests.at(-1)!.searchParams.get("since")).toBe(
    new Date(now + 60_000 - 86_400_000).toISOString(),
  );

  // A missing cutoff must not silently broaden a shared last-24-hours query.
  const beforeInvalid = jobsReads;
  query.delete("at");
  await page.goto(`/admin/jobs?${query}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "The investigation link is invalid. No jobs were requested.",
  );
  expect(jobsReads).toBe(beforeInvalid);
  await page.getByRole("link", { name: "Reset investigation", exact: true }).click();
  await expect(page.getByText("linked-created-1", { exact: true })).toBeVisible();
  expect(requests.at(-1)!.searchParams.has("since")).toBe(false);
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

test("Jobs mutations stay serialized and bind outcomes to the submitted view and handler", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(
    page.context(),
    140 + testInfo.retry + testInfo.repeatEachIndex * (testInfo.project.retries + 1),
  );
  await signInAsE2EAdmin(page);
  const listRequests: string[] = [];
  await page.route("**/api/admin/jobs?*", async (route) => {
    const state = new URL(route.request().url()).searchParams.get("state");
    listRequests.push(state ?? "");
    const jobs = (state === "failed" ? [1, 2] : state === "created" ? [1] : []).map((index) => ({
      id: `mutation-${state}-${index}`,
      name: "media.cleanup",
      state,
      source: state === "failed" ? "archive" : "live",
      data: {},
      retryCount: 0,
      output: null,
      createdOn: "2026-09-24T00:00:00.000Z",
      startedOn: null,
      completedOn: null,
    }));
    await route.fulfill({ json: { supported: true, jobs, total: jobs.length } });
  });
  await page.route("**/api/admin/jobs/schedules", (route) =>
    route.fulfill({
      json: {
        supported: true,
        schedules: [],
        handlers: ["media:cleanup", "system:sessionCleanup"],
      },
    }),
  );
  let releaseRetry: (() => void) | undefined;
  const retryGate = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  let retryRequests = 0;
  await page.route("**/api/admin/jobs/*/retry", async (route) => {
    retryRequests += 1;
    await retryGate;
    await route.fulfill({ json: { id: "mutation-failed-1" } });
  });
  let releaseEnqueue: (() => void) | undefined;
  let enqueueGate = Promise.resolve();
  let enqueueMode: "success" | "mismatch" | "network" = "success";
  const submissions: unknown[] = [];
  await page.route("**/api/admin/jobs/enqueue", async (route) => {
    submissions.push(route.request().postDataJSON());
    const mode = enqueueMode;
    await enqueueGate;
    if (mode === "network") {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      json: {
        id: "manual-cleanup-job",
        type: mode === "mismatch" ? "system:sessionCleanup" : "media:cleanup",
        data: {},
      },
    });
  });
  function holdEnqueue() {
    enqueueGate = new Promise<void>((resolve) => {
      releaseEnqueue = resolve;
    });
  }
  const unknownOutcome = page.getByText(
    "The request result could not be confirmed. Refresh and inspect jobs before submitting again.",
    { exact: true },
  );
  await page.goto("/admin/jobs");
  await page.getByRole("tab", { name: "Failed", exact: true }).click();
  const retries = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retries).toHaveCount(2);
  await retries.first().click();
  await expect.poll(() => retryRequests).toBe(1);
  await expect(retries.first()).toBeDisabled();
  await expect(retries.last()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry all failed", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "mutation-failed-1" })).toBeVisible();
  await page.getByRole("tab", { name: "Pending", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Scheduled", exact: true }).click();
  await expect(page.getByLabel("Handler", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Enqueue", exact: true })).toBeDisabled();
  // Return to the same URL before completion: an earlier visit still must not
  // refresh this visit or regain authority to publish its result here.
  await page.goBack();
  await expect(page.getByText("mutation-created-1", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(retries).toHaveCount(2);
  await expect(retries.first()).toBeDisabled();
  const beforeRetryCompletion = listRequests.length;
  releaseRetry?.();
  await expect(retries.first()).toBeEnabled();
  expect(listRequests.length).toBe(beforeRetryCompletion);
  expect(retryRequests).toBe(1);

  await page.getByRole("tab", { name: "Scheduled", exact: true }).click();
  const handler = page.getByLabel("Handler", { exact: true });
  const payload = page.getByLabel("Payload (JSON)", { exact: true });
  const enqueue = page.getByRole("button", { name: "Enqueue", exact: true });
  await handler.selectOption("media:cleanup");
  await payload.fill("{}");
  holdEnqueue();
  await enqueue.click();
  await expect.poll(() => submissions.length).toBe(1);
  await expect(handler).toBeDisabled();
  await expect(payload).toBeDisabled();
  await expect(enqueue).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "media:cleanup" })).toBeVisible();
  expect(submissions[0]).toEqual({ type: "media:cleanup", data: {} });
  releaseEnqueue?.();
  const success = page.getByText("Enqueued media:cleanup (job id manual-cleanup-job).", {
    exact: true,
  });
  await expect(success).toBeVisible();
  await expect(payload).toBeEnabled();
  await payload.fill("{ }");
  await expect(success).toHaveCount(0);

  enqueueMode = "mismatch";
  await enqueue.click();
  await expect(unknownOutcome).toBeVisible();
  await expect(success).toHaveCount(0);
  expect(submissions.length).toBe(2);
  enqueueMode = "network";
  await payload.fill("{}");
  await enqueue.click();
  await expect.poll(() => submissions.length).toBe(3);
  await expect(unknownOutcome).toBeVisible();
  await expect(enqueue).toBeEnabled();
  await expect(success).toHaveCount(0);

  enqueueMode = "success";
  holdEnqueue();
  await enqueue.click();
  await expect.poll(() => submissions.length).toBe(4);
  await page.getByRole("tab", { name: "Pending", exact: true }).click();
  await expect(page.getByText("mutation-created-1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  const beforeEnqueueCompletion = listRequests.length;
  releaseEnqueue?.();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  expect(listRequests.length).toBe(beforeEnqueueCompletion);
  await expect(unknownOutcome).toHaveCount(0);
  await expect(success).toHaveCount(0);
  await page.getByRole("tab", { name: "Scheduled", exact: true }).click();
  await expect(handler).toHaveValue("");
  await expect(success).toHaveCount(0);
});
