import { describe, expect, it, vi } from "vitest";

import { configureBuiltinJobContext, registerBuiltinHandlers } from "./builtin-handlers.js";
import { getJobHandler } from "./handlers.js";
import { resetPlugins } from "../plugins/index.js";

describe("built-in media job contract", () => {
  it("rejects malformed built-in context registration", () => {
    expect(() => configureBuiltinJobContext({ typo: vi.fn() } as never)).toThrow(
      'Unsupported built-in job context key "typo"',
    );
    expect(() => configureBuiltinJobContext({ processImage: "not-a-function" } as never)).toThrow(
      'Built-in job context "processImage" must be a function or undefined',
    );
  });

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
      "job.data(media:processImage)",
    );
    await expect(handler?.({ mediaId: "not-a-uuid" })).rejects.toThrow(
      "job.data(media:processImage).mediaId",
    );
    expect(processImage).toHaveBeenCalledTimes(1);
  });

  it("fails unknown plugin schedule jobs when no legacy dispatcher exists", async () => {
    resetPlugins();
    configureBuiltinJobContext({ runScheduledPluginTask: undefined });
    registerBuiltinHandlers();

    await expect(
      getJobHandler("plugin:scheduledTask")?.({ pluginId: "missing", taskId: "daily" }),
    ).rejects.toThrow('Plugin "missing" is not registered');
  });
});
