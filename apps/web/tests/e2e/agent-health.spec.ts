import { NP_AGENT_WORKER_QUEUE_NAMES } from "@nexpress/core/jobs-contract";
import { expect, test } from "@playwright/test";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
import { isolateE2ERateLimitBucket } from "./fixtures/rate-limit.js";

test("Health shows the real Agent snapshot with keyboard-accessible counts and explicit measurement limits", async ({
  page,
}, testInfo) => {
  await isolateE2ERateLimitBucket(page.context(), 249 + testInfo.retry);
  await signInAsE2EAdmin(page);
  await page.goto("/admin/health");
  const diagnostics = page.getByRole("region", { name: "Agent diagnostics", exact: true });
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.getByText(/Snapshot status:/)).toBeVisible();
  const maintenance = page.getByRole("region", { name: "Agent maintenance evidence", exact: true });
  await expect(maintenance).toBeVisible();
  for (const label of [
    "Process registration",
    "Generic worker heartbeat",
    "Retained queue failures",
    "Committed retention receipts",
    "Evidence limits",
  ])
    await expect(maintenance.getByRole("heading", { name: label, exact: true })).toBeVisible();
  await expect(
    maintenance.getByText(
      "A completed sweep records cursor traversal, not deletion of all eligible data. Active work and required evidence remain protected.",
    ),
  ).toBeVisible();
  const budget = page.getByRole("region", { name: "Agent budget measurement", exact: true });
  await expect(budget).toBeVisible();
  for (const label of [
    "Successfully measured sites",
    "Sites with unresolved usage",
    "Sites with unavailable measurement",
  ])
    await expect(budget.getByText(label, { exact: true })).toBeVisible();
  await expect(
    budget.getByRole("heading", { name: "Measurement limits", exact: true }),
  ).toBeVisible();
  const workers = page.getByRole("region", { name: "Agent worker subscriptions", exact: true });
  await expect(workers).toBeVisible();
  for (const label of [
    "Workers with fresh Agent subscriptions",
    "Paused Agent workers",
    "Inactive workers",
    "Stale worker evidence",
    "Workers marked stopped",
    "Workers with unknown evidence",
  ])
    await expect(workers.getByText(label, { exact: true })).toBeVisible();
  await expect(workers.getByText(/do not prove job progress/)).toBeVisible();
  const queues = workers.getByRole("region", {
    name: "Queue subscription observations",
    exact: true,
  });
  await expect(queues).toBeVisible();
  for (const queue of NP_AGENT_WORKER_QUEUE_NAMES) {
    const observation = queues.getByRole("region", { name: queue, exact: true });
    await expect(observation).toBeVisible();
    await expect(observation.locator("dd")).toHaveCount(4);
  }
  const backlog = page.getByRole("region", { name: "Agent queue backlog", exact: true });
  await expect(backlog).toBeVisible();
  for (const queue of NP_AGENT_WORKER_QUEUE_NAMES) {
    const observation = backlog.getByRole("region", { name: `${queue} backlog`, exact: true });
    await expect(observation.locator("dd")).toHaveCount(7);
  }
  await expect(backlog.getByText(/scheduled work is not overdue work/)).toBeVisible();
  await expect(backlog.getByText(/Ages do not prove progress or a stuck job/)).toBeVisible();
  const backlogTimestamp = await backlog.locator("time").getAttribute("datetime");
  const workerTimestamp = await workers.locator("time").getAttribute("datetime");
  const budgetTimestamp = await budget.locator("time").getAttribute("datetime");
  const generated = diagnostics.locator("time");
  const timestamp = await generated.getAttribute("datetime");
  expect(timestamp).toBeTruthy();
  expect(Number.isFinite(Date.parse(timestamp!))).toBe(true);
  for (const label of ["Providers", "Vault", "Blocking issues", "Snapshot limits"])
    await expect(diagnostics.getByRole("heading", { name: label, exact: true })).toBeVisible();
  await expect(
    diagnostics.getByText(
      "Worker heartbeat and queue consumer liveness are not measured by this snapshot.",
    ),
  ).toBeVisible();
  const disclosure = diagnostics.locator("summary");
  await expect(disclosure).toContainText("Persisted state counts");
  // Native disclosure is reachable through actual document order.
  for (
    let i = 0;
    i < 100 && !(await disclosure.evaluate((element) => element === document.activeElement));
    i++
  )
    await page.keyboard.press("Tab");
  await expect(disclosure).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(diagnostics.locator("details")).toHaveAttribute("open", "");
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.classList.toggle("dark", value === "dark");
      }, theme);
      expect(
        await diagnostics.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      expect(
        await maintenance.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      expect(
        await budget.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      expect(
        await workers.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      expect(
        await backlog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      const backlogPath = testInfo.outputPath(`agent-backlog-${width}-${theme}.png`);
      await backlog.screenshot({ path: backlogPath, animations: "disabled" });
      await testInfo.attach(`agent-backlog-${width}-${theme}`, {
        path: backlogPath,
        contentType: "image/png",
      });
      const workerPath = testInfo.outputPath(`agent-worker-${width}-${theme}.png`);
      await workers.screenshot({ path: workerPath, animations: "disabled" });
      await testInfo.attach(`agent-worker-${width}-${theme}`, {
        path: workerPath,
        contentType: "image/png",
      });
      const budgetPath = testInfo.outputPath(`agent-budget-${width}-${theme}.png`);
      await budget.screenshot({ path: budgetPath, animations: "disabled" });
      await testInfo.attach(`agent-budget-${width}-${theme}`, {
        path: budgetPath,
        contentType: "image/png",
      });
      const maintenancePath = testInfo.outputPath(`agent-maintenance-${width}-${theme}.png`);
      await maintenance.screenshot({ path: maintenancePath, animations: "disabled" });
      await testInfo.attach(`agent-maintenance-${width}-${theme}`, {
        path: maintenancePath,
        contentType: "image/png",
      });
      const path = testInfo.outputPath(`agent-health-${width}-${theme}.png`);
      await diagnostics.screenshot({ path, animations: "disabled" });
      await testInfo.attach(`agent-health-${width}-${theme}`, { path, contentType: "image/png" });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Refresh", exact: true }).click();
  await expect(generated).not.toHaveAttribute("datetime", timestamp!);
  await expect(workers.locator("time")).not.toHaveAttribute("datetime", workerTimestamp!);
  await expect(backlog.locator("time")).not.toHaveAttribute("datetime", backlogTimestamp!);
  await expect(budget.locator("time")).not.toHaveAttribute("datetime", budgetTimestamp!);
  await expect(diagnostics.locator("details")).not.toHaveAttribute("open", "");
});
