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
  await expect(page.getByText("Loading logs…", { exact: true })).not.toBeVisible();
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
