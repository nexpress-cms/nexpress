import { test, type Page } from "@playwright/test";

const observing = new WeakSet<Page>();

/** Opt-in local observation only; ordinary CI never waits for operator input. */
export function isAgentLifecycleInteractive(): boolean {
  const enabled = process.env.NP_E2E_LIFECYCLE_INTERACTIVE === "1";
  if (enabled && process.env.CI)
    throw new Error("Interactive lifecycle observation is only available outside CI.");
  return enabled;
}

export async function agentLifecycleCheckpoint(page: Page, label: string): Promise<void> {
  if (!isAgentLifecycleInteractive()) return;
  test.setTimeout(0);
  if (!observing.has(page)) {
    observing.add(page);
    // A listener prevents Playwright's default auto-dismiss; the local operator owns the dialog.
    page.on("dialog", (dialog) => {
      process.stdout.write(`Native ${dialog.type()} dialog: respond in the headed browser.\n`);
    });
  }
  test.info().annotations.push({ type: "interactive-checkpoint", description: label });
  process.stdout.write(`Lifecycle checkpoint: ${label}. Inspect the current state, then Resume.\n`);
  await page.pause();
}
