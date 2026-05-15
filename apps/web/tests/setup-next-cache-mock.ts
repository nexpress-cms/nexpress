import { vi } from "vitest";

/**
 * Stub `next/cache` for integration tests.
 *
 * Several route handlers (sites admin, theme settings, plugin config,
 * setup wizard, active theme) call `revalidateTag` / `revalidatePath`
 * after a successful write so the public site picks up the change
 * within milliseconds rather than after the 600s cache TTL. In
 * production those helpers run inside Next's request context and
 * succeed; under vitest we invoke the handlers directly and there's
 * no request context to attach to, so the real implementations throw:
 *
 *     Error: Invariant: static generation store missing in
 *     revalidateTag np:site:patch-target
 *
 * The cache bust is a real side-effect that the test isn't trying to
 * exercise — it's covered separately by the cached-theme / cached-site
 * helpers' own tests. Replace the module with no-op stubs so the
 * route's success path returns 200 instead of crashing into the
 * generic 500.
 *
 * Mock lives in setupFiles so it applies process-wide; the
 * registration is hoisted by vitest's transformer before any route
 * module that imports `next/cache` loads.
 */
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T): T => fn,
  unstable_noStore: vi.fn(),
}));
