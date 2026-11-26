import { afterEach, expect, it, vi } from "vitest";
import { npAwaitAgentGuardianHostReadV1 } from "./guardian-host-read.js";

afterEach(() => vi.useRealTimers());
it("releases a stalled pure host lookup and discards its late result", async () => {
  vi.useFakeTimers();
  let release: ((value: string) => void) | undefined;
  const lookup = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const continuation = vi.fn();
  const pending = npAwaitAgentGuardianHostReadV1(lookup).then(continuation);
  const assertion = expect(pending).rejects.toMatchObject({
    code: "GUARDIAN_SOURCE_READ_TIMEOUT",
    statusCode: 503,
  });
  await vi.advanceTimersByTimeAsync(500);
  await assertion;
  release?.("late-private-key-marker");
  await vi.advanceTimersByTimeAsync(1000);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(continuation).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("preserves immediate results and errors without retaining a timeout", async () => {
  vi.useFakeTimers();
  await expect(npAwaitAgentGuardianHostReadV1(() => new Uint8Array([7]))).resolves.toEqual(
    new Uint8Array([7]),
  );
  const error = new Error("private-local-key-lookup");
  await expect(
    npAwaitAgentGuardianHostReadV1(() => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(vi.getTimerCount()).toBe(0);
});
