import { describe, expect, it, vi } from "vitest";

import { configureBuiltinJobContext, registerBuiltinHandlers } from "./builtin-handlers.js";
import { getJobHandler } from "./handlers.js";

describe("built-in media job contract", () => {
  it("validates the exact payload before dispatching the configured processor", async () => {
    const processImage = vi.fn<(_: unknown) => Promise<void>>().mockResolvedValue(undefined);
    configureBuiltinJobContext({ processImage });
    registerBuiltinHandlers();
    const handler = getJobHandler("media:processImage");
    expect(handler).toBeDefined();

    const payload = { mediaId: "bd134b0f-b9ea-4ff4-81ef-606e42e27703" };
    await handler?.(payload);
    expect(processImage).toHaveBeenCalledWith(payload);

    await expect(handler?.({ ...payload, extra: true })).rejects.toThrow(
      "Invalid media:processImage job payload",
    );
    await expect(handler?.({ mediaId: "not-a-uuid" })).rejects.toThrow(
      "Invalid media:processImage job payload",
    );
    expect(processImage).toHaveBeenCalledTimes(1);
  });
});
