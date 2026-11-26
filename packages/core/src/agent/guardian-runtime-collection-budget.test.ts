import { afterEach, expect, it, vi } from "vitest";
import { CollectionTimeout, collectionBudget } from "./guardian-runtime-collection-budget.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("stops nested collection work when the integer timer expires before the monotonic deadline", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const clock = vi.spyOn(performance, "now").mockReturnValue(0.25);
  const budget = collectionBudget();
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lookup = vi.fn();
  clock.mockReturnValue(0.75);
  const nested = budget.wait(() => released.then(() => budget.wait(lookup)));
  const timedOut = expect(nested).rejects.toMatchObject({
    code: "GUARDIAN_RUNTIME_SOURCE_TIMEOUT",
    statusCode: 503,
  });

  // The 4999 ms timer fires while the absolute deadline (5000.25) is still ahead.
  clock.mockReturnValue(4999.75);
  await vi.advanceTimersByTimeAsync(4999);
  await timedOut;
  expect(() => budget.checkpoint()).toThrow(CollectionTimeout);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(lookup).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
