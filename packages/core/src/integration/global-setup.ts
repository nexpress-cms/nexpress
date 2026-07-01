import { prepareTemplateDatabase } from "./setup.js";

/**
 * Vitest globalSetup hook for the core integration suite. Mirror of
 * apps/web/tests/global-setup.ts — see that file for the wider parallel-
 * tests rationale and run-namespaced template DB lifecycle. Lives next to
 * the consumers so vitest can resolve relative paths from
 * `vitest.integration.config.ts` without leaning on package exports (the
 * file isn't part of the public surface).
 */
export default async function () {
  const teardown = await prepareTemplateDatabase();
  return teardown;
}
