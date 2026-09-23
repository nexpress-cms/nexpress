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
