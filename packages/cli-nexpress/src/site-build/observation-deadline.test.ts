import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSiteBuildObservationActiveV1,
  createSiteBuildObservationDeadlineV1,
} from "./observation-deadline.js";

afterEach(() => vi.useRealTimers());
describe("trusted observation total deadline", () => {
  it.each([900_000, 3_600_000])(
    "keeps one monotonic %i ms budget and aborts exactly at expiry",
    async (budget) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      const deadline = createSiteBuildObservationDeadlineV1(budget);
      try {
        await vi.advanceTimersByTimeAsync(budget - 1);
        expect(deadline.remainingMs()).toBe(1);
        deadline.assertActive();
        await vi.advanceTimersByTimeAsync(1);
        expect(deadline.signal.aborted).toBe(true);
        expect(deadline.remainingMs()).toBe(0);
        expect(() => deadline.assertActive()).toThrow();
      } finally {
        deadline.dispose();
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("propagates parent cancellation, disposes listeners/timers and closes overrun gaps", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const parent = new AbortController();
    parent.abort("private error never exposed");
    const deadline = createSiteBuildObservationDeadlineV1(1_000, parent.signal);
    expect(() => deadline.assertActive()).toThrow("unavailable");
    deadline.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => assertSiteBuildObservationActiveV1({ remainingMs: () => 0 })).toThrow();
    for (const value of [0, -1, 3_600_001, NaN, 1.5])
      expect(() => createSiteBuildObservationDeadlineV1(value)).toThrow();
  });
});
