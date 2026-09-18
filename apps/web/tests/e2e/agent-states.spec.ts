import { expect, test } from "@playwright/test";
import { signInAsE2EAdmin } from "./fixtures/auth-helpers.js";
import { agent, catalog } from "./fixtures/runtime-studio.js";

test("Studio refresh retains marked evidence then clears failed or invalid responses", async ({
  page,
}) => {
  let release = () => {};
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let status = 200;
  let malformed = false;
  let reads = 0;
  await page.route("**/api/admin/agents/overview", async (route) => {
    reads++;
    await gate;
    if (status !== 200)
      return route.fulfill({
        status,
        json: { error: { code: "HTTP_ERROR", message: "Safe failure" }, status },
      });
    if (malformed) return route.fulfill({ json: { privateExtra: "PRIVATE_UNVALIDATED_VALUE" } });
    return route.fulfill({ response: await route.fetch() });
  });
  await signInAsE2EAdmin(page);
  await page.goto("/admin/agents/connections");
  await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Loading");
  release();
  const empty = page.getByText("No provider connections for this site.", { exact: true });
  await expect(empty).toBeVisible();
  await expect(page.getByText("Last received", { exact: false })).toBeVisible();
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Refreshing" })).toBeVisible();
  await expect(empty).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await page.clock.install();
  for (const failure of [403, 404, 429, 502, "contract"] as const) {
    status = failure === "contract" ? 200 : failure;
    malformed = failure === "contract";
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(empty).toHaveCount(0);
    await expect(page.getByText("PRIVATE_UNVALIDATED_VALUE")).toHaveCount(0);
    const stopped = reads;
    await page.clock.fastForward(60_000);
    expect(reads).toBe(stopped);
    status = 200;
    malformed = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(empty).toBeVisible();
  }
});

test("Runtime shared read states preserve bounded large lists and fail closed", async ({
  page,
}, testInfo) => {
  let phase: "populated" | "empty" | "forbidden" | "contract" = "populated";
  let release = () => {};
  let gate = Promise.resolve();
  const name = "긴 운영 이름과 검토가 필요한 지역화 데이터 ".repeat(3);
  const items = Array.from({ length: 50 }, (_, i) => ({
    ...agent,
    id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
    definition: { ...agent.definition, name: `${name}${i}` },
  }));
  await page.route("**/api/admin/agents/capabilities", (route) => route.fulfill({ json: catalog }));
  await page.route("**/api/admin/agents/configurations*", async (route) => {
    await gate;
    if (phase === "forbidden")
      return route.fulfill({
        status: 403,
        json: { error: { code: "FORBIDDEN", message: "Not allowed" }, status: 403 },
      });
    if (phase === "contract")
      return route.fulfill({ json: { items, secret: "UNVALIDATED_RUNTIME_VALUE" } });
    return route.fulfill({
      json: {
        schemaVersion: "np.agent-configurations-page.v1",
        items: phase === "empty" ? [] : items,
        nextCursor: null,
      },
    });
  });
  await signInAsE2EAdmin(page);
  await page.goto("/admin/agents/configurations");
  const cards = page.getByRole("link", { name: new RegExp("긴 운영 이름") });
  await expect(cards).toHaveCount(50);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await cards.first().click({ trial: true });
      await cards.last().click({ trial: true });
      const screenshot = testInfo.outputPath(`runtime-list-${width}-${colorScheme}.png`);
      await page.screenshot({ path: screenshot, animations: "disabled" });
      await testInfo.attach(`runtime-list-${width}-${colorScheme}`, {
        path: screenshot,
        contentType: "image/png",
      });
    }
  }
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Refreshing" })).toBeVisible();
  await expect(cards).toHaveCount(50);
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  for (const next of ["contract", "empty", "forbidden"] as const) {
    phase = next;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    if (next === "empty")
      await expect(page.getByText("No Agents match this view.", { exact: false })).toBeVisible();
    else await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(cards).toHaveCount(0);
    await expect(page.getByText("UNVALIDATED_RUNTIME_VALUE")).toHaveCount(0);
  }
});
