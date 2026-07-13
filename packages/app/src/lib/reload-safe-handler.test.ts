import { describe, expect, it, vi } from "vitest";

import { npGetReloadSafeHandler } from "./reload-safe-handler";

describe("npGetReloadSafeHandler", () => {
  it("preserves handler identity while dispatching to the latest implementation", async () => {
    const firstImplementation = vi.fn<(payload: { value: string }) => Promise<void>>();
    const secondImplementation = vi.fn<(payload: { value: string }) => Promise<void>>();
    firstImplementation.mockResolvedValue(undefined);
    secondImplementation.mockResolvedValue(undefined);

    const first = npGetReloadSafeHandler("np.test.reload-safe-handler", firstImplementation);
    await first({ value: "before" });

    const second = npGetReloadSafeHandler("np.test.reload-safe-handler", secondImplementation);
    await first({ value: "after" });

    expect(second).toBe(first);
    expect(firstImplementation).toHaveBeenCalledOnce();
    expect(firstImplementation).toHaveBeenCalledWith({ value: "before" });
    expect(secondImplementation).toHaveBeenCalledOnce();
    expect(secondImplementation).toHaveBeenCalledWith({ value: "after" });
  });

  it("rejects non-canonical ownership keys", () => {
    expect(() => npGetReloadSafeHandler("wordpress-import", () => Promise.resolve())).toThrow(
      "canonical np dot-segment syntax",
    );
  });
});
